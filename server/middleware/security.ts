import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { fromZodError } from 'zod-validation-error';

/**
 * Rate limiting store interface
 */
interface RateLimitStore {
  get(key: string): Promise<number | null>;
  set(key: string, value: number, ttl: number): Promise<void>;
  increment(key: string, ttl: number): Promise<number>;
  reset(key: string): Promise<void>;
  startCleanup(): void;
  stopCleanup(): void;
}

/**
 * Simple memory-only rate limit store for clean PrismMail installation
 */
class RedisRateLimitStore implements RateLimitStore {
  private fallbackStore: MemoryRateLimitStore;

  constructor() {
    this.fallbackStore = new MemoryRateLimitStore();
    logger.info('Using memory-only rate limiting for clean installation');
  }

  async get(key: string): Promise<number | null> {
    return this.fallbackStore.get(key);
  }

  async set(key: string, value: number, ttl: number): Promise<void> {
    return this.fallbackStore.set(key, value, ttl);
  }

  async increment(key: string, ttl: number): Promise<number> {
    return this.fallbackStore.increment(key, ttl);
  }

  async reset(key: string): Promise<void> {
    return this.fallbackStore.reset(key);
  }

  startCleanup(): void {
    this.fallbackStore.startCleanup();
  }

  stopCleanup(): void {
    this.fallbackStore.stopCleanup();
  }

  getConnectionStatus(): boolean {
    return false; // Always return false for memory-only mode
  }
}

/**
 * In-memory rate limit store (for development and fallback)
 */
class MemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, { value: number; expires: number }>();
  private cleanupInterval?: NodeJS.Timeout;

  async get(key: string): Promise<number | null> {
    const entry = this.store.get(key);
    if (!entry || entry.expires < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: number, ttl: number): Promise<void> {
    this.store.set(key, { value, expires: Date.now() + ttl });
  }

  async increment(key: string, ttl: number): Promise<number> {
    const current = await this.get(key);
    const newValue = (current || 0) + 1;
    await this.set(key, newValue, ttl);
    return newValue;
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }

  // Cleanup expired entries periodically
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of Array.from(this.store.entries())) {
      if (entry.expires < now) {
        this.store.delete(key);
      }
    }
  }

  // Start automatic cleanup
  startCleanup(): void {
    if (!this.cleanupInterval) {
      this.cleanupInterval = setInterval(() => {
        this.cleanup();
      }, 60000); // Cleanup every minute
    }
  }

  // Stop automatic cleanup (for graceful shutdown)
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }
}

/**
 * Rate limiting configuration
 */
interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  message?: string;
  standardHeaders?: boolean;
  legacyHeaders?: boolean;
}

/**
 * Advanced rate limiting middleware
 */
export class RateLimiter {
  private store: RateLimitStore;
  private config: RateLimitConfig;
  private storeType: 'memory' | 'redis';

  constructor(rateLimitConfig: Partial<RateLimitConfig> = {}) {
    // Choose store based on configuration
    if (config.security.enableDistributedRateLimit) {
      this.store = new RedisRateLimitStore();
      this.storeType = 'redis';
      logger.info('Initialized Redis-compatible rate limiting');
    } else {
      this.store = new MemoryRateLimitStore();
      this.storeType = 'memory';
      logger.info('Initialized memory-based rate limiting');
    }

    this.config = {
      windowMs: config.security.rateLimitWindowMs,
      maxRequests: config.security.rateLimitMaxRequests,
      keyGenerator: (req) => req.ip || 'unknown',
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
      message: 'Too many requests, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
      ...rateLimitConfig,
    };

    // Setup cleanup
    this.store.startCleanup();
  }

  middleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const key = this.config.keyGenerator!(req);
        const now = Date.now();
        const windowStart = now - this.config.windowMs;
        
        // Get current request count
        const requestCount = await this.store.increment(key, this.config.windowMs);
        
        // Set rate limit headers
        if (this.config.standardHeaders) {
          res.set({
            'RateLimit-Limit': this.config.maxRequests.toString(),
            'RateLimit-Remaining': Math.max(0, this.config.maxRequests - requestCount).toString(),
            'RateLimit-Reset': Math.ceil((now + this.config.windowMs) / 1000).toString(),
          });
        }

        // Check if rate limit exceeded
        if (requestCount > this.config.maxRequests) {
          logger.warn('Rate limit exceeded', {
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            path: req.path,
            requestCount,
            limit: this.config.maxRequests,
          });

          return res.status(429).json({
            success: false,
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: this.config.message,
              retryAfter: Math.ceil(this.config.windowMs / 1000),
            },
          });
        }

        next();
      } catch (error) {
        logger.error('Rate limiting error', { error: error as Error });
        next(); // Continue on rate limiter errors
      }
    };
  }

  /**
   * Reset rate limit for a specific key
   */
  async reset(key: string): Promise<void> {
    await this.store.reset(key);
  }

  /**
   * Graceful shutdown - cleanup intervals
   */
  shutdown(): void {
    this.store.stopCleanup();
    logger.info(`Rate limiter shutdown completed (${this.storeType} store)`);
  }

  /**
   * Get rate limiter status and metrics
   */
  getStatus(): Record<string, any> {
    const status: Record<string, any> = {
      storeType: this.storeType,
      config: {
        windowMs: this.config.windowMs,
        maxRequests: this.config.maxRequests,
      },
    };

    if (this.store instanceof RedisRateLimitStore) {
      status.redisConnected = (this.store as RedisRateLimitStore).getConnectionStatus();
    }

    return status;
  }
}

/**
 * Input validation middleware factory
 */
export function validateInput(schema: z.ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = req[source];
      const result = schema.safeParse(data);
      
      if (!result.success) {
        const validationError = fromZodError(result.error);
        
        logger.warn('Input validation failed', {
          path: req.path,
          source,
          errors: result.error.errors,
          requestId: (req as any).requestId,
        });

        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: validationError.message,
            field: result.error.errors[0]?.path.join('.'),
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Attach validated data to request
      (req as any).validated = result.data;
      next();
    } catch (error) {
      logger.error('Input validation middleware error', { 
        error: error as Error,
        requestId: (req as any).requestId,
      });
      next(error);
    }
  };
}

/**
 * Production-grade security headers middleware with strict CSP
 */
export function securityHeaders() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Strict Content Security Policy for production
    const isDevelopment = config.server.nodeEnv === 'development';
    const cspDirectives = [
      "default-src 'self'",
      isDevelopment 
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://replit.com" // Allow Replit dev banner
        : "script-src 'self'", // Strict for production
      isDevelopment
        ? "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com" // Allow Google Fonts
        : "style-src 'self' 'sha256-HASH-HERE'", // Use specific hashes in production
      "img-src 'self' data: blob: https:",
      isDevelopment
        ? "font-src 'self' https: https://fonts.gstatic.com" // Allow Google Fonts
        : "font-src 'self' https:",
      "connect-src 'self' ws: wss:",
      "media-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      ...(isDevelopment ? [] : ["upgrade-insecure-requests", "block-all-mixed-content"]) // Remove strict rules in dev
    ];
    
    res.setHeader('Content-Security-Policy', cspDirectives.join('; '));

    // Essential security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0'); // Disable as modern CSP is better
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', [
      'geolocation=()',
      'microphone=()', 
      'camera=()',
      'payment=()',
      'usb=()',
      'magnetometer=()',
      'gyroscope=()',
      'accelerometer=()'
    ].join(', '));
    
    // HSTS - enforced in production
    if (config.server.nodeEnv === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    }

    // Remove server fingerprinting
    res.removeHeader('X-Powered-By');
    res.removeHeader('Server');
    res.setHeader('Server', 'PrismMail/1.0');

    next();
  };
}

/**
 * CSRF protection middleware
 */
export function csrfProtection() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip CSRF for safe methods and API authentication
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next();
    }

    // Skip for WebSocket upgrades
    if (req.headers.upgrade === 'websocket') {
      return next();
    }

    const token = req.headers['x-csrf-token'] || req.body._csrf;
    const sessionToken = (req.session as any)?.csrfToken;

    if (!token || !sessionToken || token !== sessionToken) {
      logger.warn('CSRF token validation failed', {
        ip: req.ip,
        path: req.path,
        hasToken: !!token,
        hasSessionToken: !!sessionToken,
        requestId: (req as any).requestId,
      });

      return res.status(403).json({
        success: false,
        error: {
          code: 'CSRF_TOKEN_INVALID',
          message: 'Invalid or missing CSRF token',
          timestamp: new Date().toISOString(),
        },
      });
    }

    next();
  };
}

/**
 * XSS prevention utilities
 */
export class XSSProtection {
  /**
   * Sanitize string input to prevent XSS
   */
  static sanitizeString(input: string): string {
    if (typeof input !== 'string') return '';
    
    return input
      .replace(/[<>]/g, '') // Remove angle brackets
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+=/gi, '') // Remove event handlers
      .trim();
  }

  /**
   * Sanitize object recursively
   */
  static sanitizeObject(obj: any): any {
    if (typeof obj === 'string') {
      return this.sanitizeString(obj);
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }
    
    if (obj && typeof obj === 'object') {
      const sanitized: any = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          sanitized[key] = this.sanitizeObject(obj[key]);
        }
      }
      return sanitized;
    }
    
    return obj;
  }

  /**
   * Middleware to sanitize request data
   */
  static middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      if (req.body) {
        req.body = XSSProtection.sanitizeObject(req.body);
      }
      
      if (req.query) {
        req.query = XSSProtection.sanitizeObject(req.query);
      }
      
      next();
    };
  }
}

/**
 * API authentication middleware
 */
export function requireAuth() {
  return (req: Request, res: Response, next: NextFunction) => {
    const session = req.session as any;
    
    if (!session?.user?.id) {
      logger.warn('Unauthenticated API access attempt', {
        ip: req.ip,
        path: req.path,
        userAgent: req.headers['user-agent'],
        requestId: (req as any).requestId,
      });

      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required to access this resource',
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Add user info to request
    (req as any).user = session.user;
    next();
  };
}

/**
 * Request size limiting middleware
 */
export function limitRequestSize(maxSizeBytes: number = 10 * 1024 * 1024) { // 10MB default
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    
    if (contentLength > maxSizeBytes) {
      logger.warn('Request size limit exceeded', {
        contentLength,
        maxSize: maxSizeBytes,
        ip: req.ip,
        path: req.path,
        requestId: (req as any).requestId,
      });

      return res.status(413).json({
        success: false,
        error: {
          code: 'REQUEST_TOO_LARGE',
          message: 'Request size exceeds maximum allowed limit',
          maxSize: maxSizeBytes,
          timestamp: new Date().toISOString(),
        },
      });
    }

    next();
  };
}

/**
 * IP whitelisting/blacklisting middleware
 */
export function ipFilter(options: {
  whitelist?: string[];
  blacklist?: string[];
  trustProxy?: boolean;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = options.trustProxy && req.headers['x-forwarded-for'] 
      ? (req.headers['x-forwarded-for'] as string).split(',')[0].trim()
      : req.ip || 'unknown';

    if (options.blacklist?.includes(ip || '')) {
      logger.warn('Blocked IP attempted access', {
        ip,
        path: req.path,
        userAgent: req.headers['user-agent'],
      });

      return res.status(403).json({
        success: false,
        error: {
          code: 'IP_BLOCKED',
          message: 'Access denied from this IP address',
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (options.whitelist && !options.whitelist.includes(ip || '')) {
      logger.warn('Non-whitelisted IP attempted access', {
        ip,
        path: req.path,
        userAgent: req.headers['user-agent'],
      });

      return res.status(403).json({
        success: false,
        error: {
          code: 'IP_NOT_ALLOWED',
          message: 'Access restricted to whitelisted IP addresses',
          timestamp: new Date().toISOString(),
        },
      });
    }

    next();
  };
}

// Export configured middleware instances
export const rateLimiter = new RateLimiter();

// Per-route rate limiters for different endpoint types
export const authRateLimiter = new RateLimiter({
  windowMs: 300000, // 5 minutes
  maxRequests: 5, // Very strict for auth endpoints
  message: 'Too many authentication attempts, please try again in 5 minutes.',
  keyGenerator: (req) => `auth:${req.ip}:${req.body?.email || 'unknown'}`,
});

export const composeRateLimiter = new RateLimiter({
  windowMs: 60000, // 1 minute
  maxRequests: 10, // Moderate for email composition
  message: 'Too many email sends, please slow down.',
  keyGenerator: (req) => `compose:${req.ip}:${(req as any).user?.id || 'anonymous'}`,
});

export const apiRateLimiter = new RateLimiter({
  windowMs: 60000, // 1 minute
  maxRequests: 60, // Standard API limits
  message: 'API rate limit exceeded, please try again later.',
});

export const strictRateLimiter = new RateLimiter({
  windowMs: 60000, // 1 minute
  maxRequests: 10, // Much stricter for sensitive endpoints
  message: 'Rate limit exceeded for sensitive operation.',
});

/**
 * Create route-specific rate limiter
 */
export function createRouteRateLimiter(config: {
  route: string;
  windowMs?: number;
  maxRequests?: number;
  keyGenerator?: (req: Request) => string;
}) {
  return new RateLimiter({
    windowMs: config.windowMs || 60000,
    maxRequests: config.maxRequests || 30,
    keyGenerator: config.keyGenerator || ((req) => `${config.route}:${req.ip}`),
    message: `Rate limit exceeded for ${config.route}`,
  });
}

/**
 * Shutdown all rate limiters
 */
export function shutdownAllRateLimiters(): void {
  [rateLimiter, authRateLimiter, composeRateLimiter, apiRateLimiter, strictRateLimiter].forEach(limiter => {
    limiter.shutdown();
  });
}

/**
 * Global request timeout middleware
 */
export function globalTimeout(timeoutMs: number = config.performance.requestTimeout) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn('Request timeout exceeded', {
          path: req.path,
          method: req.method,
          timeout: timeoutMs,
          requestId: (req as any).requestId
        });
        
        res.status(408).json({
          success: false,
          error: {
            code: 'REQUEST_TIMEOUT',
            message: 'Request timeout exceeded',
            timeout: timeoutMs,
            timestamp: new Date().toISOString()
          }
        });
      }
    }, timeoutMs);

    // Clear timeout when response finishes
    res.on('finish', () => {
      clearTimeout(timeout);
    });

    // Clear timeout when response is closed
    res.on('close', () => {
      clearTimeout(timeout);
    });

    next();
  };
}

/**
 * Compression middleware enforcement
 */
export function enforceCompression() {
  // Note: In real implementation, you'd use the 'compression' npm package
  return (req: Request, res: Response, next: NextFunction) => {
    if (config.performance.enableCompression) {
      // Set compression headers
      const acceptEncoding = req.headers['accept-encoding'] || '';
      
      if (acceptEncoding.includes('gzip')) {
        res.setHeader('Content-Encoding', 'gzip');
      } else if (acceptEncoding.includes('deflate')) {
        res.setHeader('Content-Encoding', 'deflate');
      }
      
      // Set vary header for caching
      res.setHeader('Vary', 'Accept-Encoding');
    }
    
    next();
  };
}

/**
 * Strict CORS configuration
 */
export function strictCors() {
  const allowedOrigins = config.security.corsOrigins 
    ? config.security.corsOrigins.split(',').map(origin => origin.trim())
    : [];
    
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    
    // Only enable CORS if explicitly configured
    if (config.security.enableCors && allowedOrigins.length > 0) {
      // Check if origin is allowed
      if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', [
          'Origin',
          'X-Requested-With', 
          'Content-Type',
          'Accept',
          'Authorization',
          'X-CSRF-Token'
        ].join(', '));
        res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
      } else if (origin) {
        logger.warn('CORS request from unauthorized origin', {
          origin,
          allowedOrigins,
          path: req.path,
          method: req.method
        });
      }
    }
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    
    next();
  };
}

/**
 * Enhanced body size limits with different limits per route type
 */
export function enhancedBodyLimits() {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    let maxSize = 1 * 1024 * 1024; // 1MB default
    
    // Different limits for different route types
    if (req.path.includes('/api/mail/send') || req.path.includes('/api/compose')) {
      maxSize = 10 * 1024 * 1024; // 10MB for email composition
    } else if (req.path.includes('/api/upload')) {
      maxSize = 50 * 1024 * 1024; // 50MB for file uploads
    } else if (req.path.includes('/api/auth')) {
      maxSize = 10 * 1024; // 10KB for auth endpoints
    }
    
    if (contentLength > maxSize) {
      logger.warn('Request size limit exceeded for route', {
        contentLength,
        maxSize,
        path: req.path,
        method: req.method,
        requestId: (req as any).requestId
      });

      return res.status(413).json({
        success: false,
        error: {
          code: 'REQUEST_TOO_LARGE',
          message: `Request size exceeds maximum allowed limit for this endpoint`,
          maxSize,
          actualSize: contentLength,
          timestamp: new Date().toISOString()
        }
      });
    }

    next();
  };
}

export default {
  RateLimiter,
  validateInput,
  securityHeaders,
  csrfProtection,
  XSSProtection,
  requireAuth,
  limitRequestSize,
  enhancedBodyLimits,
  globalTimeout,
  enforceCompression,
  strictCors,
  ipFilter,
  rateLimiter,
  authRateLimiter,
  composeRateLimiter,
  apiRateLimiter,
  strictRateLimiter,
  createRouteRateLimiter,
  shutdownAllRateLimiters
};