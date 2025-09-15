import express, { type Request, Response, NextFunction } from "express";
import { WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import { parse as parseCookie } from "cookie";
import { parse as parseUrl } from "url";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeEwsPushNotifications } from "./ewsPushNotifications";
import { initializeEwsStreamingService } from "./ewsStreaming";
import { initializeImapIdleService } from "./imapIdle";
import { storage } from "./storage";
import { emailEventEmitter, EMAIL_EVENTS, type EmailReceivedEvent } from "./events";
import { getSession } from "./replitAuth";
import { pushNotificationManager, EmailNotificationHelper } from "./push/pushNotifications";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);
  
  // Interface for authenticated WebSocket connections
  interface AuthenticatedWebSocket {
    ws: any;
    userId: string;
    userEmail?: string;
    userAccounts?: Set<string>; // Set of account IDs this user owns
  }

  // Store authenticated WebSocket connections
  const authenticatedConnections = new Map<any, AuthenticatedWebSocket>();

  // Helper function to authenticate WebSocket connection using query parameter
  // For simplicity, we'll require the client to pass userId as a query parameter
  // In a production system, you'd want more robust session validation
  async function authenticateWebSocket(req: IncomingMessage): Promise<{ userId: string; userEmail?: string } | null> {
    try {
      // Parse URL and get query parameters  
      const url = parseUrl(req.url || '', true);
      const userId = url.query.userId as string;
      
      if (!userId) {
        console.log('WebSocket authentication failed: No userId provided');
        return null;
      }

      // Validate that the user exists in our system
      const user = await storage.getUser(userId);
      if (!user) {
        console.log(`WebSocket authentication failed: User ${userId} not found`);
        return null;
      }

      console.log(`WebSocket authentication success: ${user.email} (${userId})`);
      return {
        userId: user.id,
        userEmail: user.email
      };
    } catch (error) {
      console.error('WebSocket authentication error:', error);
      return null;
    }
  }

  // Helper function to get user's account IDs
  async function getUserAccountIds(userId: string): Promise<Set<string>> {
    try {
      const userAccounts = await storage.getUserAccountConnections(userId);
      return new Set(userAccounts.map(account => account.id));
    } catch (error) {
      console.error('Error getting user accounts:', error);
      return new Set();
    }
  }

  // Set up WebSocket server for real-time notifications with authentication
  const wss = new WebSocketServer({ server, path: '/ws' });
  
  wss.on('connection', async (ws, req) => {
    console.log('WebSocket client attempting connection...');
    
    // Authenticate the WebSocket connection
    const authResult = await authenticateWebSocket(req);
    
    if (!authResult) {
      console.log('WebSocket authentication failed, closing connection');
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: 'Authentication required. Please log in and try again.' 
      }));
      ws.close(1008, 'Authentication failed'); // Policy violation
      return;
    }

    // Get user's account IDs for event filtering
    const userAccounts = await getUserAccountIds(authResult.userId);

    // Store authenticated connection
    const authenticatedConn: AuthenticatedWebSocket = {
      ws,
      userId: authResult.userId,
      userEmail: authResult.userEmail,
      userAccounts
    };
    authenticatedConnections.set(ws, authenticatedConn);

    console.log(`WebSocket client authenticated: ${authResult.userEmail} (${authResult.userId})`);
    
    // Send welcome message with user info
    ws.send(JSON.stringify({ 
      type: 'connected', 
      message: 'WebSocket connection established and authenticated',
      userId: authResult.userId,
      accountCount: userAccounts.size
    }));
    
    // Handle client messages
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log(`WebSocket message from ${authResult.userEmail}:`, data);
        
        // Handle ping/pong for connection keepalive
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
      } catch (error) {
        console.error('Invalid WebSocket message:', error);
      }
    });
    
    ws.on('close', () => {
      authenticatedConnections.delete(ws);
      console.log(`WebSocket client disconnected: ${authResult.userEmail}`);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for ${authResult.userEmail}:`, error);
      authenticatedConnections.delete(ws);
    });
  });
  
  // Set up authenticated email event listeners with user filtering
  emailEventEmitter.on(EMAIL_EVENTS.EMAIL_RECEIVED, async (data: EmailReceivedEvent) => {
    const message = JSON.stringify({
      type: EMAIL_EVENTS.EMAIL_RECEIVED,
      data: data
    });
    
    // Broadcast WebSocket notifications to authenticated clients who own the account
    authenticatedConnections.forEach((connInfo, ws) => {
      if (ws.readyState === ws.OPEN && connInfo.userAccounts?.has(data.accountId)) {
        ws.send(message);
        console.log(`Sent emailReceived event to ${connInfo.userEmail} for account ${data.accountId}`);
      }
    });

    // Send push notifications for new emails
    try {
      // Get account owner's user ID from the account
      const account = await storage.getAccountConnection(data.accountId);
      if (!account) {
        console.warn(`Account ${data.accountId} not found for push notification`);
        return;
      }

      // Get user's notification preferences
      const userPrefs = await storage.getUserNotificationPreferences(account.userId);
      const accountPrefs = await storage.getAccountNotificationPreferences(account.userId, data.accountId);
      
      // Check if push notifications are enabled for this user and account
      if (!userPrefs?.enableNotifications || !userPrefs?.enableNewEmailNotifications) {
        console.log(`Push notifications disabled for user ${account.userId}`);
        return;
      }

      if (accountPrefs && !accountPrefs.enableNotifications) {
        console.log(`Push notifications disabled for account ${data.accountId}`);
        return;
      }

      // Check if this folder should trigger notifications
      if (accountPrefs?.notifyForFolders) {
        const allowedFolders = accountPrefs.notifyForFolders.split(',');
        if (!allowedFolders.includes(data.folder.toLowerCase())) {
          console.log(`Folder ${data.folder} not in notification list for account ${data.accountId}`);
          return;
        }
      }

      // Create privacy-aware notification payload
      const notificationPayload = EmailNotificationHelper.createNewEmailNotification(
        {
          id: data.messageId,
          accountId: data.accountId,
          from: data.sender,
          subject: data.subject,
          isVip: false // TODO: Add VIP detection logic
        },
        {
          showSender: userPrefs?.showSenderInNotifications ?? true,
          showSubject: userPrefs?.showSubjectInNotifications ?? true,
          showPreview: false // Never show email body preview for privacy
        }
      );

      // Send push notification
      const result = await pushNotificationManager.sendNotificationToUser(
        account.userId,
        notificationPayload,
        {
          urgency: 'normal',
          TTL: 24 * 60 * 60 // 24 hours
        }
      );

      console.log(`Push notification sent for email ${data.messageId}: ${result.success} success, ${result.failed} failed`);
      
    } catch (error) {
      console.error('Failed to send push notification for email:', error);
    }
  });
  
  emailEventEmitter.on(EMAIL_EVENTS.EMAIL_SYNCED, (data) => {
    const message = JSON.stringify({
      type: EMAIL_EVENTS.EMAIL_SYNCED, 
      data: data
    });
    
    // Broadcast only to authenticated clients who own the account
    authenticatedConnections.forEach((connInfo, ws) => {
      if (ws.readyState === ws.OPEN && connInfo.userAccounts?.has(data.accountId)) {
        ws.send(message);
        console.log(`Sent emailSynced event to ${connInfo.userEmail} for account ${data.accountId}`);
      }
    });
  });
  
  console.log('WebSocket server initialized');
  
  // Initialize EWS push notifications service
  try {
    await initializeEwsPushNotifications(storage);
    log('EWS push notification service initialized');
  } catch (error) {
    console.error('Failed to initialize EWS push notifications:', error);
  }

  // Initialize EWS streaming notifications service
  try {
    await initializeEwsStreamingService(storage);
    log('EWS streaming notification service initialized');
  } catch (error) {
    console.error('Failed to initialize EWS streaming notifications:', error);
  }

  // Initialize IMAP IDLE service
  try {
    await initializeImapIdleService(storage);
    log('IMAP IDLE service initialized');
  } catch (error) {
    console.error('Failed to initialize IMAP IDLE service:', error);
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // Prevent API routes from falling through to SPA - terminal handler for unmatched /api/* routes
  app.use('/api', (_req, res) => {
    res.status(404).json({ message: 'Not Found' });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
