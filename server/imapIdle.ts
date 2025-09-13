import { ImapFlow } from 'imapflow';
import { IStorage } from './storage';
import { decryptAccountSettingsWithPassword } from './crypto';
import { syncImapEmails } from './emailSync';

export interface ImapIdleManager {
  accountId: string;
  connection?: ImapFlow;
  isActive: boolean;
  isIdle: boolean;
  lastError?: string;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  reconnectScheduled: boolean;
  cooldownUntil?: Date;
  selectedFolder?: string;
  mailboxLock?: any;
}

export interface ImapNotificationEvent {
  accountId: string;
  folder: string;
  eventType: 'EXISTS' | 'EXPUNGE' | 'FETCH';
  details?: any;
  timestamp: Date;
}

class ImapIdleService {
  private connections: Map<string, ImapIdleManager> = new Map();
  private storage: IStorage;
  private isShuttingDown: boolean = false;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(storage: IStorage) {
    this.storage = storage;
    this.setupGracefulShutdown();
    this.startHeartbeat();
  }

  /**
   * Start IDLE connection for an IMAP account
   */
  async startIdleConnection(accountId: string, folder: string = 'INBOX'): Promise<{ success: boolean; error?: string }> {
    try {
      // Check if account is in cooldown
      const existingManager = this.connections.get(accountId);
      if (existingManager?.cooldownUntil && existingManager.cooldownUntil > new Date()) {
        const remaining = Math.round((existingManager.cooldownUntil.getTime() - Date.now()) / 1000);
        console.log(`Account ${accountId} is in cooldown for ${remaining} more seconds - skipping connection attempt`);
        return { success: false, error: `Account in cooldown for ${remaining} seconds` };
      }
      
      if (existingManager?.isActive) {
        console.log(`IDLE connection already active for account ${accountId}`);
        return { success: true };
      }

      // CRITICAL FIX: If existing manager exists but not active, preserve state and use startIdleConnectionWithState
      if (existingManager) {
        console.log(`PRESERVED STATE RESTART: Preserving existing state for account ${accountId} (attempt ${existingManager.reconnectAttempts}/${existingManager.maxReconnectAttempts})`);
        const preservedState = {
          reconnectAttempts: existingManager.reconnectAttempts,
          maxReconnectAttempts: existingManager.maxReconnectAttempts,
          cooldownUntil: existingManager.cooldownUntil,
          selectedFolder: existingManager.selectedFolder
        };
        return await this.startIdleConnectionWithState(accountId, folder, preservedState);
      }

      console.log(`FRESH START: Starting new IMAP IDLE connection for account ${accountId}, folder: ${folder}`);
      
      // Get encrypted account settings
      const accountData = await this.storage.getAccountConnectionEncrypted(accountId);
      if (!accountData) {
        throw new Error('Account not found');
      }

      // Decrypt account settings
      const settings = decryptAccountSettingsWithPassword(accountData.settingsJson);
      
      // Create IMAP connection
      const client = new ImapFlow({
        host: settings.host,
        port: settings.port,
        secure: settings.useSSL,
        auth: {
          user: settings.username,
          pass: settings.password,
        },
        socketTimeout: 60000, // Longer timeout for IDLE connections
        greetingTimeout: 30000,
        maxIdleTime: 30 * 60 * 1000, // 30 minutes max IDLE time
      });

      // Create connection manager (only for fresh starts)
      const manager: ImapIdleManager = {
        accountId,
        connection: client,
        isActive: false,
        isIdle: false,
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
        reconnectScheduled: false,
        selectedFolder: folder
      };

      this.connections.set(accountId, manager);

      // Set up event handlers
      this.setupIdleEventHandlers(client, accountId);

      // Connect and start IDLE
      await this.connectAndStartIdle(manager);

      console.log(`IMAP IDLE connection started successfully for account ${accountId}`);
      
      return { success: true };

    } catch (error: any) {
      console.error(`Failed to start IMAP IDLE connection for account ${accountId}:`, error);
      
      // CRITICAL FIX: Handle ECONNREFUSED immediately to stop infinite retries
      if (error.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
        console.warn(`Host unreachable for account ${accountId} (ECONNREFUSED) - applying immediate 15-minute cooldown`);
        const manager = this.connections.get(accountId);
        if (manager) {
          manager.cooldownUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
          manager.reconnectAttempts = manager.maxReconnectAttempts; // Prevent further attempts
          manager.lastError = `ECONNREFUSED: ${error.message}`;
          console.log(`Account ${accountId} will not retry for 15 minutes due to unreachable host`);
        }
      }
      
      return { 
        success: false, 
        error: error.message || 'Failed to start IDLE connection' 
      };
    }
  }

  /**
   * Clean up connection without removing manager from connections map
   */
  private async cleanupConnection(manager: ImapIdleManager): Promise<void> {
    try {
      if (manager.connection && manager.isActive) {
        // Stop IDLE mode if active
        if (manager.isIdle) {
          try {
            // ImapFlow doesn't have idleStop() - IDLE is stopped by issuing another command or closing
            await manager.connection.noop(); // Send NOOP to break IDLE
          } catch (idleError) {
            console.log(`IDLE stop failed for account ${manager.accountId} (connection may already be closed)`);
          }
        }
        
        // Release the mailbox lock if we have one
        if (manager.mailboxLock) {
          try {
            manager.mailboxLock.release();
            manager.mailboxLock = undefined;
          } catch (lockError) {
            console.log(`Lock release failed for account ${manager.accountId}`);
          }
        }
        
        // Close connection
        try {
          await manager.connection.logout();
        } catch (logoutError) {
          console.log(`Logout failed for account ${manager.accountId} (connection may already be closed)`);
        }
      }
    } catch (error) {
      console.error(`Error cleaning up connection for account ${manager.accountId}:`, error);
    }

    manager.isActive = false;
    manager.isIdle = false;
    manager.connection = undefined;
  }

  /**
   * Start IDLE connection with preserved state
   */
  private async startIdleConnectionWithState(accountId: string, folder: string, preservedState: any): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`Starting IMAP IDLE connection for account ${accountId}, folder: ${folder} (preserving state)`);
      
      // Get encrypted account settings
      const accountData = await this.storage.getAccountConnectionEncrypted(accountId);
      if (!accountData) {
        throw new Error('Account not found');
      }

      // Decrypt account settings
      const settings = decryptAccountSettingsWithPassword(accountData.settingsJson);
      
      // Create IMAP connection
      const client = new ImapFlow({
        host: settings.host,
        port: settings.port,
        secure: settings.useSSL,
        auth: {
          user: settings.username,
          pass: settings.password,
        },
        socketTimeout: 60000, // Longer timeout for IDLE connections
        greetingTimeout: 30000,
        maxIdleTime: 30 * 60 * 1000, // 30 minutes max IDLE time
      });

      // Get existing manager or create new one with preserved state
      let manager = this.connections.get(accountId);
      if (!manager) {
        manager = {
          accountId,
          connection: client,
          isActive: false,
          isIdle: false,
          reconnectAttempts: preservedState.reconnectAttempts || 0,
          maxReconnectAttempts: preservedState.maxReconnectAttempts || 5,
          reconnectScheduled: false,
          cooldownUntil: preservedState.cooldownUntil,
          selectedFolder: folder
        };
        this.connections.set(accountId, manager);
      } else {
        // Update existing manager with new connection and preserved state
        manager.connection = client;
        // CRITICAL FIX: Use nullish coalescing to avoid resetting attempts when value is 0
        manager.reconnectAttempts = preservedState.reconnectAttempts ?? manager.reconnectAttempts;
        manager.maxReconnectAttempts = preservedState.maxReconnectAttempts ?? manager.maxReconnectAttempts;
        manager.cooldownUntil = preservedState.cooldownUntil;
        manager.selectedFolder = folder;
      }

      // Set up event handlers
      this.setupIdleEventHandlers(client, accountId);

      // Connect and start IDLE
      await this.connectAndStartIdle(manager);

      console.log(`IMAP IDLE connection started successfully for account ${accountId}`);
      
      return { success: true };

    } catch (error: any) {
      console.error(`Failed to start IMAP IDLE connection for account ${accountId}:`, error);
      
      // CRITICAL FIX: Handle ECONNREFUSED immediately to stop infinite retries
      if (error.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
        console.warn(`Host unreachable for account ${accountId} (ECONNREFUSED) - applying immediate 15-minute cooldown`);
        const manager = this.connections.get(accountId);
        if (manager) {
          manager.cooldownUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
          manager.reconnectAttempts = manager.maxReconnectAttempts; // Prevent further attempts
          manager.lastError = `ECONNREFUSED: ${error.message}`;
          console.log(`Account ${accountId} will not retry for 15 minutes due to unreachable host`);
        }
      }
      
      return { 
        success: false, 
        error: error.message || 'Failed to start IDLE connection' 
      };
    }
  }

  /**
   * Stop IDLE connection for an IMAP account
   */
  async stopIdleConnection(accountId: string): Promise<void> {
    const manager = this.connections.get(accountId);
    if (!manager) {
      console.log(`No IDLE connection found for account ${accountId}`);
      return;
    }

    console.log(`Stopping IMAP IDLE connection for account ${accountId}`);

    try {
      if (manager.connection && manager.isActive) {
        // Stop IDLE mode if active
        if (manager.isIdle) {
          try {
            // ImapFlow doesn't have idleStop() - IDLE is stopped by issuing another command or closing
            await manager.connection.noop(); // Send NOOP to break IDLE
          } catch (idleError) {
            console.log(`IDLE stop failed for account ${accountId} (connection may already be closed)`);
          }
        }
        
        // Release the mailbox lock if we have one
        if (manager.mailboxLock) {
          try {
            manager.mailboxLock.release();
            manager.mailboxLock = undefined;
          } catch (lockError) {
            console.log(`Lock release failed for account ${accountId}`);
          }
        }
        
        // Close connection
        try {
          await manager.connection.logout();
        } catch (logoutError) {
          console.log(`Logout failed for account ${accountId} (connection may already be closed)`);
        }
      }
    } catch (error) {
      console.error(`Error closing IDLE connection for account ${accountId}:`, error);
    }

    manager.isActive = false;
    manager.isIdle = false;
    manager.reconnectScheduled = false;
    this.connections.delete(accountId);
    
    console.log(`IMAP IDLE connection stopped for account ${accountId}`);
  }

  /**
   * Restart IDLE connection for an account
   */
  async restartIdleConnection(accountId: string): Promise<{ success: boolean; error?: string }> {
    const manager = this.connections.get(accountId);
    if (!manager) {
      return { success: false, error: 'No manager found for account' };
    }
    
    const folder = manager.selectedFolder || 'INBOX';
    
    // Preserve the attempt count and other state before stopping
    const preservedState = {
      reconnectAttempts: manager.reconnectAttempts,
      maxReconnectAttempts: manager.maxReconnectAttempts,
      cooldownUntil: manager.cooldownUntil
    };
    
    // Stop the existing connection (but don't remove manager completely)
    await this.cleanupConnection(manager);
    
    // Wait a moment before restarting
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    try {
      // Restart with preserved state
      const result = await this.startIdleConnectionWithState(accountId, folder, preservedState);
      return result;
    } catch (error: any) {
      return { 
        success: false, 
        error: error.message || 'Failed to restart IDLE connection' 
      };
    }
  }

  /**
   * Start IDLE connections for all active IMAP accounts
   */
  async startAllIdleConnections(): Promise<void> {
    try {
      console.log('Starting IMAP IDLE connections for all active accounts...');
      
      // Get all active IMAP accounts from storage
      const imapAccounts = await this.storage.getAllActiveImapAccounts();
      
      if (imapAccounts.length === 0) {
        console.log('No active IMAP accounts found');
        return;
      }
      
      console.log(`Found ${imapAccounts.length} active IMAP accounts`);
      
      // Start IDLE connections for each account in parallel
      const idlePromises = imapAccounts.map(async (account) => {
        try {
          console.log(`Starting IDLE connection for account ${account.id} (${account.name})`);
          const result = await this.startIdleConnection(account.id, 'INBOX');
          
          if (result.success) {
            console.log(`Successfully started IDLE connection for account ${account.id}`);
          } else {
            console.error(`Failed to start IDLE connection for account ${account.id}: ${result.error}`);
          }
          
          return result;
        } catch (error) {
          console.error(`Error starting IDLE connection for account ${account.id}:`, error);
          return { success: false, error: (error as Error).message };
        }
      });
      
      // Wait for all connections to complete (don't fail if some fail)
      const results = await Promise.allSettled(idlePromises);
      
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      const failed = results.length - successful;
      
      console.log(`IMAP IDLE initialization completed: ${successful} successful, ${failed} failed`);
      
    } catch (error) {
      console.error('Error starting all IMAP IDLE connections:', error);
    }
  }

  /**
   * Stop all IDLE connections (used during shutdown)
   */
  async stopAllIdleConnections(): Promise<void> {
    console.log('Stopping all IMAP IDLE connections...');
    this.isShuttingDown = true;

    const stopPromises = Array.from(this.connections.keys()).map(accountId => 
      this.stopIdleConnection(accountId)
    );

    await Promise.all(stopPromises);

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    console.log('All IMAP IDLE connections stopped');
  }

  /**
   * Get IDLE connection status for an account
   */
  getIdleConnectionStatus(accountId: string): { isActive: boolean; isIdle: boolean; error?: string } {
    const manager = this.connections.get(accountId);
    if (!manager) {
      return { isActive: false, isIdle: false };
    }

    return {
      isActive: manager.isActive,
      isIdle: manager.isIdle,
      error: manager.lastError
    };
  }

  /**
   * Setup event handlers for IMAP IDLE connections
   */
  private setupIdleEventHandlers(client: ImapFlow, accountId: string): void {
    // Handle mailbox changes during IDLE
    client.on('exists', async (data) => {
      try {
        console.log(`IMAP IDLE EXISTS event for account ${accountId}:`, data);
        await this.handleExistsEvent(accountId, data);
      } catch (error) {
        console.error(`Error handling EXISTS event for account ${accountId}:`, error);
      }
    });

    client.on('expunge', async (data) => {
      try {
        console.log(`IMAP IDLE EXPUNGE event for account ${accountId}:`, data);
        await this.handleExpungeEvent(accountId, data);
      } catch (error) {
        console.error(`Error handling EXPUNGE event for account ${accountId}:`, error);
      }
    });

    client.on('flags', async (data) => {
      try {
        console.log(`IMAP IDLE FLAGS event for account ${accountId}:`, data);
        await this.handleFlagsEvent(accountId, data);
      } catch (error) {
        console.error(`Error handling FLAGS event for account ${accountId}:`, error);
      }
    });

    // Handle connection events
    client.on('close', async () => {
      console.log(`IMAP connection closed for account ${accountId}`);
      await this.handleConnectionClosed(accountId);
    });

    client.on('error', async (error) => {
      console.error(`IMAP connection error for account ${accountId}:`, error);
      await this.handleConnectionError(accountId, error);
    });
  }

  /**
   * Connect to IMAP server and start IDLE mode
   */
  private async connectAndStartIdle(manager: ImapIdleManager): Promise<void> {
    if (!manager.connection) {
      throw new Error('No connection available');
    }

    const client = manager.connection;
    
    // Connect to IMAP server
    await client.connect();
    
    // Select the folder and get mailbox lock
    const folder = manager.selectedFolder || 'INBOX';
    const lock = await client.getMailboxLock(folder);
    
    // Store the lock for later release
    manager.mailboxLock = lock;
    
    // Set state BEFORE starting IDLE (idle() blocks)
    manager.isActive = true;
    manager.isIdle = true;
    // CRITICAL FIX: Do NOT reset reconnectAttempts here - preserve the counter
    manager.lastError = undefined;
    manager.reconnectScheduled = false;
    
    console.log(`IMAP IDLE mode started for account ${manager.accountId}, folder: ${folder}`);
    
    // Start IDLE mode in background (don't await - it blocks until stopped)
    client.idle().catch((error) => {
      console.error(`IDLE command failed for account ${manager.accountId}:`, error);
      // Error will be handled by the 'error' event handler
    });
  }

  /**
   * Handle EXISTS events (new messages)
   */
  private async handleExistsEvent(accountId: string, data: any): Promise<void> {
    try {
      console.log(`Handling new message event for account ${accountId}`);
      
      const manager = this.connections.get(accountId);
      const folder = manager?.selectedFolder || 'INBOX';
      
      // Trigger sync for the specific folder
      await this.triggerFolderSync(accountId, folder);
      
      // Update folder counts
      await this.updateFolderCounts(accountId, folder);
      
    } catch (error) {
      console.error(`Error handling EXISTS event for account ${accountId}:`, error);
    }
  }

  /**
   * Handle EXPUNGE events (deleted messages)
   */
  private async handleExpungeEvent(accountId: string, data: any): Promise<void> {
    try {
      console.log(`Handling message deletion event for account ${accountId}`);
      
      const manager = this.connections.get(accountId);
      const folder = manager?.selectedFolder || 'INBOX';
      
      // Trigger sync to update message list
      await this.triggerFolderSync(accountId, folder);
      
      // Update folder counts
      await this.updateFolderCounts(accountId, folder);
      
    } catch (error) {
      console.error(`Error handling EXPUNGE event for account ${accountId}:`, error);
    }
  }

  /**
   * Handle FLAGS events (flag changes)
   */
  private async handleFlagsEvent(accountId: string, data: any): Promise<void> {
    try {
      console.log(`Handling flag change event for account ${accountId}`);
      
      const manager = this.connections.get(accountId);
      const folder = manager?.selectedFolder || 'INBOX';
      
      // Trigger sync to update message flags
      await this.triggerFolderSync(accountId, folder);
      
      // Update folder counts (unread count might have changed)
      await this.updateFolderCounts(accountId, folder);
      
    } catch (error) {
      console.error(`Error handling FLAGS event for account ${accountId}:`, error);
    }
  }

  /**
   * Trigger sync for a specific folder
   */
  private async triggerFolderSync(accountId: string, folder: string): Promise<void> {
    try {
      // Get encrypted account settings
      const accountData = await this.storage.getAccountConnectionEncrypted(accountId);
      if (!accountData) {
        console.warn(`Account ${accountId} not found for folder sync`);
        return;
      }

      console.log(`Triggering IMAP sync for account ${accountId}, folder: ${folder}`);
      
      // Use existing sync function
      const syncResult = await syncImapEmails(
        accountId,
        accountData.settingsJson,
        this.storage,
        { folder, limit: 25 } // Limit to recent messages
      );

      console.log(`IMAP sync completed for account ${accountId}, folder ${folder}: ${syncResult.messageCount} messages`);
      
    } catch (error) {
      console.error(`Error triggering folder sync for account ${accountId}, folder ${folder}:`, error);
    }
  }

  /**
   * Update folder counts after notifications
   */
  private async updateFolderCounts(accountId: string, folder: string): Promise<void> {
    try {
      // Get folder information
      const folders = await this.storage.getAccountFolders(accountId);
      const folderInfo = folders.find(f => f.folderType === folder.toLowerCase() || f.folderId === folder);
      
      if (!folderInfo) {
        console.warn(`Cannot update counts - folder ${folder} not found for account ${accountId}`);
        return;
      }
      
      // Count messages in this folder from our database
      const allMessages = await this.storage.getMailMessages(accountId, folder);
      const totalCount = allMessages.length;
      const unreadCount = allMessages.filter(msg => !msg.isRead).length;
      
      // Update the folder counts in storage
      await this.storage.updateFolderCounts(accountId, folderInfo.folderId, unreadCount, totalCount);
      
      console.log(`Updated folder counts for ${folder}: ${unreadCount} unread, ${totalCount} total`);
      
    } catch (error) {
      console.error(`Error updating folder counts for account ${accountId}, folder ${folder}:`, error);
    }
  }

  /**
   * Handle connection closed events
   */
  private async handleConnectionClosed(accountId: string): Promise<void> {
    const manager = this.connections.get(accountId);
    if (!manager) return;

    manager.isActive = false;
    manager.isIdle = false;
    console.log(`IMAP connection closed for account ${accountId}`);
    
    // Only schedule reconnection if not already scheduled and not shutting down
    if (!this.isShuttingDown && !manager.reconnectScheduled) {
      // CRITICAL FIX: Pass more detailed error information to strengthen ECONNREFUSED detection
      const reason = manager.lastError ? `connection closed: ${manager.lastError}` : 'connection closed';
      this.scheduleReconnection(manager, reason);
    }
  }

  /**
   * Handle connection errors and attempt reconnection
   */
  private async handleConnectionError(accountId: string, error: any): Promise<void> {
    const manager = this.connections.get(accountId);
    if (!manager) return;

    manager.lastError = error.message || 'Connection error';
    manager.isActive = false;
    manager.isIdle = false;
    console.error(`IMAP connection error for account ${accountId}:`, error);

    // Only schedule reconnection if not already scheduled and not shutting down
    if (!this.isShuttingDown && !manager.reconnectScheduled) {
      this.scheduleReconnection(manager, `connection error: ${error.message}`);
    }
  }

  /**
   * Centralized reconnection scheduler
   */
  private scheduleReconnection(manager: ImapIdleManager, reason: string): void {
    if (manager.reconnectScheduled) {
      console.log(`Reconnection already scheduled for account ${manager.accountId}`);
      return;
    }

    // Check for cooldown period
    if (manager.cooldownUntil && manager.cooldownUntil > new Date()) {
      const remaining = Math.round((manager.cooldownUntil.getTime() - Date.now()) / 1000);
      console.log(`Account ${manager.accountId} in cooldown for ${remaining} more seconds - skipping reconnection`);
      return;
    }

    // Detect ECONNREFUSED errors and apply immediate cooldown
    if (reason.includes('ECONNREFUSED') || manager.lastError?.includes('ECONNREFUSED')) {
      console.warn(`Account ${manager.accountId} has unreachable host (ECONNREFUSED) - applying immediate 15-minute cooldown`);
      manager.cooldownUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
      manager.reconnectAttempts = manager.maxReconnectAttempts; // Prevent further attempts
      console.log(`Account ${manager.accountId} will not retry for 15 minutes due to unreachable host`);
      return;
    }

    // Check if max attempts reached
    if (manager.reconnectAttempts >= manager.maxReconnectAttempts) {
      console.warn(`Max reconnection attempts (${manager.maxReconnectAttempts}) reached for account ${manager.accountId} - adding 15 minute cooldown`);
      manager.cooldownUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
      manager.reconnectAttempts = 0; // Reset for next cooldown period
      console.log(`Account ${manager.accountId} will automatically restart after cooldown expires`);
      // CRITICAL FIX: Don't delete manager - keep it for auto-restart after cooldown
      return;
    }

    manager.reconnectScheduled = true;
    manager.reconnectAttempts++;
    
    // Enhanced exponential backoff with jitter
    const baseDelay = 1000 * Math.pow(2, manager.reconnectAttempts);
    const jitter = Math.random() * 1000;
    const delay = Math.min(baseDelay + jitter, 60000); // Cap at 60 seconds
    
    console.log(`Scheduling reconnection for account ${manager.accountId} due to ${reason} (attempt ${manager.reconnectAttempts}/${manager.maxReconnectAttempts}) in ${Math.round(delay)}ms`);
    
    setTimeout(async () => {
      manager.reconnectScheduled = false;
      try {
        await this.restartIdleConnection(manager.accountId);
      } catch (retryError) {
        console.error(`Reconnection attempt failed for account ${manager.accountId}:`, retryError);
      }
    }, delay);
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const shutdown = async () => {
      console.log('Graceful shutdown initiated for IMAP IDLE service...');
      await this.stopAllIdleConnections();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('SIGQUIT', shutdown);
  }

  /**
   * Start heartbeat to monitor connection health
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.monitorConnectionHealth();
    }, 60000); // Check every minute
  }

  /**
   * Monitor connection health and restart if needed
   */
  private monitorConnectionHealth(): void {
    Array.from(this.connections.entries()).forEach(([accountId, manager]) => {
      // CRITICAL FIX: Check if cooldown has expired and auto-restart
      if (manager.cooldownUntil && manager.cooldownUntil <= new Date()) {
        console.log(`Health check: Cooldown expired for account ${accountId} - attempting auto-restart`);
        manager.cooldownUntil = undefined; // Clear expired cooldown
        manager.reconnectAttempts = 0; // Reset attempts for fresh start
        
        if (!manager.isActive) {
          console.log(`Auto-restarting account ${accountId} after cooldown expiration`);
          this.restartIdleConnection(accountId).catch(error => {
            console.error(`Failed to auto-restart account ${accountId} after cooldown:`, error);
          });
        }
        return;
      }
      
      // Skip accounts still in cooldown
      if (manager.cooldownUntil && manager.cooldownUntil > new Date()) {
        const remaining = Math.round((manager.cooldownUntil.getTime() - Date.now()) / 1000);
        console.log(`Health check: Skipping account ${accountId} - in cooldown for ${remaining} more seconds`);
        return;
      }
      
      // Skip accounts that have hit max attempts but have no cooldown set (shouldn't happen)
      if (manager.reconnectAttempts >= manager.maxReconnectAttempts && !manager.cooldownUntil) {
        console.log(`Health check: Skipping account ${accountId} - reached max attempts (${manager.maxReconnectAttempts}) without cooldown`);
        return;
      }
      
      // Skip ECONNREFUSED accounts that are in permanent cooldown
      if (manager.lastError?.includes('ECONNREFUSED') && 
          manager.reconnectAttempts >= manager.maxReconnectAttempts) {
        console.log(`Health check: Skipping account ${accountId} - unreachable host (ECONNREFUSED)`);
        return;
      }
      
      // Restart unhealthy connections that haven't reached max attempts
      if (!manager.isActive && manager.reconnectAttempts < manager.maxReconnectAttempts) {
        console.log(`Health check: Restarting unhealthy IDLE connection for account ${accountId} (attempt ${manager.reconnectAttempts}/${manager.maxReconnectAttempts})`);
        this.restartIdleConnection(accountId).catch(error => {
          console.error(`Failed to restart IDLE connection during health check for account ${accountId}:`, error);
        });
      }
      
      // Handle stale active connections (connected but not in IDLE mode)
      if (manager.isActive && !manager.isIdle && !manager.reconnectScheduled) {
        console.log(`Health check: Detected stale connection for account ${accountId} - restarting`);
        this.restartIdleConnection(accountId).catch(error => {
          console.error(`Failed to restart stale connection for account ${accountId}:`, error);
        });
      }
    });
  }
}

// Export singleton instance
let imapIdleService: ImapIdleService | null = null;

export function getImapIdleService(storage: IStorage): ImapIdleService {
  if (!imapIdleService) {
    imapIdleService = new ImapIdleService(storage);
  }
  return imapIdleService;
}

export async function initializeImapIdleService(storage: IStorage): Promise<ImapIdleService> {
  const service = getImapIdleService(storage);
  
  // Start IDLE connections for active accounts
  await service.startAllIdleConnections();
  
  return service;
}

export { ImapIdleService };