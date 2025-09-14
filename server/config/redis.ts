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
 * Singleton Redis instance for application use
 */
export const redis = createRedisConnection();

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