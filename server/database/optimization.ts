import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool } from '@neondatabase/serverless';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { metrics, DatabaseMetrics } from '../monitoring/metrics.js';
import { sql } from 'drizzle-orm';

/**
 * Database connection pool configuration
 */
export interface PoolConfig {
  max: number;
  min: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  statementTimeout: number;
  query_timeout: number;
}

/**
 * Optimized database connection manager
 */
class DatabaseManager {
  private pool!: Pool;
  private db: any;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor() {
    this.initializePool();
    this.setupHealthCheck();
  }

  private initializePool(): void {
    const poolConfig: PoolConfig = {
      max: config.database.maxConnections,
      min: Math.max(1, Math.floor(config.database.maxConnections * 0.1)), // 10% of max as minimum
      idleTimeoutMillis: config.database.idleTimeout,
      connectionTimeoutMillis: config.database.connectionTimeout,
      statementTimeout: 30000, // 30 seconds
      query_timeout: 30000, // 30 seconds
    };

    this.pool = new Pool({
      connectionString: config.database.url,
      ...poolConfig,
    });

    // Pool event listeners for metrics
    this.pool.on('connect', (client) => {
      DatabaseMetrics.trackConnection('acquired');
      logger.debug('Database connection acquired', { poolSize: this.pool.totalCount });
    });

    this.pool.on('remove', (client) => {
      DatabaseMetrics.trackConnection('released');
      logger.debug('Database connection released', { poolSize: this.pool.totalCount });
    });

    this.pool.on('error', (err, client) => {
      DatabaseMetrics.trackConnection('error');
      logger.error('Database connection error', { error: err });
    });

    this.db = drizzle(this.pool);
    logger.info('Database connection pool initialized', poolConfig);
  }

  private setupHealthCheck(): void {
    // Check database health every 30 seconds
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.healthCheck();
      } catch (error) {
        logger.error('Database health check failed', { error: error as Error });
      }
    }, 30000);
  }

  /**
   * Get database instance
   */
  getDatabase(): any {
    return this.db;
  }

  /**
   * Get connection pool statistics
   */
  getPoolStats(): any {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      maxConnections: config.database.maxConnections,
    };
  }

  /**
   * Execute query with automatic metrics and error handling
   */
  async query<T>(
    queryFn: (db: any) => Promise<T>,
    operation: string,
    table: string
  ): Promise<T> {
    return DatabaseMetrics.trackQuery(operation, table)(async () => {
      try {
        return await queryFn(this.db);
      } catch (error) {
        logger.error('Database query error', {
          operation,
          table,
          error: error as Error,
        });
        throw error;
      }
    });
  }

  /**
   * Execute transaction with automatic retry and metrics
   */
  async transaction<T>(
    transactionFn: (tx: any) => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        return await DatabaseMetrics.trackQuery('transaction', 'multiple')(async () => {
          return await this.db.transaction(transactionFn);
        });
      } catch (error) {
        attempt++;
        
        if (attempt >= maxRetries) {
          logger.error('Transaction failed after retries', {
            attempts: attempt,
            error: error as Error,
          });
          throw error;
        }

        // Wait before retry (exponential backoff)
        const delay = Math.pow(2, attempt) * 100;
        await new Promise(resolve => setTimeout(resolve, delay));
        
        logger.warn('Transaction failed, retrying', {
          attempt,
          maxRetries,
          delay,
          error: error as Error,
        });
      }
    }

    throw new Error('Transaction failed after all retries');
  }

  /**
   * Database health check
   */
  async healthCheck(): Promise<{ status: string; latency: number; poolStats: any }> {
    const start = Date.now();
    
    try {
      await this.db.execute(sql`SELECT 1 as health_check`);
      const latency = Date.now() - start;
      const poolStats = this.getPoolStats();
      
      metrics.gauge('db_connection_pool_total', poolStats.totalCount);
      metrics.gauge('db_connection_pool_idle', poolStats.idleCount);
      metrics.gauge('db_connection_pool_waiting', poolStats.waitingCount);
      metrics.histogram('db_health_check_duration', latency);
      
      return {
        status: 'healthy',
        latency,
        poolStats,
      };
    } catch (error) {
      const latency = Date.now() - start;
      metrics.histogram('db_health_check_duration', latency, { success: 'false' });
      throw error;
    }
  }

  /**
   * Gracefully close database connections
   */
  async close(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    try {
      await this.pool.end();
      logger.info('Database connections closed gracefully');
    } catch (error) {
      logger.error('Error closing database connections', { error: error as Error });
    }
  }
}

/**
 * Database indexing optimization
 */
export class DatabaseIndexes {
  /**
   * Create performance indexes for email operations
   */
  static async createOptimalIndexes(db: any): Promise<void> {
    const indexes = [
      // Mail index optimizations for common queries
      {
        name: 'idx_mail_account_folder_date',
        sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_account_folder_date 
              ON mail_index (account_id, folder, date DESC)`,
        description: 'Optimize email listing by account and folder, ordered by date'
      },
      {
        name: 'idx_mail_account_unread',
        sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_account_unread 
              ON mail_index (account_id, is_read) WHERE is_read = false`,
        description: 'Optimize unread email queries'
      },
      {
        name: 'idx_mail_account_flagged',
        sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_account_flagged 
              ON mail_index (account_id, is_flagged) WHERE is_flagged = true`,
        description: 'Optimize flagged email queries'
      },
      {
        name: 'idx_mail_priority',
        sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_priority 
              ON mail_index (account_id, priority DESC, date DESC) WHERE priority > 0`,
        description: 'Optimize priority email queries'
      },
      {
        name: 'idx_mail_search',
        sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_search 
              ON mail_index USING gin (to_tsvector('english', subject || ' ' || "from" || ' ' || snippet))`,
        description: 'Full-text search optimization'
      },
      {
        name: 'idx_mail_message_id_unique',
        sql: `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_message_id_unique 
              ON mail_index (account_id, folder, message_id)`,
        description: 'Prevent duplicate messages and optimize lookups'
      },

      // Account connections optimizations
      {
        name: 'idx_account_connections_user_active',
        sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_connections_user_active 
              ON account_connections (user_id, is_active) WHERE is_active = true`,
        description: 'Optimize active account queries per user'
      },
      {
        name: 'idx_account_connections_protocol',
        sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_connections_protocol 
              ON account_connections (protocol, is_active) WHERE is_active = true`,
        description: 'Optimize queries by email protocol'
      },

      // Account folders optimizations
      {
        name: 'idx_account_folders_account_active',
        sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_folders_account_active 
              ON account_folders (account_id, is_active) WHERE is_active = true`,
        description: 'Optimize folder queries per account'
      },
      {
        name: 'idx_account_folders_sync',
        sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_folders_sync 
              ON account_folders (last_synced ASC) WHERE is_active = true`,
        description: 'Optimize sync scheduling queries'
      },

      // Priority rules optimizations
      {
        name: 'idx_priority_rules_account_active',
        sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_priority_rules_account_active 
              ON priority_rules (account_id, is_active) WHERE is_active = true`,
        description: 'Optimize priority rule queries'
      },

      // VIP contacts optimizations
      {
        name: 'idx_vip_contacts_user_email',
        sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vip_contacts_user_email 
              ON vip_contacts (user_id, email)`,
        description: 'Optimize VIP contact lookups'
      },

      // Session optimizations
      {
        name: 'idx_sessions_expire',
        sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_expire 
              ON sessions (expire)`,
        description: 'Optimize session cleanup'
      },

      // User preferences
      {
        name: 'idx_user_prefs_user_id',
        sql: `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_user_prefs_user_id 
              ON user_prefs (user_id)`,
        description: 'Unique user preferences lookup'
      },
    ];

    logger.info('Creating database indexes for optimal performance...');

    for (const index of indexes) {
      try {
        await db.execute(sql.raw(index.sql));
        logger.info(`Created index: ${index.name}`, { description: index.description });
      } catch (error) {
        // Index might already exist or there might be a conflict
        logger.warn(`Failed to create index: ${index.name}`, { 
          error: error as Error,
          description: index.description 
        });
      }
    }

    logger.info('Database index creation completed');
  }

  /**
   * Analyze database performance and suggest optimizations
   */
  static async analyzePerformance(db: any): Promise<any> {
    try {
      // Get table sizes
      const tableSizes = await db.execute(sql`
        SELECT 
          schemaname,
          tablename,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
          pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
        FROM pg_tables 
        WHERE schemaname = 'public'
        ORDER BY size_bytes DESC
      `);

      // Get index usage
      const indexUsage = await db.execute(sql`
        SELECT 
          schemaname,
          tablename,
          indexname,
          idx_scan,
          idx_tup_read,
          idx_tup_fetch
        FROM pg_stat_user_indexes 
        ORDER BY idx_scan DESC
      `);

      // Get slow queries (if pg_stat_statements is enabled)
      let slowQueries = [];
      try {
        slowQueries = await db.execute(sql`
          SELECT 
            query,
            calls,
            total_time,
            mean_time,
            stddev_time
          FROM pg_stat_statements 
          ORDER BY mean_time DESC 
          LIMIT 10
        `);
      } catch (error) {
        logger.debug('pg_stat_statements not available for slow query analysis');
      }

      return {
        tableSizes: tableSizes.rows,
        indexUsage: indexUsage.rows,
        slowQueries: slowQueries,
        analyzedAt: new Date(),
      };
    } catch (error) {
      logger.error('Failed to analyze database performance', { error: error as Error });
      throw error;
    }
  }

  /**
   * Optimize database settings for email workload
   */
  static async optimizeSettings(db: any): Promise<void> {
    const optimizations = [
      // Optimize for email workload
      "SET shared_preload_libraries = 'pg_stat_statements'",
      "SET track_activity_query_size = 2048",
      "SET track_io_timing = on",
      "SET log_min_duration_statement = 1000", // Log queries taking more than 1 second
      
      // Memory settings (these would be in postgresql.conf in production)
      "SET work_mem = '16MB'", // For sorting and hash operations
      "SET maintenance_work_mem = '256MB'", // For index creation
      "SET effective_cache_size = '1GB'", // Estimate of available OS cache
    ];

    for (const setting of optimizations) {
      try {
        await db.execute(sql.raw(setting));
        logger.debug(`Applied database optimization: ${setting}`);
      } catch (error) {
        logger.warn(`Failed to apply database optimization: ${setting}`, { 
          error: error as Error 
        });
      }
    }
  }
}

/**
 * Query optimization utilities
 */
export class QueryOptimizer {
  /**
   * Paginated query with performance optimization
   */
  static buildPaginatedQuery(baseQuery: any, page: number, limit: number, maxLimit: number = 200) {
    const safeLimit = Math.min(limit, maxLimit);
    const offset = (page - 1) * safeLimit;
    
    return baseQuery.limit(safeLimit).offset(offset);
  }

  /**
   * Build optimized email list query
   */
  static buildEmailListQuery(db: any, filters: {
    accountId: string;
    folder?: string;
    isRead?: boolean;
    isFlagged?: boolean;
    priority?: number;
    searchTerm?: string;
    page: number;
    limit: number;
  }) {
    let query = db.select().from('mail_index').where(sql`account_id = ${filters.accountId}`);

    if (filters.folder) {
      query = query.where(sql`folder = ${filters.folder}`);
    }

    if (filters.isRead !== undefined) {
      query = query.where(sql`is_read = ${filters.isRead}`);
    }

    if (filters.isFlagged !== undefined) {
      query = query.where(sql`is_flagged = ${filters.isFlagged}`);
    }

    if (filters.priority !== undefined) {
      query = query.where(sql`priority >= ${filters.priority}`);
    }

    if (filters.searchTerm) {
      query = query.where(sql`
        to_tsvector('english', subject || ' ' || "from" || ' ' || snippet) 
        @@ plainto_tsquery('english', ${filters.searchTerm})
      `);
    }

    // Order by date descending for most recent first
    query = query.orderBy(sql`date DESC`);

    return this.buildPaginatedQuery(query, filters.page, filters.limit);
  }
}

// Initialize global database manager
export const dbManager = new DatabaseManager();

// Export optimized database instance
export const optimizedDb = dbManager.getDatabase();

export default dbManager;