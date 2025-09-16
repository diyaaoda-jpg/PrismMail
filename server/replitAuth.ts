import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

if (!process.env.REPLIT_DOMAINS) {
  throw new Error("Environment variable REPLIT_DOMAINS not provided");
}

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false, // Set to false for development to work with http://localhost
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(
  claims: any,
) {
  await storage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

// Helper function to dynamically register OIDC strategy
async function ensureStrategyRegistered(req: any): Promise<string> {
  const config = await getOidcConfig();
  
  // Use stable PUBLIC_URL if available, otherwise fall back to dynamic construction
  let callbackURL: string;
  if (process.env.PUBLIC_URL) {
    callbackURL = `${process.env.PUBLIC_URL}/api/callback`;
    console.log('[AUTH] Using stable PUBLIC_URL for callback:', callbackURL);
  } else {
    // Fallback to dynamic construction for backward compatibility
    const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
    const host = req.get('host') || req.hostname;
    callbackURL = `${protocol}://${host}/api/callback`;
    console.log('[AUTH] Using dynamic callback URL (consider setting PUBLIC_URL env var):', callbackURL);
  }
  
  // Use stable strategy name based on PUBLIC_URL if available
  const host = req.get('host') || req.hostname;
  const strategyName = process.env.PUBLIC_URL ? 
    `replitauth:stable` : 
    `replitauth:${host}`;
  
  console.log('[AUTH] Dynamic strategy check for:', host);
  console.log('[AUTH] Callback URL:', callbackURL);
  
  // Check if strategy already exists
  try {
    // Try to get the strategy - if it exists, it won't throw
    (passport as any)._strategy(strategyName);
    console.log('[AUTH] Strategy already registered:', strategyName);
    return strategyName;
  } catch (error) {
    // Strategy doesn't exist, continue with registration
  }
  
  console.log('[AUTH] Creating new dynamic strategy:', strategyName);
  
  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };
  
  const strategy = new Strategy(
    {
      name: strategyName,
      config,
      scope: "openid email profile offline_access",
      callbackURL,
    },
    verify,
  );
  
  passport.use(strategy);
  console.log(`[AUTH] ✅ Registered dynamic strategy: ${strategyName}`);
  console.log(`[AUTH] ✅ Callback URL: ${callbackURL}`);
  
  return strategyName;
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", async (req, res, next) => {
    console.log('[AUTH] ===== LOGIN REQUEST DETAILS =====');
    console.log('[AUTH] Hostname:', req.hostname);
    console.log('[AUTH] Host header:', req.get('host'));
    console.log('[AUTH] Protocol:', req.protocol);
    console.log('[AUTH] X-Forwarded-Proto:', req.get('x-forwarded-proto'));
    console.log('[AUTH] Original URL:', req.originalUrl);
    
    try {
      // Dynamically ensure strategy is registered for this request
      const strategyName = await ensureStrategyRegistered(req);
      
      console.log('[AUTH] Using strategy:', strategyName);
      console.log('[AUTH] Available strategies:', Object.keys((passport as any)._strategies || {}));
      
      passport.authenticate(strategyName, {
        prompt: "login consent",
        scope: ["openid", "email", "profile", "offline_access"],
      })(req, res, next);
    } catch (error: unknown) {
      console.error('[AUTH] Error during dynamic strategy registration:', error);
      return res.status(500).json({ 
        error: 'Failed to initialize authentication strategy',
        details: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  // Add a debug route to test callback endpoint accessibility
  app.get("/api/callback/test", (req, res) => {
    console.log('[AUTH] Callback test endpoint hit successfully');
    res.json({ 
      message: 'Callback endpoint is reachable',
      hostname: req.hostname,
      timestamp: new Date().toISOString(),
      headers: req.headers
    });
  });
  
  // Add comprehensive OIDC callback debugging route to capture all callback attempts
  app.all("/api/callback/debug", (req, res) => {
    console.log('[OIDC-DEBUG] ===== COMPREHENSIVE CALLBACK DEBUG =====');
    console.log('[OIDC-DEBUG] Method:', req.method);
    console.log('[OIDC-DEBUG] Original URL:', req.originalUrl);
    console.log('[OIDC-DEBUG] Hostname:', req.hostname);
    console.log('[OIDC-DEBUG] Protocol:', req.protocol);
    console.log('[OIDC-DEBUG] Secure:', req.secure);
    console.log('[OIDC-DEBUG] IP:', req.ip);
    console.log('[OIDC-DEBUG] Full URL:', `${req.protocol}://${req.get('host')}${req.originalUrl}`);
    console.log('[OIDC-DEBUG] Headers:', JSON.stringify(req.headers, null, 2));
    console.log('[OIDC-DEBUG] Query Parameters:', JSON.stringify(req.query, null, 2));
    console.log('[OIDC-DEBUG] Body:', JSON.stringify(req.body, null, 2));
    console.log('[OIDC-DEBUG] Cookies:', JSON.stringify(req.cookies, null, 2));
    console.log('[OIDC-DEBUG] Session ID:', req.sessionID);
    console.log('[OIDC-DEBUG] Session Data:', JSON.stringify(req.session, null, 2));
    console.log('[OIDC-DEBUG] User:', JSON.stringify(req.user, null, 2));
    console.log('[OIDC-DEBUG] Authenticated:', req.isAuthenticated ? req.isAuthenticated() : 'N/A');
    console.log('[OIDC-DEBUG] Available Strategies:', Object.keys((passport as any)._strategies || {}));
    console.log('[OIDC-DEBUG] Timestamp:', new Date().toISOString());
    console.log('[OIDC-DEBUG] ============================================');
    
    res.json({
      success: true,
      message: 'OIDC callback debug information captured',
      data: {
        method: req.method,
        hostname: req.hostname,
        originalUrl: req.originalUrl,
        query: req.query,
        body: req.body,
        headers: req.headers,
        sessionId: req.sessionID,
        isAuthenticated: req.isAuthenticated ? req.isAuthenticated() : false,
        timestamp: new Date().toISOString()
      }
    });
  });
  
  app.get("/api/callback", async (req, res, next) => {
    console.log('[AUTH] ===== CALLBACK REQUEST DETAILS =====');
    console.log('[AUTH] Hostname:', req.hostname);
    console.log('[AUTH] Host header:', req.get('host'));
    console.log('[AUTH] Protocol:', req.protocol);
    console.log('[AUTH] X-Forwarded-Proto:', req.get('x-forwarded-proto'));
    console.log('[AUTH] Original URL:', req.originalUrl);
    console.log('[AUTH] Query params:', req.query);
    console.log('[AUTH] Method:', req.method);
    
    try {
      // Dynamically ensure strategy is registered for this request
      const strategyName = await ensureStrategyRegistered(req);
      
      console.log('[AUTH] Using strategy for callback:', strategyName);
      console.log('[AUTH] Available strategies:', Object.keys(passport._strategies || {}));
      console.log('[AUTH] Proceeding with callback authentication...');
      
      passport.authenticate(strategyName, {
        successReturnToOrRedirect: "/",
        failureRedirect: "/api/login",
        failureFlash: false
      })(req, res, next);
    } catch (error: unknown) {
      console.error('[AUTH] Error during callback strategy registration:', error);
      return res.status(500).json({ 
        error: 'Failed to initialize authentication callback strategy',
        details: error instanceof Error ? error.message : String(error),
        query: req.query
      });
    }
  });

  // Development authentication bypass - enable in development or when explicitly set
  if (process.env.DEV_AUTH_BYPASS === 'true' || app.get('env') === 'development') {
    console.log('[AUTH] Development authentication bypass is ENABLED');
    
    app.post("/api/dev/login", async (req, res) => {
      console.log('[AUTH] Development login attempt:', req.body);
      
      const { userId, email, firstName, lastName } = req.body;
      
      if (!userId || !email) {
        return res.status(400).json({ 
          error: 'Missing required fields: userId and email are required' 
        });
      }
      
      try {
        // Create/update user in our storage
        await storage.upsertUser({
          id: userId,
          email: email,
          firstName: firstName || 'Dev',
          lastName: lastName || 'User',
          profileImageUrl: null,
        });
        
        // Create a mock user session object
        const mockUser = {
          claims: {
            sub: userId,
            email: email,
            first_name: firstName || 'Dev',
            last_name: lastName || 'User',
            exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours from now
          },
          access_token: 'dev-access-token',
          refresh_token: 'dev-refresh-token',
          expires_at: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
        };
        
        // Use passport's req.login to establish session
        req.login(mockUser, (err) => {
          if (err) {
            console.error('[AUTH] Development login failed:', err);
            return res.status(500).json({ error: 'Failed to establish session' });
          }
          
          console.log('[AUTH] Development login successful for:', email);
          res.json({ 
            success: true, 
            message: 'Development authentication successful',
            user: { id: userId, email: email }
          });
        });
        
      } catch (error) {
        console.error('[AUTH] Development login error:', error);
        res.status(500).json({ 
          error: 'Internal server error during development login' 
        });
      }
    });
    
    // Browser-accessible quick login for development
    app.get("/api/dev/quick-login", async (req, res) => {
      console.log('[AUTH] Browser quick login attempt');
      
      try {
        // Generate unique user for this session
        const timestamp = Date.now();
        const userId = `dev-user-${timestamp}`;
        const email = `user${timestamp}@dev.prismmail.local`;
        
        // Create/update user in storage
        await storage.upsertUser({
          id: userId,
          email: email,
          firstName: 'Development',
          lastName: 'User',
          profileImageUrl: null,
        });
        
        // Create mock user session
        const mockUser = {
          claims: {
            sub: userId,
            email: email,
            first_name: 'Development',
            last_name: 'User',
            exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60),
          },
          access_token: 'dev-access-token',
          refresh_token: 'dev-refresh-token',
          expires_at: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
        };
        
        // Establish session and redirect to home
        req.login(mockUser, (err) => {
          if (err) {
            console.error('[AUTH] Browser quick login failed:', err);
            return res.status(500).send('Authentication failed. Please try again.');
          }
          
          console.log('[AUTH] Browser quick login successful for:', email);
          // Redirect to home page which will now show authenticated content
          res.redirect('/');
        });
        
      } catch (error) {
        console.error('[AUTH] Browser quick login error:', error);
        res.status(500).send('Authentication error. Please check logs.');
      }
    });
    
    // Development logout route
    app.post("/api/dev/logout", (req, res) => {
      req.logout(() => {
        console.log('[AUTH] Development logout successful');
        res.json({ success: true, message: 'Development logout successful' });
      });
    });
  } else {
    console.log('[AUTH] Development authentication bypass is DISABLED');
  }

  app.get("/api/logout", async (req, res) => {
    req.logout(async () => {
      const config = await getOidcConfig();
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error: unknown) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};