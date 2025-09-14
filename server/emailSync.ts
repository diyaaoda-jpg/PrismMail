import { ImapFlow } from 'imapflow';
import { decryptAccountSettingsWithPassword } from './crypto';
import { IStorage } from './storage';
import { InsertMailMessage, InsertAccountFolder } from '../shared/schema';

export interface SyncResult {
  success: boolean;
  messageCount?: number;
  error?: string;
  lastSync: Date;
}

export interface EmailSyncOptions {
  folder?: string;
  limit?: number;
  since?: Date;
}

export interface AppendEmailOptions {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  attachments?: Array<{
    filename: string;
    content: string; // Base64 encoded
    contentType: string;
  }>;
  from: string;
  messageId?: string;
}

/**
 * Check if message already exists in database
 */
async function messageExists(
  storage: IStorage, 
  accountId: string, 
  folder: string, 
  messageId: string
): Promise<boolean> {
  // Get a reasonable number of recent messages to check against
  const existingMessages = await storage.getMailMessages(accountId, folder, 1000, 0);
  console.log(`Checking if message ${messageId} exists in ${folder}: found ${existingMessages.length} existing messages`);
  const exists = existingMessages.some(msg => msg.messageId === messageId);
  console.log(`Message ${messageId} exists: ${exists}`);
  return exists;
}

/**
 * Convert readable stream to buffer
 */
async function streamToBuffer(readable: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    readable.on('data', (chunk: Buffer) => chunks.push(chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

/**
 * Decode email body based on encoding
 */
function decodeBody(buffer: Buffer, encoding?: string, charset?: string): string {
  let decoded = buffer;
  
  // Handle common encodings
  if (encoding === 'base64') {
    try {
      decoded = Buffer.from(buffer.toString(), 'base64');
    } catch (e) {
      console.log('Failed to decode base64:', e);
    }
  } else if (encoding === 'quoted-printable') {
    try {
      // Simple quoted-printable decoder
      let str = buffer.toString();
      str = str.replace(/=([0-9A-F]{2})/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
      str = str.replace(/=\r?\n/g, '');
      decoded = Buffer.from(str, 'binary');
    } catch (e) {
      console.log('Failed to decode quoted-printable:', e);
    }
  }
  
  // Convert to string with proper charset
  const charsetEncoding = (charset && Buffer.isEncoding(charset)) ? charset : 'utf8';
  return decoded.toString(charsetEncoding as BufferEncoding);
}

/**
 * Recursively visit body structure to find text parts
 */
async function visitBodyStructure(
  client: ImapFlow,
  uid: number,
  node: any,
  result: { bodyText: string; bodyHtml: string }
): Promise<void> {
  if (!node) return;
  
  if (node.childNodes && Array.isArray(node.childNodes)) {
    // Multipart - visit all children
    for (const child of node.childNodes) {
      await visitBodyStructure(client, uid, child, result);
    }
  } else if (node.type && node.part) {
    // Text part - try to download content
    try {
      const { content } = await client.download(uid, node.part, { uid: true });
      const buffer = await streamToBuffer(content);
      const text = decodeBody(buffer, node.encoding, node.parameters?.charset);
      
      if (node.type === 'text/plain' && !result.bodyText) {
        result.bodyText = text.substring(0, 10000);
        console.log(`Downloaded text/plain part ${node.part} for UID ${uid}: ${text.length} chars`);
      } else if (node.type === 'text/html' && !result.bodyHtml) {
        result.bodyHtml = text.substring(0, 20000);
        console.log(`Downloaded text/html part ${node.part} for UID ${uid}: ${text.length} chars`);
      }
    } catch (e) {
      console.error(`Failed to download part ${node.part} for UID ${uid}:`, e);
    }
  }
}

/**
 * Extract text content from IMAP message
 */
async function extractMessageContent(
  client: ImapFlow, 
  uid: number, 
  bodyStructure: any
): Promise<{ bodyText: string; bodyHtml: string }> {
  const result = { bodyText: '', bodyHtml: '' };

  try {
    await visitBodyStructure(client, uid, bodyStructure, result);
    
    // Fallback: if we have text but no HTML, create simple HTML
    if (result.bodyText && !result.bodyHtml) {
      result.bodyHtml = `<pre>${result.bodyText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
    }
    
    // Log if we couldn't find any content
    if (!result.bodyText && !result.bodyHtml) {
      console.warn(`No text content found for UID ${uid}, bodyStructure:`, JSON.stringify(bodyStructure, null, 2));
    }
    
  } catch (error) {
    console.error(`Error extracting message content for UID ${uid}:`, error);
  }

  return result;
}

/**
 * Check if message has attachments based on bodyStructure
 */
function hasAttachments(bodyStructure: any): boolean {
  if (!bodyStructure.childNodes) {
    return false;
  }

  for (const part of bodyStructure.childNodes) {
    if (part.disposition === 'attachment') {
      return true;
    }
    if (part.childNodes && hasAttachments(part)) {
      return true;
    }
  }

  return false;
}

/**
 * Map IMAP SPECIAL-USE flags to standardized folder types
 */
function mapImapFolderType(flags: string[]): string {
  if (flags.includes('\\Inbox')) return 'inbox';
  if (flags.includes('\\Sent')) return 'sent';
  if (flags.includes('\\Drafts')) return 'drafts';
  if (flags.includes('\\Trash')) return 'deleted';
  if (flags.includes('\\Archive')) return 'archive';
  if (flags.includes('\\Junk')) return 'spam';
  return 'custom';
}

/**
 * Discover and synchronize IMAP folders to database
 * @param accountId - The account connection ID
 * @param settingsJson - Encrypted settings JSON from database
 * @param storage - Storage instance for database operations
 * @returns Success status and folder count
 */
export async function discoverImapFolders(
  accountId: string,
  settingsJson: string,
  storage: IStorage
): Promise<{ success: boolean; folderCount: number; error?: string }> {
  let client: ImapFlow | undefined;
  
  try {
    const settings = decryptAccountSettingsWithPassword(settingsJson);
    
    client = new ImapFlow({
      host: settings.host,
      port: settings.port,
      secure: settings.useSSL,
      auth: {
        user: settings.username,
        pass: settings.password,
      },
      socketTimeout: 30000,
      greetingTimeout: 30000,
    });

    console.log(`Discovering IMAP folders for account ${accountId}`);
    
    // Connect to IMAP server
    await client.connect();
    
    // List all folders with their attributes
    const folders = await client.list();
    
    let folderCount = 0;
    
    for (const folder of folders) {
      try {
        // Skip non-selectable folders
        if (folder.flags && Array.from(folder.flags).includes('\\Noselect')) {
          continue;
        }
        
        // Map folder type using SPECIAL-USE flags
        const folderType = mapImapFolderType(Array.from(folder.flags || [])) as "inbox" | "sent" | "drafts" | "deleted" | "archive" | "spam" | "custom";
        
        // Create folder object
        const folderData: InsertAccountFolder = {
          accountId,
          folderId: folder.path,
          folderType,
          displayName: folder.name || folder.path,
          unreadCount: 0,
          totalCount: 0,
          isActive: true,
          lastSynced: null,
        };
        
        // Upsert folder to database
        await storage.upsertAccountFolder(folderData);
        folderCount++;
        
        console.log(`Discovered IMAP folder: ${folder.path} (${folderType})`);
        
      } catch (error) {
        console.error(`Error processing folder ${folder.path}:`, error);
      }
    }
    
    console.log(`IMAP folder discovery completed: ${folderCount} folders found`);
    
    return { success: true, folderCount };
    
  } catch (error: any) {
    console.error('IMAP folder discovery failed:', error);
    
    return {
      success: false,
      folderCount: 0,
      error: error.message || 'IMAP folder discovery failed'
    };
  } finally {
    if (client) {
      try {
        await client.logout();
        console.log('IMAP client disconnected cleanly');
      } catch (error) {
        console.error('Error disconnecting IMAP client:', error);
      }
    }
  }
}

/**
 * Append a sent email to the Sent folder via IMAP APPEND command
 * @param accountId - The account connection ID
 * @param settingsJson - Encrypted settings JSON from database
 * @param emailOptions - Email content and metadata
 * @returns Success status and any error messages
 */
export async function appendSentEmailToFolder(
  accountId: string,
  settingsJson: string,
  emailOptions: AppendEmailOptions
): Promise<{ success: boolean; error?: string }> {
  let client: ImapFlow | undefined;

  try {
    const settings = decryptAccountSettingsWithPassword(settingsJson);

    client = new ImapFlow({
      host: settings.host,
      port: settings.port,
      secure: settings.useSSL,
      auth: {
        user: settings.username,
        pass: settings.password,
      },
      socketTimeout: 30000,
      greetingTimeout: 30000,
    });

    console.log(`Appending sent email to Sent folder for account ${accountId}`);

    // Connect to IMAP server
    await client.connect();

    // Construct the email message in RFC2822 format for APPEND
    const { to, cc, bcc, subject, bodyText, bodyHtml, attachments, from, messageId } = emailOptions;
    
    // Build email headers
    const headers: string[] = [
      `Message-ID: ${messageId || `<${Date.now()}.${Math.random()}@prismmail>`}`,
      `Date: ${new Date().toUTCString()}`,
      `From: ${from}`,
      `To: ${to}`,
    ];

    if (cc) headers.push(`Cc: ${cc}`);
    if (bcc) headers.push(`Bcc: ${bcc}`);
    
    headers.push(`Subject: ${subject}`);
    headers.push('MIME-Version: 1.0');

    // Determine content type based on whether we have HTML
    const boundary = `boundary-${Date.now()}-${Math.random()}`;
    let emailContent = headers.join('\r\n');

    if (bodyHtml && bodyHtml !== bodyText.replace(/\n/g, '<br>')) {
      // Multipart message with both text and HTML
      emailContent += `\r\nContent-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`;
      
      // Plain text part
      emailContent += `--${boundary}\r\n`;
      emailContent += 'Content-Type: text/plain; charset=utf-8\r\n';
      emailContent += 'Content-Transfer-Encoding: 8bit\r\n\r\n';
      emailContent += bodyText + '\r\n\r\n';
      
      // HTML part
      emailContent += `--${boundary}\r\n`;
      emailContent += 'Content-Type: text/html; charset=utf-8\r\n';
      emailContent += 'Content-Transfer-Encoding: 8bit\r\n\r\n';
      emailContent += bodyHtml + '\r\n\r\n';
      
      emailContent += `--${boundary}--\r\n`;
    } else {
      // Simple text message
      emailContent += '\r\nContent-Type: text/plain; charset=utf-8\r\n';
      emailContent += 'Content-Transfer-Encoding: 8bit\r\n\r\n';
      emailContent += bodyText + '\r\n';
    }

    // Try to find the Sent folder - common names
    const sentFolderNames = ['Sent', 'SENT', 'Sent Messages', 'Sent Items', 'Outbox'];
    let sentFolder: string | null = null;

    // List folders to find the correct Sent folder
    const folders = await client.list();
    for (const folder of folders) {
      // Check for SPECIAL-USE flags first
      if (folder.flags && Array.from(folder.flags).includes('\\Sent')) {
        sentFolder = folder.path;
        break;
      }
      // Fall back to checking common folder names
      if (sentFolderNames.some(name => 
        folder.path.toLowerCase() === name.toLowerCase() || 
        folder.name?.toLowerCase() === name.toLowerCase()
      )) {
        sentFolder = folder.path;
        break;
      }
    }

    if (!sentFolder) {
      console.warn('Sent folder not found, defaulting to "Sent"');
      sentFolder = 'Sent';
    }

    console.log(`Using Sent folder: ${sentFolder}`);

    // Append the email to the Sent folder with the \Seen flag (since it's a sent message)
    await client.append(sentFolder, emailContent, ['\\Seen']);

    console.log(`Successfully appended sent email to ${sentFolder}`);

    return { success: true };

  } catch (error: any) {
    console.error('Failed to append sent email to folder:', error);
    return {
      success: false,
      error: error.message || 'Failed to append sent email to Sent folder'
    };
  } finally {
    if (client) {
      try {
        await client.logout();
        console.log('IMAP client disconnected cleanly');
      } catch (error) {
        console.error('Error disconnecting IMAP client:', error);
      }
    }
  }
}

/**
 * Synchronize emails from an IMAP account to the database
 * @param accountId - The account connection ID
 * @param settingsJson - Encrypted settings JSON from database
 * @param storage - Storage instance for database operations
 * @param options - Sync options (folder, limit, etc.)
 * @returns Sync result with success status and message count
 */
export async function syncImapEmails(
  accountId: string,
  settingsJson: string,
  storage: IStorage,
  options: EmailSyncOptions = {}
): Promise<SyncResult> {
  let client: ImapFlow | undefined;
  
  try {
    const settings = decryptAccountSettingsWithPassword(settingsJson);
    const { folder = 'INBOX', limit = 50, since } = options;
    
    client = new ImapFlow({
      host: settings.host,
      port: settings.port,
      secure: settings.useSSL,
      auth: {
        user: settings.username,
        pass: settings.password,
      },
      socketTimeout: 30000,
      greetingTimeout: 30000,
    });

    console.log(`Starting IMAP sync for account ${accountId}, folder: ${folder}`);
    
    // Connect to IMAP server
    await client.connect();
    
    // Select the folder
    const mailbox = await client.getMailboxLock(folder);
    
    try {
      // Build search criteria
      let searchCriteria: any = { all: true };
      if (since) {
        searchCriteria = { since };
      }
      
      // Fetch message UIDs
      const messageUids = await client.search(searchCriteria, { uid: true });
      
      if (!messageUids || !Array.isArray(messageUids) || messageUids.length === 0) {
        console.log('No messages found in folder');
        return {
          success: true,
          messageCount: 0,
          lastSync: new Date(),
        };
      }
      
      // Limit the number of messages to sync (get most recent)
      const uidsToSync = messageUids.slice(-limit);
      
      console.log(`Found ${messageUids.length} messages, syncing ${uidsToSync.length}`);
      
      let syncedCount = 0;
      
      // Process messages in batches
      for (const uid of uidsToSync) {
        try {
          // Check if message already exists
          const messageId = uid.toString();
          
          if (await messageExists(storage, accountId, folder, messageId)) {
            console.log(`Message ${uid} already exists, skipping`);
            continue;
          }
          
          // Fetch message details
          const message = await client.fetchOne(uid, {
            uid: true,
            flags: true,
            envelope: true,
            bodyStructure: true,
            size: true,
          }, { uid: true });
          
          if (!message) {
            console.log(`Could not fetch message ${uid}`);
            continue;
          }
          
          // Extract email content
          const { bodyText, bodyHtml } = await extractMessageContent(
            client, 
            uid, 
            message.bodyStructure
          );
          
          // Parse email data
          const emailData: InsertMailMessage = {
            accountId,
            folder,
            messageId,
            threadId: message.envelope?.messageId || messageId,
            subject: message.envelope?.subject || '(No Subject)',
            from: message.envelope?.from?.[0]?.address || 'unknown@unknown.com',
            to: message.envelope?.to?.map((addr: any) => addr.address).join(', ') || '',
            date: message.envelope?.date || new Date(),
            size: message.size || 0,
            hasAttachments: hasAttachments(message.bodyStructure),
            isRead: message.flags?.has('\\Seen') || false,
            isFlagged: message.flags?.has('\\Flagged') || false,
            priority: 0, // Will be assigned by priority rules later
            snippet: (bodyText || bodyHtml.replace(/<[^>]*>/g, '')).substring(0, 200).replace(/\s+/g, ' ').trim(),
            bodyHtml,
            bodyText,
          };
          
          // Store in database
          await storage.createMailMessage(emailData);
          syncedCount++;
          
          console.log(`Synced message: ${emailData.subject} from ${emailData.from}`);
          
        } catch (messageError) {
          console.error(`Error processing message ${uid}:`, messageError);
          // Continue with next message
        }
      }
      
      // Update folder counts after sync
      try {
        // Count total and unread messages in this folder
        const allMessages = await storage.getMailMessages(accountId, folder);
        const totalCount = allMessages.length;
        const unreadCount = allMessages.filter(msg => !msg.isRead).length;
        
        // Update folder counts
        await storage.updateFolderCounts(accountId, folder, unreadCount, totalCount);
        console.log(`Updated folder counts for ${folder}: ${unreadCount} unread, ${totalCount} total`);
      } catch (countError) {
        console.error(`Error updating folder counts for ${folder}:`, countError);
        // Don't fail the sync if folder count update fails
      }

      return {
        success: true,
        messageCount: syncedCount,
        lastSync: new Date(),
      };
      
    } finally {
      // Always release the mailbox lock
      mailbox.release();
    }
    
  } catch (error: any) {
    console.error('IMAP sync failed:', error);
    
    let errorMessage = 'Sync failed';
    if (error.message) {
      if (error.message.includes('ENOTFOUND')) {
        errorMessage = 'Server not found - check host address';
      } else if (error.message.includes('ECONNREFUSED')) {
        errorMessage = 'Connection refused - check port and SSL settings';
      } else if (error.message.includes('Invalid credentials')) {
        errorMessage = 'Invalid username or password';
      } else if (error.message.includes('timeout')) {
        errorMessage = 'Connection timeout - server may be unreachable';
      } else {
        errorMessage = error.message.substring(0, 200);
      }
    }
    
    return {
      success: false,
      error: errorMessage,
      lastSync: new Date(),
    };
  } finally {
    // Always cleanup IMAP connection
    if (client) {
      try {
        await client.logout();
        console.log('IMAP client disconnected cleanly');
      } catch (logoutError) {
        console.error('Error during IMAP logout:', logoutError);
      }
    }
  }
}

/**
 * Sync emails for all active accounts belonging to a user
 * @param userId - The user ID
 * @param storage - Storage instance
 * @returns Array of sync results for each account
 */
export async function syncAllUserAccounts(
  userId: string,
  storage: IStorage
): Promise<{ accountId: string; result: SyncResult }[]> {
  try {
    // Get all active accounts for the user
    const accounts = await storage.getUserAccountConnections(userId);
    const activeAccounts = accounts.filter((account: any) => account.isActive);
    
    console.log(`Syncing ${activeAccounts.length} active accounts for user ${userId}`);
    
    const results: { accountId: string; result: SyncResult }[] = [];
    
    // Process accounts sequentially to avoid overwhelming the servers
    for (const account of activeAccounts) {
      console.log(`Syncing account: ${account.name} (${account.protocol})`);
      
      if (account.protocol === 'IMAP') {
        // Get encrypted settings for this account
        const encryptedAccount = await storage.getAccountConnectionEncrypted(account.id);
        if (encryptedAccount) {
          const result = await syncImapEmails(
            account.id,
            encryptedAccount.settingsJson,
            storage,
            { folder: 'INBOX', limit: 25 } // Start with inbox, 25 recent messages
          );
          
          results.push({ accountId: account.id, result });
          
          // Update account sync status
          if (!result.success && result.error) {
            await storage.updateAccountConnection(account.id, { 
              lastError: result.error,
              lastChecked: result.lastSync
            });
          } else {
            await storage.updateAccountConnection(account.id, { 
              lastError: null,
              lastChecked: result.lastSync
            });
          }
        }
      } else if (account.protocol === 'EWS') {
        // Get encrypted settings for this account
        const encryptedAccount = await storage.getAccountConnectionEncrypted(account.id);
        if (encryptedAccount) {
          const { syncEwsEmails } = await import('./ewsSync.js');
          const result = await syncEwsEmails(
            storage,
            account.id,
            'INBOX', // Start with inbox
            25 // 25 recent messages
          );
          
          results.push({ 
            accountId: account.id, 
            result: {
              success: result.success,
              error: result.error,
              lastSync: result.lastSync,
              messageCount: result.messageCount
            }
          });
          
          // Update account sync status
          if (!result.success && result.error) {
            await storage.updateAccountConnection(account.id, { 
              lastError: result.error,
              lastChecked: result.lastSync
            });
          } else {
            await storage.updateAccountConnection(account.id, { 
              lastError: null,
              lastChecked: result.lastSync
            });
          }
        }
      }
    }
    
    return results;
    
  } catch (error) {
    console.error('Error syncing user accounts:', error);
    return [];
  }
}