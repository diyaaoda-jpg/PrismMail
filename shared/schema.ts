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

// Enhanced Mail message index
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
  priority: integer("priority").default(0), // 0-3 manual priority rating
  autoPriority: integer("auto_priority").default(0), // 0-3 auto-calculated priority
  prioritySource: varchar("priority_source", {
    enum: ["manual", "rule", "vip", "thread", "auto"]
  }).default("auto"), // How the priority was assigned
  ruleId: varchar("rule_id").references(() => priorityRules.id), // Rule that assigned priority
  isVip: boolean("is_vip").default(false), // Is sender a VIP contact
  priorityScore: integer("priority_score").default(0), // Detailed scoring (0-100)
  priorityFactors: jsonb("priority_factors"), // JSON with priority calculation details
  responseTime: integer("response_time"), // Time to respond in seconds (for analytics)
  isInFocus: boolean("is_in_focus").default(false), // Should show in focus mode
  snippet: text("snippet"),
  bodyHtml: text("body_html"),
  bodyText: text("body_text"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Unique constraint to prevent duplicate messages
  unique("unique_message_per_account_folder").on(table.accountId, table.folder, table.messageId),
  // Index for efficient priority and focus filtering
  index("idx_mail_priority").on(table.accountId, table.priority, table.isInFocus),
  index("idx_mail_vip").on(table.isVip, table.date),
]);

// Enhanced Priority rules for auto-classification
export const priorityRules = pgTable("priority_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().references(() => accountConnections.id, { onDelete: "cascade" }),
  name: varchar("name").notNull(),
  description: text("description"), // User-friendly description of what the rule does
  conditionsJson: text("conditions_json").notNull(), // JSON with from, subject, etc conditions
  priority: integer("priority").notNull(), // 0-3
  colorTag: varchar("color_tag"),
  isActive: boolean("is_active").default(true),
  executionOrder: integer("execution_order").default(0), // Order of rule execution
  matchCount: integer("match_count").default(0), // Track how many emails this rule has matched
  lastMatched: timestamp("last_matched"), // When this rule last matched an email
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Enhanced VIP contacts
export const vipContacts = pgTable("vip_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  email: varchar("email").notNull(),
  name: varchar("name"),
  organization: varchar("organization"), // Company or group name
  title: varchar("title"), // Job title or role
  vipGroup: varchar("vip_group", { 
    enum: ["executive", "client", "family", "team", "vendor", "custom"] 
  }).default("custom"),
  priority: integer("priority").default(3), // Auto-priority for VIPs (1-3)
  colorTag: varchar("color_tag"), // Custom color for VIP identification
  notes: text("notes"), // Optional notes about the VIP
  interactionCount: integer("interaction_count").default(0), // Email interaction frequency
  lastInteraction: timestamp("last_interaction"), // Last email exchange
  photoUrl: varchar("photo_url"), // Profile photo URL
  isActive: boolean("is_active").default(true), // Can temporarily disable VIP status
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Unique constraint to prevent duplicate VIP entries per user
  unique("unique_vip_per_user").on(table.userId, table.email),
]);

// Enhanced User preferences
export const userPrefs = pgTable("user_prefs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  theme: varchar("theme").default("light"), // light, dark
  colorTheme: varchar("color_theme").default("default"), // default, sunrise, neon, deepspace
  backgroundImageUrl: varchar("background_image_url"),
  defaultSort: varchar("default_sort").default("date"),
  listDensity: varchar("list_density").default("comfortable"),
  signatureHtml: text("signature_html"),
  readingMode: boolean("reading_mode").default(false),
  // Priority and Focus Mode settings
  focusModeEnabled: boolean("focus_mode_enabled").default(false),
  focusMinPriority: integer("focus_min_priority").default(2), // Minimum priority to show in focus mode
  focusShowVipOnly: boolean("focus_show_vip_only").default(false),
  focusShowUnreadOnly: boolean("focus_show_unread_only").default(false),
  autoPriorityEnabled: boolean("auto_priority_enabled").default(true),
  priorityNotifications: boolean("priority_notifications").default(true), // Notifications for high-priority emails
  vipNotificationsEnabled: boolean("vip_notifications_enabled").default(true),
  // Sync settings
  syncInterval: integer("sync_interval").default(600), // Default 10 minutes (600 seconds)
  autoSync: boolean("auto_sync").default(true),
  lastSyncTime: timestamp("last_sync_time"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Priority analytics for insights and optimization
export const priorityAnalytics = pgTable("priority_analytics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: varchar("account_id").references(() => accountConnections.id, { onDelete: "cascade" }),
  metricType: varchar("metric_type", {
    enum: ["priority_distribution", "focus_time", "response_time", "rule_effectiveness", "vip_interactions"]
  }).notNull(),
  metricData: jsonb("metric_data").notNull(), // JSON data specific to metric type
  aggregationPeriod: varchar("aggregation_period", {
    enum: ["daily", "weekly", "monthly"]
  }).notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  // Index for efficient querying by user and time period
  index("idx_analytics_user_period").on(table.userId, table.metricType, table.periodStart),
]);

// Enhanced Email Attachments table for comprehensive attachment management
export const emailAttachments = pgTable("email_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: varchar("account_id").references(() => accountConnections.id, { onDelete: "cascade" }),
  // File metadata
  filename: varchar("filename").notNull(), // Sanitized filename for storage
  originalName: varchar("original_name").notNull(), // Original filename from user
  mimeType: varchar("mime_type").notNull(),
  size: integer("size").notNull(), // File size in bytes
  fileHash: varchar("file_hash"), // SHA-256 hash for deduplication and integrity
  // Storage information
  storagePath: varchar("storage_path").notNull(), // Secure path where file is stored (legacy)
  storageKey: varchar("storage_key"), // New storage abstraction key
  uploadToken: varchar("upload_token"), // Temporary token for upload verification
  // Relationships and associations
  messageId: varchar("message_id").references(() => mailIndex.id, { onDelete: "set null" }),
  draftId: varchar("draft_id").references(() => mailDrafts.id, { onDelete: "cascade" }),
  sentEmailId: varchar("sent_email_id").references(() => mailSent.id, { onDelete: "set null" }),
  // Security and tracking
  virusScanStatus: varchar("virus_scan_status", {
    enum: ["pending", "clean", "infected", "error", "skipped"]
  }).default("pending"),
  virusScanResult: text("virus_scan_result"), // Detailed scan result if applicable
  virusScanEngine: varchar("virus_scan_engine"), // Which scanner was used (ClamAV, etc.)
  detectedType: varchar("detected_type"), // Actual MIME type detected by magic numbers
  securityRisk: varchar("security_risk"), // Security risk classification
  downloadCount: integer("download_count").default(0),
  lastDownloaded: timestamp("last_downloaded"),
  // Status and lifecycle
  isActive: boolean("is_active").default(true), // Soft delete capability
  isOrphaned: boolean("is_orphaned").default(false), // Mark orphaned attachments for cleanup
  expiresAt: timestamp("expires_at"), // Optional expiration for temporary attachments
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Security index for user ownership verification
  index("idx_attachments_user_security").on(table.userId, table.id),
  // Performance index for draft/message associations
  index("idx_attachments_draft").on(table.draftId, table.isActive),
  index("idx_attachments_message").on(table.messageId, table.isActive),
  // Cleanup index for orphaned attachments
  index("idx_attachments_cleanup").on(table.isOrphaned, table.expiresAt, table.createdAt),
  // Deduplication index
  index("idx_attachments_dedup").on(table.fileHash, table.userId),
  // Virus scan status index
  index("idx_attachments_virus_scan").on(table.virusScanStatus, table.createdAt),
]);

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

// Email drafts table for composition feature
export const mailDrafts = pgTable("mail_drafts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: varchar("account_id").notNull().references(() => accountConnections.id, { onDelete: "cascade" }),
  subject: text("subject").default(""),
  bodyText: text("body_text").default(""), // Plain text version
  bodyHtml: text("body_html").default(""), // Rich HTML version
  toRecipients: text("to_recipients").default(""), // JSON array of email addresses
  ccRecipients: text("cc_recipients").default(""), // JSON array of email addresses
  bccRecipients: text("bcc_recipients").default(""), // JSON array of email addresses
  priority: integer("priority").default(0), // 0-3 priority level
  attachments: jsonb("attachments"), // JSON array of attachment metadata
  replyToMessageId: varchar("reply_to_message_id"), // Reference to original message if reply/forward
  compositionMode: varchar("composition_mode", {
    enum: ["new", "reply", "reply_all", "forward"]
  }).default("new"),
  isAutoSaved: boolean("is_auto_saved").default(false), // True if auto-saved vs manually saved
  lastEditedAt: timestamp("last_edited_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Index for efficient retrieval by user and account
  index("idx_drafts_user_account").on(table.userId, table.accountId),
  index("idx_drafts_last_edited").on(table.lastEditedAt),
]);

// Sent emails tracking table for composition feature
export const mailSent = pgTable("mail_sent", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: varchar("account_id").notNull().references(() => accountConnections.id, { onDelete: "cascade" }),
  draftId: varchar("draft_id").references(() => mailDrafts.id), // Reference to original draft
  messageId: varchar("message_id"), // SMTP/EWS message ID from server
  subject: text("subject").notNull(),
  bodyText: text("body_text"), // Plain text version sent
  bodyHtml: text("body_html"), // Rich HTML version sent
  toRecipients: text("to_recipients").notNull(), // JSON array of email addresses
  ccRecipients: text("cc_recipients").default(""), // JSON array of email addresses
  bccRecipients: text("bcc_recipients").default(""), // JSON array of email addresses
  priority: integer("priority").default(0), // 0-3 priority level
  attachments: jsonb("attachments"), // JSON array of attachment metadata
  deliveryStatus: varchar("delivery_status", {
    enum: ["pending", "sent", "delivered", "failed", "bounced"]
  }).default("pending"),
  deliveryError: text("delivery_error"), // Error message if delivery failed
  replyToMessageId: varchar("reply_to_message_id"), // Reference to original message if reply/forward
  compositionMode: varchar("composition_mode", {
    enum: ["new", "reply", "reply_all", "forward"]
  }).default("new"),
  sentAt: timestamp("sent_at").defaultNow(),
  deliveredAt: timestamp("delivered_at"), // When delivery was confirmed
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Index for efficient retrieval by user and delivery status
  index("idx_sent_user_status").on(table.userId, table.deliveryStatus),
  index("idx_sent_account").on(table.accountId, table.sentAt),
  index("idx_sent_message_id").on(table.messageId),
]);

// Enhanced insert schemas with strict validation and field length limits
export const insertUserSchema = createInsertSchema(users)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    email: z.string().email("Invalid email format").max(255, "Email must be 255 characters or less"),
    firstName: z.string().min(1, "First name is required").max(100, "First name must be 100 characters or less").optional(),
    lastName: z.string().min(1, "Last name is required").max(100, "Last name must be 100 characters or less").optional(),
    profileImageUrl: z.string().url("Invalid URL format").max(500, "URL must be 500 characters or less").optional()
  });

export const insertAccountConnectionSchema = createInsertSchema(accountConnections)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    name: z.string().min(1, "Account name is required").max(100, "Account name must be 100 characters or less"),
    settingsJson: z.string().min(1, "Settings are required").max(10000, "Settings too large")
  });

export const insertMailIndexSchema = createInsertSchema(mailIndex)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    messageId: z.string().min(1, "Message ID is required").max(255, "Message ID too long"),
    subject: z.string().max(1000, "Subject must be 1000 characters or less").optional(),
    from: z.string().max(500, "From field too long").optional(),
    to: z.string().max(2000, "To field too long").optional(),
    priority: z.number().int().min(0).max(3, "Priority must be between 0 and 3"),
    autoPriority: z.number().int().min(0).max(3, "Auto priority must be between 0 and 3"),
    priorityScore: z.number().int().min(0).max(100, "Priority score must be between 0 and 100"),
    folder: z.string().min(1, "Folder is required").max(255, "Folder name too long")
  });

export const insertPriorityRuleSchema = createInsertSchema(priorityRules)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    name: z.string().min(1, "Rule name is required").max(100, "Rule name must be 100 characters or less"),
    description: z.string().max(500, "Description must be 500 characters or less").optional(),
    conditionsJson: z.string().min(1, "Conditions are required").max(5000, "Conditions too complex"),
    priority: z.number().int().min(0).max(3, "Priority must be between 0 and 3"),
    executionOrder: z.number().int().min(0).max(1000, "Execution order out of range")
  });

export const insertVipContactSchema = createInsertSchema(vipContacts)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    email: z.string().email("Invalid email format").max(255, "Email must be 255 characters or less"),
    name: z.string().max(100, "Name must be 100 characters or less").optional(),
    organization: z.string().max(100, "Organization must be 100 characters or less").optional(),
    title: z.string().max(100, "Title must be 100 characters or less").optional(),
    priority: z.number().int().min(1).max(3, "Priority must be between 1 and 3"),
    notes: z.string().max(1000, "Notes must be 1000 characters or less").optional()
  });

export const insertUserPrefsSchema = createInsertSchema(userPrefs)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    signatureHtml: z.string().max(5000, "Signature must be 5000 characters or less").optional(),
    backgroundImageUrl: z.string().url("Invalid URL format").max(500, "URL must be 500 characters or less").optional()
  });

export const insertAccountFolderSchema = createInsertSchema(accountFolders)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    folderId: z.string().min(1, "Folder ID is required").max(255, "Folder ID too long"),
    displayName: z.string().min(1, "Display name is required").max(255, "Display name too long"),
    unreadCount: z.number().int().min(0, "Unread count must be non-negative"),
    totalCount: z.number().int().min(0, "Total count must be non-negative")
  });

export const insertPriorityAnalyticsSchema = createInsertSchema(priorityAnalytics)
  .omit({ id: true, createdAt: true })
  .extend({
    metricType: z.string().min(1, "Metric type is required").max(100, "Metric type too long"),
    metricValue: z.number().min(0, "Metric value must be non-negative")
  });

// ENHANCED DRAFT SCHEMA with comprehensive validation
export const insertMailDraftSchema = createInsertSchema(mailDrafts)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    subject: z.string().max(500, "Subject must be 500 characters or less"),
    bodyText: z.string().max(100000, "Email body too large (max 100KB)"),
    bodyHtml: z.string().max(200000, "HTML body too large (max 200KB)"),
    toRecipients: z.string().max(2000, "Too many recipients").refine(
      (val) => {
        if (!val) return true;
        try {
          const emails = JSON.parse(val);
          return Array.isArray(emails) && emails.every(email => 
            typeof email === 'string' && z.string().email().safeParse(email).success
          ) && emails.length <= 50;
        } catch { return false; }
      },
      "Invalid recipient format or too many recipients (max 50)"
    ),
    ccRecipients: z.string().max(2000, "Too many CC recipients").optional(),
    bccRecipients: z.string().max(2000, "Too many BCC recipients").optional(),
    priority: z.number().int().min(0).max(3, "Priority must be between 0 and 3"),
    replyToMessageId: z.string().max(255, "Reply message ID too long").optional()
  });

// ENHANCED SENT EMAIL SCHEMA with comprehensive validation  
export const insertMailSentSchema = createInsertSchema(mailSent)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    subject: z.string().min(1, "Subject is required").max(500, "Subject must be 500 characters or less"),
    bodyText: z.string().max(100000, "Email body too large (max 100KB)").optional(),
    bodyHtml: z.string().max(200000, "HTML body too large (max 200KB)").optional(),
    toRecipients: z.string().min(1, "Recipients are required").max(2000, "Too many recipients").refine(
      (val) => {
        try {
          const emails = JSON.parse(val);
          return Array.isArray(emails) && emails.length > 0 && emails.every(email => 
            typeof email === 'string' && z.string().email().safeParse(email).success
          ) && emails.length <= 50;
        } catch { return false; }
      },
      "Invalid recipient format or too many recipients (max 50)"
    ),
    ccRecipients: z.string().max(2000, "Too many CC recipients").optional(),
    bccRecipients: z.string().max(2000, "Too many BCC recipients").optional(),
    priority: z.number().int().min(0).max(3, "Priority must be between 0 and 3"),
    deliveryError: z.string().max(1000, "Delivery error message too long").optional(),
    replyToMessageId: z.string().max(255, "Reply message ID too long").optional()
  });

// Update schemas for PUT operations (partial updates allowed)
export const updatePriorityRuleSchema = createInsertSchema(priorityRules)
  .omit({ id: true, createdAt: true, updatedAt: true, accountId: true })
  .partial()
  .refine(
    (data) => Object.keys(data).length > 0,
    "At least one field must be provided for update"
  )
  .refine(
    (data) => {
      // Validate conditionsJson if provided
      if (data.conditionsJson) {
        try {
          const conditions = JSON.parse(data.conditionsJson);
          return conditions.logic && Array.isArray(conditions.rules);
        } catch {
          return false;
        }
      }
      return true;
    },
    "Invalid conditions JSON format"
  );

export const updateVipContactSchema = createInsertSchema(vipContacts)
  .omit({ id: true, createdAt: true, updatedAt: true, userId: true })
  .partial()
  .refine(
    (data) => Object.keys(data).length > 0,
    "At least one field must be provided for update"
  )
  .refine(
    (data) => {
      // Validate email format if provided
      if (data.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(data.email);
      }
      return true;
    },
    "Invalid email format"
  )
  .refine(
    (data) => {
      // Validate priority range if provided
      if (data.priority !== undefined) {
        return data.priority >= 0 && data.priority <= 3;
      }
      return true;
    },
    "Priority must be between 0 and 3"
  );

export const updateUserPrefsSchema = createInsertSchema(userPrefs)
  .omit({ id: true, createdAt: true, updatedAt: true, userId: true })
  .partial()
  .refine(
    (data) => Object.keys(data).length > 0,
    "At least one field must be provided for update"
  );

// Rule reordering validation schema
export const reorderRulesSchema = z.object({
  ruleUpdates: z.array(
    z.object({
      id: z.string().min(1, "Rule ID is required"),
      executionOrder: z.number().int().min(0, "Execution order must be non-negative")
    })
  ).min(1, "At least one rule update is required")
});

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
export type UpdatePriorityRule = z.infer<typeof updatePriorityRuleSchema>;
export type VipContact = typeof vipContacts.$inferSelect;
export type InsertVipContact = z.infer<typeof insertVipContactSchema>;
export type UpdateVipContact = z.infer<typeof updateVipContactSchema>;
export type UserPrefs = typeof userPrefs.$inferSelect;
export type InsertUserPrefs = z.infer<typeof insertUserPrefsSchema>;
export type UpdateUserPrefs = z.infer<typeof updateUserPrefsSchema>;
export type AccountFolder = typeof accountFolders.$inferSelect;
export type InsertAccountFolder = z.infer<typeof insertAccountFolderSchema>;
export type PriorityAnalytics = typeof priorityAnalytics.$inferSelect;
export type InsertPriorityAnalytics = z.infer<typeof insertPriorityAnalyticsSchema>;
export type ReorderRules = z.infer<typeof reorderRulesSchema>;

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

// Type definitions for new tables
export type MailDraft = typeof mailDrafts.$inferSelect;
export type InsertMailDraft = z.infer<typeof insertMailDraftSchema>;
export type MailSent = typeof mailSent.$inferSelect;
export type InsertMailSent = z.infer<typeof insertMailSentSchema>;
export type EmailAttachment = typeof emailAttachments.$inferSelect;
export type InsertEmailAttachment = z.infer<typeof insertEmailAttachmentSchema>;

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

// Attachment validation schemas
export const insertEmailAttachmentSchema = createInsertSchema(emailAttachments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  uploadToken: true,
  fileHash: true,
  virusScanStatus: true,
  virusScanResult: true,
  downloadCount: true,
  lastDownloaded: true,
  isOrphaned: true,
}).extend({
  filename: z.string()
    .min(1, "Filename is required")
    .max(255, "Filename is too long")
    .refine(
      (filename) => {
        // Sanitize filename - allow only safe characters
        const safeFilenameRegex = /^[a-zA-Z0-9._\-\s()]+$/;
        return safeFilenameRegex.test(filename);
      },
      "Filename contains invalid characters. Only letters, numbers, periods, hyphens, underscores, spaces, and parentheses are allowed"
    ),
  originalName: z.string()
    .min(1, "Original filename is required")
    .max(255, "Original filename is too long"),
  mimeType: z.string()
    .min(1, "MIME type is required")
    .refine(
      (mimeType) => {
        // Whitelist of allowed MIME types for security
        const allowedTypes = [
          // Documents
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-powerpoint',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'text/plain',
          'text/csv',
          'application/json',
          'application/xml',
          'text/xml',
          // Images
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/bmp',
          'image/webp',
          'image/svg+xml',
          'image/tiff',
          // Archives (commonly needed)
          'application/zip',
          'application/x-rar-compressed',
          'application/x-7z-compressed',
          // Other common types
          'application/rtf',
          'text/calendar' // .ics files
        ];
        return allowedTypes.includes(mimeType.toLowerCase());
      },
      "File type not allowed. Please upload documents, images, or common archive files only"
    ),
  size: z.number()
    .int("File size must be a whole number")
    .min(1, "File size must be greater than 0")
    .max(26214400, "File size cannot exceed 25MB"), // 25MB limit per file
  storagePath: z.string()
    .min(1, "Storage path is required")
    .max(500, "Storage path is too long"),
});

// Enhanced attachment upload request schema
export const attachmentUploadRequestSchema = z.object({
  accountId: z.string().min(1, "Account ID is required"),
  draftId: z.string().optional(), // Optional association with draft
  files: z.array(z.object({
    fieldname: z.string(),
    originalname: z.string(),
    encoding: z.string(),
    mimetype: z.string(),
    size: z.number(),
    buffer: z.instanceof(Buffer).optional(),
    destination: z.string().optional(),
    filename: z.string().optional(),
    path: z.string().optional()
  })).min(1, "At least one file is required").max(10, "Cannot upload more than 10 files at once")
}).refine(
  (data) => {
    // Total size validation across all files (100MB total limit)
    const totalSize = data.files.reduce((sum, file) => sum + file.size, 0);
    return totalSize <= 104857600; // 100MB total limit
  },
  "Total file size cannot exceed 100MB"
);

// Attachment download response schema
export const attachmentDownloadSchema = z.object({
  id: z.string().min(1, "Attachment ID is required"),
  userId: z.string().min(1, "User ID is required"),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
  downloadToken: z.string().optional() // Optional secure download token
});

// Legacy interface for backward compatibility
export interface LegacyEmailAttachment {
  filename: string;
  content: string; // Base64 encoded
  contentType: string;
  size: number;
}
