import { IStorage } from './storage';
import { decryptAccountSettingsWithPassword } from './crypto';
import { InsertAccountFolder } from '../shared/schema';
import { PriorityEngine } from './services/priorityEngine';
import { distributedJobService } from './services/distributedJobs';

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
          
          // Extract email content and metadata
          const emailData = {
            accountId,
            folder,
            messageId: item.Id.UniqueId,
            subject: item.Subject || 'No Subject',
            sender: extractSenderFromEws(item),
            recipients: extractRecipientsFromEws(item),
            date: item.DateTimeReceived ? new Date(item.DateTimeReceived.toString()) : new Date(),
            isRead: (item as any).IsRead || false,
            isImportant: (item as any).Importance?.toString() === 'High',
            hasAttachments: item.HasAttachments || false,
            flags: extractFlagsFromEws(item),
            priority: calculatePriority((item as any).Importance, (item as any).From?.Name),
            autoPriority: calculatePriority((item as any).Importance, (item as any).From?.Name), // Auto-calculated priority
            priorityScore: calculatePriorityScore((item as any).Importance, (item as any).From?.Name), // Detailed scoring 0-100
            snippet: item.Preview || extractSnippetFromBody(item.Body?.Text),
            bodyContent: item.Body?.Text || '',
            bodyType: (item as any).Body?.BodyType?.toString() === 'HTML' ? 'html' : 'text'
          };

          // Save to database
          const savedEmail = await storage.createMailMessage(emailData);
          messageCount++;
          
          console.log(`Saved EWS message: ${emailData.subject}`);
          
          // Event-driven priority scoring via distributed jobs
          if (savedEmail?.id) {
            try {
              // Queue priority scoring with high priority for immediate processing
              await distributedJobService.queuePriorityScoring(
                savedEmail.id, 
                accountId, 
                'sync-context', // Worker will resolve userId from accountId
                { priority: 'high' }
              );
              
              console.log(`Queued priority job for newly synced EWS email ${savedEmail.id}`);
              
            } catch (priorityError) {
              console.error(`Failed to queue priority job for EWS email ${savedEmail.id}:`, priorityError);
              // Continue processing - priority calculation failure shouldn't stop sync
            }
          }
          
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
 * Calculate detailed priority score (0-100) based on various factors
 */
function calculatePriorityScore(importance?: any, senderName?: string): number {
  let score = 50; // Base score (normal importance)
  
  // Adjust based on importance
  const importanceStr = importance?.toString();
  if (importanceStr === 'High') {
    score += 30; // High importance adds 30 points
  } else if (importanceStr === 'Low') {
    score -= 20; // Low importance subtracts 20 points
  }
  
  // Could add more sophisticated scoring factors here:
  // - VIP status
  // - Keyword matching
  // - Time-based factors
  // - Thread context
  
  // Ensure score stays within 0-100 range
  return Math.max(0, Math.min(100, score));
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