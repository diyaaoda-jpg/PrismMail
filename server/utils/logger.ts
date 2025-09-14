import { config } from '../config/index.js';

/**
 * Log levels with numeric values for filtering
 */
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

/**
 * Structured log entry interface
 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: Record<string, any>;
  error?: Error;
  requestId?: string;
  userId?: string;
  duration?: number;
  metadata?: Record<string, any>;
}

/**
 * Performance metrics interface
 */
export interface PerformanceMetric {
  operation: string;
  duration: number;
  success: boolean;
  timestamp: Date;
  metadata?: Record<string, any>;
}

/**
 * Production-grade logger with structured logging and performance tracking
 */
class Logger {
  private readonly logLevel: LogLevel;
  private readonly enableMetrics: boolean;
  private readonly performanceMetrics: PerformanceMetric[] = [];
  private readonly maxMetricsCache = 1000;

  constructor() {
    this.logLevel = this.parseLogLevel(config.server.logLevel);
    this.enableMetrics = config.performance.enableProfiling;
  }

  private parseLogLevel(level: string): LogLevel {
    switch (level.toLowerCase()) {
      case 'error': return LogLevel.ERROR;
      case 'warn': return LogLevel.WARN;
      case 'info': return LogLevel.INFO;
      case 'debug': return LogLevel.DEBUG;
      default: return LogLevel.INFO;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.logLevel;
  }

  private formatLogEntry(entry: LogEntry): string {
    // Use structured JSON logging for production
    const logObject = {
      timestamp: entry.timestamp.toISOString(),
      level: LogLevel[entry.level],
      message: entry.message,
      ...(entry.requestId && { requestId: entry.requestId }),
      ...(entry.userId && { userId: this.sanitizeUserId(entry.userId) }),
      ...(entry.duration && { duration: entry.duration }),
      ...(entry.context && { context: this.sanitizeContext(entry.context) }),
      ...(entry.error && { 
        error: {
          message: entry.error.message,
          name: entry.error.name,
          stack: config.server.nodeEnv === 'development' ? entry.error.stack : undefined
        }
      }),
      ...(entry.metadata && { metadata: this.sanitizeContext(entry.metadata) })
    };

    return JSON.stringify(logObject);
  }

  /**
   * Sanitize user ID to remove PII while keeping ability to track
   */
  private sanitizeUserId(userId: string): string {
    // Hash the user ID to remove PII but maintain tracking capability
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(userId).digest('hex').substring(0, 12);
  }

  /**
   * Sanitize context object to remove PII
   */
  private sanitizeContext(context: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(context)) {
      // Remove common PII fields
      if (this.isPIIField(key)) {
        // Keep field but mask value
        sanitized[key] = this.maskPII(String(value));
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeContext(value);
      } else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }

  /**
   * Check if field contains PII
   */
  private isPIIField(fieldName: string): boolean {
    const piiFields = [
      'email', 'userEmail', 'username', 'name', 'firstName', 'lastName',
      'phone', 'phoneNumber', 'address', 'ip', 'userAgent', 'password',
      'host', 'server', 'hostname'
    ];
    
    return piiFields.some(pii => 
      fieldName.toLowerCase().includes(pii.toLowerCase())
    );
  }

  /**
   * Mask PII data while preserving some structure for debugging
   */
  private maskPII(value: string): string {
    if (!value || value.length === 0) return '[empty]';
    
    // For email addresses, show domain but mask local part
    if (value.includes('@')) {
      const [local, domain] = value.split('@');
      return `${local.substring(0, 2)}***@${domain}`;
    }
    
    // For IP addresses, mask last octet
    if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) {
      const parts = value.split('.');
      return `${parts[0]}.${parts[1]}.${parts[2]}.***`;
    }
    
    // For other values, show first 2 characters
    if (value.length <= 4) return '***';
    return `${value.substring(0, 2)}***`;
  }

  private writeLog(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) return;

    const formattedMessage = this.formatLogEntry(entry);
    
    // Write to appropriate output stream
    switch (entry.level) {
      case LogLevel.ERROR:
        console.error(formattedMessage);
        break;
      case LogLevel.WARN:
        console.warn(formattedMessage);
        break;
      case LogLevel.INFO:
        console.info(formattedMessage);
        break;
      case LogLevel.DEBUG:
        console.debug(formattedMessage);
        break;
    }

    // In production, you might want to send critical errors to external services
    if (entry.level === LogLevel.ERROR && config.server.nodeEnv === 'production') {
      this.handleCriticalError(entry);
    }
  }

  private handleCriticalError(entry: LogEntry): void {
    // In a real production environment, you would integrate with services like:
    // - Sentry for error tracking
    // - DataDog for monitoring
    // - PagerDuty for alerting
    // For now, we'll just ensure the error is prominently logged
    console.error('CRITICAL ERROR:', entry);
  }

  /**
   * Log an error message
   */
  error(message: string, context?: Record<string, any>, error?: Error): void {
    this.writeLog({
      level: LogLevel.ERROR,
      message,
      timestamp: new Date(),
      context,
      error,
    });
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: Record<string, any>): void {
    this.writeLog({
      level: LogLevel.WARN,
      message,
      timestamp: new Date(),
      context,
    });
  }

  /**
   * Log an info message
   */
  info(message: string, context?: Record<string, any>): void {
    this.writeLog({
      level: LogLevel.INFO,
      message,
      timestamp: new Date(),
      context,
    });
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: Record<string, any>): void {
    this.writeLog({
      level: LogLevel.DEBUG,
      message,
      timestamp: new Date(),
      context,
    });
  }

  /**
   * Log with custom metadata
   */
  log(level: LogLevel, message: string, options: {
    context?: Record<string, any>;
    error?: Error;
    requestId?: string;
    userId?: string;
    duration?: number;
    metadata?: Record<string, any>;
  } = {}): void {
    this.writeLog({
      level,
      message,
      timestamp: new Date(),
      ...options,
    });
  }

  /**
   * Create a child logger with persistent context
   */
  child(context: Record<string, any>): ChildLogger {
    return new ChildLogger(this, context);
  }

  /**
   * Track performance metrics
   */
  recordMetric(metric: PerformanceMetric): void {
    if (!this.enableMetrics) return;

    this.performanceMetrics.push(metric);
    
    // Keep cache size manageable
    if (this.performanceMetrics.length > this.maxMetricsCache) {
      this.performanceMetrics.shift();
    }

    // Log slow operations
    if (metric.duration > 1000) {
      this.warn(`Slow operation detected: ${metric.operation}`, {
        duration: metric.duration,
        success: metric.success,
        metadata: metric.metadata,
      });
    }
  }

  /**
   * Get performance metrics
   */
  getMetrics(): PerformanceMetric[] {
    return [...this.performanceMetrics];
  }

  /**
   * Get aggregated performance statistics
   */
  getPerformanceStats(): Record<string, any> {
    if (this.performanceMetrics.length === 0) {
      return { totalOperations: 0 };
    }

    const operations = this.performanceMetrics.reduce((acc, metric) => {
      const key = metric.operation;
      if (!acc[key]) {
        acc[key] = { count: 0, totalDuration: 0, successCount: 0 };
      }
      acc[key].count++;
      acc[key].totalDuration += metric.duration;
      if (metric.success) acc[key].successCount++;
      return acc;
    }, {} as Record<string, any>);

    Object.keys(operations).forEach(key => {
      const op = operations[key];
      op.averageDuration = op.totalDuration / op.count;
      op.successRate = op.successCount / op.count;
    });

    return {
      totalOperations: this.performanceMetrics.length,
      operations,
    };
  }

  /**
   * Clear metrics cache
   */
  clearMetrics(): void {
    this.performanceMetrics.length = 0;
  }
}

/**
 * Child logger that maintains persistent context
 */
class ChildLogger {
  constructor(
    private parent: Logger,
    private context: Record<string, any>
  ) {}

  private mergeContext(additionalContext?: Record<string, any>): Record<string, any> {
    return { ...this.context, ...additionalContext };
  }

  error(message: string, context?: Record<string, any>, error?: Error): void {
    this.parent.error(message, this.mergeContext(context), error);
  }

  warn(message: string, context?: Record<string, any>): void {
    this.parent.warn(message, this.mergeContext(context));
  }

  info(message: string, context?: Record<string, any>): void {
    this.parent.info(message, this.mergeContext(context));
  }

  debug(message: string, context?: Record<string, any>): void {
    this.parent.debug(message, this.mergeContext(context));
  }

  child(additionalContext: Record<string, any>): ChildLogger {
    return new ChildLogger(this.parent, this.mergeContext(additionalContext));
  }
}

/**
 * Performance timing utility
 */
export class PerformanceTimer {
  private startTime: number;
  private operation: string;
  private metadata?: Record<string, any>;

  constructor(operation: string, metadata?: Record<string, any>) {
    this.operation = operation;
    this.metadata = metadata;
    this.startTime = Date.now();
  }

  /**
   * End timing and record metric
   */
  end(success: boolean = true): number {
    const duration = Date.now() - this.startTime;
    
    logger.recordMetric({
      operation: this.operation,
      duration,
      success,
      timestamp: new Date(),
      metadata: this.metadata,
    });

    return duration;
  }
}

/**
 * Utility function to time async operations
 */
export async function timeOperation<T>(
  operation: string,
  fn: () => Promise<T>,
  metadata?: Record<string, any>
): Promise<T> {
  const timer = new PerformanceTimer(operation, metadata);
  try {
    const result = await fn();
    timer.end(true);
    return result;
  } catch (error) {
    timer.end(false);
    throw error;
  }
}

/**
 * Express middleware for request logging
 */
export function requestLoggingMiddleware(req: any, res: any, next: any): void {
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] || `req_${Math.random().toString(36).substring(2)}`;
  
  // Add request ID to request object
  req.requestId = requestId;
  
  // Create child logger for this request
  req.logger = logger.child({ requestId });

  // Log request start with sanitized data
  req.logger.info(`${req.method} ${req.path} started`, {
    method: req.method,
    path: req.path,
    userAgent: req.headers['user-agent'], // This will be sanitized by the logger
    ip: req.ip, // This will be sanitized by the logger
    contentLength: req.headers['content-length'],
    origin: req.headers['origin']
  });

  // Hook into response finish event
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    const responseSize = res.get('Content-Length');
    
    req.logger.info(`${req.method} ${req.path} completed`, {
      method: req.method,
      path: req.path,
      statusCode,
      duration,
      responseSize,
      success: statusCode < 400
    });

    // Record performance metric
    logger.recordMetric({
      operation: `${req.method} ${req.path}`,
      duration,
      success: statusCode < 400,
      timestamp: new Date(),
      metadata: { statusCode, method: req.method, path: req.path },
    });
  });

  next();
}

// Export singleton instance
export const logger = new Logger();
export default logger;