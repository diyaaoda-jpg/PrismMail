import { ImapFlow } from 'imapflow';
import { decryptAccountSettingsWithPassword } from './crypto';
import { IStorage } from './storage';
import { InsertMailMessage } from '../shared/schema';

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
  } else if (node.type === 'text' && node.part) {
    // Text part - try to download content
    try {
      const { content } = await client.download(uid, node.part, { uid: true });
      const buffer = await streamToBuffer(content);
      const text = decodeBody(buffer, node.encoding, node.parameters?.charset);
      
      if (node.subtype === 'plain' && !result.bodyText) {
        result.bodyText = text.substring(0, 10000);
        console.log(`Downloaded text/plain part ${node.part} for UID ${uid}: ${text.length} chars`);
      } else if (node.subtype === 'html' && !result.bodyHtml) {
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
        // TODO: Implement EWS sync
        console.log('EWS sync not yet implemented');
        results.push({
          accountId: account.id,
          result: {
            success: false,
            error: 'EWS sync not yet implemented',
            lastSync: new Date(),
          }
        });
      }
    }
    
    return results;
    
  } catch (error) {
    console.error('Error syncing user accounts:', error);
    return [];
  }
}