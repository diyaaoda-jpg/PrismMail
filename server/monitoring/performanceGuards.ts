import { redis } from '../config/redis';

/**
 * Performance guards and rate limiting for scalable production deployment
 */

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (context: any) => string;
  skipSuccessfulRequests?: boolean;
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
}

/**
 * Rate limiter using Redis for distributed rate limiting
 */
export class DistributedRateLimiter {
  private options: RateLimitOptions;
  
  constructor(options: RateLimitOptions) {
    this.options = options;
  }
  
  async checkLimit(key: string): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const windowStart = Math.floor(Date.now() / this.options.windowMs) * this.options.windowMs;
    const redisKey = `ratelimit:${key}:${windowStart}`;
    
    try {
      const current = await redis.incr(redisKey);
      
      // Set expiration on first increment
      if (current === 1) {
        await redis.expire(redisKey, Math.ceil(this.options.windowMs / 1000));
      }
      
      const allowed = current <= this.options.maxRequests;
      const remaining = Math.max(0, this.options.maxRequests - current);
      const resetTime = windowStart + this.options.windowMs;
      
      return { allowed, remaining, resetTime };
      
    } catch (error) {
      console.error('Rate limiter error:', error);
      // Fail open - allow request if Redis is down
      return { allowed: true, remaining: this.options.maxRequests, resetTime: Date.now() + this.options.windowMs };
    }
  }
}

/**
 * Circuit breaker for protecting services from cascading failures
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime: number = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private options: CircuitBreakerOptions;
  
  constructor(options: CircuitBreakerOptions) {
    this.options = options;
  }
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime < this.options.resetTimeout) {
        throw new Error('Circuit breaker is OPEN');
      } else {
        this.state = 'HALF_OPEN';
      }
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }
  
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.options.failureThreshold) {
      this.state = 'OPEN';
    }
  }
  
  getState(): { state: string; failures: number } {
    return { state: this.state, failures: this.failures };
  }
}

/**
 * Bounded concurrency control for background processing
 */
export class ConcurrencyLimiter {
  private running = 0;
  private queue: (() => void)[] = [];
  
  constructor(private maxConcurrency: number) {}
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = async () => {
        this.running++;
        try {
          const result = await operation();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.running--;
          this.processQueue();
        }
      };
      
      if (this.running < this.maxConcurrency) {
        run();
      } else {
        this.queue.push(run);
      }
    });
  }
  
  private processQueue(): void {
    if (this.queue.length > 0 && this.running < this.maxConcurrency) {
      const next = this.queue.shift();
      if (next) next();
    }
  }
  
  getStats(): { running: number; queued: number; capacity: number } {
    return {
      running: this.running,
      queued: this.queue.length,
      capacity: this.maxConcurrency
    };
  }
}

/**
 * Performance monitoring and metrics collection
 */
export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private metrics = new Map<string, {
    count: number;
    totalDuration: number;
    minDuration: number;
    maxDuration: number;
    errors: number;
    lastUpdated: number;
  }>();
  
  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }
  
  async track<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const startTime = Date.now();
    
    try {
      const result = await operation();
      this.recordMetric(name, Date.now() - startTime, false);
      return result;
    } catch (error) {
      this.recordMetric(name, Date.now() - startTime, true);
      throw error;
    }
  }
  
  private recordMetric(name: string, duration: number, isError: boolean): void {
    const existing = this.metrics.get(name) || {
      count: 0,
      totalDuration: 0,
      minDuration: Infinity,
      maxDuration: 0,
      errors: 0,
      lastUpdated: 0
    };
    
    existing.count++;
    existing.totalDuration += duration;
    existing.minDuration = Math.min(existing.minDuration, duration);
    existing.maxDuration = Math.max(existing.maxDuration, duration);
    existing.lastUpdated = Date.now();
    
    if (isError) {
      existing.errors++;
    }
    
    this.metrics.set(name, existing);
  }
  
  getMetrics(): Record<string, any> {
    const result: Record<string, any> = {};
    
    Array.from(this.metrics.entries()).forEach(([name, metric]) => {
      result[name] = {
        count: metric.count,
        averageDuration: metric.count > 0 ? metric.totalDuration / metric.count : 0,
        minDuration: metric.minDuration === Infinity ? 0 : metric.minDuration,
        maxDuration: metric.maxDuration,
        errorRate: metric.count > 0 ? (metric.errors / metric.count) * 100 : 0,
        lastUpdated: metric.lastUpdated
      };
    });
    
    return result;
  }
  
  reset(): void {
    this.metrics.clear();
  }
}

/**
 * System health monitoring
 */
export class HealthMonitor {
  private checks = new Map<string, () => Promise<boolean>>();
  
  addCheck(name: string, check: () => Promise<boolean>): void {
    this.checks.set(name, check);
  }
  
  async getHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: Record<string, { status: 'pass' | 'fail'; duration: number; error?: string }>;
  }> {
    const checkResults: Record<string, any> = {};
    let passCount = 0;
    
    for (const [name, check] of Array.from(this.checks.entries())) {
      const startTime = Date.now();
      try {
        const result = await Promise.race([
          check(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Health check timeout')), 5000))
        ]);
        
        checkResults[name] = {
          status: result ? 'pass' : 'fail',
          duration: Date.now() - startTime
        };
        
        if (result) passCount++;
      } catch (error) {
        checkResults[name] = {
          status: 'fail',
          duration: Date.now() - startTime,
          error: (error as Error).message
        };
      }
    }
    
    const totalChecks = this.checks.size;
    let status: 'healthy' | 'degraded' | 'unhealthy';
    
    if (passCount === totalChecks) {
      status = 'healthy';
    } else if (passCount > totalChecks / 2) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }
    
    return { status, checks: checkResults };
  }
}

// Export singleton instances for application use
export const performanceMonitor = PerformanceMonitor.getInstance();
export const healthMonitor = new HealthMonitor();

// Rate limiters for different operations
export const priorityApiRateLimiter = new DistributedRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100 // 100 requests per minute per user
});

export const syncRateLimiter = new DistributedRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes  
  maxRequests: 10 // 10 sync operations per 5 minutes per account
});

// Concurrency limiters
export const priorityProcessingLimiter = new ConcurrencyLimiter(50); // Max 50 concurrent priority calculations
export const emailSyncLimiter = new ConcurrencyLimiter(5); // Max 5 concurrent email sync operations

// Circuit breakers
export const databaseCircuitBreaker = new CircuitBreaker({
  failureThreshold: 10,
  resetTimeout: 30000, // 30 seconds
  monitoringPeriod: 60000 // 1 minute
});

export const priorityEngineCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 15000, // 15 seconds
  monitoringPeriod: 30000 // 30 seconds
});