import { sql } from 'drizzle-orm';
import { db } from '../db';

/**
 * Database optimization and indexing for scalable priority engine
 * 
 * This module ensures all priority-related queries use proper indexes
 * for production-scale performance with millions of emails
 */

export interface IndexCreationResult {
  name: string;
  success: boolean;
  error?: string;
  alreadyExists?: boolean;
}

/**
 * Create essential indexes for priority engine scalability
 */
export async function createPriorityEngineIndexes(): Promise<IndexCreationResult[]> {
  const results: IndexCreationResult[] = [];
  
  // Critical indexes for mail_index table (most queried table)
  const indexes = [
    {
      name: 'idx_mail_account_date_priority',
      query: `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_account_date_priority 
        ON mail_index (account_id, date DESC, auto_priority DESC, is_in_focus)
      `,
      description: 'Primary index for account-based queries with date and priority sorting'
    },
    {
      name: 'idx_mail_account_folder_priority',
      query: `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_account_folder_priority 
        ON mail_index (account_id, folder, auto_priority DESC, date DESC)
      `,
      description: 'Index for folder-based priority queries'
    },
    {
      name: 'idx_mail_priority_source_rule',
      query: `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_priority_source_rule 
        ON mail_index (priority_source, rule_id, account_id)
      `,
      description: 'Index for rule-based queries and incremental rescoring'
    },
    {
      name: 'idx_mail_vip_focus',
      query: `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_vip_focus 
        ON mail_index (is_vip, is_in_focus, account_id, date DESC)
      `,
      description: 'Index for VIP and focus mode queries'
    },
    {
      name: 'idx_mail_needs_priority_update',
      query: `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_needs_priority_update 
        ON mail_index (account_id, priority_source, auto_priority, date)
        WHERE auto_priority IS NULL OR priority_source = 'auto'
      `,
      description: 'Partial index for emails needing priority updates'
    },
    {
      name: 'idx_mail_from_sender_priority',
      query: `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_from_sender_priority 
        ON mail_index (from, account_id, date DESC)
      `,
      description: 'Index for sender-based queries and VIP matching'
    },
    {
      name: 'idx_mail_subject_search',
      query: `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_subject_search 
        ON mail_index USING gin(to_tsvector('english', subject))
      `,
      description: 'Full-text search index for subject lines'
    },
    {
      name: 'idx_mail_updated_recent',
      query: `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_updated_recent 
        ON mail_index (updated_at DESC, account_id)
        WHERE updated_at > NOW() - INTERVAL '7 days'
      `,
      description: 'Index for recently updated emails (partial index)'
    },
    
    // Indexes for account_connections table
    {
      name: 'idx_account_user_active',
      query: `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_user_active 
        ON account_connections (user_id, is_active, protocol)
      `,
      description: 'Index for user account lookups'
    },
    
    // Indexes for priority_rules table
    {
      name: 'idx_rules_account_active_order',
      query: `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rules_account_active_order 
        ON priority_rules (account_id, is_active, execution_order)
      `,
      description: 'Index for active rules lookup with execution order'
    },
    {
      name: 'idx_rules_match_count',
      query: `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rules_match_count 
        ON priority_rules (account_id, match_count DESC, updated_at DESC)
      `,
      description: 'Index for rule effectiveness analytics'
    },
    
    // Indexes for vip_contacts table
    {
      name: 'idx_vip_user_email',
      query: `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vip_user_email 
        ON vip_contacts (user_id, email, priority DESC)
      `,
      description: 'Index for VIP contact lookups'
    },
    {
      name: 'idx_vip_interaction_stats',
      query: `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vip_interaction_stats 
        ON vip_contacts (user_id, interaction_count DESC, last_interaction DESC)
      `,
      description: 'Index for VIP interaction analytics'
    }
  ];
  
  console.log('Creating database indexes for priority engine scalability...');
  
  for (const index of indexes) {
    try {
      console.log(`Creating index: ${index.name} - ${index.description}`);
      
      await db.execute(sql.raw(index.query));
      
      results.push({
        name: index.name,
        success: true,
        alreadyExists: false
      });
      
      console.log(`✓ Successfully created index: ${index.name}`);
      
    } catch (error: any) {
      const isAlreadyExists = error.message?.includes('already exists');
      
      results.push({
        name: index.name,
        success: isAlreadyExists,
        error: isAlreadyExists ? undefined : error.message,
        alreadyExists: isAlreadyExists
      });
      
      if (isAlreadyExists) {
        console.log(`✓ Index already exists: ${index.name}`);
      } else {
        console.error(`✗ Failed to create index ${index.name}:`, error.message);
      }
    }
  }
  
  return results;
}

/**
 * Analyze query performance and suggest optimizations
 */
export async function analyzeQueryPerformance(): Promise<{
  slowQueries: any[];
  missingIndexes: string[];
  recommendations: string[];
}> {
  const results = {
    slowQueries: [] as any[],
    missingIndexes: [] as string[],
    recommendations: [] as string[]
  };
  
  try {
    // Check for slow queries in the last hour
    const slowQueries = await db.execute(sql`
      SELECT query, mean_exec_time, calls, total_exec_time
      FROM pg_stat_statements 
      WHERE query LIKE '%mail_index%' OR query LIKE '%priority%' OR query LIKE '%vip_contacts%'
      ORDER BY mean_exec_time DESC 
      LIMIT 10
    `);
    
    results.slowQueries = (slowQueries.rows as any[]) || [];
    
    // Check for missing indexes on frequently queried columns
    const potentialMissingIndexes = await db.execute(sql`
      SELECT schemaname, tablename, attname, n_distinct, correlation
      FROM pg_stats 
      WHERE schemaname = 'public' 
      AND tablename IN ('mail_index', 'priority_rules', 'vip_contacts', 'account_connections')
      AND n_distinct > 100
      ORDER BY n_distinct DESC
    `);
    
    results.missingIndexes = ((potentialMissingIndexes.rows as any[]) || []).map((row: any) => 
      `${row.tablename}.${row.attname} (${row.n_distinct} distinct values)`
    );
    
  } catch (error) {
    console.warn('Query performance analysis requires pg_stat_statements extension:', error);
  }
  
  // General recommendations based on schema analysis
  results.recommendations.push(
    'Consider partitioning mail_index by account_id for very large deployments',
    'Monitor query performance with pg_stat_statements extension',
    'Use connection pooling for high-concurrency workloads',
    'Consider read replicas for analytics and reporting queries',
    'Implement query result caching for frequently accessed priority rules',
    'Use partial indexes for filtering large result sets',
    'Monitor index usage and remove unused indexes periodically'
  );
  
  return results;
}

/**
 * Verify index usage and performance
 */
export async function verifyIndexPerformance(): Promise<{
  indexUsage: any[];
  tableStats: any[];
  cacheHitRatio: number;
}> {
  const results = {
    indexUsage: [] as any[],
    tableStats: [] as any[],
    cacheHitRatio: 0
  };
  
  try {
    // Check index usage statistics
    const indexUsage = await db.execute(sql`
      SELECT 
        schemaname, tablename, indexname,
        idx_scan, idx_tup_read, idx_tup_fetch
      FROM pg_stat_user_indexes 
      WHERE schemaname = 'public'
      AND tablename IN ('mail_index', 'priority_rules', 'vip_contacts', 'account_connections')
      ORDER BY idx_scan DESC
    `);
    
    results.indexUsage = (indexUsage.rows as any[]) || [];
    
    // Check table statistics
    const tableStats = await db.execute(sql`
      SELECT 
        schemaname, tablename,
        n_tup_ins, n_tup_upd, n_tup_del,
        seq_scan, seq_tup_read, idx_scan, idx_tup_fetch
      FROM pg_stat_user_tables 
      WHERE schemaname = 'public'
      AND tablename IN ('mail_index', 'priority_rules', 'vip_contacts', 'account_connections')
    `);
    
    results.tableStats = (tableStats.rows as any[]) || [];
    
    // Check cache hit ratio
    const cacheStats = await db.execute(sql`
      SELECT 
        sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)) * 100 as cache_hit_ratio
      FROM pg_statio_user_tables
      WHERE schemaname = 'public'
    `);
    
    results.cacheHitRatio = Number(cacheStats.rows?.[0]?.cache_hit_ratio) || 0;
    
  } catch (error) {
    console.error('Error verifying index performance:', error);
  }
  
  return results;
}

/**
 * Initialize database optimizations
 */
export async function initializeOptimizations(): Promise<void> {
  console.log('Initializing database optimizations for priority engine...');
  
  try {
    // Create indexes
    const indexResults = await createPriorityEngineIndexes();
    const successCount = indexResults.filter(r => r.success).length;
    const errorCount = indexResults.filter(r => !r.success && !r.alreadyExists).length;
    
    console.log(`Index creation completed: ${successCount} successful, ${errorCount} errors`);
    
    // Analyze performance
    const performance = await analyzeQueryPerformance();
    console.log(`Performance analysis: ${performance.slowQueries.length} slow queries identified`);
    
    // Set optimized PostgreSQL settings for priority workloads
    await db.execute(sql`
      -- Optimize for read-heavy workloads with complex queries
      SET work_mem = '256MB';
      SET effective_cache_size = '4GB';
      SET random_page_cost = 1.1;
      SET cpu_tuple_cost = 0.01;
      SET cpu_index_tuple_cost = 0.005;
      SET cpu_operator_cost = 0.0025;
    `);
    
    console.log('Database optimization initialization completed');
    
  } catch (error) {
    console.error('Error initializing database optimizations:', error);
    throw error;
  }
}