import express, { type Request, Response, NextFunction } from "express";
import { WebSocketServer } from "ws";
import { IncomingMessage, createServer } from "http";
import { parse as parseCookie } from "cookie";
import { parse as parseUrl } from "url";
import { registerRoutes } from "./routes";
import { setupAttachmentRoutes } from "./attachmentRoutes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeEwsPushNotifications } from "./ewsPushNotifications";
import { initializeEwsStreamingService } from "./ewsStreaming";
import { initializeImapIdleService } from "./imapIdle";
import { storage } from "./storage";
import { emailEventEmitter, EMAIL_EVENTS } from "./events";
import { getSession } from "./replitAuth";
import { db } from "./db";
import { sessions } from "@shared/schema";
import { sql } from "drizzle-orm";

// Production-grade architecture imports
import { ArchitectureIntegration, BackwardCompatibility } from "./integration/index.js";
import { config } from "./config/index.js";
import { logger } from "./utils/logger.js";
import { metrics, EmailMetrics } from "./monitoring/metrics.js";

const app = express();

// Set trust proxy for external domain access (Replit hosting)
app.set('trust proxy', 1);

// Initialize production-grade architecture FIRST
const architectureIntegration = new ArchitectureIntegration(app);

// Basic middleware (before routes)
app.use(express.json({ limit: config.performance.requestTimeout ? '10mb' : '1mb' }));
app.use(express.urlencoded({ extended: false }));

// CRITICAL FIX: Register ALL API routes BEFORE Vite setup
// This ensures API routes get priority over Vite's catch-all
const server = createServer(app);

(async () => {
  try {
    // Initialize production-grade architecture foundation
    await architectureIntegration.initialize();
    
    // Ensure backward compatibility
    BackwardCompatibility.ensureWebSocketCompatibility();
    BackwardCompatibility.ensureEmailSyncCompatibility();
    BackwardCompatibility.ensureUICompatibility();
    
    logger.info('Production-grade architecture successfully integrated');
  } catch (error) {
    logger.error('Failed to initialize production-grade architecture', { error: error as Error });
    process.exit(1);
  }
  await registerRoutes(app);
  
  // Setup enhanced attachment routes with comprehensive security
  setupAttachmentRoutes(app);

  // ARCHITECT FIX: Setup Vite AFTER routes but BEFORE 404 fallback
  if (config.server.nodeEnv === 'development') {
    // CRITICAL FIX: Set Vite HMR port to prevent WebSocket connection issues
    process.env.VITE_HMR_PORT = '5000';
    process.env.VITE_DEV_SERVER_URL = `http://localhost:5000`;
    
    // CRITICAL FIX: Prevent Content-Encoding mismatch causing net::ERR_CONTENT_DECODING_FAILED
    app.use((req, res, next) => {
      const originalEnd = res.end.bind(res);
      const originalSend = res.send.bind(res);
      
      res.end = function(chunk?: any, encoding?: any, cb?: any) {
        const contentType = res.getHeader('Content-Type');
        if (typeof contentType === 'string' && (contentType.includes('text/html') || contentType.includes('javascript') || contentType.includes('css'))) {
          res.removeHeader('Content-Encoding');
          res.setHeader('Cache-Control', 'no-transform');
        }
        return originalEnd(chunk, encoding, cb);
      };
      
      res.send = function(body?: any) {
        const contentType = res.getHeader('Content-Type');
        if (typeof contentType === 'string' && (contentType.includes('text/html') || contentType.includes('javascript') || contentType.includes('css'))) {
          res.removeHeader('Content-Encoding');
          res.setHeader('Cache-Control', 'no-transform');
        }
        return originalSend(body);
      };
      
      next();
    });
    
    await setupVite(app, server);
    log('🎯 CONTENT-ENCODING FIX: Stripped compression headers to prevent decoding errors');
  }

  // Health check endpoints are already handled in registerRoutes()

  // CRITICAL: Enforce platform-assigned PORT environment variable
  const envPort = process.env.PORT;
  if (!envPort) {
    console.error('CRITICAL: PORT environment variable is required but not set');
    console.error('The platform assigns a specific PORT that must be used for external access');
    logger.error('Server startup failed: PORT environment variable not set');
    process.exit(1);
  }
  
  const port = parseInt(envPort, 10);
  if (isNaN(port) || port <= 0) {
    console.error(`CRITICAL: Invalid PORT environment variable: ${envPort}`);
    logger.error('Server startup failed: Invalid PORT value', { port: envPort });
    process.exit(1);
  }

  // CRITICAL: Start server listening immediately to enable early health checks
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    console.log(`✅ CRITICAL FIX: Server successfully bound to platform-assigned PORT ${port}`);
    console.log(`🌐 External access now available at http://0.0.0.0:${port}`);
    log(`Server listening on platform PORT ${port} - external access enabled`);
    logger.info('Server started successfully', { port, host: '0.0.0.0' });
  });
  
  // Initialize services asynchronously after server is listening
  
  // Interface for authenticated WebSocket connections
  interface AuthenticatedWebSocket {
    ws: any;
    userId: string;
    userEmail?: string;
    userAccounts?: Set<string>; // Set of account IDs this user owns
  }

  // Store authenticated WebSocket connections
  const authenticatedConnections = new Map<any, AuthenticatedWebSocket>();

  // SECURITY FIX: Authenticate WebSocket connection using session validation
  // Replaced spoofable userId query parameter with secure session-based authentication
  async function authenticateWebSocket(req: IncomingMessage): Promise<{ userId: string; userEmail?: string } | null> {
    try {
      // Extract and validate session from cookies
      const cookieHeader = req.headers.cookie;
      if (!cookieHeader) {
        console.log('WebSocket authentication failed: No session cookie');
        return null;
      }

      // Parse cookies properly using imported cookie parser
      const cookies = parseCookie(cookieHeader);
      const connectSidCookie = cookies['connect.sid'];
      
      if (!connectSidCookie) {
        console.log('WebSocket authentication failed: No valid session cookie');
        return null;
      }

      // Handle signed cookies (format: s:<sid>.<signature>)
      let sessionId = connectSidCookie;
      if (connectSidCookie.startsWith('s:')) {
        // Extract the raw session ID from signed cookie (before first dot)
        const signedPart = connectSidCookie.slice(2); // Remove 's:' prefix
        sessionId = signedPart.split('.')[0]; // Get sid before signature
      }
      
      // Query sessions table directly to validate session
      const [sessionRecord] = await db.select()
        .from(sessions)
        .where(sql`sid = ${sessionId} AND expire > NOW()`);
      
      if (!sessionRecord || !sessionRecord.sess) {
        console.log('WebSocket authentication failed: Invalid or expired session');
        return null;
      }

      // Parse session data to extract user information (handle multiple auth formats)
      const sessionData = sessionRecord.sess as any;
      const userId = sessionData.passport?.user?.id || 
                     sessionData.user?.id || 
                     sessionData.userId;
      
      if (!userId) {
        console.log('WebSocket authentication failed: No authenticated user in session');
        return null;
      }

      // Get user details from validated session
      const user = await storage.getUser(userId);
      if (!user) {
        console.log(`WebSocket authentication failed: User ${userId} not found`);
        return null;
      }

      console.log(`WebSocket authentication success: ${user.email} (${user.id})`);
      return {
        userId: user.id,
        userEmail: user.email ?? undefined
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
  
  // Add comprehensive error handling for the WebSocket server itself
  wss.on('error', (error) => {
    console.error('WebSocket server error:', error);
    logger.error('WebSocket server error occurred', { error: error as Error });
    // Don't crash the application for WebSocket server errors
  });
  
  // Handle WebSocket server issues
  wss.on('close', () => {
    console.log('WebSocket server closed');
    logger.info('WebSocket server closed');
  });
  
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
  emailEventEmitter.on(EMAIL_EVENTS.EMAIL_RECEIVED, (data) => {
    const message = JSON.stringify({
      type: EMAIL_EVENTS.EMAIL_RECEIVED,
      data: data
    });
    
    // Broadcast only to authenticated clients who own the account
    authenticatedConnections.forEach((connInfo, ws) => {
      if (ws.readyState === ws.OPEN && connInfo.userAccounts?.has(data.accountId)) {
        ws.send(message);
        console.log(`Sent emailReceived event to ${connInfo.userEmail} for account ${data.accountId}`);
      }
    });
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

  // Enhanced error handler that doesn't crash the process
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // Log the error for debugging
    console.error('Express error handler:', err);
    logger.error('HTTP request error', { 
      error: err, 
      status, 
      message,
      stack: err.stack 
    });

    // Send error response but don't crash the process
    if (!res.headersSent) {
      res.status(status).json({ message });
    }
  });

  // Fixed frontend serving logic with proper environment detection
  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  const isProduction = process.env.NODE_ENV === 'production';
  const isDevelopment = !isProduction;
  
  if (isDevelopment) {
    try {
      // Permanently override process.exit to prevent Vite from killing the server on warnings
      const originalExit = process.exit;
      let exitAttempts = 0;
      
      // Create permanent process.exit protection for development mode
      process.exit = ((code?: number): never => {
        exitAttempts++;
        console.log(`[VITE-PROTECTION] Prevented process.exit(${code}) - attempt #${exitAttempts} - server continues running`);
        log(`Process exit attempt #${exitAttempts} prevented - Vite/CSS warnings will not crash the server`, 'vite-protection');
        
        // Log the stack trace to help identify what's trying to exit
        const stack = new Error().stack;
        if (stack) {
          console.log('[VITE-PROTECTION] Exit attempt stack trace:', stack);
        }
        
        // Return a dummy never-returning promise to satisfy TypeScript
        return new Promise(() => {}) as never;
      }) as any;
      
      // Set up graceful shutdown handlers that can override the protection when needed
      const gracefulShutdown = (signal: string) => {
        console.log(`[SHUTDOWN] Received ${signal} - initiating graceful shutdown`);
        log(`Graceful shutdown initiated by ${signal}`, 'shutdown');
        
        // Restore original process.exit for graceful shutdown
        process.exit = originalExit;
        
        // Give a moment for cleanup then exit
        setTimeout(() => {
          console.log('[SHUTDOWN] Graceful shutdown complete');
          process.exit(0);
        }, 1000);
      };
      
      // Handle common shutdown signals
      process.on('SIGINT', () => gracefulShutdown('SIGINT'));
      process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
      
      // FINAL FIX: Vite setup removed from here - will be called before 404 fallback
      
      log('Vite development server initialized with permanent exit protection');
      log('Use Ctrl+C (SIGINT) or SIGTERM for graceful shutdown', 'vite-protection');
      
    } catch (error) {
      console.error('CRITICAL: Failed to setup Vite dev server:', error);
      logger.error('Vite setup failed', { error: error as Error });
      // Log the full error details for debugging
      console.error('Vite setup error details:', {
        message: (error as Error).message,
        stack: (error as Error).stack,
        name: (error as Error).name
      });
      // Fallback to basic static serving if Vite fails
      serveBasicStatic(app);
    }
  } else {
    try {
      serveStatic(app);
      log('Static file serving initialized for production');
    } catch (error) {
      console.error('Failed to setup static file serving:', error);
      logger.error('Static file setup failed', { error: error as Error });
      // Fallback to basic static serving
      serveBasicStatic(app);
    }
  }

  // Fallback static serving function for when main methods fail
  function serveBasicStatic(app: express.Express) {
    log('Using fallback static file serving');
    // Serve a basic HTML response as ultimate fallback
    app.use('*', (_req: Request, res: Response) => {
      res.status(200).set({ 'Content-Type': 'text/html' }).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>PrismMail</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body>
          <div id="root">
            <div style="display: flex; justify-content: center; align-items: center; height: 100vh; font-family: Arial, sans-serif;">
              <div style="text-align: center;">
                <h1>PrismMail Server Running</h1>
                <p>The server is running but frontend assets are not available.</p>
                <p>Please check the development environment setup.</p>
                <p><a href="/healthz">Health Check</a></p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `);
    });
  }

  // Server is already listening on the platform-assigned PORT above
  // All initialization is complete
})();
