import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertAccountConnectionSchema, sendEmailRequestSchema, type SendEmailRequest, type SendEmailResponse, type ImapSettings } from "@shared/schema";
import { testConnection } from "./connectionTest";
import { discoverImapFolders, appendSentEmailToFolder } from "./emailSync";
import { discoverEwsFolders } from "./ewsSync";
import { getEwsPushService } from "./ewsPushNotifications";
import { getImapIdleService } from "./imapIdle";
import { z } from "zod";
import nodemailer from "nodemailer";
import { decryptAccountSettingsWithPassword } from "./crypto";

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Account connection routes
  app.get('/api/accounts', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const accounts = await storage.getUserAccountConnections(userId);
      res.json(accounts);
    } catch (error) {
      console.error("Error fetching accounts:", error);
      res.status(500).json({ message: "Failed to fetch accounts" });
    }
  });

  // Test connection endpoint - validates credentials before creating account
  app.post('/api/accounts/test-connection', isAuthenticated, async (req: any, res) => {
    try {
      const { 
        protocol, host, port, username, password, useSSL,
        // SMTP settings for IMAP accounts
        enableCustomSmtp, smtpHost, smtpPort, smtpSecure, smtpUsername, smtpPassword
      } = req.body;

      // Validate required fields
      if (!protocol || !host || !username || !password) {
        return res.status(400).json({ 
          message: "Missing required fields: protocol, host, username, password" 
        });
      }

      // Create temporary settings JSON for testing
      let settingsJson: string;
      
      if (protocol === 'IMAP') {
        // For IMAP: enforce port 993 and SSL, and include SMTP settings
        const settings: any = {
          host,
          port: 993, // Always use 993 for IMAP
          username,
          password,
          useSSL: true // Always use SSL for IMAP
        };

        // Add SMTP configuration if provided
        if (enableCustomSmtp) {
          if (!smtpHost || !smtpPort) {
            return res.status(400).json({ 
              message: "SMTP host and port are required when custom SMTP is enabled" 
            });
          }
          settings.smtp = {
            host: smtpHost,
            port: parseInt(smtpPort),
            secure: smtpSecure ?? (parseInt(smtpPort) === 465),
            username: smtpUsername || username, // Default to IMAP username
            password: smtpPassword || password  // Default to IMAP password
          };
        } else {
          // Auto-configure SMTP based on IMAP settings
          const autoSmtpHost = host.replace(/^imap\./, 'smtp.');
          settings.smtp = {
            host: autoSmtpHost,
            port: 587,
            secure: false, // STARTTLS on port 587
            username: username,
            password: password
          };
        }

        settingsJson = JSON.stringify(settings);
      } else if (protocol === 'EWS') {
        // For EWS: no port or SSL settings needed, and no separate SMTP
        settingsJson = JSON.stringify({
          host, // Should be full EWS URL like https://mail.example.com/ews
          username,
          password
        });
      } else {
        return res.status(400).json({ message: "Unsupported protocol. Use IMAP or EWS." });
      }

      // Test the connection (include SMTP test for IMAP accounts)
      const testSmtp = protocol === 'IMAP';
      const testResult = await testConnection(protocol as 'IMAP' | 'EWS', settingsJson, testSmtp);

      if (testResult.success) {
        res.json({ 
          success: true, 
          message: `${protocol} connection test successful${testSmtp ? ' (including SMTP)' : ''}`,
          details: testResult
        });
      } else {
        res.status(400).json({ 
          success: false, 
          message: testResult.error || `${protocol} connection test failed`
        });
      }

    } catch (error: any) {
      console.error("Connection test error:", error);
      res.status(500).json({ 
        success: false, 
        message: error.message || "Connection test failed" 
      });
    }
  });

  app.post('/api/accounts', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { 
        name, protocol, host, port, username, password, useSSL,
        // SMTP settings for IMAP accounts
        enableCustomSmtp, smtpHost, smtpPort, smtpSecure, smtpUsername, smtpPassword
      } = req.body;
      
      // Validate required fields
      if (!name || !protocol || !host || !username || !password) {
        return res.status(400).json({ 
          message: "Missing required fields" 
        });
      }

      // Create settingsJson based on protocol
      let settingsJson: string;
      
      if (protocol === 'IMAP') {
        // For IMAP: enforce port 993 and SSL, and include SMTP settings
        const settings: any = {
          host,
          port: 993, // Always use 993 for IMAP
          username,
          password,
          useSSL: true // Always use SSL for IMAP
        };

        // Add SMTP configuration
        if (enableCustomSmtp) {
          if (!smtpHost || !smtpPort) {
            return res.status(400).json({ 
              message: "SMTP host and port are required when custom SMTP is enabled" 
            });
          }
          settings.smtp = {
            host: smtpHost,
            port: parseInt(smtpPort),
            secure: smtpSecure ?? (parseInt(smtpPort) === 465),
            username: smtpUsername || username, // Default to IMAP username
            password: smtpPassword || password  // Default to IMAP password
          };
        } else {
          // Auto-configure SMTP based on IMAP settings
          const autoSmtpHost = host.replace(/^imap\./, 'smtp.');
          settings.smtp = {
            host: autoSmtpHost,
            port: 587,
            secure: false, // STARTTLS on port 587
            username: username,
            password: password
          };
        }

        settingsJson = JSON.stringify(settings);
      } else if (protocol === 'EWS') {
        // For EWS: no port or SSL settings needed, and no separate SMTP
        settingsJson = JSON.stringify({
          host, // Should be full EWS URL like https://mail.example.com/ews
          username,
          password
        });
      } else {
        return res.status(400).json({ message: "Unsupported protocol. Use IMAP or EWS." });
      }

      // Prepare account data for storage
      const accountData = {
        userId,
        name,
        protocol,
        settingsJson
      };
      
      // Create the account first
      const account = await storage.createAccountConnection(accountData);
      
      // Get encrypted settings for connection testing
      const encryptedAccount = await storage.getAccountConnectionEncrypted(account.id);
      if (!encryptedAccount) {
        throw new Error('Failed to retrieve account for connection testing');
      }
      
      // Test the connection in the background (include SMTP test for IMAP)
      const testSmtp = protocol === 'IMAP';
      testConnection(protocol as 'IMAP' | 'EWS', encryptedAccount.settingsJson, testSmtp)
        .then(async (result) => {
          // Update the account with connection test results
          await storage.updateAccountConnection(account.id, {
            isActive: result.success,
            lastChecked: result.lastChecked,
            lastError: result.error || null,
          });
          
          // If EWS account and successfully connected, discover folders first, then start push notifications
          if (result.success && protocol === 'EWS') {
            try {
              console.log(`Discovering EWS folders for new account ${account.id}`);
              
              // First, discover and sync folders to database
              const folderDiscoveryResult = await discoverEwsFolders(account.id, encryptedAccount.settingsJson, storage);
              
              if (folderDiscoveryResult.success) {
                console.log(`Folder discovery successful for account ${account.id}: ${folderDiscoveryResult.folderCount} folders discovered`);
                
                // Only start push notifications after successful folder discovery
                const pushService = getEwsPushService(storage);
                const subscriptionResult = await pushService.startSubscription(account.id);
                console.log(`Push subscription result for account ${account.id}:`, subscriptionResult);
              } else {
                console.error(`Folder discovery failed for account ${account.id}: ${folderDiscoveryResult.error}`);
                // Update account with folder discovery error but keep it active
                await storage.updateAccountConnection(account.id, {
                  lastError: `Folder discovery failed: ${folderDiscoveryResult.error}`
                });
              }
            } catch (error) {
              console.error(`Failed to setup EWS account ${account.id}:`, error);
              // Update account with setup error
              await storage.updateAccountConnection(account.id, {
                lastError: `EWS setup failed: ${(error as Error).message}`
              });
            }
          }
          
          // If IMAP account and successfully connected, start IDLE connection
          if (result.success && protocol === 'IMAP') {
            try {
              const idleService = getImapIdleService(storage);
              const idleResult = await idleService.startIdleConnection(account.id, 'INBOX');
              console.log(`IDLE connection result for account ${account.id}:`, idleResult);
            } catch (error) {
              console.error(`Failed to start IDLE connection for account ${account.id}:`, error);
            }
          }
        })
        .catch(async (error) => {
          console.error('Background connection test failed:', error);
          // Update with failure status
          await storage.updateAccountConnection(account.id, {
            isActive: false,
            lastChecked: new Date(),
            lastError: 'Connection test failed: ' + error.message,
          });
          
          // Stop push subscription for failed EWS accounts
          if (protocol === 'EWS') {
            try {
              const pushService = getEwsPushService(storage);
              await pushService.stopSubscription(account.id);
            } catch (error) {
              console.error(`Failed to stop push subscription for failed account ${account.id}:`, error);
            }
          }
          
          // Stop IDLE connection for failed IMAP accounts
          if (protocol === 'IMAP') {
            try {
              const idleService = getImapIdleService(storage);
              await idleService.stopIdleConnection(account.id);
            } catch (error) {
              console.error(`Failed to stop IDLE connection for failed account ${account.id}:`, error);
            }
          }
        });
      
      res.json(account);
    } catch (error: any) {
      console.error("Error creating account:", error);
      res.status(500).json({ message: error.message || "Failed to create account" });
    }
  });

  app.put('/api/accounts/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.claims.sub;
      const { 
        name, protocol, host, username, password, useSSL,
        // SMTP settings for IMAP accounts
        enableCustomSmtp, smtpHost, smtpPort, smtpSecure, smtpUsername, smtpPassword
      } = req.body;
      
      // Validate the ID is a proper string
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ message: "Invalid account ID" });
      }
      
      // Verify the account belongs to the user before updating
      const accounts = await storage.getUserAccountConnections(userId);
      const accountToUpdate = accounts.find(account => account.id === id);
      
      if (!accountToUpdate) {
        return res.status(404).json({ message: "Account not found or does not belong to user" });
      }
      
      // Validate required fields
      if (!name || !protocol || !host || !username || !password) {
        return res.status(400).json({ 
          message: "Missing required fields" 
        });
      }

      // Create settingsJson based on protocol with SMTP support
      let settingsJson: string;
      
      if (protocol === 'IMAP') {
        // For IMAP: enforce port 993 and SSL, and include SMTP settings
        const settings: any = {
          host,
          port: 993, // Always use 993 for IMAP
          username,
          password,
          useSSL: true // Always use SSL for IMAP
        };

        // Add SMTP configuration
        if (enableCustomSmtp) {
          if (!smtpHost || !smtpPort) {
            return res.status(400).json({ 
              message: "SMTP host and port are required when custom SMTP is enabled" 
            });
          }
          settings.smtp = {
            host: smtpHost,
            port: parseInt(smtpPort),
            secure: smtpSecure ?? (parseInt(smtpPort) === 465),
            username: smtpUsername || username, // Default to IMAP username
            password: smtpPassword || password  // Default to IMAP password
          };
        } else {
          // Auto-configure SMTP based on IMAP settings
          const autoSmtpHost = host.replace(/^imap\./, 'smtp.');
          settings.smtp = {
            host: autoSmtpHost,
            port: 587,
            secure: false, // STARTTLS on port 587
            username: username,
            password: password
          };
        }

        settingsJson = JSON.stringify(settings);
      } else if (protocol === 'EWS') {
        // For EWS: no port or SSL settings needed, and no separate SMTP
        settingsJson = JSON.stringify({
          host, // Should be full EWS URL like https://mail.example.com/ews
          username,
          password
        });
      } else {
        return res.status(400).json({ message: "Unsupported protocol. Use IMAP or EWS." });
      }
      
      // Test the connection with new settings (include SMTP test for IMAP)
      const testSmtp = protocol === 'IMAP';
      const testResult = await testConnection(protocol as 'IMAP' | 'EWS', settingsJson, testSmtp);
      
      if (!testResult.success) {
        return res.status(400).json({ 
          success: false, 
          message: testResult.error || `${protocol} connection test failed`
        });
      }
      
      // Update the account with new settings
      const updatedAccount = await storage.updateAccountConnection(id, {
        name,
        protocol,
        settingsJson: settingsJson,
        isActive: true,
        lastChecked: new Date(),
        lastError: null,
      });
      
      if (!updatedAccount) {
        return res.status(404).json({ message: "Failed to update account" });
      }
      
      // Restart push subscription for updated EWS accounts
      if (protocol === 'EWS') {
        try {
          const pushService = getEwsPushService(storage);
          // Stop existing subscription if any
          await pushService.stopSubscription(id);
          // Start new subscription with updated settings
          const subscriptionResult = await pushService.startSubscription(id);
          console.log(`Push subscription restarted for updated account ${id}:`, subscriptionResult);
        } catch (error) {
          console.error(`Failed to restart push subscription for updated account ${id}:`, error);
        }
      }
      
      // Restart IDLE connection for updated IMAP accounts
      if (protocol === 'IMAP') {
        try {
          const idleService = getImapIdleService(storage);
          // Stop existing IDLE connection if any
          await idleService.stopIdleConnection(id);
          // Start new IDLE connection with updated settings
          const idleResult = await idleService.startIdleConnection(id, 'INBOX');
          console.log(`IDLE connection restarted for updated account ${id}:`, idleResult);
        } catch (error) {
          console.error(`Failed to restart IDLE connection for updated account ${id}:`, error);
        }
      }
      
      res.json(updatedAccount);
      
    } catch (error: any) {
      console.error("Error updating account:", error);
      res.status(500).json({ message: error.message || "Failed to update account" });
    }
  });

  app.delete('/api/accounts/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.claims.sub;
      
      // Validate the ID is a proper string
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ message: "Invalid account ID" });
      }
      
      // Verify the account belongs to the user before deleting
      const accounts = await storage.getUserAccountConnections(userId);
      const accountToDelete = accounts.find(account => account.id === id);
      
      if (!accountToDelete) {
        return res.status(404).json({ message: "Account not found or does not belong to user" });
      }
      
      // Stop push subscription before deleting EWS account
      if (accountToDelete.protocol === 'EWS') {
        try {
          const pushService = getEwsPushService(storage);
          await pushService.stopSubscription(id);
          console.log(`Push subscription stopped for deleted account ${id}`);
        } catch (error) {
          console.error(`Failed to stop push subscription for deleted account ${id}:`, error);
        }
      }
      
      // Stop IDLE connection before deleting IMAP account
      if (accountToDelete.protocol === 'IMAP') {
        try {
          const idleService = getImapIdleService(storage);
          await idleService.stopIdleConnection(id);
          console.log(`IDLE connection stopped for deleted account ${id}`);
        } catch (error) {
          console.error(`Failed to stop IDLE connection for deleted account ${id}:`, error);
        }
      }
      
      await storage.deleteAccountConnection(id);
      res.json({ message: "Account deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting account:", error);
      res.status(500).json({ message: error.message || "Failed to delete account" });
    }
  });

  // Push notification management routes
  app.get('/api/accounts/:accountId/push-status', isAuthenticated, async (req: any, res) => {
    try {
      const { accountId } = req.params;
      const userId = req.user.claims.sub;
      
      // Verify account belongs to the authenticated user
      const accounts = await storage.getUserAccountConnections(userId);
      const account = accounts.find((a: any) => a.id === accountId);
      
      if (!account) {
        return res.status(404).json({ message: 'Account not found' });
      }
      
      // Only EWS accounts support push notifications
      if (account.protocol !== 'EWS') {
        return res.json({ supported: false, message: 'Push notifications only supported for EWS accounts' });
      }
      
      // Get push notification status
      const pushService = getEwsPushService(storage);
      const status = pushService.getSubscriptionStatus(accountId);
      
      res.json({
        supported: true,
        ...status
      });
      
    } catch (error: any) {
      console.error("Error getting push status:", error);
      res.status(500).json({ message: error.message || "Failed to get push status" });
    }
  });

  app.post('/api/accounts/:accountId/push-start', isAuthenticated, async (req: any, res) => {
    try {
      const { accountId } = req.params;
      const userId = req.user.claims.sub;
      
      // Verify account belongs to the authenticated user
      const accounts = await storage.getUserAccountConnections(userId);
      const account = accounts.find((a: any) => a.id === accountId);
      
      if (!account) {
        return res.status(404).json({ message: 'Account not found' });
      }
      
      // Only EWS accounts support push notifications
      if (account.protocol !== 'EWS') {
        return res.status(400).json({ message: 'Push notifications only supported for EWS accounts' });
      }
      
      // Start push subscription
      const pushService = getEwsPushService(storage);
      const result = await pushService.startSubscription(accountId);
      
      res.json(result);
      
    } catch (error: any) {
      console.error("Error starting push subscription:", error);
      res.status(500).json({ message: error.message || "Failed to start push subscription" });
    }
  });

  app.post('/api/accounts/:accountId/push-stop', isAuthenticated, async (req: any, res) => {
    try {
      const { accountId } = req.params;
      const userId = req.user.claims.sub;
      
      // Verify account belongs to the authenticated user
      const accounts = await storage.getUserAccountConnections(userId);
      const account = accounts.find((a: any) => a.id === accountId);
      
      if (!account) {
        return res.status(404).json({ message: 'Account not found' });
      }
      
      // Stop push subscription
      const pushService = getEwsPushService(storage);
      await pushService.stopSubscription(accountId);
      
      res.json({ success: true, message: 'Push subscription stopped' });
      
    } catch (error: any) {
      console.error("Error stopping push subscription:", error);
      res.status(500).json({ message: error.message || "Failed to stop push subscription" });
    }
  });

  // Account folder routes
  app.get('/api/accounts/:accountId/folders', isAuthenticated, async (req: any, res) => {
    try {
      const { accountId } = req.params;
      
      // Verify account belongs to the authenticated user
      const accounts = await storage.getUserAccountConnections(req.user.claims.sub);
      const account = accounts.find((a: any) => a.id === accountId);
      
      if (!account) {
        return res.status(404).json({ message: 'Account not found' });
      }
      
      // Get folders for this account
      const folders = await storage.getAccountFolders(accountId);
      
      res.json(folders);
    } catch (error) {
      console.error("Error fetching account folders:", error);
      res.status(500).json({ message: "Failed to fetch folders" });
    }
  });

  // Discover folders for an account
  app.post('/api/accounts/:accountId/discover-folders', isAuthenticated, async (req: any, res) => {
    try {
      const { accountId } = req.params;
      
      // Verify account belongs to the authenticated user
      const accounts = await storage.getUserAccountConnections(req.user.claims.sub);
      const account = accounts.find((a: any) => a.id === accountId);
      
      if (!account) {
        return res.status(404).json({ message: 'Account not found' });
      }
      
      if (!account.isActive) {
        return res.status(400).json({ message: 'Account is not active' });
      }
      
      // Get encrypted account settings
      const encryptedAccount = await storage.getAccountConnectionEncrypted(accountId);
      if (!encryptedAccount) {
        return res.status(404).json({ message: 'Account settings not found' });
      }
      
      let result;
      
      if (account.protocol === 'IMAP') {
        result = await discoverImapFolders(
          accountId,
          encryptedAccount.settingsJson,
          storage
        );
      } else if (account.protocol === 'EWS') {
        result = await discoverEwsFolders(
          accountId,
          encryptedAccount.settingsJson,
          storage
        );
      } else {
        return res.status(400).json({ message: `Unsupported protocol: ${account.protocol}` });
      }
      
      res.json({
        success: result.success,
        folderCount: result.folderCount,
        error: result.error
      });
      
    } catch (error) {
      console.error("Error discovering account folders:", error);
      res.status(500).json({ message: "Failed to discover folders" });
    }
  });

  // Mail routes
  app.get('/api/mail/:accountId/:folder', isAuthenticated, async (req: any, res) => {
    try {
      const { accountId, folder } = req.params;
      const { limit = 50, offset = 0 } = req.query;
      const messages = await storage.getMailMessages(accountId, folder.toUpperCase(), parseInt(limit), parseInt(offset));
      res.json(messages);
    } catch (error) {
      console.error("Error fetching mail:", error);
      res.status(500).json({ message: "Failed to fetch mail" });
    }
  });

  // Fallback route for backwards compatibility
  app.get('/api/mail/:accountId', isAuthenticated, async (req: any, res) => {
    try {
      const { accountId } = req.params;
      const { folder, limit = 50, offset = 0 } = req.query;
      const messages = await storage.getMailMessages(accountId, folder, parseInt(limit), parseInt(offset));
      res.json(messages);
    } catch (error) {
      console.error("Error fetching mail:", error);
      res.status(500).json({ message: "Failed to fetch mail" });
    }
  });

  app.patch('/api/mail/:messageId', isAuthenticated, async (req: any, res) => {
    try {
      const { messageId } = req.params;
      const message = await storage.updateMailMessage(messageId, req.body);
      res.json(message);
    } catch (error) {
      console.error("Error updating message:", error);
      res.status(500).json({ message: "Failed to update message" });
    }
  });

  // Email synchronization routes
  app.post('/api/accounts/:accountId/sync', isAuthenticated, async (req: any, res) => {
    try {
      const { accountId } = req.params;
      const { folder = 'INBOX', limit = 25 } = req.body;
      
      // Verify account belongs to the authenticated user
      const accounts = await storage.getUserAccountConnections(req.user.claims.sub);
      const account = accounts.find((a: any) => a.id === accountId);
      
      if (!account) {
        return res.status(404).json({ message: 'Account not found' });
      }
      
      if (!account.isActive) {
        return res.status(400).json({ message: 'Account is not active' });
      }
      
      // Get encrypted account settings
      const encryptedAccount = await storage.getAccountConnectionEncrypted(accountId);
      if (!encryptedAccount) {
        return res.status(404).json({ message: 'Account settings not found' });
      }
      
      if (account.protocol === 'IMAP') {
        // Import IMAP sync function
        const { syncImapEmails } = await import('./emailSync');
        
        const result = await syncImapEmails(
          accountId,
          encryptedAccount.settingsJson,
          storage,
          { folder, limit }
        );
        
        // Update account sync status
        if (!result.success && result.error) {
          await storage.updateAccountConnection(accountId, { 
            lastError: result.error,
            lastChecked: result.lastSync
          });
        } else {
          await storage.updateAccountConnection(accountId, { 
            lastError: null,
            lastChecked: result.lastSync
          });
        }
        
        res.json(result);
      } else if (account.protocol === 'EWS') {
        // Import EWS sync function
        const { syncEwsEmails } = await import('./ewsSync');
        
        const result = await syncEwsEmails(storage, accountId, folder, limit);
        
        if (result.error) {
          res.status(500).json({
            success: false,
            error: result.error,
            messageCount: result.messageCount
          });
        } else {
          res.json({
            success: true,
            messageCount: result.messageCount,
            lastSync: new Date()
          });
        }
      } else {
        res.status(400).json({ message: `Unsupported protocol: ${account.protocol}` });
      }
      
    } catch (error) {
      console.error("Error syncing account:", error);
      res.status(500).json({ message: "Failed to sync account" });
    }
  });

  // Sync all folders for a specific account
  app.post('/api/accounts/:accountId/sync-all', isAuthenticated, async (req: any, res) => {
    try {
      const { accountId } = req.params;
      const { limit = 25 } = req.body;
      
      // Verify account belongs to the authenticated user
      const accounts = await storage.getUserAccountConnections(req.user.claims.sub);
      const account = accounts.find((a: any) => a.id === accountId);
      
      if (!account) {
        return res.status(404).json({ message: 'Account not found' });
      }
      
      if (!account.isActive) {
        return res.status(400).json({ message: 'Account is not active' });
      }
      
      // Get all active folders for this account
      const folders = await storage.getAccountFolders(accountId);
      const activeFolders = folders.filter(folder => folder.isActive);
      
      if (activeFolders.length === 0) {
        return res.status(400).json({ message: 'No active folders found for this account' });
      }
      
      console.log(`Starting sync-all for account ${accountId} with ${activeFolders.length} folders`);
      
      const results = [];
      let totalMessageCount = 0;
      
      // Get encrypted account settings
      const encryptedAccount = await storage.getAccountConnectionEncrypted(accountId);
      if (!encryptedAccount) {
        return res.status(404).json({ message: 'Account settings not found' });
      }
      
      // Sync each folder
      for (const folder of activeFolders) {
        try {
          console.log(`Syncing folder: ${folder.displayName} (${folder.folderType})`);
          
          let result;
          
          if (account.protocol === 'IMAP') {
            // Import IMAP sync function
            const { syncImapEmails } = await import('./emailSync');
            
            result = await syncImapEmails(
              accountId,
              encryptedAccount.settingsJson,
              storage,
              { folder: folder.folderId, limit }
            );
          } else if (account.protocol === 'EWS') {
            // Import EWS sync function
            const { syncEwsEmails } = await import('./ewsSync');
            
            result = await syncEwsEmails(storage, accountId, folder.folderId, limit);
          } else {
            throw new Error(`Unsupported protocol: ${account.protocol}`);
          }
          
          // Update folder sync timestamp
          await storage.updateAccountFolder(folder.id, {
            lastSynced: new Date()
          });
          
          const folderResult = {
            folderId: folder.folderId,
            folderType: folder.folderType,
            displayName: folder.displayName,
            success: result.success !== false,
            messageCount: result.messageCount || 0,
            error: result.error
          };
          
          results.push(folderResult);
          totalMessageCount += folderResult.messageCount;
          
          console.log(`Folder ${folder.displayName}: ${folderResult.messageCount} messages synced`);
          
        } catch (error) {
          console.error(`Error syncing folder ${folder.displayName}:`, error);
          results.push({
            folderId: folder.folderId,
            folderType: folder.folderType,
            displayName: folder.displayName,
            success: false,
            messageCount: 0,
            error: (error as Error).message
          });
        }
      }
      
      // Update account sync status
      const hasErrors = results.some(r => !r.success);
      await storage.updateAccountConnection(accountId, {
        lastChecked: new Date(),
        lastError: hasErrors ? 'Some folders failed to sync' : null
      });
      
      console.log(`Sync-all completed for account ${accountId}: ${totalMessageCount} total messages`);
      
      res.json({
        success: !hasErrors,
        accountId,
        foldersProcessed: results.length,
        totalMessageCount,
        results
      });
      
    } catch (error) {
      console.error("Error syncing all folders:", error);
      res.status(500).json({ message: "Failed to sync all folders" });
    }
  });

  // Sync all accounts for the authenticated user
  app.post('/api/sync/all', isAuthenticated, async (req: any, res) => {
    try {
      // Import sync function dynamically
      const { syncAllUserAccounts } = await import('./emailSync');
      
      const results = await syncAllUserAccounts(req.user.claims.sub, storage);
      
      res.json({
        success: true,
        accountsProcessed: results.length,
        results
      });
      
    } catch (error) {
      console.error("Error syncing all accounts:", error);
      res.status(500).json({ message: "Failed to sync accounts" });
    }
  });

  // Priority rules routes
  app.get('/api/rules/:accountId', isAuthenticated, async (req: any, res) => {
    try {
      const { accountId } = req.params;
      const rules = await storage.getPriorityRules(accountId);
      res.json(rules);
    } catch (error) {
      console.error("Error fetching rules:", error);
      res.status(500).json({ message: "Failed to fetch rules" });
    }
  });

  app.post('/api/rules', isAuthenticated, async (req: any, res) => {
    try {
      const rule = await storage.createPriorityRule(req.body);
      res.json(rule);
    } catch (error) {
      console.error("Error creating rule:", error);
      res.status(500).json({ message: "Failed to create rule" });
    }
  });

  // VIP contacts routes
  app.get('/api/vips', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const vips = await storage.getVipContacts(userId);
      res.json(vips);
    } catch (error) {
      console.error("Error fetching VIPs:", error);
      res.status(500).json({ message: "Failed to fetch VIPs" });
    }
  });

  app.post('/api/vips', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const vip = await storage.createVipContact({ ...req.body, userId });
      res.json(vip);
    } catch (error) {
      console.error("Error creating VIP:", error);
      res.status(500).json({ message: "Failed to create VIP" });
    }
  });

  // User preferences routes
  app.get('/api/preferences', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const prefs = await storage.getUserPrefs(userId);
      res.json(prefs);
    } catch (error) {
      console.error("Error fetching preferences:", error);
      res.status(500).json({ message: "Failed to fetch preferences" });
    }
  });

  app.post('/api/preferences', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const prefs = await storage.upsertUserPrefs({ ...req.body, userId });
      res.json(prefs);
    } catch (error) {
      console.error("Error updating preferences:", error);
      res.status(500).json({ message: "Failed to update preferences" });
    }
  });

  // Email sending endpoint - only for IMAP accounts with SMTP configuration
  app.post('/api/accounts/:accountId/send', isAuthenticated, async (req: any, res) => {
    try {
      const { accountId } = req.params;
      const userId = req.user.claims.sub;

      // Validate request body against schema
      const validationResult = sendEmailRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          success: false,
          error: "Invalid email data: " + validationResult.error.issues.map(i => i.message).join(", ")
        });
      }

      const emailData: SendEmailRequest = validationResult.data;

      // Verify account belongs to user and get encrypted settings
      const accounts = await storage.getUserAccountConnections(userId);
      const account = accounts.find(acc => acc.id === accountId);

      if (!account) {
        return res.status(404).json({
          success: false,
          error: "Account not found or does not belong to user"
        });
      }

      // Only IMAP accounts support SMTP sending
      if (account.protocol !== 'IMAP') {
        return res.status(400).json({
          success: false,
          error: "Email sending is only supported for IMAP accounts. EWS accounts handle sending internally."
        });
      }

      if (!account.isActive) {
        return res.status(400).json({
          success: false,
          error: "Account is not active. Please check account connection."
        });
      }

      // Get encrypted settings for SMTP configuration
      const encryptedAccount = await storage.getAccountConnectionEncrypted(accountId);
      if (!encryptedAccount) {
        return res.status(500).json({
          success: false,
          error: "Failed to retrieve account settings"
        });
      }

      // Decrypt settings to get SMTP configuration
      const settings = decryptAccountSettingsWithPassword(encryptedAccount.settingsJson) as ImapSettings;
      
      if (!settings.smtp) {
        return res.status(500).json({
          success: false,
          error: "SMTP configuration not found for this account"
        });
      }

      // Create nodemailer transporter with SMTP settings
      const transporter = nodemailer.createTransport({
        host: settings.smtp.host,
        port: settings.smtp.port,
        secure: settings.smtp.secure,
        auth: {
          user: settings.smtp.username,
          pass: settings.smtp.password
        },
        connectionTimeout: 30000,
        greetingTimeout: 30000,
        socketTimeout: 30000
      });

      // Verify SMTP connection
      try {
        await transporter.verify();
      } catch (error: any) {
        console.error('SMTP verification failed:', error);
        return res.status(500).json({
          success: false,
          error: "SMTP connection failed: " + error.message
        });
      }

      // Prepare email message
      const mailOptions = {
        from: settings.smtp.username, // Use SMTP username as sender
        to: emailData.to,
        cc: emailData.cc || undefined,
        bcc: emailData.bcc || undefined,
        subject: emailData.subject,
        text: emailData.body,
        html: emailData.bodyHtml || emailData.body.replace(/\n/g, '<br>'), // Convert newlines to HTML if no HTML provided
        attachments: emailData.attachments?.map(att => ({
          filename: att.filename,
          content: att.content,
          encoding: 'base64',
          contentType: att.contentType
        }))
      };

      // Send the email
      let sendResult;
      try {
        sendResult = await transporter.sendMail(mailOptions);
        console.log('Email sent successfully:', sendResult.messageId);
      } catch (error: any) {
        console.error('Failed to send email:', error);
        return res.status(500).json({
          success: false,
          error: "Failed to send email: " + error.message
        });
      }

      // Append sent email to Sent folder via IMAP APPEND
      try {
        const appendResult = await appendSentEmailToFolder(accountId, encryptedAccount.settingsJson, {
          to: emailData.to,
          cc: emailData.cc,
          bcc: emailData.bcc,
          subject: emailData.subject,
          bodyText: emailData.body,
          bodyHtml: emailData.bodyHtml,
          from: settings.smtp.username,
          messageId: sendResult.messageId,
          attachments: emailData.attachments
        });

        if (!appendResult.success) {
          console.error('Failed to append to Sent folder:', appendResult.error);
          // Don't fail the entire request - email was sent successfully
        } else {
          console.log('Successfully appended sent email to Sent folder');
        }
      } catch (error) {
        console.error('Error appending to Sent folder:', error);
        // Don't fail the entire request - email was sent successfully
      }
      
      // Store sent email in database for immediate UI display
      try {
        const sentEmailData = {
          accountId,
          folder: 'SENT',
          messageId: sendResult.messageId || `sent-${Date.now()}`,
          threadId: null,
          subject: emailData.subject,
          from: settings.smtp.username,
          to: emailData.to + (emailData.cc ? `, ${emailData.cc}` : '') + (emailData.bcc ? `, ${emailData.bcc}` : ''),
          date: new Date(),
          size: emailData.body.length + (emailData.bodyHtml?.length || 0),
          hasAttachments: (emailData.attachments?.length || 0) > 0,
          isRead: true, // Sent emails are always "read"
          isFlagged: false,
          priority: 0,
          snippet: emailData.body.substring(0, 200),
          bodyHtml: emailData.bodyHtml || emailData.body.replace(/\n/g, '<br>'),
          bodyText: emailData.body
        };

        await storage.createMailMessage(sentEmailData);
        console.log('Sent email stored in database');
      } catch (error) {
        console.error('Failed to store sent email in database:', error);
        // Don't fail the entire request if database storage fails
      }

      // Return success response
      const response: SendEmailResponse = {
        success: true,
        messageId: sendResult.messageId,
        sentAt: new Date()
      };

      res.json(response);

    } catch (error: any) {
      console.error("Email sending error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to send email"
      });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
