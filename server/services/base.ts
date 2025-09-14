import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { metrics } from '../monitoring/metrics.js';

/**
 * Base service class with common functionality
 */
export abstract class BaseService {
  protected readonly serviceName: string;
  protected readonly logger: any;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
    this.logger = logger.child({ service: serviceName });
  }

  /**
   * Execute operation with automatic error handling and metrics
   */
  protected async executeOperation<T>(
    operationName: string,
    operation: () => Promise<T>,
    context?: Record<string, any>
  ): Promise<T> {
    const start = Date.now();
    const operationContext = {
      service: this.serviceName,
      operation: operationName,
      ...context,
    };

    try {
      this.logger.debug(`Starting operation: ${operationName}`, operationContext);
      
      const result = await operation();
      const duration = Date.now() - start;
      
      metrics.histogram(`service_operation_duration`, duration, {
        service: this.serviceName,
        operation: operationName,
        success: 'true',
      });
      
      this.logger.info(`Operation completed: ${operationName}`, {
        ...operationContext,
        duration,
        success: true,
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      
      metrics.histogram(`service_operation_duration`, duration, {
        service: this.serviceName,
        operation: operationName,
        success: 'false',
      });
      
      metrics.increment(`service_operation_errors`, 1, {
        service: this.serviceName,
        operation: operationName,
      });
      
      this.logger.error(`Operation failed: ${operationName}`, {
        ...operationContext,
        duration,
        error: error as Error,
      });
      
      throw error;
    }
  }

  /**
   * Validate service health
   */
  abstract healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details?: any }>;

  /**
   * Get service metrics
   */
  getMetrics(): Record<string, any> {
    return {
      serviceName: this.serviceName,
      status: 'active',
      timestamp: new Date(),
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.logger.info(`Shutting down service: ${this.serviceName}`);
    // Override in subclasses for cleanup
  }
}

/**
 * Service dependency injection container
 */
export class ServiceContainer {
  private services = new Map<string, BaseService>();
  private dependencies = new Map<string, string[]>();

  /**
   * Register a service
   */
  register<T extends BaseService>(name: string, service: T, dependencies: string[] = []): void {
    this.services.set(name, service);
    this.dependencies.set(name, dependencies);
    logger.info(`Service registered: ${name}`, { dependencies });
  }

  /**
   * Get a service
   */
  get<T extends BaseService>(name: string): T {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service not found: ${name}`);
    }
    return service as T;
  }

  /**
   * Check if service exists
   */
  has(name: string): boolean {
    return this.services.has(name);
  }

  /**
   * Get all services
   */
  getAll(): Map<string, BaseService> {
    return new Map(this.services);
  }

  /**
   * Initialize all services in dependency order
   */
  async initializeAll(): Promise<void> {
    const initialized = new Set<string>();
    const initializing = new Set<string>();

    const initializeService = async (serviceName: string): Promise<void> => {
      if (initialized.has(serviceName)) return;
      if (initializing.has(serviceName)) {
        throw new Error(`Circular dependency detected for service: ${serviceName}`);
      }

      initializing.add(serviceName);
      
      // Initialize dependencies first
      const deps = this.dependencies.get(serviceName) || [];
      for (const dep of deps) {
        await initializeService(dep);
      }

      // Initialize the service
      const service = this.services.get(serviceName);
      if (service) {
        logger.info(`Initializing service: ${serviceName}`);
        await service.healthCheck(); // Verify service is healthy
        initialized.add(serviceName);
      }

      initializing.delete(serviceName);
    };

    // Initialize all services
    for (const serviceName of Array.from(this.services.keys())) {
      await initializeService(serviceName);
    }

    logger.info('All services initialized successfully', {
      serviceCount: this.services.size,
      services: Array.from(this.services.keys()),
    });
  }

  /**
   * Health check all services
   */
  async healthCheckAll(): Promise<Record<string, any>> {
    const results: Record<string, any> = {};
    
    for (const [name, service] of this.services.entries()) {
      try {
        const health = await service.healthCheck();
        results[name] = {
          status: health.status,
          details: health.details,
          timestamp: new Date(),
        };
      } catch (error) {
        results[name] = {
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date(),
        };
      }
    }
    
    return results;
  }

  /**
   * Gracefully shutdown all services
   */
  async shutdownAll(): Promise<void> {
    logger.info('Shutting down all services...');
    
    const shutdownPromises = Array.from(this.services.entries()).map(async ([name, service]) => {
      try {
        await service.shutdown();
        logger.info(`Service shutdown completed: ${name}`);
      } catch (error) {
        logger.error(`Service shutdown failed: ${name}`, { error: error as Error });
      }
    });

    await Promise.allSettled(shutdownPromises);
    logger.info('All services shutdown completed');
  }
}

/**
 * Retry mechanism for service operations
 */
export class RetryHandler {
  static async withRetry<T>(
    operation: () => Promise<T>,
    options: {
      maxRetries?: number;
      baseDelay?: number;
      maxDelay?: number;
      exponentialBackoff?: boolean;
      retryCondition?: (error: Error) => boolean;
    } = {}
  ): Promise<T> {
    const {
      maxRetries = 3,
      baseDelay = 1000,
      maxDelay = 10000,
      exponentialBackoff = true,
      retryCondition = () => true,
    } = options;

    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxRetries || !retryCondition(lastError)) {
          throw lastError;
        }
        
        const delay = exponentialBackoff 
          ? Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
          : baseDelay;
          
        logger.warn(`Operation failed, retrying in ${delay}ms`, {
          attempt: attempt + 1,
          maxRetries,
          error: lastError.message,
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError!;
  }
}

/**
 * Circuit breaker for service resilience
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private readonly threshold: number = 5,
    private readonly timeout: number = 60000 // 1 minute
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime < this.timeout) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'half-open';
    }

    try {
      const result = await operation();
      this.reset();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.threshold) {
      this.state = 'open';
      logger.warn('Circuit breaker opened', {
        failures: this.failures,
        threshold: this.threshold,
      });
    }
  }

  private reset(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  getState(): { state: string; failures: number; lastFailureTime: number } {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime,
    };
  }
}

// Global service container
export const serviceContainer = new ServiceContainer();

export default BaseService;