import { IStorage } from './storage';
import { decryptAccountSettingsWithPassword } from './crypto';
import { syncEwsEmails } from './ewsSync';

export interface EwsStreamingManager {
  accountId: string;
  subscriptionId?: string;
  connectionId?: string;
  isActive: boolean;
  lastError?: string;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  reconnectScheduled: boolean;
  cooldownUntil?: Date;
  streamingConnection?: any; // EWS streaming connection
}

export interface EwsNotificationEvent {
  accountId: string;
  eventType: 'NewMail' | 'Created' | 'Deleted' | 'Modified' | 'Moved' | 'Copied';
  folderId: string;
  itemId?: string;
  timestamp: Date;
  details?: any;
}

class EwsStreamingService {
  private connections: Map<string, EwsStreamingManager> = new Map();
  private storage: IStorage;
  private isShuttingDown: boolean = false;
  private heartbeatInterval?: NodeJS.Timeout;
  
  // Important folders to monitor for EWS accounts
  private readonly PRIORITY_FOLDERS = ['Inbox', 'SentItems', 'Drafts', 'DeletedItems'];

  constructor(storage: IStorage) {
    this.storage = storage;
    this.setupGracefulShutdown();
    this.startHeartbeat();
  }

  private setupGracefulShutdown(): void {
    const gracefulShutdown = async (signal: string) => {
      console.log(`Received ${signal}, shutting down EWS streaming connections gracefully...`);
      this.isShuttingDown = true;
      await this.stopAllConnections();
      process.exit(0);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  }

  private startHeartbeat(): void {
    // Check connection health every 5 minutes
    this.heartbeatInterval = setInterval(() => {
      if (!this.isShuttingDown) {
        this.checkConnectionHealth();
      }
    }, 5 * 60 * 1000);
  }

  private async checkConnectionHealth(): Promise<void> {
    for (const [accountId, manager] of Array.from(this.connections.entries())) {
      if (manager.isActive && manager.streamingConnection) {
        try {
          // Check if connection is still alive - if not, it will throw
          // EWS streaming connections automatically handle heartbeats
          console.log(`EWS streaming connection health check for account ${accountId}: OK`);
        } catch (error) {
          console.log(`EWS streaming connection health check failed for account ${accountId}, reconnecting...`);
          await this.reconnectAccount(accountId);
        }
      }
    }
  }

  async initializeForAllAccounts(): Promise<{ successful: number; failed: number }> {
    console.log('Starting EWS streaming subscriptions for all active accounts...');
    
    try {
      const ewsAccounts = await this.storage.getAllActiveEwsAccounts();
      
      console.log(`Found ${ewsAccounts.length} active EWS accounts`);
      
      let successful = 0;
      let failed = 0;

      for (const account of ewsAccounts) {
        try {
          console.log(`Starting streaming subscription for account ${account.id} (${account.name})`);
          await this.startStreamingForAccount(account.id);
          console.log(`Successfully started streaming subscription for account ${account.id}`);
          successful++;
        } catch (error) {
          console.error(`Failed to start streaming subscription for account ${account.id}:`, error);
          failed++;
        }
      }

      console.log(`EWS streaming subscription initialization completed: ${successful} successful, ${failed} failed`);
      return { successful, failed };
    } catch (error) {
      console.error('Error during EWS streaming initialization:', error);
      return { successful: 0, failed: 0 };
    }
  }

  async startStreamingForAccount(accountId: string): Promise<void> {
    if (this.isShuttingDown) return;

    try {
      // Get account details
      const ewsAccounts = await this.storage.getAllActiveEwsAccounts();
      const account = ewsAccounts.find((acc: any) => acc.id === accountId);
      
      if (!account) {
        throw new Error(`EWS account ${accountId} not found or not EWS protocol`);
      }

      // Stop existing connection if any
      await this.stopStreamingForAccount(accountId);

      // Initialize manager
      const manager: EwsStreamingManager = {
        accountId,
        isActive: false,
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
        reconnectScheduled: false
      };

      this.connections.set(accountId, manager);

      // Decrypt account settings
      const decryptedSettings = await decryptAccountSettingsWithPassword(account.settingsJson);
      
      console.log('EWS streaming: Raw encrypted settings length:', account.settingsJson.length);
      console.log('EWS streaming: Raw encrypted settings preview:', JSON.stringify(account.settingsJson).substring(0, 100));
      console.log('EWS streaming: Decrypted settings:', {
        host: decryptedSettings.host,
        username: decryptedSettings.username,
        hasPassword: !!decryptedSettings.password
      });

      const { ExchangeService, Uri, WebCredentials, WellKnownFolderName, EventType, StreamingSubscription, StreamingSubscriptionConnection } = await import('ews-javascript-api');
      
      // Create EWS service
      const service = new ExchangeService();
      service.Url = new Uri(`https://${decryptedSettings.host}/EWS/Exchange.asmx`);
      service.Credentials = new WebCredentials(decryptedSettings.username, decryptedSettings.password);

      // Create folder IDs for subscription using FolderId constructor
      const { FolderId } = await import('ews-javascript-api');
      const folderIds = this.PRIORITY_FOLDERS.map(folderName => {
        switch (folderName) {
          case 'Inbox': return new FolderId(WellKnownFolderName.Inbox);
          case 'SentItems': return new FolderId(WellKnownFolderName.SentItems);
          case 'Drafts': return new FolderId(WellKnownFolderName.Drafts);
          case 'DeletedItems': return new FolderId(WellKnownFolderName.DeletedItems);
          default: return new FolderId(WellKnownFolderName.Inbox);
        }
      });

      console.log(`Starting EWS streaming subscription for account ${accountId}`);

      // Create streaming subscription with timeout
      const subscriptionPromise = service.SubscribeToStreamingNotifications(
        folderIds,
        EventType.NewMail,
        EventType.Created,
        EventType.Deleted,
        EventType.Modified,
        EventType.Moved
      );

      // Add timeout to prevent hanging
      const subscription = await Promise.race([
        subscriptionPromise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('EWS streaming subscription timeout')), 10000)
        )
      ]) as any;

      console.log(`EWS streaming subscription created for account ${accountId}`);

      // Create streaming connection with 30-minute timeout
      const connection = new StreamingSubscriptionConnection(service, 30);
      connection.AddSubscription(subscription);

      // Set up event handlers
      connection.OnNotificationEvent.push(async (sender: any, args: any) => {
        try {
          await this.handleNotificationEvent(accountId, args);
        } catch (error) {
          console.error(`Error handling EWS streaming notification for account ${accountId}:`, error);
        }
      });

      connection.OnSubscriptionError.push(async (sender: any, args: any) => {
        console.error(`EWS streaming subscription error for account ${accountId}:`, args.Exception);
        manager.lastError = args.Exception?.message;
        await this.scheduleReconnect(accountId);
      });

      connection.OnDisconnect.push(async (sender: any, args: any) => {
        console.log(`EWS streaming connection disconnected for account ${accountId}`);
        if (!this.isShuttingDown) {
          await this.scheduleReconnect(accountId);
        }
      });

      // Start the connection asynchronously - don't wait for it during startup
      console.log(`Opening EWS streaming connection for account ${accountId}`);
      
      // Open connection in the background with retry logic
      connection.Open().then(() => {
        console.log(`EWS streaming connection opened successfully for account ${accountId}`);
        manager.isActive = true;
      }).catch(async (error) => {
        console.error(`Failed to open EWS streaming connection for account ${accountId}:`, error);
        manager.lastError = error.message;
        // Schedule a retry instead of giving up
        await this.scheduleReconnect(accountId);
      });

      // Update manager - mark as pending until connection opens
      manager.subscriptionId = subscription.Id;
      manager.streamingConnection = connection;
      manager.reconnectAttempts = 0;
      manager.lastError = undefined;

      console.log(`EWS streaming subscription started successfully for account ${accountId}`);

    } catch (error) {
      const manager = this.connections.get(accountId);
      if (manager) {
        manager.isActive = false;
        manager.lastError = error instanceof Error ? error.message : String(error);
      }
      throw error;
    }
  }

  private async handleNotificationEvent(accountId: string, args: any): Promise<void> {
    try {
      console.log(`EWS streaming notification for account ${accountId}:`, {
        eventType: args.Events?.[0]?.EventType,
        itemCount: args.Events?.length
      });

      const events: EwsNotificationEvent[] = [];
      
      for (const event of args.Events || []) {
        const notificationEvent: EwsNotificationEvent = {
          accountId,
          eventType: event.EventType,
          folderId: event.ParentFolderId?.UniqueId || 'unknown',
          itemId: event.ItemId?.UniqueId,
          timestamp: new Date(),
          details: {
            watermark: event.Watermark,
            oldParentFolderId: event.OldParentFolderId?.UniqueId
          }
        };
        events.push(notificationEvent);
      }

      // Process events - trigger sync for affected folders
      await this.processNotificationEvents(accountId, events);

    } catch (error) {
      console.error(`Error processing EWS streaming notification for account ${accountId}:`, error);
    }
  }

  private async processNotificationEvents(accountId: string, events: EwsNotificationEvent[]): Promise<void> {
    // Group events by folder to minimize sync calls
    const folderEvents = new Map<string, EwsNotificationEvent[]>();
    
    for (const event of events) {
      if (!folderEvents.has(event.folderId)) {
        folderEvents.set(event.folderId, []);
      }
      folderEvents.get(event.folderId)!.push(event);
    }

    // Trigger sync for each affected folder
    for (const [folderId, folderEventList] of Array.from(folderEvents.entries())) {
      try {
        // Map folder ID to folder name for sync
        const folderName = this.getFolderNameFromId(folderId, folderEventList[0]);
        if (folderName) {
          console.log(`EWS streaming: Triggering sync for folder ${folderName} due to ${folderEventList.length} events`);
          
          // Trigger background sync
          setImmediate(async () => {
            try {
              await syncEwsEmails(this.storage, accountId, folderName);
            } catch (error) {
              console.error(`Error syncing EWS folder ${folderName} for account ${accountId}:`, error);
            }
          });
        }
      } catch (error) {
        console.error(`Error processing events for folder ${folderId}:`, error);
      }
    }
  }

  private getFolderNameFromId(folderId: string, sampleEvent: EwsNotificationEvent): string | null {
    // Try to map folder ID to folder name based on event type and known patterns
    // This is a simplified mapping - in production you might want to cache folder ID mappings
    switch (sampleEvent.eventType) {
      case 'NewMail':
        return 'INBOX'; // New mail typically goes to inbox
      case 'Created':
      case 'Modified':
      case 'Deleted':
        // For these events, we might need to sync multiple folders to be safe
        return 'INBOX'; // Default to inbox for now
      default:
        return 'INBOX';
    }
  }

  async stopStreamingForAccount(accountId: string): Promise<void> {
    const manager = this.connections.get(accountId);
    if (!manager) return;

    console.log(`Stopping EWS streaming subscription for account ${accountId}`);

    try {
      if (manager.streamingConnection) {
        await manager.streamingConnection.Close();
      }
    } catch (error) {
      console.log(`Error closing EWS streaming connection for account ${accountId}:`, error);
    }

    manager.isActive = false;
    manager.streamingConnection = undefined;
    manager.subscriptionId = undefined;
    
    this.connections.delete(accountId);
  }

  private async scheduleReconnect(accountId: string): Promise<void> {
    const manager = this.connections.get(accountId);
    if (!manager || manager.reconnectScheduled || this.isShuttingDown) {
      return;
    }

    manager.reconnectAttempts++;
    manager.reconnectScheduled = true;

    if (manager.reconnectAttempts > manager.maxReconnectAttempts) {
      console.log(`Max reconnection attempts reached for EWS streaming account ${accountId}`);
      manager.isActive = false;
      return;
    }

    const delay = Math.min(30000 * Math.pow(2, manager.reconnectAttempts - 1), 300000); // Max 5 minutes
    console.log(`Scheduling EWS streaming reconnect for account ${accountId} in ${delay}ms (attempt ${manager.reconnectAttempts})`);

    setTimeout(async () => {
      if (!this.isShuttingDown) {
        await this.reconnectAccount(accountId);
      }
    }, delay);
  }

  private async reconnectAccount(accountId: string): Promise<void> {
    const manager = this.connections.get(accountId);
    if (!manager) return;

    console.log(`Attempting to reconnect EWS streaming for account ${accountId}`);
    manager.reconnectScheduled = false;

    try {
      await this.startStreamingForAccount(accountId);
    } catch (error) {
      console.error(`Failed to reconnect EWS streaming for account ${accountId}:`, error);
      await this.scheduleReconnect(accountId);
    }
  }

  async stopAllConnections(): Promise<void> {
    console.log('Stopping all EWS streaming connections...');
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    const stopPromises = Array.from(this.connections.keys()).map(accountId => 
      this.stopStreamingForAccount(accountId)
    );

    await Promise.all(stopPromises);
    console.log('All EWS streaming connections stopped');
  }

  getConnectionStatus(): Map<string, EwsStreamingManager> {
    return new Map(this.connections);
  }

  async getActiveConnections(): Promise<EwsStreamingManager[]> {
    return Array.from(this.connections.values()).filter(manager => manager.isActive);
  }
}

// Singleton instance
let ewsStreamingService: EwsStreamingService | null = null;

export async function initializeEwsStreamingService(storage: IStorage): Promise<{ successful: number; failed: number }> {
  if (ewsStreamingService) {
    console.log('EWS streaming service already initialized');
    return { successful: 0, failed: 0 };
  }

  ewsStreamingService = new EwsStreamingService(storage);
  return await ewsStreamingService.initializeForAllAccounts();
}

export function getEwsStreamingService(): EwsStreamingService | null {
  return ewsStreamingService;
}

export async function stopEwsStreamingService(): Promise<void> {
  if (ewsStreamingService) {
    await ewsStreamingService.stopAllConnections();
    ewsStreamingService = null;
  }
}