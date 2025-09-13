import { IStorage } from './storage';
import { decryptAccountSettingsWithPassword } from './crypto';

export interface EwsSyncResult {
  messageCount: number;
  error?: string;
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
    const settings = decryptAccountSettingsWithPassword(accountData.settingsJson);
    
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
      BasePropertySet 
    } = ewsApi;

    // Create Exchange service
    const service = new ExchangeService(ExchangeVersion.Exchange2013);
    service.Credentials = new WebCredentials(settings.username, settings.password);
    
    // Set EWS URL
    let ewsUrl = settings.host;
    if (!ewsUrl.startsWith('http')) {
      ewsUrl = (settings.useSSL ? 'https://' : 'http://') + ewsUrl;
    }
    if (!ewsUrl.includes('/EWS/')) {
      ewsUrl = ewsUrl.endsWith('/') ? ewsUrl + 'EWS/Exchange.asmx' : ewsUrl + '/EWS/Exchange.asmx';
    }
    
    service.Url = new Uri(ewsUrl);

    try {
      // Get the inbox folder
      const inboxFolder = await service.GetFolder(WellKnownFolderName.Inbox);
      
      // Create item view to limit results
      const itemView = new ItemView(limit);
      itemView.PropertySet = new PropertySet(BasePropertySet.FirstClassProperties);
      
      // Find emails in inbox
      const findItemsResults = await service.FindItems(inboxFolder.Id, itemView);
      const items = findItemsResults.Items;

      console.log(`Found ${items.length} emails in EWS inbox`);

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
          
          // Extract email content and metadata
          const emailData = {
            accountId,
            folder,
            messageId: item.Id.UniqueId,
            subject: item.Subject || 'No Subject',
            sender: extractSenderFromEws(item),
            recipients: extractRecipientsFromEws(item),
            date: item.DateTimeReceived ? new Date(item.DateTimeReceived.toString()) : new Date(),
            isRead: item.IsRead || false,
            isImportant: item.Importance === 'High',
            hasAttachments: item.HasAttachments || false,
            flags: extractFlagsFromEws(item),
            priority: calculatePriority(item.Importance, item.Sender?.Name),
            snippet: item.Preview || extractSnippetFromBody(item.Body?.Text),
            bodyContent: item.Body?.Text || '',
            bodyType: item.Body?.BodyType === 'HTML' ? 'html' : 'text'
          };

          // Save to database
          await storage.createMailMessage(emailData);
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
      
      return { messageCount };

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
  if (item.Sender?.Name && item.Sender?.Address) {
    return `${item.Sender.Name} <${item.Sender.Address}>`;
  } else if (item.Sender?.Address) {
    return item.Sender.Address;
  } else if (item.From?.Name && item.From?.Address) {
    return `${item.From.Name} <${item.From.Address}>`;
  } else if (item.From?.Address) {
    return item.From.Address;
  }
  return 'Unknown Sender';
}

/**
 * Extract recipients from EWS item
 */
function extractRecipientsFromEws(item: any): string {
  const recipients: string[] = [];
  
  // Add To recipients
  if (item.ToRecipients) {
    for (const recipient of item.ToRecipients) {
      if (recipient.Name && recipient.Address) {
        recipients.push(`${recipient.Name} <${recipient.Address}>`);
      } else if (recipient.Address) {
        recipients.push(recipient.Address);
      }
    }
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
  
  if (item.IsFlagged) {
    flags.push('Flagged');
  }
  
  if (item.Importance === 'High') {
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
function calculatePriority(importance?: string, senderName?: string): number {
  let priority = 0;
  
  // Base priority on importance
  if (importance === 'High') {
    priority = 2;
  } else if (importance === 'Low') {
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