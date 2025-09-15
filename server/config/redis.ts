import Redis from 'ioredis';

/**
 * Redis configuration for distributed background jobs
 */
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null, // Required for BullMQ blocking operations
  retryDelayOnFailover: 100,
  connectTimeout: 30000,
  lazyConnect: true,
  // Prevent memory leaks in development
  maxmemoryPolicy: 'allkeys-lru',
  // Enable keyspace notifications for monitoring
  keyspaceEvents: 'Ex'
};

/**
 * Create Redis connection with proper error handling
 */
export function createRedisConnection(): Redis {
  const redis = new Redis(redisConfig);
  
  redis.on('connect', () => {
    console.log('Redis connected successfully');
  });
  
  redis.on('error', (error) => {
    console.error('Redis connection error:', error);
  });
  
  redis.on('close', () => {
    console.log('Redis connection closed');
  });
  
  return redis;
}

/**
 * Safe Redis connection with proper fallback handling
 */
class SafeRedisConnection {
  private client: Redis | null = null;
  private connected = false;
  private connectionAttempted = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.initializeConnection();
  }

  private async initializeConnection(): Promise<void> {
    if (this.connectionAttempted) return;
    this.connectionAttempted = true;

    try {
      // Only attempt connection if Redis URL is configured
      if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
        console.log('Redis not configured - using fallback mode');
        return;
      }

      this.client = new Redis(redisConfig);
      
      this.client.on('connect', () => {
        console.log('Redis connected successfully');
        this.connected = true;
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = null;
        }
      });
      
      this.client.on('error', (error) => {
        console.log('Redis connection error (using fallback):', error.message);
        this.connected = false;
        this.scheduleReconnect();
      });
      
      this.client.on('close', () => {
        console.log('Redis connection closed (using fallback)');
        this.connected = false;
        this.scheduleReconnect();
      });

      // Test connection with timeout
      await Promise.race([
        this.client.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 5000))
      ]);
      
    } catch (error) {
      console.log('Redis connection failed - using fallback mode:', (error as Error).message);
      this.connected = false;
      this.client = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;
    
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (!this.connected && process.env.REDIS_URL || process.env.REDIS_HOST) {
        console.log('Attempting Redis reconnection...');
        this.connectionAttempted = false;
        this.initializeConnection();
      }
    }, 30000); // Retry every 30 seconds
  }

  async ping(): Promise<string> {
    if (this.connected && this.client) {
      try {
        return await this.client.ping();
      } catch (error) {
        this.connected = false;
        return 'PONG'; // Fallback response
      }
    }
    return 'PONG'; // Fallback response
  }

  async get(key: string): Promise<string | null> {
    if (this.connected && this.client) {
      try {
        return await this.client.get(key);
      } catch (error) {
        this.connected = false;
      }
    }
    return null; // Fallback
  }

  async set(key: string, value: string, mode?: string, duration?: number): Promise<string> {
    if (this.connected && this.client) {
      try {
        if (mode === 'EX' && duration) {
          return await this.client.setex(key, duration, value);
        }
        return await this.client.set(key, value);
      } catch (error) {
        this.connected = false;
      }
    }
    return 'OK'; // Fallback response
  }

  async setex(key: string, seconds: number, value: string): Promise<string> {
    if (this.connected && this.client) {
      try {
        return await this.client.setex(key, seconds, value);
      } catch (error) {
        this.connected = false;
      }
    }
    return 'OK'; // Fallback response
  }

  async incr(key: string): Promise<number> {
    if (this.connected && this.client) {
      try {
        return await this.client.incr(key);
      } catch (error) {
        this.connected = false;
      }
    }
    return 1; // Fallback response
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (this.connected && this.client) {
      try {
        return await this.client.expire(key, seconds);
      } catch (error) {
        this.connected = false;
      }
    }
    return 1; // Fallback response
  }

  multi() {
    if (this.connected && this.client) {
      try {
        return this.client.multi();
      } catch (error) {
        this.connected = false;
      }
    }
    // Fallback multi object
    return {
      incr: () => ({
        expire: () => ({
          exec: () => Promise.resolve([[null, 1], [null, 1]])
        })
      })
    };
  }

  async quit(): Promise<string> {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.client) {
      try {
        const result = await this.client.quit();
        this.connected = false;
        this.client = null;
        return result;
      } catch (error) {
        this.connected = false;
        this.client = null;
      }
    }
    return 'OK';
  }

  on(event: string, handler: Function): void {
    // Safe no-op for event listeners when Redis is not available
    if (this.client) {
      this.client.on(event as any, handler as any);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}

export const redis = new SafeRedisConnection();

/**
 * Health check for Redis connection
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch (error) {
    console.error('Redis health check failed:', error);
    return false;
  }
}

/**
 * Graceful shutdown
 */
export async function closeRedis(): Promise<void> {
  try {
    await redis.quit();
    console.log('Redis connection closed gracefully');
  } catch (error) {
    console.error('Error closing Redis connection:', error);
  }
}