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
    try {
      // Try the correct Replit OIDC discovery endpoint
      return await client.discovery(
        new URL(process.env.ISSUER_URL ?? "https://replit.com"),
        process.env.REPL_ID!
      );
    } catch (error) {
      console.error('[AUTH] OIDC discovery failed, disabling authentication:', error);
      console.log('[AUTH] Authentication will be disabled due to OIDC configuration failure');
      // Return null to disable authentication instead of creating a broken fallback
      return null;
    }
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
      secure: true,
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
  try {
    console.log('[AUTH] Upserting user with claims:', {
      sub: claims["sub"],
      email: claims["email"] ? '[REDACTED]' : undefined,
      firstName: claims["first_name"],
      lastName: claims["last_name"]
    });

    const result = await storage.upsertUser({
      id: claims["sub"],
      email: claims["email"],
      firstName: claims["first_name"],
      lastName: claims["last_name"],
      profileImageUrl: claims["profile_image_url"],
    });

    console.log('[AUTH] Successfully upserted user:', { id: result.id, email: result.email ? '[REDACTED]' : undefined });
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('[AUTH] Critical error during user upsert:', {
      error: errorMessage,
      stack: errorStack,
      claims: {
        sub: claims["sub"],
        email: claims["email"] ? '[REDACTED]' : undefined,
        firstName: claims["first_name"],
        lastName: claims["last_name"]
      },
      timestamp: new Date().toISOString()
    });
    throw new Error(`Authentication failed: Unable to create or update user record. ${errorMessage}`);
  }
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  if (!config) {
    console.log('[AUTH] OIDC configuration failed, setting up development authentication fallback');
    
    // Development mode fallback - add simple auth routes that will work for testing
    app.get("/api/login", (req, res) => {
      console.log('[AUTH] Development login redirect - OIDC not available');
      res.status(503).json({
        success: false,
        error: {
          code: 'AUTH_UNAVAILABLE',
          message: 'Authentication service temporarily unavailable',
          details: 'OIDC discovery failed - please check server configuration'
        }
      });
    });

    app.get("/api/callback", (req, res) => {
      console.log('[AUTH] Development callback - OIDC not available');
      res.status(503).json({
        success: false,
        error: {
          code: 'AUTH_UNAVAILABLE', 
          message: 'Authentication callback unavailable',
          details: 'OIDC discovery failed - please check server configuration'
        }
      });
    });

    app.get("/api/logout", (req, res) => {
      console.log('[AUTH] Development logout - redirecting to home');
      res.redirect('/');
    });
    
    return;
  }

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    try {
      console.log('[AUTH] Starting OIDC verification process');
      
      const user = {};
      updateUserSession(user, tokens);
      
      // Upsert user with comprehensive error handling
      await upsertUser(tokens.claims());
      
      console.log('[AUTH] OIDC verification completed successfully');
      verified(null, user);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error('[AUTH] OIDC verification failed:', {
        error: errorMessage,
        stack: errorStack,
        timestamp: new Date().toISOString()
      });
      
      // Pass the error to passport which will redirect to failure page
      // instead of crashing the server
      verified(error, false);
    }
  };

  for (const domain of process.env
    .REPLIT_DOMAINS!.split(",")) {
    const strategy = new Strategy(
      {
        name: `replitauth:${domain}`,
        config,
        scope: "openid email profile offline_access",
        callbackURL: `https://${domain}/api/callback`,
      },
      verify,
    );
    passport.use(strategy);
  }

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    console.log('[AUTH] Login initiated for hostname:', req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    console.log('[AUTH] OIDC callback received for hostname:', req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
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
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};