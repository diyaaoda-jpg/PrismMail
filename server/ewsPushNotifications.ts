import { IStorage } from './storage';
import { decryptAccountSettingsWithPassword } from './crypto';
import { syncEwsEmails } from './ewsSync';

export interface EwsSubscriptionManager {
  accountId: string;
  connection?: any; // StreamingSubscriptionConnection
  subscription?: any; // StreamingSubscription
  isActive: boolean;
  lastError?: string;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

export interface NotificationEvent {
  accountId: string;
  folderId: string;
  itemId: string;
  eventType: 'NewMail' | 'Modified' | 'Deleted';
  timestamp: Date;
}

class EwsPushNotificationService {
  private subscriptions: Map<string, EwsSubscriptionManager> = new Map();
  private storage: IStorage;
  private isShuttingDown: boolean = false;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(storage: IStorage) {
    this.storage = storage;
    this.setupGracefulShutdown();
    this.startHeartbeat();
  }

  /**
   * Start push notifications for an EWS account
   */
  async startSubscription(accountId: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.subscriptions.has(accountId)) {
        console.log(`Subscription already exists for account ${accountId}`);
        return { success: true };
      }

      console.log(`Starting EWS push subscription for account ${accountId}`);
      
      // Get encrypted account settings
      const accountData = await this.storage.getAccountConnectionEncrypted(accountId);
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
        StreamingSubscription,
        StreamingSubscriptionConnection,
        EventType,
        WellKnownFolderName,
        FolderId
      } = ewsApi;

      // Create Exchange service
      const service = new ExchangeService(ExchangeVersion.Exchange2013);
      service.Credentials = new WebCredentials(settings.username, settings.password);
      
      // Normalize EWS URL
      const ewsUrl = this.normalizeEwsUrl(settings.host);
      service.Url = new Uri(ewsUrl);
      
      service.PreAuthenticate = true;
      service.UserAgent = 'PrismMail/1.0';

      // Get folder IDs to subscribe to
      const folderIds = await this.getFolderIdsForSubscription(accountId);
      
      if (folderIds.length === 0) {
        throw new Error('No folders found for subscription');
      }

      // Create streaming subscription
      const subscription = await service.SubscribeToStreamingNotifications(
        folderIds, // Array of folder IDs
        EventType.NewMail,
        EventType.Modified,
        EventType.Deleted
      );

      // Create streaming connection
      const connection = new StreamingSubscriptionConnection(service, 30); // 30 minutes timeout
      connection.AddSubscription(subscription);

      // Set up event handlers
      this.setupEventHandlers(connection, accountId);

      // Create subscription manager
      const manager: EwsSubscriptionManager = {
        accountId,
        connection,
        subscription,
        isActive: false,
        reconnectAttempts: 0,
        maxReconnectAttempts: 5
      };

      this.subscriptions.set(accountId, manager);

      // Start the connection
      await this.startConnection(manager);

      console.log(`EWS push subscription started successfully for account ${accountId}`);
      
      return { success: true };

    } catch (error: any) {
      console.error(`Failed to start EWS subscription for account ${accountId}:`, error);
      return { 
        success: false, 
        error: error.message || 'Failed to start subscription' 
      };
    }
  }

  /**
   * Stop push notifications for an EWS account
   */
  async stopSubscription(accountId: string): Promise<void> {
    const manager = this.subscriptions.get(accountId);
    if (!manager) {
      console.log(`No subscription found for account ${accountId}`);
      return;
    }

    console.log(`Stopping EWS subscription for account ${accountId}`);

    try {
      if (manager.connection && manager.isActive) {
        manager.connection.Close();
      }
    } catch (error) {
      console.error(`Error closing connection for account ${accountId}:`, error);
    }

    manager.isActive = false;
    this.subscriptions.delete(accountId);
    
    console.log(`EWS subscription stopped for account ${accountId}`);
  }

  /**
   * Restart subscription for an account (useful for reconnection)
   */
  async restartSubscription(accountId: string): Promise<{ success: boolean; error?: string }> {
    await this.stopSubscription(accountId);
    
    // Wait a moment before restarting
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return await this.startSubscription(accountId);
  }

  /**
   * Start subscriptions for all active EWS accounts
   */
  async startAllSubscriptions(): Promise<void> {
    try {
      console.log('Starting EWS subscriptions for all active accounts...');
      
      // Get all active EWS accounts from storage
      const ewsAccounts = await this.storage.getAllActiveEwsAccounts();
      
      if (ewsAccounts.length === 0) {
        console.log('No active EWS accounts found');
        return;
      }
      
      console.log(`Found ${ewsAccounts.length} active EWS accounts`);
      
      // Start subscriptions for each account in parallel
      const subscriptionPromises = ewsAccounts.map(async (account) => {
        try {
          console.log(`Starting subscription for account ${account.id} (${account.name})`);
          const result = await this.startSubscription(account.id);
          
          if (result.success) {
            console.log(`Successfully started subscription for account ${account.id}`);
          } else {
            console.error(`Failed to start subscription for account ${account.id}: ${result.error}`);
          }
          
          return result;
        } catch (error) {
          console.error(`Error starting subscription for account ${account.id}:`, error);
          return { success: false, error: (error as Error).message };
        }
      });
      
      // Wait for all subscriptions to complete (don't fail if some fail)
      const results = await Promise.allSettled(subscriptionPromises);
      
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      const failed = results.length - successful;
      
      console.log(`EWS subscription initialization completed: ${successful} successful, ${failed} failed`);
      
    } catch (error) {
      console.error('Error starting all EWS subscriptions:', error);
    }
  }

  /**
   * Stop all subscriptions (used during shutdown)
   */
  async stopAllSubscriptions(): Promise<void> {
    console.log('Stopping all EWS subscriptions...');
    this.isShuttingDown = true;

    const stopPromises = Array.from(this.subscriptions.keys()).map(accountId => 
      this.stopSubscription(accountId)
    );

    await Promise.all(stopPromises);

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    console.log('All EWS subscriptions stopped');
  }

  /**
   * Get subscription status for an account
   */
  getSubscriptionStatus(accountId: string): { isActive: boolean; error?: string } {
    const manager = this.subscriptions.get(accountId);
    if (!manager) {
      return { isActive: false };
    }

    return {
      isActive: manager.isActive,
      error: manager.lastError
    };
  }

  /**
   * Get folder IDs that should be subscribed to for push notifications
   */
  private async getFolderIdsForSubscription(accountId: string): Promise<any[]> {
    try {
      // Get account folders from database
      const folders = await this.storage.getAccountFolders(accountId);
      
      // Filter for important folders that should have push notifications
      const importantFolderTypes = ['inbox', 'sent', 'drafts'];
      const importantFolders = folders.filter(folder => 
        folder.isActive && importantFolderTypes.includes(folder.folderType)
      );

      // Convert to EWS FolderId objects
      const ewsApi = await import('ews-javascript-api');
      const { FolderId } = ewsApi;
      
      return importantFolders.map(folder => new FolderId(folder.folderId));
    } catch (error) {
      console.error(`Error getting folder IDs for subscription ${accountId}:`, error);
      return [];
    }
  }

  /**
   * Setup event handlers for streaming connection
   */
  private setupEventHandlers(connection: any, accountId: string): void {
    // Handle notification events
    connection.OnNotificationEvent = async (sender: any, args: any) => {
      try {
        await this.handleNotificationEvent(accountId, args);
      } catch (error) {
        console.error(`Error handling notification for account ${accountId}:`, error);
      }
    };

    // Handle subscription errors
    connection.OnSubscriptionError = async (sender: any, args: any) => {
      console.error(`Subscription error for account ${accountId}:`, args.Exception);
      await this.handleSubscriptionError(accountId, args.Exception);
    };

    // Handle disconnection
    connection.OnDisconnect = async (sender: any, args: any) => {
      console.log(`Connection disconnected for account ${accountId}`);
      await this.handleDisconnection(accountId);
    };
  }

  /**
   * Handle notification events from EWS
   */
  private async handleNotificationEvent(accountId: string, args: any): Promise<void> {
    try {
      const notifications = args.Events || [];
      
      for (const notification of notifications) {
        const eventType = notification.EventType;
        const folderId = notification.FolderId?.UniqueId;
        const itemId = notification.ItemId?.UniqueId;

        console.log(`EWS notification - Account: ${accountId}, Type: ${eventType}, Folder: ${folderId}`);

        // Create notification event
        const notificationEvent: NotificationEvent = {
          accountId,
          folderId: folderId || '',
          itemId: itemId || '',
          eventType: eventType as 'NewMail' | 'Modified' | 'Deleted',
          timestamp: new Date()
        };

        // Handle different event types
        switch (eventType) {
          case 'NewMail':
            await this.handleNewMailEvent(notificationEvent);
            break;
          case 'Modified':
            await this.handleModifiedEvent(notificationEvent);
            break;
          case 'Deleted':
            await this.handleDeletedEvent(notificationEvent);
            break;
          default:
            console.log(`Unhandled event type: ${eventType}`);
        }
      }
    } catch (error) {
      console.error(`Error processing notification events for account ${accountId}:`, error);
    }
  }

  /**
   * Handle new mail events
   */
  private async handleNewMailEvent(event: NotificationEvent): Promise<void> {
    try {
      console.log(`Handling new mail event for account ${event.accountId}`);
      
      // Trigger sync for the specific folder
      await this.triggerFolderSync(event.accountId, event.folderId);
      
      // Update folder counts
      await this.updateFolderCounts(event.accountId, event.folderId);
      
    } catch (error) {
      console.error(`Error handling new mail event:`, error);
    }
  }

  /**
   * Handle modified mail events
   */
  private async handleModifiedEvent(event: NotificationEvent): Promise<void> {
    try {
      console.log(`Handling modified mail event for account ${event.accountId}`);
      
      // For modified events, we might want to sync specific message or folder
      await this.triggerFolderSync(event.accountId, event.folderId);
      
    } catch (error) {
      console.error(`Error handling modified event:`, error);
    }
  }

  /**
   * Handle deleted mail events
   */
  private async handleDeletedEvent(event: NotificationEvent): Promise<void> {
    try {
      console.log(`Handling deleted mail event for account ${event.accountId}`);
      
      // For deleted events, we might want to remove from local cache
      // For now, trigger a sync to update the folder
      await this.triggerFolderSync(event.accountId, event.folderId);
      
    } catch (error) {
      console.error(`Error handling deleted event:`, error);
    }
  }

  /**
   * Trigger sync for a specific folder
   */
  private async triggerFolderSync(accountId: string, folderId: string): Promise<void> {
    try {
      // Get folder information to determine folder type
      const folders = await this.storage.getAccountFolders(accountId);
      const folder = folders.find(f => f.folderId === folderId);
      
      if (!folder) {
        console.warn(`Folder with ID ${folderId} not found for account ${accountId}`);
        return;
      }

      // Trigger sync using existing EWS sync function
      console.log(`Triggering EWS sync for folder ${folder.displayName} (${folder.folderType})`);
      
      // Pass the folder ID directly to sync function so it can map it properly
      const syncResult = await syncEwsEmails(
        this.storage,
        accountId,
        folderId, // Pass raw folder ID - let syncEwsEmails handle the mapping
        25 // Limit to recent messages
      );

      console.log(`EWS sync completed for folder ${folder.displayName}: ${syncResult.messageCount} messages`);
      
      // Update folder counts after sync
      await this.updateFolderCounts(accountId, folderId);
      
    } catch (error) {
      console.error(`Error triggering EWS folder sync for ${folderId}:`, error);
    }
  }

  /**
   * Update folder counts after notifications
   */
  private async updateFolderCounts(accountId: string, folderId: string): Promise<void> {
    try {
      // Get folder information to determine folder type for counting
      const folders = await this.storage.getAccountFolders(accountId);
      const folder = folders.find(f => f.folderId === folderId);
      
      if (!folder) {
        console.warn(`Cannot update counts - folder ${folderId} not found for account ${accountId}`);
        return;
      }
      
      // Count messages in this folder from our database
      const allMessages = await this.storage.getMailMessages(accountId, folder.folderType);
      const totalCount = allMessages.length;
      const unreadCount = allMessages.filter(msg => !msg.isRead).length;
      
      // Update the folder counts in storage
      await this.storage.updateFolderCounts(accountId, folderId, unreadCount, totalCount);
      
      console.log(`Updated folder counts for ${folder.displayName}: ${unreadCount} unread, ${totalCount} total`);
      
    } catch (error) {
      console.error(`Error updating folder counts for ${folderId}:`, error);
    }
  }

  /**
   * Handle subscription errors and attempt reconnection
   */
  private async handleSubscriptionError(accountId: string, error: any): Promise<void> {
    const manager = this.subscriptions.get(accountId);
    if (!manager) return;

    manager.lastError = error.message || 'Subscription error';
    console.error(`Subscription error for account ${accountId}:`, error);

    // Attempt reconnection if within retry limits
    if (manager.reconnectAttempts < manager.maxReconnectAttempts) {
      manager.reconnectAttempts++;
      console.log(`Attempting to reconnect subscription for account ${accountId} (attempt ${manager.reconnectAttempts}/${manager.maxReconnectAttempts})`);
      
      // Enhanced exponential backoff with jitter
      const baseDelay = 1000 * Math.pow(2, manager.reconnectAttempts);
      const jitter = Math.random() * 1000; // Add up to 1 second of jitter
      const delay = Math.min(baseDelay + jitter, 60000); // Cap at 60 seconds
      
      console.log(`Waiting ${Math.round(delay)}ms before reconnection attempt`);
      
      setTimeout(async () => {
        try {
          await this.restartSubscription(accountId);
        } catch (retryError) {
          console.error(`Reconnection attempt failed for account ${accountId}:`, retryError);
        }
      }, delay);
    } else {
      console.error(`Max reconnection attempts (${manager.maxReconnectAttempts}) reached for account ${accountId}`);
      await this.stopSubscription(accountId);
    }
  }

  /**
   * Handle connection disconnection
   */
  private async handleDisconnection(accountId: string): Promise<void> {
    const manager = this.subscriptions.get(accountId);
    if (!manager) return;

    manager.isActive = false;
    console.log(`Connection disconnected for account ${accountId}`);
    
    if (!this.isShuttingDown) {
      // Only attempt reconnection if we haven't exceeded retry limits
      if (manager.reconnectAttempts < manager.maxReconnectAttempts) {
        console.log(`Scheduling reconnection for account ${accountId}`);
        
        // Use exponential backoff for disconnection reconnects too
        const baseDelay = 2000; // Start with 2 seconds for disconnections
        const backoffDelay = Math.min(baseDelay * Math.pow(1.5, manager.reconnectAttempts), 30000);
        const jitter = Math.random() * 1000;
        const delay = backoffDelay + jitter;
        
        setTimeout(async () => {
          try {
            await this.restartSubscription(accountId);
          } catch (error) {
            console.error(`Disconnection reconnection failed for account ${accountId}:`, error);
          }
        }, delay);
      } else {
        console.warn(`Disconnection detected but max reconnect attempts exceeded for account ${accountId}`);
      }
    } else {
      console.log(`Shutting down - not attempting reconnection for account ${accountId}`);
    }
  }

  /**
   * Start the streaming connection
   */
  private async startConnection(manager: EwsSubscriptionManager): Promise<void> {
    try {
      if (manager.connection) {
        manager.connection.Open();
        manager.isActive = true;
        manager.reconnectAttempts = 0; // Reset reconnect attempts
        manager.lastError = undefined;
        console.log(`Streaming connection opened for account ${manager.accountId}`);
      }
    } catch (error) {
      manager.lastError = (error as Error).message;
      throw error;
    }
  }

  /**
   * Normalize EWS URL to canonical Exchange endpoint format
   */
  private normalizeEwsUrl(hostUrl: string): string {
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
   * Setup graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const shutdown = async () => {
      console.log('Graceful shutdown initiated...');
      await this.stopAllSubscriptions();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('SIGQUIT', shutdown);
  }

  /**
   * Start heartbeat to monitor subscription health
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.monitorSubscriptionHealth();
    }, 60000); // Check every minute
  }

  /**
   * Monitor subscription health and restart if needed
   */
  private monitorSubscriptionHealth(): void {
    Array.from(this.subscriptions.entries()).forEach(([accountId, manager]) => {
      if (!manager.isActive && manager.reconnectAttempts < manager.maxReconnectAttempts) {
        console.log(`Health check: Restarting unhealthy subscription for account ${accountId}`);
        this.restartSubscription(accountId).catch(error => {
          console.error(`Failed to restart subscription during health check for account ${accountId}:`, error);
        });
      }
    });
  }
}

// Export singleton instance
let ewsPushService: EwsPushNotificationService | null = null;

export function getEwsPushService(storage: IStorage): EwsPushNotificationService {
  if (!ewsPushService) {
    ewsPushService = new EwsPushNotificationService(storage);
  }
  return ewsPushService;
}

export async function initializeEwsPushNotifications(storage: IStorage): Promise<EwsPushNotificationService> {
  const service = getEwsPushService(storage);
  
  // Start subscriptions for active accounts
  await service.startAllSubscriptions();
  
  return service;
}

export { EwsPushNotificationService };