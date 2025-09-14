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
/**
 * Prometheus metrics exporter
 */
export class PrometheusExporter {
  /**
   * Export metrics in Prometheus format
   */
  static exportMetrics(): string {
    const allMetrics = metrics.getAllMetrics();
    const aggregated = metrics.getAggregatedMetrics();
    const systemMetrics = metrics.getSystemMetrics();
    const timestamp = Date.now();
    
    let output = '# HELP prismmail_info Application information\n';
    output += '# TYPE prismmail_info gauge\n';
    output += `prismmail_info{version="${systemMetrics.version}",environment="${config.server.nodeEnv}"} 1 ${timestamp}\n\n`;
    
    // System metrics
    output += this.exportSystemMetrics(systemMetrics, timestamp);
    
    // Application metrics
    output += this.exportApplicationMetrics(aggregated, timestamp);
    
    // HTTP metrics
    output += this.exportHttpMetrics(allMetrics, timestamp);
    
    // Database metrics
    output += this.exportDatabaseMetrics(allMetrics, timestamp);
    
    // Email metrics
    output += this.exportEmailMetrics(allMetrics, timestamp);
    
    return output;
  }
  
  private static exportSystemMetrics(systemMetrics: any, timestamp: number): string {
    let output = '';
    
    // Memory metrics
    output += '# HELP prismmail_memory_heap_used_bytes Memory heap used in bytes\n';
    output += '# TYPE prismmail_memory_heap_used_bytes gauge\n';
    output += `prismmail_memory_heap_used_bytes ${systemMetrics.memory.heapUsed} ${timestamp}\n`;
    
    output += '# HELP prismmail_memory_heap_total_bytes Memory heap total in bytes\n';
    output += '# TYPE prismmail_memory_heap_total_bytes gauge\n';
    output += `prismmail_memory_heap_total_bytes ${systemMetrics.memory.heapTotal} ${timestamp}\n`;
    
    // CPU metrics
    output += '# HELP prismmail_cpu_usage_seconds CPU usage in seconds\n';
    output += '# TYPE prismmail_cpu_usage_seconds counter\n';
    output += `prismmail_cpu_usage_seconds{mode="user"} ${systemMetrics.cpu.user / 1000000} ${timestamp}\n`;
    output += `prismmail_cpu_usage_seconds{mode="system"} ${systemMetrics.cpu.system / 1000000} ${timestamp}\n`;
    
    // Uptime
    output += '# HELP prismmail_uptime_seconds Application uptime in seconds\n';
    output += '# TYPE prismmail_uptime_seconds gauge\n';
    output += `prismmail_uptime_seconds ${systemMetrics.uptime} ${timestamp}\n\n`;
    
    return output;
  }
  
  private static exportApplicationMetrics(aggregated: any, timestamp: number): string {
    let output = '';
    
    // Export all aggregated metrics
    for (const [name, data] of Object.entries(aggregated)) {
      const safeName = name.replace(/[^a-zA-Z0-9_]/g, '_');
      const metricData = data as any;
      
      if (metricData.type === 'counter') {
        output += `# HELP prismmail_${safeName}_total Total count\n`;
        output += `# TYPE prismmail_${safeName}_total counter\n`;
        output += `prismmail_${safeName}_total ${metricData.total} ${timestamp}\n`;
        
        output += `# HELP prismmail_${safeName}_rate_per_second Rate per second\n`;
        output += `# TYPE prismmail_${safeName}_rate_per_second gauge\n`;
        output += `prismmail_${safeName}_rate_per_second ${metricData.rate} ${timestamp}\n`;
      } else if (metricData.type === 'gauge') {
        output += `# HELP prismmail_${safeName} Current gauge value\n`;
        output += `# TYPE prismmail_${safeName} gauge\n`;
        output += `prismmail_${safeName} ${metricData.current} ${timestamp}\n`;
      } else if (metricData.type === 'histogram' || metricData.type === 'timer') {
        output += `# HELP prismmail_${safeName}_duration_seconds Duration in seconds\n`;
        output += `# TYPE prismmail_${safeName}_duration_seconds histogram\n`;
        output += `prismmail_${safeName}_duration_seconds{quantile="0.5"} ${(metricData.p50 || 0) / 1000} ${timestamp}\n`;
        output += `prismmail_${safeName}_duration_seconds{quantile="0.9"} ${(metricData.p90 || 0) / 1000} ${timestamp}\n`;
        output += `prismmail_${safeName}_duration_seconds{quantile="0.95"} ${(metricData.p95 || 0) / 1000} ${timestamp}\n`;
        output += `prismmail_${safeName}_duration_seconds{quantile="0.99"} ${(metricData.p99 || 0) / 1000} ${timestamp}\n`;
        output += `prismmail_${safeName}_duration_seconds_count ${metricData.count} ${timestamp}\n`;
        output += `prismmail_${safeName}_duration_seconds_sum ${(metricData.avg * metricData.count) / 1000} ${timestamp}\n`;
      }
    }
    
    return output + '\n';
  }
  
  private static exportHttpMetrics(allMetrics: any, timestamp: number): string {
    let output = '';
    
    // HTTP request metrics
    if (allMetrics.http_requests_total) {
      output += '# HELP prismmail_http_requests_total Total HTTP requests\n';
      output += '# TYPE prismmail_http_requests_total counter\n';
      
      const httpMetrics = allMetrics.http_requests_total;
      const methodCounts: Record<string, number> = {};
      
      httpMetrics.forEach((entry: MetricEntry) => {
        const method = entry.labels?.method || 'unknown';
        methodCounts[method] = (methodCounts[method] || 0) + entry.value;
      });
      
      for (const [method, count] of Object.entries(methodCounts)) {
        output += `prismmail_http_requests_total{method="${method}"} ${count} ${timestamp}\n`;
      }
    }
    
    return output + '\n';
  }
  
  private static exportDatabaseMetrics(allMetrics: any, timestamp: number): string {
    let output = '';
    
    // Database connection pool metrics
    if (allMetrics.db_connection_pool_total) {
      const latest = allMetrics.db_connection_pool_total[allMetrics.db_connection_pool_total.length - 1];
      output += '# HELP prismmail_db_connections_total Database connection pool size\n';
      output += '# TYPE prismmail_db_connections_total gauge\n';
      output += `prismmail_db_connections_total ${latest.value} ${timestamp}\n`;
    }
    
    // Database query metrics
    if (allMetrics.db_queries_total) {
      output += '# HELP prismmail_db_queries_total Total database queries\n';
      output += '# TYPE prismmail_db_queries_total counter\n';
      
      const dbMetrics = allMetrics.db_queries_total;
      const operationCounts: Record<string, { success: number; failed: number }> = {};
      
      dbMetrics.forEach((entry: MetricEntry) => {
        const operation = entry.labels?.operation || 'unknown';
        const success = entry.labels?.success === 'true';
        
        if (!operationCounts[operation]) {
          operationCounts[operation] = { success: 0, failed: 0 };
        }
        
        if (success) {
          operationCounts[operation].success += entry.value;
        } else {
          operationCounts[operation].failed += entry.value;
        }
      });
      
      for (const [operation, counts] of Object.entries(operationCounts)) {
        output += `prismmail_db_queries_total{operation="${operation}",status="success"} ${counts.success} ${timestamp}\n`;
        output += `prismmail_db_queries_total{operation="${operation}",status="failed"} ${counts.failed} ${timestamp}\n`;
      }
    }
    
    return output + '\n';
  }
  
  private static exportEmailMetrics(allMetrics: any, timestamp: number): string {
    let output = '';
    
    // Email sync metrics
    if (allMetrics.email_syncs_total) {
      output += '# HELP prismmail_email_syncs_total Total email sync operations\n';
      output += '# TYPE prismmail_email_syncs_total counter\n';
      
      const emailMetrics = allMetrics.email_syncs_total;
      const protocolCounts: Record<string, { success: number; failed: number }> = {};
      
      emailMetrics.forEach((entry: MetricEntry) => {
        const protocol = entry.labels?.protocol || 'unknown';
        const success = entry.labels?.success === 'true';
        
        if (!protocolCounts[protocol]) {
          protocolCounts[protocol] = { success: 0, failed: 0 };
        }
        
        if (success) {
          protocolCounts[protocol].success += entry.value;
        } else {
          protocolCounts[protocol].failed += entry.value;
        }
      });
      
      for (const [protocol, counts] of Object.entries(protocolCounts)) {
        output += `prismmail_email_syncs_total{protocol="${protocol}",status="success"} ${counts.success} ${timestamp}\n`;
        output += `prismmail_email_syncs_total{protocol="${protocol}",status="failed"} ${counts.failed} ${timestamp}\n`;
      }
    }
    
    return output + '\n';
  }
}

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