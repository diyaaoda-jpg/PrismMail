import { IStorage } from './storage';
import { decryptAccountSettingsWithPassword } from './crypto';
import { InsertAccountFolder } from '../shared/schema';
import { AttachmentService } from './services/attachmentService';
import { generateThreadId } from './threadUtils';
import path from 'path';
import fs from 'fs';

export interface EwsSyncResult {
  success: boolean;
  messageCount: number;
  error?: string;
}

/**
 * Normalize EWS URL to canonical Exchange endpoint format
 */
function normalizeEwsUrl(hostUrl: string): string {
  let url: URL;
  try {
    // If no scheme, prepend https://
    if (!hostUrl.startsWith('http')) {
      hostUrl = 'https://' + hostUrl;
    }
    url = new URL(hostUrl);
  } catch {
    throw new Error('Invalid EWS server name format');
  }
  
  // Always use the canonical Exchange EWS endpoint (force HTTPS)
  return url.origin + '/EWS/Exchange.asmx';
}

/**
 * Map EWS WellKnownFolderName to standardized folder types
 */
function mapEwsFolderType(folderName: string): string {
  switch (folderName.toLowerCase()) {
    case 'inbox':
      return 'inbox';
    case 'sentitems':
    case 'sent':
      return 'sent';
    case 'drafts':
      return 'drafts';
    case 'deleteditems':
    case 'deleted':
      return 'deleted';
    case 'archive':
      return 'archive';
    case 'junkemail':
    case 'spam':
      return 'spam';
    default:
      return 'custom';
  }
}

/**
 * Map folder type to EWS WellKnownFolderName
 */
function getEwsWellKnownFolderName(folderType: string, WellKnownFolderName: any): any {
  switch (folderType.toLowerCase()) {
    case 'inbox':
      return WellKnownFolderName.Inbox;
    case 'sent':
    case 'sentitems':
      return WellKnownFolderName.SentItems;
    case 'drafts':
      return WellKnownFolderName.Drafts;
    case 'deleted':
    case 'deleteditems':
      return WellKnownFolderName.DeletedItems;
    case 'archive':
      return WellKnownFolderName.Archive;
    case 'spam':
    case 'junkemail':
      return WellKnownFolderName.JunkEmail;
    default:
      // Default to inbox for unknown folder types
      return WellKnownFolderName.Inbox;
  }
}

/**
 * Discover and synchronize EWS folders to database
 * @param accountId - The account connection ID
 * @param settingsJson - Encrypted settings JSON from database
 * @param storage - Storage instance for database operations
 * @returns Success status and folder count
 */
export async function discoverEwsFolders(
  accountId: string,
  settingsJson: string,
  storage: IStorage
): Promise<{ success: boolean; folderCount: number; error?: string }> {
  try {
    // Get encrypted account settings
    console.log('EWS folder discovery: Raw encrypted settings length:', settingsJson?.length || 0);
    console.log('EWS folder discovery: Raw encrypted settings preview:', settingsJson?.substring(0, 100) || 'empty');
    const settings = decryptAccountSettingsWithPassword(settingsJson);
    console.log('EWS folder discovery: Decrypted settings:', {
      host: settings?.host || 'undefined',
      username: settings?.username || 'undefined', 
      hasPassword: !!(settings?.password)
    });
    
    // Dynamic import to avoid require() issues
    const ewsApi = await import('ews-javascript-api');
    const { 
      ExchangeService, 
      ExchangeVersion, 
      WebCredentials, 
      Uri, 
      WellKnownFolderName, 
      Folder
    } = ewsApi;

    // Create Exchange service
    const service = new ExchangeService(ExchangeVersion.Exchange2013);
    service.Credentials = new WebCredentials(settings.username, settings.password);
    
    // Use canonical EWS URL normalization
    const ewsUrl = normalizeEwsUrl(settings.host);
    service.Url = new Uri(ewsUrl);
    
    // Enable pre-authentication for better compatibility
    service.PreAuthenticate = true;
    service.UserAgent = 'PrismMail/1.0';

    console.log(`Discovering EWS folders for account ${accountId}`);

    // Standard EWS well-known folders to discover
    const wellKnownFolders = [
      { name: 'Inbox', wellKnownName: WellKnownFolderName.Inbox },
      { name: 'SentItems', wellKnownName: WellKnownFolderName.SentItems },
      { name: 'Drafts', wellKnownName: WellKnownFolderName.Drafts },
      { name: 'DeletedItems', wellKnownName: WellKnownFolderName.DeletedItems },
      { name: 'Archive', wellKnownName: WellKnownFolderName.Archive },
      { name: 'JunkEmail', wellKnownName: WellKnownFolderName.JunkEmail },
    ];

    let folderCount = 0;

    for (const folderInfo of wellKnownFolders) {
      try {
        // Try to bind to the well-known folder
        const folder = await Folder.Bind(service, folderInfo.wellKnownName);
        
        // Map folder type
        const folderType = mapEwsFolderType(folderInfo.name) as "inbox" | "sent" | "drafts" | "deleted" | "archive" | "spam" | "custom";
        
        // Create folder object
        const folderData: InsertAccountFolder = {
          accountId,
          folderId: folder.Id.UniqueId,
          folderType,
          displayName: folder.DisplayName || folderInfo.name,
          unreadCount: folder.UnreadCount || 0,
          totalCount: folder.TotalCount || 0,
          isActive: true,
          lastSynced: null,
        };
        
        // Upsert folder to database
        await storage.upsertAccountFolder(folderData);
        folderCount++;
        
        console.log(`Discovered EWS folder: ${folder.DisplayName || folderInfo.name} (${folderType})`);
        
      } catch (error) {
        // Some folders might not exist (like Archive), so log but continue
        console.log(`EWS folder ${folderInfo.name} not available:`, (error as Error).message);
      }
    }
    
    console.log(`EWS folder discovery completed: ${folderCount} folders found`);
    
    return { success: true, folderCount };
    
  } catch (error: any) {
    console.error('EWS folder discovery failed:', error);
    
    return {
      success: false,
      folderCount: 0,
      error: error.message || 'EWS folder discovery failed'
    };
  }
}

/**
 * Synchronize emails from Exchange Web Services
 * @param storage - Storage interface
 * @param accountId - Account ID to sync
 * @param folder - Folder to sync (default: INBOX)
 * @param limit - Maximum number of messages to sync
 * @returns Sync result with message count
 */
export async function syncEwsEmails(
  storage: IStorage,
  accountId: string,
  folder: string = 'INBOX',
  limit: number = 25
): Promise<EwsSyncResult> {
  try {
    // Get encrypted account settings
    const accountData = await storage.getAccountConnectionEncrypted(accountId);
    if (!accountData) {
      throw new Error('Account not found');
    }

    // Decrypt account settings
    console.log('EWS sync: Raw encrypted settings length:', accountData.settingsJson?.length || 0);
    console.log('EWS sync: Raw encrypted settings preview:', accountData.settingsJson?.substring(0, 100) || 'empty');
    const settings = decryptAccountSettingsWithPassword(accountData.settingsJson);
    console.log('EWS sync: Decrypted settings:', {
      host: settings?.host || 'undefined',
      username: settings?.username || 'undefined',
      hasPassword: !!(settings?.password)
    });
    
    // Dynamic import to avoid require() issues
    const ewsApi = await import('ews-javascript-api');
    const { 
      ExchangeService, 
      ExchangeVersion, 
      WebCredentials, 
      Uri, 
      WellKnownFolderName, 
      ItemView, 
      PropertySet, 
      BasePropertySet,
      Folder
    } = ewsApi;

    // Create Exchange service
    const service = new ExchangeService(ExchangeVersion.Exchange2013);
    service.Credentials = new WebCredentials(settings.username, settings.password);
    
    // Use canonical EWS URL normalization
    const ewsUrl = normalizeEwsUrl(settings.host);
    service.Url = new Uri(ewsUrl);
    
    // Enable pre-authentication for better compatibility
    service.PreAuthenticate = true;
    service.UserAgent = 'PrismMail/1.0';

    try {
      // Get the correct folder based on folder parameter
      let targetFolder;
      
      if (folder === 'INBOX' || folder.toLowerCase() === 'inbox') {
        // Handle the default case and common variations
        targetFolder = await Folder.Bind(service, WellKnownFolderName.Inbox);
      } else {
        // Try to get folder from database first to determine correct folder type
        const accountFolders = await storage.getAccountFolders(accountId);
        const folderInfo = accountFolders.find(f => 
          f.folderId === folder || 
          f.folderType === folder.toLowerCase() ||
          f.displayName.toLowerCase() === folder.toLowerCase()
        );
        
        if (folderInfo) {
          // Use the folder type to get the correct WellKnownFolderName
          const wellKnownFolderName = getEwsWellKnownFolderName(folderInfo.folderType, WellKnownFolderName);
          targetFolder = await Folder.Bind(service, wellKnownFolderName);
        } else {
          // Fallback: try common folder mappings
          const wellKnownFolderName = getEwsWellKnownFolderName(folder, WellKnownFolderName);
          targetFolder = await Folder.Bind(service, wellKnownFolderName);
        }
      }
      
      // Create item view to limit results
      const itemView = new ItemView(limit);
      itemView.PropertySet = new PropertySet(BasePropertySet.FirstClassProperties);
      
      // Find emails in the target folder
      const findItemsResults = await service.FindItems(targetFolder.Id, itemView);
      const items = findItemsResults.Items;

      console.log(`Found ${items.length} emails in EWS folder: ${targetFolder.DisplayName || folder}`);

      let messageCount = 0;

      // Process each email
      for (const item of items) {
        try {
          // Check if message already exists
          const messageId = item.Id.UniqueId;
          const exists = await messageExists(storage, accountId, folder, messageId);
          
          if (exists) {
            console.log(`Message ${messageId} already exists, skipping`);
            continue;
          }

          // Load additional properties for the email
          await service.LoadPropertiesForItems([item], new PropertySet(BasePropertySet.FirstClassProperties));
          
          // Extract email addresses and subject
          const subject = item.Subject || 'No Subject';
          const fromEmail = extractSenderFromEws(item);
          const toEmails = extractToRecipientsFromEws(item);
          const ccEmails = extractCcRecipientsFromEws(item);
          const replyToEmails = extractReplyToFromEws(item);
          
          // Generate proper threadId for conversation grouping
          const threadId = generateThreadId(subject, fromEmail, toEmails, ccEmails, replyToEmails);
          
          // Extract email content and metadata - FIX: Map sender to from field for database compatibility
          const emailData = {
            accountId,
            folder,
            messageId: item.Id.UniqueId,
            threadId,
            subject,
            from: fromEmail, // Fixed: Use 'from' field to match database schema
            to: toEmails,
            cc: ccEmails,
            bcc: extractBccRecipientsFromEws(item),
            replyTo: replyToEmails, // Enhanced: Extract reply-to header
            date: item.DateTimeReceived ? new Date(item.DateTimeReceived.toString()) : new Date(),
            isRead: (item as any).IsRead || false,
            isFlagged: (item as any).Importance?.toString() === 'High' || (item as any).IsFlagged || false,
            hasAttachments: item.HasAttachments || false,
            priority: calculatePriority((item as any).Importance, (item as any).From?.Name),
            snippet: item.Preview || extractSnippetFromBody(item.Body?.Text),
            bodyHtml: (item as any).Body?.BodyType?.toString() === 'HTML' ? sanitizeHtmlContent(item.Body?.Text || '') : '',
            bodyText: (item as any).Body?.BodyType?.toString() !== 'HTML' ? item.Body?.Text || '' : htmlToPlainText(item.Body?.Text || ''),
            size: item.Size || 0
          };

          // Save to database
          const savedEmail = await storage.createMailMessage(emailData);
          
          // Process attachments if the email has them
          if (emailData.hasAttachments && item.HasAttachments) {
            try {
              console.log(`Processing attachments for EWS message: ${emailData.subject}`);
              
              // Load attachments from EWS
              const attachmentPropertySet = new PropertySet();
              attachmentPropertySet.Add(ewsApi.AttachmentSchema.Name);
              attachmentPropertySet.Add(ewsApi.AttachmentSchema.ContentType);
              attachmentPropertySet.Add(ewsApi.AttachmentSchema.Size);
              
              // Load attachment details
              await service.LoadPropertiesForItems([item], new PropertySet(BasePropertySet.FirstClassProperties));
              
              for (let i = 0; i < item.Attachments.Count; i++) {
                try {
                  const attachment = item.Attachments.__thisIndexer(i);
                  
                  // Load attachment content
                  await attachment.Load();
                  
                  let attachmentData: Buffer | null = null;
                  let fileName = attachment.Name || `attachment_${i}`;
                  let mimeType = attachment.ContentType || 'application/octet-stream';
                  
                  // Handle different attachment types
                  if ((attachment as any).Content && (attachment as any).Content.length > 0) {
                    // File attachment with binary content
                    attachmentData = Buffer.from((attachment as any).Content);
                  } else if (attachment.ToString && typeof attachment.ToString === 'function') {
                    // Text-based attachment
                    const textContent = attachment.ToString();
                    attachmentData = Buffer.from(textContent, 'utf8');
                    if (!mimeType.includes('text')) {
                      mimeType = 'text/plain';
                    }
                  }
                  
                  if (attachmentData && attachmentData.length > 0) {
                    // Save attachment using AttachmentService
                    const attachmentRecord = await AttachmentService.saveAttachment(
                      fileName,
                      attachmentData,
                      mimeType
                    );
                    
                    // Link attachment to email
                    await storage.createEmailAttachment({
                      emailId: savedEmail.id,
                      attachmentId: attachmentRecord.id
                    });
                    
                    console.log(`Saved EWS attachment: ${fileName} (${attachmentData.length} bytes)`);
                  }
                } catch (attachmentError) {
                  console.error(`Failed to process EWS attachment ${i}:`, attachmentError);
                  // Continue with other attachments
                }
              }
            } catch (error) {
              console.error(`Failed to process attachments for EWS message ${emailData.subject}:`, error);
              // Don't fail the entire sync if attachment processing fails
            }
          }
          
          messageCount++;
          console.log(`Saved EWS message: ${emailData.subject}`);
          
        } catch (error) {
          console.error(`Error processing EWS message ${item.Id?.UniqueId}:`, error);
          // Continue with next message
        }
      }

      // Update account sync status
      await storage.updateAccountConnection(accountId, {
        isActive: true,
        lastChecked: new Date(),
        lastError: null
      });

      console.log(`EWS sync completed: ${messageCount} messages synced`);
      
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
      
      return { success: true, messageCount };

    } finally {
      // EWS connection doesn't need explicit cleanup like IMAP
      console.log('EWS sync operation completed');
    }

  } catch (error: any) {
    console.error('EWS sync failed:', error);
    
    // Update account with error status
    try {
      await storage.updateAccountConnection(accountId, {
        isActive: false,
        lastChecked: new Date(),
        lastError: error.message || 'EWS sync failed'
      });
    } catch (updateError) {
      console.error('Failed to update account status:', updateError);
    }
    
    return {
      success: false,
      messageCount: 0,
      error: error.message || 'EWS synchronization failed'
    };
  }
}

/**
 * Check if a message already exists in the database
 */
async function messageExists(storage: IStorage, accountId: string, folder: string, messageId: string): Promise<boolean> {
  try {
    // Get recent messages to check against
    const existingMessages = await storage.getMailMessages(accountId, folder, 100, 0);
    return existingMessages.some(msg => msg.messageId === messageId);
  } catch (error) {
    console.error('Error checking message existence:', error);
    return false;
  }
}

/**
 * Extract sender information from EWS item
 */
function extractSenderFromEws(item: any): string {
  // EWS uses From property for sender information
  if (item.From?.Name && item.From?.Address) {
    return `${item.From.Name} <${item.From.Address}>`;
  } else if (item.From?.Address) {
    return item.From.Address;
  } else if (item.From?.Name) {
    return item.From.Name;
  }
  return 'Unknown Sender';
}

/**
 * Extract To recipients from EWS item
 */
function extractToRecipientsFromEws(item: any): string {
  const recipients: string[] = [];
  
  try {
    if (item.ToRecipients && Array.isArray(item.ToRecipients)) {
      for (const recipient of item.ToRecipients) {
        if (recipient?.Name && recipient?.Address) {
          recipients.push(`${recipient.Name} <${recipient.Address}>`);
        } else if (recipient?.Address) {
          recipients.push(recipient.Address);
        }
      }
    } else if (item.ToRecipients && typeof item.ToRecipients === 'object' && item.ToRecipients.Address) {
      if (item.ToRecipients.Name && item.ToRecipients.Address) {
        recipients.push(`${item.ToRecipients.Name} <${item.ToRecipients.Address}>`);
      } else if (item.ToRecipients.Address) {
        recipients.push(item.ToRecipients.Address);
      }
    }
  } catch (error) {
    console.warn('Error extracting To recipients from EWS item:', error);
  }
  
  return recipients.join(', ');
}

/**
 * Extract Cc recipients from EWS item
 */
function extractCcRecipientsFromEws(item: any): string {
  const recipients: string[] = [];
  
  try {
    if (item.CcRecipients && Array.isArray(item.CcRecipients)) {
      for (const recipient of item.CcRecipients) {
        if (recipient?.Name && recipient?.Address) {
          recipients.push(`${recipient.Name} <${recipient.Address}>`);
        } else if (recipient?.Address) {
          recipients.push(recipient.Address);
        }
      }
    } else if (item.CcRecipients && typeof item.CcRecipients === 'object' && item.CcRecipients.Address) {
      if (item.CcRecipients.Name && item.CcRecipients.Address) {
        recipients.push(`${item.CcRecipients.Name} <${item.CcRecipients.Address}>`);
      } else if (item.CcRecipients.Address) {
        recipients.push(item.CcRecipients.Address);
      }
    }
  } catch (error) {
    console.warn('Error extracting Cc recipients from EWS item:', error);
  }
  
  return recipients.join(', ');
}

/**
 * Extract Bcc recipients from EWS item (typically not available for received messages)
 */
function extractBccRecipientsFromEws(item: any): string {
  const recipients: string[] = [];
  
  try {
    if (item.BccRecipients && Array.isArray(item.BccRecipients)) {
      for (const recipient of item.BccRecipients) {
        if (recipient?.Name && recipient?.Address) {
          recipients.push(`${recipient.Name} <${recipient.Address}>`);
        } else if (recipient?.Address) {
          recipients.push(recipient.Address);
        }
      }
    } else if (item.BccRecipients && typeof item.BccRecipients === 'object' && item.BccRecipients.Address) {
      if (item.BccRecipients.Name && item.BccRecipients.Address) {
        recipients.push(`${item.BccRecipients.Name} <${item.BccRecipients.Address}>`);
      } else if (item.BccRecipients.Address) {
        recipients.push(item.BccRecipients.Address);
      }
    }
  } catch (error) {
    console.warn('Error extracting Bcc recipients from EWS item:', error);
  }
  
  return recipients.join(', ');
}

/**
 * Extract Reply-To header from EWS item
 */
function extractReplyToFromEws(item: any): string {
  try {
    if (item.ReplyTo && Array.isArray(item.ReplyTo)) {
      const replyToAddresses: string[] = [];
      for (const recipient of item.ReplyTo) {
        if (recipient?.Name && recipient?.Address) {
          replyToAddresses.push(`${recipient.Name} <${recipient.Address}>`);
        } else if (recipient?.Address) {
          replyToAddresses.push(recipient.Address);
        }
      }
      return replyToAddresses.join(', ');
    } else if (item.ReplyTo && typeof item.ReplyTo === 'object' && item.ReplyTo.Address) {
      if (item.ReplyTo.Name && item.ReplyTo.Address) {
        return `${item.ReplyTo.Name} <${item.ReplyTo.Address}>`;
      } else if (item.ReplyTo.Address) {
        return item.ReplyTo.Address;
      }
    }
  } catch (error) {
    console.warn('Error extracting Reply-To from EWS item:', error);
  }
  
  return ''; // Return empty string if no Reply-To header (will use From for replies)
}

/**
 * Sanitize HTML content to prevent XSS and ensure valid HTML
 */
function sanitizeHtmlContent(html: string): string {
  if (!html || typeof html !== 'string') return '';
  
  // Remove potentially dangerous elements and attributes
  const dangerousTags = /<(script|iframe|object|embed|link|meta|style)[^>]*>.*?<\/\1>|<(script|iframe|object|embed|link|meta|style)[^>]*\/>/gi;
  let sanitized = html.replace(dangerousTags, '');
  
  // Remove dangerous attributes
  const dangerousAttrs = /(on\w+|javascript:|data:|vbscript:)/gi;
  sanitized = sanitized.replace(dangerousAttrs, '');
  
  // Fix common HTML entity issues that cause "Character reference not valid" errors
  sanitized = sanitized
    .replace(/&(?![a-zA-Z0-9#][a-zA-Z0-9]*;)/g, '&amp;') // Fix unescaped ampersands
    .replace(/&nbsp;/g, '&#160;') // Use numeric entity for non-breaking space
    .replace(/&ldquo;/g, '&#8220;') // Left double quotation mark
    .replace(/&rdquo;/g, '&#8221;') // Right double quotation mark
    .replace(/&lsquo;/g, '&#8217;') // Left single quotation mark
    .replace(/&rsquo;/g, '&#8217;') // Right single quotation mark
    .replace(/&mdash;/g, '&#8212;') // Em dash
    .replace(/&ndash;/g, '&#8211;') // En dash
    .replace(/&hellip;/g, '&#8230;') // Horizontal ellipsis
    .replace(/&trade;/g, '&#8482;'); // Trademark symbol
  
  // Ensure proper UTF-8 encoding
  try {
    sanitized = decodeURIComponent(escape(sanitized));
  } catch {
    // If encoding fails, keep original
  }
  
  return sanitized;
}

/**
 * Convert HTML content to plain text
 */
function htmlToPlainText(html: string): string {
  if (!html || typeof html !== 'string') return '';
  
  let text = html
    // Replace common HTML elements with text equivalents
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/ul>|<\/ol>/gi, '\n')
    // Remove all other HTML tags
    .replace(/<[^>]*>/g, '')
    // Decode common HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&#8212;/g, '—')
    .replace(/&#8211;/g, '–')
    .replace(/&#160;/g, ' ')
    // Clean up excess whitespace
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .replace(/\s+/g, ' ')
    .trim();
  
  return text;
}

/**
 * Extract recipients from EWS item
 */
function extractRecipientsFromEws(item: any): string {
  const recipients: string[] = [];
  
  try {
    // Add To recipients
    if (item.ToRecipients && Array.isArray(item.ToRecipients)) {
      for (const recipient of item.ToRecipients) {
        if (recipient?.Name && recipient?.Address) {
          recipients.push(`${recipient.Name} <${recipient.Address}>`);
        } else if (recipient?.Address) {
          recipients.push(recipient.Address);
        }
      }
    } else if (item.ToRecipients && typeof item.ToRecipients === 'object' && item.ToRecipients.Address) {
      // Handle single recipient case
      if (item.ToRecipients.Name && item.ToRecipients.Address) {
        recipients.push(`${item.ToRecipients.Name} <${item.ToRecipients.Address}>`);
      } else if (item.ToRecipients.Address) {
        recipients.push(item.ToRecipients.Address);
      }
    }
    
    // Add CC recipients  
    if (item.CcRecipients && Array.isArray(item.CcRecipients)) {
      for (const recipient of item.CcRecipients) {
        if (recipient?.Name && recipient?.Address) {
          recipients.push(`${recipient.Name} <${recipient.Address}>`);
        } else if (recipient?.Address) {
          recipients.push(recipient.Address);
        }
      }
    } else if (item.CcRecipients && typeof item.CcRecipients === 'object' && item.CcRecipients.Address) {
      // Handle single recipient case
      if (item.CcRecipients.Name && item.CcRecipients.Address) {
        recipients.push(`${item.CcRecipients.Name} <${item.CcRecipients.Address}>`);
      } else if (item.CcRecipients.Address) {
        recipients.push(item.CcRecipients.Address);
      }
    }
  } catch (error) {
    console.warn('Error extracting recipients from EWS item:', error);
  }
  
  return recipients.join(', ') || 'Unknown Recipients';
}

/**
 * Extract email flags from EWS item
 */
function extractFlagsFromEws(item: any): string[] {
  const flags: string[] = [];
  
  if (item.IsRead) {
    flags.push('Seen');
  }
  
  if (item.Flag?.FlagStatus === 'Flagged') {
    flags.push('Flagged');
  }
  
  if (item.Importance?.toString() === 'High') {
    flags.push('Important');
  }
  
  if (item.HasAttachments) {
    flags.push('HasAttachment');
  }
  
  return flags;
}

/**
 * Calculate email priority based on importance and sender
 */
function calculatePriority(importance?: any, senderName?: string): number {
  let priority = 0;
  
  // Base priority on importance
  const importanceStr = importance?.toString();
  if (importanceStr === 'High') {
    priority = 2;
  } else if (importanceStr === 'Low') {
    priority = 0;
  } else {
    priority = 1; // Normal importance
  }
  
  // Could add VIP sender logic here
  // For now, just return the importance-based priority
  
  return Math.min(priority, 3); // Cap at 3 stars
}

/**
 * Extract snippet from email body
 */
function extractSnippetFromBody(bodyContent?: string): string {
  if (!bodyContent) {
    return '';
  }
  
  // Remove HTML tags and get first 150 characters
  const plainText = bodyContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return plainText.length > 150 ? plainText.substring(0, 150) + '...' : plainText;
}