import { z } from 'zod';
import { fromZodError } from 'zod-validation-error';

/**
 * Environment-specific configuration schemas
 */
const DatabaseConfigSchema = z.object({
  url: z.string().url('DATABASE_URL must be a valid URL'),
  maxConnections: z.coerce.number().min(1).max(100).default(20),
  connectionTimeout: z.coerce.number().min(1000).max(30000).default(5000),
  idleTimeout: z.coerce.number().min(10000).max(300000).default(60000),
  ssl: z.boolean().default(true),
});

const AuthConfigSchema = z.object({
  sessionSecret: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  sessionMaxAge: z.coerce.number().min(3600).max(2592000).default(604800), // 7 days default
  issuerUrl: z.string().url().optional(),
  replitDomains: z.string().optional(),
  cookieSecure: z.boolean().default(true),
  cookieHttpOnly: z.boolean().default(true),
  cookieSameSite: z.enum(['strict', 'lax', 'none']).default('lax'),
});

const EmailConfigSchema = z.object({
  syncInterval: z.coerce.number().min(30).max(3600).default(300), // 5 minutes default
  maxEmailsPerSync: z.coerce.number().min(10).max(1000).default(100),
  ewsTimeout: z.coerce.number().min(5000).max(60000).default(30000),
  imapTimeout: z.coerce.number().min(5000).max(60000).default(30000),
  enableRealTimeSync: z.boolean().default(true),
  maxConnectionRetries: z.coerce.number().min(1).max(10).default(3),
});

const SecurityConfigSchema = z.object({
  rateLimitWindowMs: z.coerce.number().min(60000).max(3600000).default(900000), // 15 minutes
  rateLimitMaxRequests: z.coerce.number().min(10).max(1000).default(100),
  enableCors: z.boolean().default(false),
  corsOrigins: z.string().optional(),
  enableHelmet: z.boolean().default(true),
  enableCSRF: z.boolean().default(true),
  encryptionKey: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters'),
});

const ServerConfigSchema = z.object({
  port: z.coerce.number().min(1000).max(65535).default(5000),
  host: z.string().default('0.0.0.0'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  enableMetrics: z.boolean().default(true),
  metricsPort: z.coerce.number().min(1000).max(65535).default(3001),
});

const PerformanceConfigSchema = z.object({
  enableProfiling: z.boolean().default(false),
  enableTracing: z.boolean().default(false),
  memoryLimit: z.coerce.number().min(128).max(8192).default(512), // MB
  requestTimeout: z.coerce.number().min(5000).max(300000).default(30000),
  enableCompression: z.boolean().default(true),
  enableCaching: z.boolean().default(true),
  cacheMaxAge: z.coerce.number().min(60).max(86400).default(3600), // 1 hour
});

/**
 * Feature flags configuration
 */
const FeatureFlagsSchema = z.object({
  enableAdvancedSearch: z.boolean().default(true),
  enablePriorityRules: z.boolean().default(true),
  enableVipContacts: z.boolean().default(true),
  enableReadingMode: z.boolean().default(true),
  enableDarkMode: z.boolean().default(true),
  enableEmailComposition: z.boolean().default(true),
  enableRealTimeNotifications: z.boolean().default(true),
  enableEmailSync: z.boolean().default(true),
  enablePerformanceMetrics: z.boolean().default(true),
  enableDebugMode: z.boolean().default(false),
  maxAccountsPerUser: z.coerce.number().min(1).max(50).default(10),
  maxEmailsPerPage: z.coerce.number().min(10).max(200).default(50),
});

/**
 * Complete application configuration schema
 */
const AppConfigSchema = z.object({
  database: DatabaseConfigSchema,
  auth: AuthConfigSchema,
  email: EmailConfigSchema,
  security: SecurityConfigSchema,
  server: ServerConfigSchema,
  performance: PerformanceConfigSchema,
  features: FeatureFlagsSchema,
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type EmailConfig = z.infer<typeof EmailConfigSchema>;
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type PerformanceConfig = z.infer<typeof PerformanceConfigSchema>;
export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>;

/**
 * Load and validate configuration from environment variables
 */
function loadConfig(): AppConfig {
  const rawConfig = {
    database: {
      url: process.env.DATABASE_URL,
      maxConnections: process.env.DB_MAX_CONNECTIONS,
      connectionTimeout: process.env.DB_CONNECTION_TIMEOUT,
      idleTimeout: process.env.DB_IDLE_TIMEOUT,
      ssl: process.env.DB_SSL !== 'false',
    },
    auth: {
      sessionSecret: process.env.SESSION_SECRET,
      sessionMaxAge: process.env.SESSION_MAX_AGE,
      issuerUrl: process.env.ISSUER_URL,
      replitDomains: process.env.REPLIT_DOMAINS,
      cookieSecure: process.env.COOKIE_SECURE !== 'false',
      cookieHttpOnly: process.env.COOKIE_HTTP_ONLY !== 'false',
      cookieSameSite: process.env.COOKIE_SAME_SITE || 'lax',
    },
    email: {
      syncInterval: process.env.EMAIL_SYNC_INTERVAL,
      maxEmailsPerSync: process.env.EMAIL_MAX_PER_SYNC,
      ewsTimeout: process.env.EWS_TIMEOUT,
      imapTimeout: process.env.IMAP_TIMEOUT,
      enableRealTimeSync: process.env.ENABLE_REALTIME_SYNC !== 'false',
      maxConnectionRetries: process.env.EMAIL_MAX_RETRIES,
    },
    security: {
      rateLimitWindowMs: process.env.RATE_LIMIT_WINDOW_MS,
      rateLimitMaxRequests: process.env.RATE_LIMIT_MAX_REQUESTS,
      enableCors: process.env.ENABLE_CORS === 'true',
      corsOrigins: process.env.CORS_ORIGINS,
      enableHelmet: process.env.ENABLE_HELMET !== 'false',
      enableCSRF: process.env.ENABLE_CSRF !== 'false',
      encryptionKey: process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET,
    },
    server: {
      port: process.env.PORT,
      host: process.env.HOST,
      nodeEnv: process.env.NODE_ENV,
      logLevel: process.env.LOG_LEVEL,
      enableMetrics: process.env.ENABLE_METRICS !== 'false',
      metricsPort: process.env.METRICS_PORT,
    },
    performance: {
      enableProfiling: process.env.ENABLE_PROFILING === 'true',
      enableTracing: process.env.ENABLE_TRACING === 'true',
      memoryLimit: process.env.MEMORY_LIMIT,
      requestTimeout: process.env.REQUEST_TIMEOUT,
      enableCompression: process.env.ENABLE_COMPRESSION !== 'false',
      enableCaching: process.env.ENABLE_CACHING !== 'false',
      cacheMaxAge: process.env.CACHE_MAX_AGE,
    },
    features: {
      enableAdvancedSearch: process.env.FEATURE_ADVANCED_SEARCH !== 'false',
      enablePriorityRules: process.env.FEATURE_PRIORITY_RULES !== 'false',
      enableVipContacts: process.env.FEATURE_VIP_CONTACTS !== 'false',
      enableReadingMode: process.env.FEATURE_READING_MODE !== 'false',
      enableDarkMode: process.env.FEATURE_DARK_MODE !== 'false',
      enableEmailComposition: process.env.FEATURE_EMAIL_COMPOSITION !== 'false',
      enableRealTimeNotifications: process.env.FEATURE_REALTIME_NOTIFICATIONS !== 'false',
      enableEmailSync: process.env.FEATURE_EMAIL_SYNC !== 'false',
      enablePerformanceMetrics: process.env.FEATURE_PERFORMANCE_METRICS !== 'false',
      enableDebugMode: process.env.FEATURE_DEBUG_MODE === 'true',
      maxAccountsPerUser: process.env.FEATURE_MAX_ACCOUNTS_PER_USER,
      maxEmailsPerPage: process.env.FEATURE_MAX_EMAILS_PER_PAGE,
    },
  };

  try {
    return AppConfigSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const validationError = fromZodError(error);
      console.error('Configuration validation failed:');
      console.error(validationError.toString());
      throw new Error(`Invalid configuration: ${validationError.message}`);
    }
    throw error;
  }
}

/**
 * Global configuration instance
 */
export const config = loadConfig();

/**
 * Runtime feature flag checker
 */
export class FeatureFlagManager {
  private flags: FeatureFlags;

  constructor(flags: FeatureFlags) {
    this.flags = flags;
  }

  isEnabled(feature: keyof FeatureFlags): boolean {
    return Boolean(this.flags[feature]);
  }

  getValue<T extends keyof FeatureFlags>(feature: T): FeatureFlags[T] {
    return this.flags[feature];
  }

  getAllFlags(): FeatureFlags {
    return { ...this.flags };
  }

  updateFlag(feature: keyof FeatureFlags, value: boolean | number): void {
    (this.flags as any)[feature] = value;
  }
}

export const featureFlags = new FeatureFlagManager(config.features);

/**
 * Configuration validation helper
 */
export function validateConfig(): { valid: boolean; errors: string[] } {
  try {
    AppConfigSchema.parse({
      database: config.database,
      auth: config.auth,
      email: config.email,
      security: config.security,
      server: config.server,
      performance: config.performance,
      features: config.features,
    });
    return { valid: true, errors: [] };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const validationError = fromZodError(error);
      return { 
        valid: false, 
        errors: error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
      };
    }
    return { valid: false, errors: ['Unknown validation error'] };
  }
}

/**
 * Configuration documentation generator
 */
export function getConfigDocumentation(): Record<string, any> {
  return {
    DATABASE_URL: 'PostgreSQL connection string (required)',
    DB_MAX_CONNECTIONS: 'Maximum database connections (default: 20)',
    DB_CONNECTION_TIMEOUT: 'Database connection timeout in ms (default: 5000)',
    DB_IDLE_TIMEOUT: 'Database idle timeout in ms (default: 60000)',
    SESSION_SECRET: 'Secret for session encryption (required, min 32 chars)',
    SESSION_MAX_AGE: 'Session expiration time in seconds (default: 604800)',
    EMAIL_SYNC_INTERVAL: 'Email sync interval in seconds (default: 300)',
    EMAIL_MAX_PER_SYNC: 'Maximum emails to sync per batch (default: 100)',
    RATE_LIMIT_WINDOW_MS: 'Rate limit window in milliseconds (default: 900000)',
    RATE_LIMIT_MAX_REQUESTS: 'Maximum requests per window (default: 100)',
    ENCRYPTION_KEY: 'Key for encrypting email credentials (required, min 32 chars)',
    PORT: 'Server port (default: 5000)',
    NODE_ENV: 'Environment: development|production|test (default: development)',
    LOG_LEVEL: 'Logging level: error|warn|info|debug (default: info)',
    // Feature flags
    FEATURE_ADVANCED_SEARCH: 'Enable advanced search functionality (default: true)',
    FEATURE_PRIORITY_RULES: 'Enable priority rules (default: true)',
    FEATURE_REALTIME_NOTIFICATIONS: 'Enable real-time notifications (default: true)',
    // ... other feature flags
  };
}

export default config;