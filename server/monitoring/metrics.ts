import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { Request, Response, NextFunction } from 'express';

/**
 * Metric types for different measurements
 */
export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  TIMER = 'timer',
}

/**
 * Metric entry interface
 */
export interface MetricEntry {
  name: string;
  type: MetricType;
  value: number;
  timestamp: Date;
  labels?: Record<string, string>;
  unit?: string;
}

/**
 * Application health status
 */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  uptime: number;
  version: string;
  environment: string;
  checks: Record<string, {
    status: 'pass' | 'fail' | 'warn';
    message?: string;
    duration?: number;
  }>;
}

/**
 * Performance metrics collector
 */
class MetricsCollector {
  private metrics: Map<string, MetricEntry[]> = new Map();
  private maxMetricsPerName = 1000;
  private healthChecks: Map<string, () => Promise<any>> = new Map();
  private startTime = Date.now();

  /**
   * Record a metric value
   */
  record(name: string, type: MetricType, value: number, labels?: Record<string, string>, unit?: string): void {
    if (!config.performance.enableProfiling) return;

    const metric: MetricEntry = {
      name,
      type,
      value,
      timestamp: new Date(),
      labels,
      unit,
    };

    const existing = this.metrics.get(name) || [];
    existing.push(metric);

    // Keep only recent metrics to prevent memory leaks
    if (existing.length > this.maxMetricsPerName) {
      existing.splice(0, existing.length - this.maxMetricsPerName);
    }

    this.metrics.set(name, existing);
  }

  /**
   * Increment a counter metric
   */
  increment(name: string, value: number = 1, labels?: Record<string, string>): void {
    this.record(name, MetricType.COUNTER, value, labels);
  }

  /**
   * Set a gauge metric
   */
  gauge(name: string, value: number, labels?: Record<string, string>): void {
    this.record(name, MetricType.GAUGE, value, labels);
  }

  /**
   * Record a histogram value
   */
  histogram(name: string, value: number, labels?: Record<string, string>): void {
    this.record(name, MetricType.HISTOGRAM, value, labels);
  }

  /**
   * Time a function execution
   */
  async timer<T>(name: string, fn: () => Promise<T>, labels?: Record<string, string>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.record(name, MetricType.TIMER, Date.now() - start, labels, 'ms');
      return result;
    } catch (error) {
      this.record(name, MetricType.TIMER, Date.now() - start, { ...labels, error: 'true' }, 'ms');
      throw error;
    }
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): Record<string, MetricEntry[]> {
    const result: Record<string, MetricEntry[]> = {};
    for (const [name, entries] of Array.from(this.metrics.entries())) {
      result[name] = [...entries];
    }
    return result;
  }

  /**
   * Get aggregated metrics
   */
  getAggregatedMetrics(): Record<string, any> {
    const aggregated: Record<string, any> = {};

    for (const [name, entries] of Array.from(this.metrics.entries())) {
      if (entries.length === 0) continue;

      const values = entries.map((e: MetricEntry) => e.value);
      const latest = entries[entries.length - 1];

      switch (latest.type) {
        case MetricType.COUNTER:
          aggregated[name] = {
            type: 'counter',
            total: values.reduce((sum: number, v: number) => sum + v, 0),
            count: values.length,
            rate: values.length / (entries.length > 1 ? 
              (latest.timestamp.getTime() - entries[0].timestamp.getTime()) / 1000 : 1),
          };
          break;

        case MetricType.GAUGE:
          aggregated[name] = {
            type: 'gauge',
            current: latest.value,
            min: Math.min(...values),
            max: Math.max(...values),
            avg: values.reduce((sum: number, v: number) => sum + v, 0) / values.length,
          };
          break;

        case MetricType.HISTOGRAM:
        case MetricType.TIMER:
          const sorted = [...values].sort((a, b) => a - b);
          aggregated[name] = {
            type: latest.type,
            count: values.length,
            min: sorted[0],
            max: sorted[sorted.length - 1],
            avg: values.reduce((sum: number, v: number) => sum + v, 0) / values.length,
            p50: sorted[Math.floor(sorted.length * 0.5)],
            p90: sorted[Math.floor(sorted.length * 0.9)],
            p95: sorted[Math.floor(sorted.length * 0.95)],
            p99: sorted[Math.floor(sorted.length * 0.99)],
          };
          break;
      }
    }

    return aggregated;
  }

  /**
   * Register a health check
   */
  registerHealthCheck(name: string, check: () => Promise<any>): void {
    this.healthChecks.set(name, check);
  }

  /**
   * Run all health checks
   */
  async getHealthStatus(): Promise<HealthStatus> {
    const checks: Record<string, any> = {};
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    for (const [name, checkFn] of Array.from(this.healthChecks.entries())) {
      const start = Date.now();
      try {
        await checkFn();
        checks[name] = {
          status: 'pass',
          duration: Date.now() - start,
        };
      } catch (error) {
        checks[name] = {
          status: 'fail',
          message: error instanceof Error ? error.message : 'Unknown error',
          duration: Date.now() - start,
        };
        overallStatus = 'unhealthy';
      }
    }

    // Check memory usage
    const memUsage = process.memoryUsage();
    const memLimitMB = config.performance.memoryLimit;
    const currentMemMB = memUsage.heapUsed / 1024 / 1024;
    
    if (currentMemMB > memLimitMB * 0.9) {
      checks.memory = {
        status: 'warn',
        message: `Memory usage high: ${currentMemMB.toFixed(1)}MB / ${memLimitMB}MB`,
      };
      if (overallStatus === 'healthy') overallStatus = 'degraded';
    } else {
      checks.memory = {
        status: 'pass',
        message: `Memory usage: ${currentMemMB.toFixed(1)}MB / ${memLimitMB}MB`,
      };
    }

    return {
      status: overallStatus,
      timestamp: new Date(),
      uptime: Date.now() - this.startTime,
      version: process.env.npm_package_version || '1.0.0',
      environment: config.server.nodeEnv,
      checks,
    };
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
  }

  /**
   * Get system resource metrics
   */
  getSystemMetrics(): Record<string, any> {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss,
        heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
      uptime: process.uptime(),
      pid: process.pid,
      version: process.version,
    };
  }
}

/**
 * Express middleware for automatic metrics collection
 */
export function metricsMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.performance.enableProfiling) {
      return next();
    }

    const start = Date.now();
    const route = req.route?.path || req.path;
    const method = req.method;

    // Track request start
    metrics.increment('http_requests_total', 1, { method, route });
    metrics.gauge('http_requests_active', 1);

    // Hook into response finish
    res.on('finish', () => {
      const duration = Date.now() - start;
      const statusCode = res.statusCode.toString();
      const statusClass = `${Math.floor(res.statusCode / 100)}xx`;

      // Record metrics
      metrics.histogram('http_request_duration', duration, { method, route, status: statusCode });
      metrics.increment('http_responses_total', 1, { method, route, status: statusCode, status_class: statusClass });
      metrics.gauge('http_requests_active', -1);

      // Log slow requests
      if (duration > 1000) {
        logger.warn('Slow HTTP request detected', {
          method,
          route,
          duration,
          statusCode,
          requestId: (req as any).requestId,
        });
      }
    });

    next();
  };
}

/**
 * Database metrics tracking
 */
export class DatabaseMetrics {
  static trackQuery(operation: string, table: string) {
    return async <T>(query: () => Promise<T>): Promise<T> => {
      const start = Date.now();
      try {
        const result = await query();
        const duration = Date.now() - start;
        
        metrics.histogram('db_query_duration', duration, { operation, table, success: 'true' });
        metrics.increment('db_queries_total', 1, { operation, table, success: 'true' });
        
        return result;
      } catch (error) {
        const duration = Date.now() - start;
        
        metrics.histogram('db_query_duration', duration, { operation, table, success: 'false' });
        metrics.increment('db_queries_total', 1, { operation, table, success: 'false' });
        metrics.increment('db_query_errors_total', 1, { operation, table });
        
        throw error;
      }
    };
  }

  static trackConnection(event: 'acquired' | 'released' | 'error'): void {
    metrics.increment('db_connections_total', 1, { event });
    
    if (event === 'acquired') {
      metrics.gauge('db_connections_active', 1);
    } else if (event === 'released') {
      metrics.gauge('db_connections_active', -1);
    }
  }
}

/**
 * Email metrics tracking
 */
export class EmailMetrics {
  static trackSync(accountId: string, protocol: 'IMAP' | 'EWS') {
    return async <T>(syncFn: () => Promise<T>): Promise<T> => {
      const start = Date.now();
      try {
        const result = await syncFn();
        const duration = Date.now() - start;
        
        metrics.histogram('email_sync_duration', duration, { protocol, success: 'true' });
        metrics.increment('email_syncs_total', 1, { protocol, success: 'true' });
        
        return result;
      } catch (error) {
        const duration = Date.now() - start;
        
        metrics.histogram('email_sync_duration', duration, { protocol, success: 'false' });
        metrics.increment('email_syncs_total', 1, { protocol, success: 'false' });
        metrics.increment('email_sync_errors_total', 1, { protocol });
        
        throw error;
      }
    };
  }

  static trackEmailProcessing(count: number, accountId: string): void {
    metrics.histogram('emails_processed_batch', count, { account_id: accountId });
    metrics.increment('emails_processed_total', count, { account_id: accountId });
  }

  static trackConnectionStatus(accountId: string, protocol: 'IMAP' | 'EWS', status: 'connected' | 'disconnected' | 'error'): void {
    metrics.increment('email_connections_total', 1, { protocol, status });
    metrics.gauge('email_connections_active', status === 'connected' ? 1 : -1, { protocol });
  }
}

// Initialize global metrics collector
export const metrics = new MetricsCollector();

// Register default health checks
metrics.registerHealthCheck('database', async () => {
  // This will be implemented when we integrate with the database
  return Promise.resolve('OK');
});

metrics.registerHealthCheck('memory', async () => {
  const memUsage = process.memoryUsage();
  const memLimitMB = config.performance.memoryLimit;
  const currentMemMB = memUsage.heapUsed / 1024 / 1024;
  
  if (currentMemMB > memLimitMB) {
    throw new Error(`Memory usage exceeded limit: ${currentMemMB.toFixed(1)}MB > ${memLimitMB}MB`);
  }
  
  return { memoryUsageMB: currentMemMB, limitMB: memLimitMB };
});

export default metrics;