import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertAccountConnectionSchema } from "@shared/schema";
import { testConnection } from "./connectionTest";
import { z } from "zod";

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
      const { protocol, host, port, username, password, useSSL } = req.body;

      // Validate required fields
      if (!protocol || !host || !username || !password) {
        return res.status(400).json({ 
          message: "Missing required fields: protocol, host, username, password" 
        });
      }

      // Create temporary settings JSON for testing
      let settingsJson: string;
      
      if (protocol === 'IMAP') {
        // For IMAP: enforce port 993 and SSL
        settingsJson = JSON.stringify({
          host,
          port: 993, // Always use 993 for IMAP
          username,
          password,
          useSSL: true // Always use SSL for IMAP
        });
      } else if (protocol === 'EWS') {
        // For EWS: no port or SSL settings needed
        settingsJson = JSON.stringify({
          host, // Should be full EWS URL like https://mail.example.com/ews
          username,
          password
        });
      } else {
        return res.status(400).json({ message: "Unsupported protocol. Use IMAP or EWS." });
      }

      // Test the connection
      const testResult = await testConnection(protocol as 'IMAP' | 'EWS', settingsJson);

      if (testResult.success) {
        res.json({ 
          success: true, 
          message: `${protocol} connection test successful`,
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
      
      // Validate request body using Zod schema
      const validationResult = insertAccountConnectionSchema.safeParse({
        ...req.body,
        userId
      });
      
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validationResult.error.issues 
        });
      }
      
      const accountData = validationResult.data;
      
      // Create the account first
      const account = await storage.createAccountConnection(accountData);
      
      // Get encrypted settings for connection testing
      const encryptedAccount = await storage.getAccountConnectionEncrypted(account.id);
      if (!encryptedAccount) {
        throw new Error('Failed to retrieve account for connection testing');
      }
      
      // Test the connection in the background
      testConnection(accountData.protocol as 'IMAP' | 'EWS', encryptedAccount.settingsJson)
        .then(async (result) => {
          // Update the account with connection test results
          await storage.updateAccountConnection(account.id, {
            isActive: result.success,
            lastChecked: result.lastChecked,
            lastError: result.error || null,
          });
        })
        .catch((error) => {
          console.error('Background connection test failed:', error);
          // Update with failure status
          storage.updateAccountConnection(account.id, {
            isActive: false,
            lastChecked: new Date(),
            lastError: 'Connection test failed: ' + error.message,
          });
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
      
      // Validate request body using Zod schema (excluding userId and id)
      const updateSchema = insertAccountConnectionSchema.omit({ userId: true });
      const validationResult = updateSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validationResult.error.issues 
        });
      }
      
      const updateData = validationResult.data;
      
      // Test the connection before updating
      let settingsJson: string;
      
      if (updateData.protocol === 'IMAP') {
        // For IMAP: enforce port 993 and SSL
        settingsJson = JSON.stringify({
          host: JSON.parse(updateData.settingsJson).host,
          port: 993,
          username: JSON.parse(updateData.settingsJson).username,
          password: JSON.parse(updateData.settingsJson).password,
          useSSL: true
        });
      } else if (updateData.protocol === 'EWS') {
        // For EWS: no port or SSL settings needed
        settingsJson = JSON.stringify({
          host: JSON.parse(updateData.settingsJson).host,
          username: JSON.parse(updateData.settingsJson).username,
          password: JSON.parse(updateData.settingsJson).password
        });
      } else {
        return res.status(400).json({ message: "Unsupported protocol. Use IMAP or EWS." });
      }
      
      // Test the connection with new settings
      const testResult = await testConnection(updateData.protocol as 'IMAP' | 'EWS', settingsJson);
      
      if (!testResult.success) {
        return res.status(400).json({ 
          success: false, 
          message: testResult.error || `${updateData.protocol} connection test failed`
        });
      }
      
      // Update the account with new settings
      const updatedAccount = await storage.updateAccountConnection(id, {
        name: updateData.name,
        protocol: updateData.protocol,
        settingsJson: settingsJson,
        isActive: true,
        lastChecked: new Date(),
        lastError: null,
      });
      
      if (!updatedAccount) {
        return res.status(404).json({ message: "Failed to update account" });
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
      
      await storage.deleteAccountConnection(id);
      res.json({ message: "Account deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting account:", error);
      res.status(500).json({ message: error.message || "Failed to delete account" });
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

  const httpServer = createServer(app);

  return httpServer;
}
