/**
 * Simple fallback implementation for services that previously used Redis
 * This replaces the complex Redis/ioredis setup that was causing issues
 */

/**
 * Safe connection stub that provides fallback behavior
 * without external Redis dependencies
 */
class SafeRedisConnection {
  private connected = false;

  constructor() {
    console.log('Redis not available - using fallback mode');
  }

  async ping(): Promise<string> {
    return 'PONG'; // Always return success for fallback
  }

  async get(key: string): Promise<string | null> {
    return null; // Fallback: no persistent storage
  }

  async set(key: string, value: string, mode?: string, duration?: number): Promise<string> {
    return 'OK'; // Fallback: pretend success
  }

  async setex(key: string, seconds: number, value: string): Promise<string> {
    return 'OK';
  }

  async incr(key: string): Promise<number> {
    return 1; // Fallback counter
  }

  async expire(key: string, seconds: number): Promise<number> {
    return 1;
  }

  multi() {
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
    this.connected = false;
    return 'OK';
  }

  on(event: string, handler: Function): void {
    // Safe no-op for event listeners
  }

  isConnected(): boolean {
    return this.connected;
  }
}

export const redis = new SafeRedisConnection();

/**
 * Health check for Redis connection (always returns false for fallback mode)
 */
export async function checkRedisHealth(): Promise<boolean> {
  return false; // Redis not available in clean installation
}

/**
 * Graceful shutdown
 */
export async function closeRedis(): Promise<void> {
  await redis.quit();
  console.log('Redis fallback connection closed');
}