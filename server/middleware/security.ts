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
}

/**
 * In-memory rate limit store (for development)
 * In production, you'd want to use Redis for distributed rate limiting
 */
class MemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, { value: number; expires: number }>();

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

  constructor(rateLimitConfig: Partial<RateLimitConfig> = {}) {
    this.store = new MemoryRateLimitStore();
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

    // Setup cleanup for memory store
    if (this.store instanceof MemoryRateLimitStore) {
      setInterval(() => {
        (this.store as MemoryRateLimitStore).cleanup();
      }, 60000); // Cleanup every minute
    }
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
 * Security headers middleware
 */
export function securityHeaders() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Content Security Policy
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Relaxed for development
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' https:",
      "connect-src 'self' ws: wss:",
      "media-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '));

    // Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    
    // HSTS for production
    if (config.server.nodeEnv === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    // Remove server information
    res.removeHeader('X-Powered-By');
    res.setHeader('Server', 'PrismMail');

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
export const strictRateLimiter = new RateLimiter({
  windowMs: 60000, // 1 minute
  maxRequests: 10, // Much stricter for sensitive endpoints
});

export default {
  RateLimiter,
  validateInput,
  securityHeaders,
  csrfProtection,
  XSSProtection,
  requireAuth,
  limitRequestSize,
  ipFilter,
  rateLimiter,
  strictRateLimiter,
};