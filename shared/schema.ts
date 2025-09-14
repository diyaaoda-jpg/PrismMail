import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, varchar, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table (mandatory for Replit Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Users table (mandatory for Replit Auth)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Email account connections
export const accountConnections = pgTable("account_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name").notNull(), // Display name
  protocol: varchar("protocol", { enum: ["IMAP", "EWS"] }).notNull(),
  settingsJson: text("settings_json").notNull(), // Encrypted connection settings
  isActive: boolean("is_active").default(false), // Set to false until connection is verified
  lastChecked: timestamp("last_checked"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Mail message index
export const mailIndex = pgTable("mail_index", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().references(() => accountConnections.id, { onDelete: "cascade" }),
  folder: varchar("folder").notNull(),
  messageId: varchar("message_id").notNull(), // Server UID
  threadId: varchar("thread_id"),
  subject: text("subject"),
  from: text("from"),
  to: text("to"),
  date: timestamp("date"),
  size: integer("size"),
  hasAttachments: boolean("has_attachments").default(false),
  isRead: boolean("is_read").default(false),
  isFlagged: boolean("is_flagged").default(false),
  priority: integer("priority").default(0), // 0-3 star rating
  snippet: text("snippet"),
  bodyHtml: text("body_html"),
  bodyText: text("body_text"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Unique constraint to prevent duplicate messages
  unique("unique_message_per_account_folder").on(table.accountId, table.folder, table.messageId),
]);

// Priority rules for auto-classification
export const priorityRules = pgTable("priority_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().references(() => accountConnections.id, { onDelete: "cascade" }),
  name: varchar("name").notNull(),
  conditionsJson: text("conditions_json").notNull(), // JSON with from, subject, etc conditions
  priority: integer("priority").notNull(), // 0-3
  colorTag: varchar("color_tag"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// VIP contacts
export const vipContacts = pgTable("vip_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  email: varchar("email").notNull(),
  name: varchar("name"),
  priority: integer("priority").default(3), // Auto-priority for VIPs
  createdAt: timestamp("created_at").defaultNow(),
});

// User preferences
export const userPrefs = pgTable("user_prefs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  theme: varchar("theme").default("light"), // light, dark
  colorTheme: varchar("color_theme").default("default"), // default, sunrise, neon, deepspace
  backgroundImageUrl: varchar("background_image_url"),
  defaultSort: varchar("default_sort").default("date"),
  listDensity: varchar("list_density").default("comfortable"),
  signatureHtml: text("signature_html"),
  readingMode: boolean("reading_mode").default(false),
  // Sync settings
  syncInterval: integer("sync_interval").default(600), // Default 10 minutes (600 seconds)
  autoSync: boolean("auto_sync").default(true),
  lastSyncTime: timestamp("last_sync_time"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Account folders catalog
export const accountFolders = pgTable("account_folders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().references(() => accountConnections.id, { onDelete: "cascade" }),
  folderId: varchar("folder_id").notNull(), // Server-side folder identifier (IMAP path or EWS ID)
  folderType: varchar("folder_type", { 
    enum: ["inbox", "sent", "drafts", "deleted", "archive", "spam", "custom"] 
  }).notNull(),
  displayName: varchar("display_name").notNull(), // Human-readable folder name
  unreadCount: integer("unread_count").default(0),
  totalCount: integer("total_count").default(0),
  isActive: boolean("is_active").default(true), // Whether this folder should be synced
  lastSynced: timestamp("last_synced"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Unique constraint to prevent duplicate folders per account
  unique("unique_folder_per_account").on(table.accountId, table.folderId),
]);

// Insert and select schemas
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAccountConnectionSchema = createInsertSchema(accountConnections).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMailIndexSchema = createInsertSchema(mailIndex).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPriorityRuleSchema = createInsertSchema(priorityRules).omit({ id: true, createdAt: true });
export const insertVipContactSchema = createInsertSchema(vipContacts).omit({ id: true, createdAt: true });
export const insertUserPrefsSchema = createInsertSchema(userPrefs).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAccountFolderSchema = createInsertSchema(accountFolders).omit({ id: true, createdAt: true, updatedAt: true });

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type AccountConnection = typeof accountConnections.$inferSelect;
export type InsertAccountConnection = z.infer<typeof insertAccountConnectionSchema>;
export type MailMessage = typeof mailIndex.$inferSelect;
export type InsertMailMessage = z.infer<typeof insertMailIndexSchema>;
export type PriorityRule = typeof priorityRules.$inferSelect;
export type InsertPriorityRule = z.infer<typeof insertPriorityRuleSchema>;
export type VipContact = typeof vipContacts.$inferSelect;
export type InsertVipContact = z.infer<typeof insertVipContactSchema>;
export type UserPrefs = typeof userPrefs.$inferSelect;
export type InsertUserPrefs = z.infer<typeof insertUserPrefsSchema>;
export type AccountFolder = typeof accountFolders.$inferSelect;
export type InsertAccountFolder = z.infer<typeof insertAccountFolderSchema>;

// Enhanced validation schemas for account settings

// SMTP Settings validation schema
export const smtpSettingsSchema = z.object({
  host: z.string()
    .min(1, "SMTP server is required")
    .max(255, "SMTP server name is too long")
    .refine(
      (host) => {
        // Basic hostname validation - allow IP addresses and domain names
        const hostnameRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*|(?:[0-9]{1,3}\.){3}[0-9]{1,3})$/;
        return hostnameRegex.test(host);
      },
      "Please enter a valid server hostname or IP address (e.g., smtp.gmail.com)"
    ),
  port: z.number()
    .int("Port must be a whole number")
    .min(1, "Port must be greater than 0")
    .max(65535, "Port must be less than 65536"),
    // Note: Removed blocking validation for non-standard ports to support all providers
    // Common ports: 25 (unencrypted), 465 (SSL), 587 (STARTTLS), 2525 (alternative)
  secure: z.boolean(),
  username: z.string()
    .min(1, "SMTP username is required")
    .max(255, "Username is too long"),
  password: z.string()
    .min(1, "SMTP password is required")
    .max(1024, "Password is too long")
}).strict();

// IMAP Settings validation schema
export const imapSettingsSchema = z.object({
  host: z.string()
    .min(1, "IMAP server is required")
    .max(255, "Server name is too long")
    .refine(
      (host) => {
        // Basic hostname validation - allow IP addresses and domain names
        const hostnameRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*|(?:[0-9]{1,3}\.){3}[0-9]{1,3})$/;
        return hostnameRegex.test(host);
      },
      "Please enter a valid server hostname or IP address (e.g., imap.gmail.com)"
    ),
  port: z.number()
    .int("Port must be a whole number")
    .min(1, "Port must be greater than 0")
    .max(65535, "Port must be less than 65536"),
    // Note: Allow any valid port 1-65535. Common ports: 993 (SSL), 143 (STARTTLS)
  username: z.string()
    .min(1, "Username is required")
    .max(255, "Username is too long")
    .refine(
      (username) => {
        // Basic email validation for username
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(username) || username.length > 0;
      },
      "Username is typically your email address"
    ),
  password: z.string()
    .min(1, "Password is required")
    .max(1024, "Password is too long"),
  useSSL: z.boolean(),
  // Note: Allow both SSL (port 993) and STARTTLS (port 143) configurations
  smtp: smtpSettingsSchema.optional()
}).strict();

// EWS Settings validation schema
export const ewsSettingsSchema = z.object({
  host: z.string()
    .min(1, "Exchange server is required")
    .max(500, "Server URL is too long")
    .refine(
      (host) => {
        // Enhanced EWS validation for proper Exchange server formats
        try {
          // If it starts with http, must be https
          if (host.startsWith('http')) {
            const url = new URL(host);
            if (url.protocol !== 'https:') {
              return false; // EWS must use HTTPS
            }
            // Must have valid hostname and can optionally include EWS path
            const isValidPath = !url.pathname || 
                              url.pathname === '/' || 
                              url.pathname.toLowerCase().includes('/ews/') ||
                              url.pathname.toLowerCase().includes('/exchange.asmx');
            return url.hostname.length > 0 && isValidPath;
          } else {
            // Otherwise validate as hostname/domain
            const hostnameRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*|(?:[0-9]{1,3}\.){3}[0-9]{1,3})$/;
            return hostnameRegex.test(host) && host.includes('.'); // Domain must have TLD
          }
        } catch {
          return false;
        }
      },
      "Exchange server must be a valid domain (e.g., mail.company.com) or HTTPS URL (e.g., https://mail.company.com/EWS/Exchange.asmx)"
    ),
  username: z.string()
    .min(1, "Username is required")
    .max(255, "Username is too long")
    .refine(
      (username) => {
        // Accept email format or domain\username format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const domainUserRegex = /^[^\\]+\\[^\\]+$/;
        return emailRegex.test(username) || domainUserRegex.test(username) || username.length > 0;
      },
      "Username is typically your email address or DOMAIN\\username format"
    ),
  password: z.string()
    .min(1, "Password is required")
    .max(1024, "Password is too long")
}).strict();

// Union schema for account settings validation
export const accountSettingsSchema = z.discriminatedUnion('protocol', [
  z.object({ protocol: z.literal('IMAP'), settings: imapSettingsSchema }),
  z.object({ protocol: z.literal('EWS'), settings: ewsSettingsSchema })
]);

// Enhanced account connection validation schema
export const enhancedAccountConnectionSchema = z.object({
  name: z.string()
    .min(1, "Account name is required")
    .max(100, "Account name is too long")
    .refine(
      (name) => name.trim().length > 0,
      "Account name cannot be just whitespace"
    ),
  protocol: z.enum(["IMAP", "EWS"], {
    errorMap: () => ({ message: "Protocol must be either IMAP or EWS" })
  }),
  settingsJson: z.string()
    .min(1, "Account settings are required")
    .refine(
      (json) => {
        try {
          JSON.parse(json);
          return true;
        } catch {
          return false;
        }
      },
      "Invalid account settings format"
    ),
  userId: z.string()
    .min(1, "User ID is required"),
  isActive: z.boolean().optional(),
  lastChecked: z.date().optional().nullable(),
  lastError: z.string().optional().nullable()
}).strict();

// Settings JSON type definitions for account connections (kept for backward compatibility)
export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean; // true for 465, false for other ports like 587
  username: string; // Can default to IMAP username
  password: string; // Can default to IMAP password
}

export interface ImapSettings {
  host: string;
  port: number; // Always 993 for IMAP
  username: string;
  password: string;
  useSSL: boolean; // Always true for IMAP
  smtp?: SmtpSettings; // Optional SMTP configuration - if not provided, auto-configured
}

export interface EwsSettings {
  host: string; // Full EWS URL like https://mail.server.com/ews
  username: string;
  password: string;
  // No SMTP needed for EWS - it handles sending directly
}

// Union type for all account settings
export type AccountSettings = ImapSettings | EwsSettings;

// Helper type to determine settings type based on protocol
export type AccountSettingsForProtocol<T extends 'IMAP' | 'EWS'> = 
  T extends 'IMAP' ? ImapSettings : EwsSettings;

// Inferred types from validation schemas
export type ValidatedSmtpSettings = z.infer<typeof smtpSettingsSchema>;
export type ValidatedImapSettings = z.infer<typeof imapSettingsSchema>;
export type ValidatedEwsSettings = z.infer<typeof ewsSettingsSchema>;
export type ValidatedAccountSettings = z.infer<typeof accountSettingsSchema>;
export type ValidatedAccountConnection = z.infer<typeof enhancedAccountConnectionSchema>;

// Email composition schemas and types
export const sendEmailRequestSchema = z.object({
  accountId: z.string().min(1, "Account ID is required"),
  to: z.string().email("Please enter a valid email address"),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Email body is required"),
  bodyHtml: z.string().optional(), // Rich HTML content
  attachments: z.array(z.object({
    filename: z.string(),
    content: z.string(), // Base64 encoded content
    contentType: z.string(),
    size: z.number()
  })).optional().default([])
});

export const sendEmailResponseSchema = z.object({
  success: z.boolean(),
  messageId: z.string().optional(), // SMTP message ID
  error: z.string().optional(),
  sentAt: z.date()
});

export type SendEmailRequest = z.infer<typeof sendEmailRequestSchema>;
export type SendEmailResponse = z.infer<typeof sendEmailResponseSchema>;

export interface EmailAttachment {
  filename: string;
  content: string; // Base64 encoded
  contentType: string;
  size: number;
}
