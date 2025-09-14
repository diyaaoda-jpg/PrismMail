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

export interface ImapFolderManager {
  accountId: string;
  folder: string;
  connection?: ImapFlow;
  isActive: boolean;
  isIdle: boolean;
  lastError?: string;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  reconnectScheduled: boolean;
  cooldownUntil?: Date;
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
  private folderConnections: Map<string, ImapFolderManager> = new Map(); // accountId:folder -> manager
  private storage: IStorage;
  private isShuttingDown: boolean = false;
  private heartbeatInterval?: NodeJS.Timeout;
  
  // Important folders to monitor for IMAP accounts
  private readonly PRIORITY_FOLDERS = ['INBOX', 'Sent', 'Sent Items', 'Drafts', 'Trash', 'Deleted Items'];

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
   * Start IDLE connections for all active IMAP accounts - supports multiple folders
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
      
      // Start multi-folder IDLE connections for each account
      const allConnectionPromises: Promise<{ success: boolean; error?: string; accountId: string; folder: string }>[] = [];
      
      for (const account of imapAccounts) {
        console.log(`Starting multi-folder IDLE connections for account ${account.id} (${account.name})`);
        
        // Get account folders from database
        const accountFolders = await this.storage.getAccountFolders(account.id);
        const foldersToMonitor = accountFolders
          .filter(f => f.isActive && this.PRIORITY_FOLDERS.some(pf => 
            f.displayName.toLowerCase().includes(pf.toLowerCase()) || 
            f.folderId.toLowerCase().includes(pf.toLowerCase())
          ))
          .map(f => f.folderId);
        
        // Fallback to INBOX if no folders found
        if (foldersToMonitor.length === 0) {
          foldersToMonitor.push('INBOX');
        }
        
        console.log(`Account ${account.id} will monitor folders: ${foldersToMonitor.join(', ')}`);
        
        // Start IDLE connection for each priority folder
        for (const folder of foldersToMonitor) {
          allConnectionPromises.push(
            this.startFolderIdleConnection(account.id, folder).then(result => ({
              ...result,
              accountId: account.id,
              folder
            })).catch(error => ({
              success: false,
              error: error.message,
              accountId: account.id,
              folder
            }))
          );
        }
      }
      
      // Wait for all folder connections to complete
      const results = await Promise.allSettled(allConnectionPromises);
      
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      const failed = results.length - successful;
      
      console.log(`IMAP IDLE initialization completed: ${successful} successful, ${failed} failed`);
      console.log(`Total folder connections started: ${results.length}`);
      
    } catch (error) {
      console.error('Error starting all IMAP IDLE connections:', error);
    }
  }

  /**
   * Start IDLE connection for a specific folder (multi-folder support)
   */
  async startFolderIdleConnection(accountId: string, folder: string): Promise<{ success: boolean; error?: string }> {
    const connectionKey = `${accountId}:${folder}`;
    
    try {
      // Check if this specific folder connection already exists
      const existingManager = this.folderConnections.get(connectionKey);
      if (existingManager?.isActive) {
        console.log(`IDLE connection already active for account ${accountId}, folder ${folder}`);
        return { success: true };
      }
      
      console.log(`Starting IDLE connection for account ${accountId}, folder: ${folder}`);
      
      // Get encrypted account settings
      const accountData = await this.storage.getAccountConnectionEncrypted(accountId);
      if (!accountData) {
        throw new Error('Account not found');
      }

      // Decrypt account settings
      const settings = decryptAccountSettingsWithPassword(accountData.settingsJson);
      
      // Create dedicated IMAP connection for this folder
      const client = new ImapFlow({
        host: settings.host,
        port: settings.port,
        secure: settings.useSSL,
        auth: {
          user: settings.username,
          pass: settings.password,
        },
        socketTimeout: 60000,
        greetingTimeout: 30000,
        maxIdleTime: 30 * 60 * 1000, // 30 minutes max IDLE time
      });

      // Create folder-specific manager
      const folderManager: ImapFolderManager = {
        accountId,
        folder,
        connection: client,
        isActive: false,
        isIdle: false,
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
        reconnectScheduled: false
      };

      this.folderConnections.set(connectionKey, folderManager);

      // Set up event handlers for this specific folder connection
      this.setupFolderIdleEventHandlers(client, accountId, folder);

      // Connect and start IDLE for this folder
      await this.connectAndStartFolderIdle(folderManager);

      console.log(`IMAP IDLE connection started successfully for account ${accountId}, folder ${folder}`);
      
      return { success: true };

    } catch (error: any) {
      console.error(`Failed to start IMAP IDLE connection for account ${accountId}, folder ${folder}:`, error);
      
      return { 
        success: false, 
        error: error.message || 'Failed to start folder IDLE connection' 
      };
    }
  }

  /**
   * Setup IDLE event handlers for folder-specific connection
   */
  private setupFolderIdleEventHandlers(client: ImapFlow, accountId: string, folder: string): void {
    const connectionKey = `${accountId}:${folder}`;
    
    client.on('exists', async (data) => {
      console.log(`📧 New message in ${folder} for account ${accountId}: UID ${data.uid}`);
      
      // Trigger incremental sync for this folder
      try {
        await syncImapEmails(accountId, folder, this.storage, { limit: 10 });
        console.log(`✅ Incremental sync completed for ${folder}`);
      } catch (error) {
        console.error(`❌ Incremental sync failed for ${folder}:`, error);
      }
      
      // Emit notification event
      const event: ImapNotificationEvent = {
        accountId,
        folder,
        eventType: 'EXISTS',
        details: data,
        timestamp: new Date()
      };
      
      // Could emit events here for real-time UI updates
      console.log(`📨 IMAP notification: ${JSON.stringify(event)}`);
    });

    client.on('expunge', (data) => {
      console.log(`🗑️ Message deleted in ${folder} for account ${accountId}: UID ${data.uid}`);
      
      const event: ImapNotificationEvent = {
        accountId,
        folder,
        eventType: 'EXPUNGE',
        details: data,
        timestamp: new Date()
      };
      
      console.log(`🗂️ IMAP notification: ${JSON.stringify(event)}`);
    });

    client.on('fetch', (data) => {
      console.log(`📨 Message updated in ${folder} for account ${accountId}: UID ${data.uid}`);
      
      const event: ImapNotificationEvent = {
        accountId,
        folder,
        eventType: 'FETCH',
        details: data,
        timestamp: new Date()
      };
      
      console.log(`📋 IMAP notification: ${JSON.stringify(event)}`);
    });

    client.on('close', () => {
      console.log(`IMAP connection closed for account ${accountId}, folder ${folder}`);
      const manager = this.folderConnections.get(connectionKey);
      if (manager) {
        manager.isActive = false;
        manager.isIdle = false;
      }
      
      // Attempt reconnection if not shutting down
      if (!this.isShuttingDown && manager && manager.reconnectAttempts < manager.maxReconnectAttempts) {
        this.scheduleReconnection(connectionKey, 5000); // 5 second delay
      }
    });

    client.on('error', (error) => {
      console.error(`IMAP connection error for account ${accountId}, folder ${folder}:`, error);
      const manager = this.folderConnections.get(connectionKey);
      if (manager) {
        manager.lastError = error.message;
        manager.isActive = false;
        manager.isIdle = false;
      }
    });
  }

  /**
   * Connect and start IDLE for a specific folder
   */
  private async connectAndStartFolderIdle(manager: ImapFolderManager): Promise<void> {
    if (!manager.connection) {
      throw new Error('No connection available');
    }

    const client = manager.connection;
    
    try {
      // Connect to IMAP server
      await client.connect();
      console.log(`Connected to IMAP server for account ${manager.accountId}, folder ${manager.folder}`);
      
      // Select the specific folder
      const lock = await client.getMailboxLock(manager.folder);
      
      // Store the lock for later release
      manager.mailboxLock = lock;
      
      // Set state BEFORE starting IDLE
      manager.isActive = true;
      manager.selectedFolder = manager.folder;
      
      console.log(`Starting IDLE mode for account ${manager.accountId}, folder ${manager.folder}`);
      
      // Start IDLE mode (this will block until IDLE is broken)
      client.idle().catch(error => {
        console.error(`IDLE error for account ${manager.accountId}, folder ${manager.folder}:`, error);
        manager.lastError = error.message;
        manager.isIdle = false;
        
        // Release lock on error
        if (manager.mailboxLock) {
          manager.mailboxLock.release();
          manager.mailboxLock = undefined;
        }
      });
      
      manager.isIdle = true;
      console.log(`✅ IDLE mode started successfully for account ${manager.accountId}, folder ${manager.folder}`);
      
    } catch (error: any) {
      console.error(`Failed to start IDLE for account ${manager.accountId}, folder ${manager.folder}:`, error);
      manager.lastError = error.message;
      manager.isActive = false;
      manager.isIdle = false;
      
      // Clean up on failure
      if (manager.mailboxLock) {
        try {
          manager.mailboxLock.release();
        } catch (lockError) {
          console.log(`Failed to release lock for ${manager.folder}:`, lockError);
        }
        manager.mailboxLock = undefined;
      }
      
      throw error;
    }
  }

  /**
   * Schedule reconnection for a folder connection
   */
  private scheduleReconnection(connectionKey: string, delay: number): void {
    const manager = this.folderConnections.get(connectionKey);
    if (!manager || manager.reconnectScheduled || this.isShuttingDown) {
      return;
    }
    
    manager.reconnectScheduled = true;
    manager.reconnectAttempts++;
    
    console.log(`Scheduling reconnection for ${connectionKey} in ${delay}ms (attempt ${manager.reconnectAttempts}/${manager.maxReconnectAttempts})`);
    
    setTimeout(async () => {
      if (this.isShuttingDown) {
        return;
      }
      
      manager.reconnectScheduled = false;
      
      try {
        const result = await this.startFolderIdleConnection(manager.accountId, manager.folder);
        if (result.success) {
          console.log(`✅ Reconnection successful for ${connectionKey}`);
          manager.reconnectAttempts = 0; // Reset on success
        } else {
          console.error(`❌ Reconnection failed for ${connectionKey}: ${result.error}`);
        }
      } catch (error) {
        console.error(`❌ Reconnection error for ${connectionKey}:`, error);
      }
    }, delay);
  }

  /**
   * Stop all IDLE connections (used during shutdown)
   */
  async stopAllIdleConnections(): Promise<void> {
    console.log('Stopping all IMAP IDLE connections...');
    this.isShuttingDown = true;

    // Stop legacy single-folder connections
    const stopPromises = Array.from(this.connections.keys()).map(accountId => 
      this.stopIdleConnection(accountId)
    );

    // Stop multi-folder connections
    const stopFolderPromises = Array.from(this.folderConnections.keys()).map(connectionKey => 
      this.stopFolderIdleConnection(connectionKey)
    );

    await Promise.all([...stopPromises, ...stopFolderPromises]);

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    console.log('All IMAP IDLE connections stopped');
  }

  /**
   * Stop a specific folder IDLE connection
   */
  async stopFolderIdleConnection(connectionKey: string): Promise<void> {
    const manager = this.folderConnections.get(connectionKey);
    if (!manager) {
      return;
    }

    console.log(`Stopping IDLE connection for ${connectionKey}`);

    try {
      if (manager.connection && manager.isActive) {
        // Stop IDLE mode if active
        if (manager.isIdle) {
          try {
            await manager.connection.noop(); // Send NOOP to break IDLE
          } catch (idleError) {
            console.log(`IDLE stop failed for ${connectionKey}`);
          }
        }
        
        // Release the mailbox lock
        if (manager.mailboxLock) {
          try {
            manager.mailboxLock.release();
          } catch (lockError) {
            console.log(`Lock release failed for ${connectionKey}`);
          }
        }
        
        // Close connection
        try {
          await manager.connection.logout();
        } catch (logoutError) {
          console.log(`Logout failed for ${connectionKey}`);
        }
      }
    } catch (error) {
      console.error(`Error stopping IDLE connection for ${connectionKey}:`, error);
    } finally {
      // Clean up manager state
      manager.isActive = false;
      manager.isIdle = false;
      manager.connection = undefined;
      manager.mailboxLock = undefined;
      
      // Remove from connections map
      this.folderConnections.delete(connectionKey);
    }
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