import { Request, Response, NextFunction } from 'express';

/**
 * Enhanced rate limiting for attachment operations
 * Separate limits for uploads vs downloads to prevent abuse
 */

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

class MemoryRateLimitStore {
  private store: RateLimitStore = {};
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const key in this.store) {
      if (this.store[key].resetTime < now) {
        delete this.store[key];
      }
    }
  }

  get(key: string): number {
    const entry = this.store[key];
    if (!entry || entry.resetTime < Date.now()) {
      return 0;
    }
    return entry.count;
  }

  increment(key: string, windowMs: number): number {
    const now = Date.now();
    const entry = this.store[key];
    
    if (!entry || entry.resetTime < now) {
      this.store[key] = {
        count: 1,
        resetTime: now + windowMs
      };
      return 1;
    }
    
    this.store[key].count++;
    return this.store[key].count;
  }

  getRemainingTime(key: string): number {
    const entry = this.store[key];
    if (!entry || entry.resetTime < Date.now()) {
      return 0;
    }
    return Math.max(0, entry.resetTime - Date.now());
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

const store = new MemoryRateLimitStore();

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  message?: string;
}

export function createRateLimit(options: RateLimitOptions) {
  const {
    windowMs,
    max,
    keyGenerator = (req) => req.ip || 'unknown',
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    message = 'Too many requests, please try again later.'
  } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyGenerator(req);
    const current = store.get(key);
    
    if (current >= max) {
      const remainingTime = store.getRemainingTime(key);
      
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message,
          retryAfter: Math.ceil(remainingTime / 1000),
          timestamp: new Date().toISOString()
        }
      });
      return;
    }
    
    // Track the request
    const count = store.increment(key, windowMs);
    
    // Add rate limit headers
    res.set({
      'X-RateLimit-Limit': max.toString(),
      'X-RateLimit-Remaining': Math.max(0, max - count).toString(),
      'X-RateLimit-Reset': new Date(Date.now() + windowMs).toISOString()
    });
    
    next();
  };
}

// Specific rate limiters for attachment operations
export const attachmentUploadLimiter = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 uploads per 15 minutes per IP
  keyGenerator: (req) => {
    // Use combination of IP and user ID for authenticated requests
    const userId = (req as any).user?.claims?.sub;
    return userId ? `upload:${userId}:${req.ip}` : `upload:${req.ip}`;
  },
  message: 'Too many upload attempts. Please wait before uploading more files.'
});

export const attachmentDownloadLimiter = createRateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 200, // 200 downloads per 5 minutes per user
  keyGenerator: (req) => {
    const userId = (req as any).user?.claims?.sub;
    return userId ? `download:${userId}` : `download:${req.ip}`;
  },
  message: 'Too many download attempts. Please wait before downloading more files.'
});

export const attachmentDeleteLimiter = createRateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 100, // 100 deletions per 10 minutes per user
  keyGenerator: (req) => {
    const userId = (req as any).user?.claims?.sub;
    return userId ? `delete:${userId}` : `delete:${req.ip}`;
  },
  message: 'Too many deletion attempts. Please wait before deleting more files.'
});

// Rate limiter for anomaly detection
export const suspiciousActivityLimiter = createRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Only 5 suspicious activities per hour
  keyGenerator: (req) => {
    const userId = (req as any).user?.claims?.sub;
    return userId ? `suspicious:${userId}` : `suspicious:${req.ip}`;
  },
  message: 'Suspicious activity detected. Account temporarily restricted.'
});

export default {
  createRateLimit,
  attachmentUploadLimiter,
  attachmentDownloadLimiter,
  attachmentDeleteLimiter,
  suspiciousActivityLimiter
};