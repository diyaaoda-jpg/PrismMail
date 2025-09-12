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
      
      // Test the connection in the background
      testConnection(accountData.protocol as 'IMAP' | 'EWS', account.settingsJson)
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
