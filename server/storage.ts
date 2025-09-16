import {
  users,
  accountConnections,
  accountFolders,
  mailIndex,
  priorityRules,
  vipContacts,
  userPrefs,
  attachments,
  signatures,
  pushSubscriptions,
  notificationPreferences,
  accountNotificationPreferences,
  notificationLog,
  type User,
  type UpsertUser,
  type AccountConnection,
  type InsertAccountConnection,
  type AccountFolder,
  type InsertAccountFolder,
  type MailMessage,
  type InsertMailMessage,
  type PriorityRule,
  type InsertPriorityRule,
  type VipContact,
  type InsertVipContact,
  type UserPrefs,
  type InsertUserPrefs,
  type Attachment,
  type InsertAttachment,
  type Signature,
  type InsertSignature,
  type PushSubscription,
  type InsertPushSubscription,
  type NotificationPreferences,
  type InsertNotificationPreferences,
  type AccountNotificationPreferences,
  type InsertAccountNotificationPreferences,
  type NotificationLog,
  type InsertNotificationLog,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, or, like, ilike, gte, lte, desc, asc, sql } from "drizzle-orm";
import { encryptAccountSettings, decryptAccountSettings } from "./crypto";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  // User operations (mandatory for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  // Account connections
  getUserAccountConnections(userId: string): Promise<AccountConnection[]>;
  getAccountConnection(id: string): Promise<AccountConnection | undefined>;
  getAllActiveEwsAccounts(): Promise<AccountConnection[]>;
  getAllActiveImapAccounts(): Promise<AccountConnection[]>;
  createAccountConnection(connection: InsertAccountConnection): Promise<AccountConnection>;
  getAccountConnectionEncrypted(id: string): Promise<{ settingsJson: string } | undefined>;
  updateAccountConnection(id: string, updates: Partial<AccountConnection>): Promise<AccountConnection | undefined>;
  deleteAccountConnection(id: string): Promise<void>;
  // Mail operations
  getMailMessages(accountId: string, folder?: string, limit?: number, offset?: number): Promise<MailMessage[]>;
  getMailMessage(id: string): Promise<MailMessage | undefined>;
  createMailMessage(message: InsertMailMessage): Promise<MailMessage>;
  updateMailMessage(id: string, updates: Partial<MailMessage>): Promise<MailMessage | undefined>;
  deleteMailMessage(id: string): Promise<void>;
  // Email organization operations
  starEmail(id: string): Promise<MailMessage | undefined>;
  unstarEmail(id: string): Promise<MailMessage | undefined>;
  archiveEmail(id: string): Promise<MailMessage | undefined>;
  unarchiveEmail(id: string): Promise<MailMessage | undefined>;
  softDeleteEmail(id: string): Promise<MailMessage | undefined>;
  restoreEmail(id: string): Promise<MailMessage | undefined>;
  getStarredEmails(userId: string, limit?: number, offset?: number): Promise<MailMessage[]>;
  getArchivedEmails(userId: string, limit?: number, offset?: number): Promise<MailMessage[]>;
  getDeletedEmails(userId: string, limit?: number, offset?: number): Promise<MailMessage[]>;
  // Priority rules
  getPriorityRules(accountId: string): Promise<PriorityRule[]>;
  createPriorityRule(rule: InsertPriorityRule): Promise<PriorityRule>;
  updatePriorityRule(id: string, updates: Partial<PriorityRule>): Promise<PriorityRule | undefined>;
  deletePriorityRule(id: string): Promise<void>;
  // VIP contacts
  getVipContacts(userId: string): Promise<VipContact[]>;
  createVipContact(contact: InsertVipContact): Promise<VipContact>;
  deleteVipContact(id: string): Promise<void>;
  // User preferences
  getUserPrefs(userId: string): Promise<UserPrefs | undefined>;
  upsertUserPrefs(prefs: InsertUserPrefs): Promise<UserPrefs>;
  // Account folders
  getAccountFolders(accountId: string): Promise<AccountFolder[]>;
  createAccountFolder(folder: InsertAccountFolder): Promise<AccountFolder>;
  updateAccountFolder(id: string, updates: Partial<AccountFolder>): Promise<AccountFolder | undefined>;
  upsertAccountFolder(folder: InsertAccountFolder): Promise<AccountFolder>;
  deleteAccountFolder(id: string): Promise<void>;
  updateFolderCounts(accountId: string, folderId: string, unreadCount: number, totalCount: number): Promise<void>;
  // Attachment operations
  getEmailAttachments(emailId: string): Promise<Attachment[]>;
  createAttachment(attachment: InsertAttachment): Promise<Attachment>;
  getAttachment(id: string): Promise<Attachment | undefined>;
  deleteAttachment(id: string): Promise<void>;
  deleteEmailAttachments(emailId: string): Promise<void>;
  // Search operations
  searchEmails(params: SearchEmailsParams): Promise<SearchEmailsResult>;
  // Draft operations
  saveDraft(accountId: string, draftData: Partial<InsertMailMessage>): Promise<MailMessage>;
  getDraft(draftId: string): Promise<MailMessage | undefined>;
  listUserDrafts(userId: string, limit?: number, offset?: number): Promise<MailMessage[]>;
  listAccountDrafts(accountId: string, limit?: number, offset?: number): Promise<MailMessage[]>;
  deleteDraft(draftId: string): Promise<void>;
  updateDraft(draftId: string, updates: Partial<MailMessage>): Promise<MailMessage | undefined>;
  // Signature operations
  getUserSignatures(userId: string, accountId?: string): Promise<Signature[]>;
  getSignature(id: string): Promise<Signature | undefined>;
  createSignature(signature: InsertSignature): Promise<Signature>;
  updateSignature(id: string, updates: Partial<Signature>): Promise<Signature | undefined>;
  deleteSignature(id: string): Promise<void>;
  setDefaultSignature(userId: string, signatureId: string, accountId?: string): Promise<void>;
  getDefaultSignature(userId: string, accountId?: string): Promise<Signature | undefined>;
  // Push notification operations
  getUserPushSubscriptions(userId: string): Promise<PushSubscription[]>;
  createPushSubscription(subscription: InsertPushSubscription): Promise<PushSubscription>;
  updatePushSubscription(id: string, updates: Partial<PushSubscription>): Promise<PushSubscription | undefined>;
  deletePushSubscription(id: string): Promise<void>;
  deletePushSubscriptionByEndpoint(userId: string, endpoint: string): Promise<void>;
  getActivePushSubscriptions(userId: string): Promise<PushSubscription[]>;
  // Notification preferences operations
  getNotificationPreferences(userId: string): Promise<NotificationPreferences | undefined>;
  upsertNotificationPreferences(prefs: InsertNotificationPreferences): Promise<NotificationPreferences>;
  getAccountNotificationPreferences(userId: string, accountId?: string): Promise<AccountNotificationPreferences[]>;
  upsertAccountNotificationPreferences(prefs: InsertAccountNotificationPreferences): Promise<AccountNotificationPreferences>;
  deleteAccountNotificationPreferences(userId: string, accountId: string): Promise<void>;
  // Notification log operations
  createNotificationLogEntry(entry: InsertNotificationLog): Promise<NotificationLog>;
  updateNotificationLogEntry(id: string, updates: Partial<NotificationLog>): Promise<NotificationLog | undefined>;
  getUserNotificationHistory(userId: string, limit?: number, offset?: number): Promise<NotificationLog[]>;
  deleteOldNotificationLogs(olderThanDays: number): Promise<void>;
}

export interface SearchEmailsParams {
  userId: string;
  query: string;
  accountId?: string; // If provided, search only this account; otherwise search all user's accounts
  folder?: string; // If provided, search only this folder
  searchFields?: ('subject' | 'from' | 'to' | 'cc' | 'bcc' | 'body' | 'all')[];
  dateFrom?: Date;
  dateTo?: Date;
  hasAttachments?: boolean;
  isRead?: boolean;
  isFlagged?: boolean;
  priority?: number;
  limit?: number;
  offset?: number;
}

export interface SearchEmailsResult {
  results: (MailMessage & { 
    relevanceScore?: number; 
    highlightedSnippet?: string;
    matchedFields?: string[];
  })[];
  totalCount: number;
  hasMore: boolean;
}

export class DatabaseStorage implements IStorage {
  // User operations (mandatory for Replit Auth)
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    try {
      // First try to find existing user by email or ID
      let existingUser: User | undefined;
      
      if (userData.email) {
        const [userByEmail] = await db.select().from(users).where(eq(users.email, userData.email));
        existingUser = userByEmail;
      }
      
      if (!existingUser && userData.id) {
        const [userById] = await db.select().from(users).where(eq(users.id, userData.id));
        existingUser = userById;
      }

      if (existingUser) {
        // User exists, update the record
        const [updatedUser] = await db
          .update(users)
          .set({
            ...userData,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existingUser.id))
          .returning();
        return updatedUser;
      } else {
        // User doesn't exist, create new one
        const [newUser] = await db
          .insert(users)
          .values({
            ...userData,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();
        return newUser;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error('Error in upsertUser:', {
        error: errorMessage,
        userData: { ...userData, email: userData.email ? '[REDACTED]' : undefined },
        stack: errorStack
      });
      
      // If we still get a constraint violation, try one more time with onConflictDoUpdate
      // This handles edge cases with concurrent requests
      try {
        const [user] = await db
          .insert(users)
          .values({
            ...userData,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: userData.id ? users.id : users.email,
            set: {
              email: userData.email,
              firstName: userData.firstName,
              lastName: userData.lastName,
              profileImageUrl: userData.profileImageUrl,
              updatedAt: new Date(),
            },
          })
          .returning();
        return user;
      } catch (finalError) {
        const finalErrorMessage = finalError instanceof Error ? finalError.message : String(finalError);
        console.error('Final upsertUser error:', finalError);
        throw new Error(`Failed to create or update user: ${finalErrorMessage}`);
      }
    }
  }

  // Account connections
  async getUserAccountConnections(userId: string): Promise<AccountConnection[]> {
    const accounts = await db.select().from(accountConnections).where(eq(accountConnections.userId, userId));
    
    // Decrypt settings but remove password from response for security
    return accounts.map(account => ({
      ...account,
      settingsJson: JSON.stringify(decryptAccountSettings(account.settingsJson))
    }));
  }

  async getAllActiveEwsAccounts(): Promise<AccountConnection[]> {
    const accounts = await db.select().from(accountConnections).where(
      and(
        eq(accountConnections.protocol, 'EWS'),
        eq(accountConnections.isActive, true)
      )
    );
    
    // Return with encrypted settings for internal use (don't decrypt for security)
    return accounts;
  }

  async getAllActiveImapAccounts(): Promise<AccountConnection[]> {
    const accounts = await db.select().from(accountConnections).where(
      and(
        eq(accountConnections.protocol, 'IMAP'),
        eq(accountConnections.isActive, true)
      )
    );
    
    // Return with encrypted settings for internal use (don't decrypt for security)
    return accounts;
  }

  async createAccountConnection(connection: InsertAccountConnection): Promise<AccountConnection> {
    // Parse settings from JSON if it's a string, otherwise use as-is
    let settings: any;
    if (typeof connection.settingsJson === 'string') {
      try {
        settings = JSON.parse(connection.settingsJson);
      } catch (error) {
        throw new Error('Invalid settings JSON format');
      }
    } else {
      settings = connection.settingsJson;
    }
    
    // Encrypt the settings before storing
    const encryptedSettings = encryptAccountSettings(settings);
    
    // Create the connection with encrypted settings
    const connectionData = {
      ...connection,
      settingsJson: encryptedSettings,
      isActive: false, // Will be set to true after successful connection test
      lastChecked: null,
      lastError: null,
    };
    
    const [result] = await db.insert(accountConnections).values(connectionData).returning();
    
    // Return result without decrypting - frontend doesn't need password
    return {
      ...result,
      settingsJson: JSON.stringify(decryptAccountSettings(result.settingsJson))
    };
  }

  async updateAccountConnection(id: string, updates: Partial<AccountConnection>): Promise<AccountConnection | undefined> {
    const updateData = { ...updates, updatedAt: new Date() };
    
    // If settingsJson is being updated, encrypt it
    if (updates.settingsJson) {
      let settings: any;
      if (typeof updates.settingsJson === 'string') {
        try {
          settings = JSON.parse(updates.settingsJson);
        } catch (error) {
          throw new Error('Invalid settings JSON format');
        }
      } else {
        settings = updates.settingsJson;
      }
      updateData.settingsJson = encryptAccountSettings(settings);
    }
    
    const [result] = await db
      .update(accountConnections)
      .set(updateData)
      .where(eq(accountConnections.id, id))
      .returning();
    
    if (!result) return undefined;
    
    // Return result without password for security
    return {
      ...result,
      settingsJson: JSON.stringify(decryptAccountSettings(result.settingsJson))
    };
  }

  async getAccountConnection(id: string): Promise<AccountConnection | undefined> {
    const [account] = await db.select().from(accountConnections).where(eq(accountConnections.id, id));
    return account;
  }

  async getAccountConnectionEncrypted(id: string): Promise<{ settingsJson: string } | undefined> {
    const [account] = await db.select({ settingsJson: accountConnections.settingsJson }).from(accountConnections).where(eq(accountConnections.id, id));
    return account;
  }

  async deleteAccountConnection(id: string): Promise<void> {
    await db.delete(accountConnections).where(eq(accountConnections.id, id));
  }


  // Mail operations
  async getMailMessages(accountId: string, folder?: string, limit = 50, offset = 0): Promise<MailMessage[]> {
    let whereCondition = eq(mailIndex.accountId, accountId);
    
    if (folder) {
      // Use case-insensitive folder matching to handle INBOX vs inbox
      whereCondition = and(
        eq(mailIndex.accountId, accountId), 
        sql`UPPER(${mailIndex.folder}) = UPPER(${folder})`
      )!;
    }
    
    return await db.select().from(mailIndex).where(whereCondition)
      .orderBy(sql`${mailIndex.date} DESC NULLS LAST`)
      .limit(limit).offset(offset);
  }

  async getMailMessage(id: string): Promise<MailMessage | undefined> {
    const [result] = await db.select().from(mailIndex).where(eq(mailIndex.id, id));
    return result;
  }

  async createMailMessage(message: InsertMailMessage): Promise<MailMessage> {
    const [result] = await db.insert(mailIndex).values(message).returning();
    return result;
  }

  async updateMailMessage(id: string, updates: Partial<MailMessage>): Promise<MailMessage | undefined> {
    const [result] = await db
      .update(mailIndex)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(mailIndex.id, id))
      .returning();
    return result;
  }

  async deleteMailMessage(id: string): Promise<void> {
    await db.delete(mailIndex).where(eq(mailIndex.id, id));
  }

  // Email organization operations
  async starEmail(id: string): Promise<MailMessage | undefined> {
    const [result] = await db
      .update(mailIndex)
      .set({ isStarred: true, updatedAt: new Date() })
      .where(eq(mailIndex.id, id))
      .returning();
    return result;
  }

  async unstarEmail(id: string): Promise<MailMessage | undefined> {
    const [result] = await db
      .update(mailIndex)
      .set({ isStarred: false, updatedAt: new Date() })
      .where(eq(mailIndex.id, id))
      .returning();
    return result;
  }

  async archiveEmail(id: string): Promise<MailMessage | undefined> {
    const [result] = await db
      .update(mailIndex)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(eq(mailIndex.id, id))
      .returning();
    return result;
  }

  async unarchiveEmail(id: string): Promise<MailMessage | undefined> {
    const [result] = await db
      .update(mailIndex)
      .set({ isArchived: false, updatedAt: new Date() })
      .where(eq(mailIndex.id, id))
      .returning();
    return result;
  }

  async softDeleteEmail(id: string): Promise<MailMessage | undefined> {
    const [result] = await db
      .update(mailIndex)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(eq(mailIndex.id, id))
      .returning();
    return result;
  }

  async restoreEmail(id: string): Promise<MailMessage | undefined> {
    const [result] = await db
      .update(mailIndex)
      .set({ isDeleted: false, isArchived: false, updatedAt: new Date() })
      .where(eq(mailIndex.id, id))
      .returning();
    return result;
  }

  async getStarredEmails(userId: string, limit = 50, offset = 0): Promise<MailMessage[]> {
    // Get all accounts for this user
    const userAccounts = await db.select({ id: accountConnections.id })
      .from(accountConnections)
      .where(eq(accountConnections.userId, userId));
    
    if (userAccounts.length === 0) return [];
    
    const accountIds = userAccounts.map(acc => acc.id);
    
    return await db.select().from(mailIndex)
      .where(and(
        sql`${mailIndex.accountId} = ANY(${accountIds})`,
        eq(mailIndex.isStarred, true),
        eq(mailIndex.isDeleted, false)
      ))
      .orderBy(sql`${mailIndex.date} DESC NULLS LAST`)
      .limit(limit)
      .offset(offset);
  }

  async getArchivedEmails(userId: string, limit = 50, offset = 0): Promise<MailMessage[]> {
    // Get all accounts for this user
    const userAccounts = await db.select({ id: accountConnections.id })
      .from(accountConnections)
      .where(eq(accountConnections.userId, userId));
    
    if (userAccounts.length === 0) return [];
    
    const accountIds = userAccounts.map(acc => acc.id);
    
    return await db.select().from(mailIndex)
      .where(and(
        sql`${mailIndex.accountId} = ANY(${accountIds})`,
        eq(mailIndex.isArchived, true),
        eq(mailIndex.isDeleted, false)
      ))
      .orderBy(sql`${mailIndex.date} DESC NULLS LAST`)
      .limit(limit)
      .offset(offset);
  }

  async getDeletedEmails(userId: string, limit = 50, offset = 0): Promise<MailMessage[]> {
    // Get all accounts for this user
    const userAccounts = await db.select({ id: accountConnections.id })
      .from(accountConnections)
      .where(eq(accountConnections.userId, userId));
    
    if (userAccounts.length === 0) return [];
    
    const accountIds = userAccounts.map(acc => acc.id);
    
    return await db.select().from(mailIndex)
      .where(and(
        sql`${mailIndex.accountId} = ANY(${accountIds})`,
        eq(mailIndex.isDeleted, true)
      ))
      .orderBy(sql`${mailIndex.date} DESC NULLS LAST`)
      .limit(limit)
      .offset(offset);
  }

  // Priority rules
  async getPriorityRules(accountId: string): Promise<PriorityRule[]> {
    return await db.select().from(priorityRules).where(eq(priorityRules.accountId, accountId));
  }

  async createPriorityRule(rule: InsertPriorityRule): Promise<PriorityRule> {
    const [result] = await db.insert(priorityRules).values(rule).returning();
    return result;
  }

  async updatePriorityRule(id: string, updates: Partial<PriorityRule>): Promise<PriorityRule | undefined> {
    const [result] = await db
      .update(priorityRules)
      .set(updates)
      .where(eq(priorityRules.id, id))
      .returning();
    return result;
  }

  async deletePriorityRule(id: string): Promise<void> {
    await db.delete(priorityRules).where(eq(priorityRules.id, id));
  }

  // VIP contacts
  async getVipContacts(userId: string): Promise<VipContact[]> {
    return await db.select().from(vipContacts).where(eq(vipContacts.userId, userId));
  }

  async createVipContact(contact: InsertVipContact): Promise<VipContact> {
    const [result] = await db.insert(vipContacts).values(contact).returning();
    return result;
  }

  async deleteVipContact(id: string): Promise<void> {
    await db.delete(vipContacts).where(eq(vipContacts.id, id));
  }

  // User preferences
  async getUserPrefs(userId: string): Promise<UserPrefs | undefined> {
    const [prefs] = await db.select().from(userPrefs).where(eq(userPrefs.userId, userId));
    return prefs;
  }

  async upsertUserPrefs(prefsData: InsertUserPrefs): Promise<UserPrefs> {
    const [result] = await db
      .insert(userPrefs)
      .values(prefsData)
      .onConflictDoUpdate({
        target: [userPrefs.userId],
        set: {
          ...prefsData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  // Account folders
  async getAccountFolders(accountId: string): Promise<AccountFolder[]> {
    return await db.select().from(accountFolders).where(eq(accountFolders.accountId, accountId))
      .orderBy(accountFolders.folderType, accountFolders.displayName);
  }

  async createAccountFolder(folder: InsertAccountFolder): Promise<AccountFolder> {
    const [result] = await db.insert(accountFolders).values(folder).returning();
    return result;
  }

  async updateAccountFolder(id: string, updates: Partial<AccountFolder>): Promise<AccountFolder | undefined> {
    const [result] = await db
      .update(accountFolders)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(accountFolders.id, id))
      .returning();
    return result;
  }

  async upsertAccountFolder(folder: InsertAccountFolder): Promise<AccountFolder> {
    const [result] = await db
      .insert(accountFolders)
      .values(folder)
      .onConflictDoUpdate({
        target: [accountFolders.accountId, accountFolders.folderId],
        set: {
          ...folder,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  async deleteAccountFolder(id: string): Promise<void> {
    await db.delete(accountFolders).where(eq(accountFolders.id, id));
  }

  async updateFolderCounts(accountId: string, folderId: string, unreadCount: number, totalCount: number): Promise<void> {
    await db
      .update(accountFolders)
      .set({ 
        unreadCount, 
        totalCount, 
        lastSynced: new Date(),
        updatedAt: new Date() 
      })
      .where(and(
        eq(accountFolders.accountId, accountId),
        eq(accountFolders.folderId, folderId)
      ));
  }

  // Attachment operations
  async getEmailAttachments(emailId: string): Promise<Attachment[]> {
    return await db.select().from(attachments).where(eq(attachments.emailId, emailId));
  }

  async createAttachment(attachment: InsertAttachment): Promise<Attachment> {
    const [result] = await db.insert(attachments).values(attachment).returning();
    return result;
  }

  async getAttachment(id: string): Promise<Attachment | undefined> {
    const [attachment] = await db.select().from(attachments).where(eq(attachments.id, id));
    return attachment;
  }

  async deleteAttachment(id: string): Promise<void> {
    await db.delete(attachments).where(eq(attachments.id, id));
  }

  async deleteEmailAttachments(emailId: string): Promise<void> {
    await db.delete(attachments).where(eq(attachments.emailId, emailId));
  }

  // Search operations
  async searchEmails(params: SearchEmailsParams): Promise<SearchEmailsResult> {
    const {
      userId,
      query,
      accountId,
      folder,
      searchFields = ['all'],
      dateFrom,
      dateTo,
      hasAttachments,
      isRead,
      isFlagged,
      priority,
      limit = 50,
      offset = 0
    } = params;

    try {
      // First, get user's account IDs to filter by
      const userAccounts = await this.getUserAccountConnections(userId);
      const userAccountIds = userAccounts.map(acc => acc.id);
      
      if (userAccountIds.length === 0) {
        return { results: [], totalCount: 0, hasMore: false };
      }

      // Build the base query conditions
      const conditions = [];

      // Filter by user's accounts
      if (accountId) {
        // Search in specific account only
        if (!userAccountIds.includes(accountId)) {
          return { results: [], totalCount: 0, hasMore: false };
        }
        conditions.push(eq(mailIndex.accountId, accountId));
      } else {
        // Search across all user's accounts
        conditions.push(sql`${mailIndex.accountId} = ANY(${userAccountIds})`);
      }

      // Folder filter
      if (folder) {
        conditions.push(eq(mailIndex.folder, folder));
      }

      // Date range filters
      if (dateFrom) {
        conditions.push(gte(mailIndex.date, dateFrom));
      }
      if (dateTo) {
        conditions.push(lte(mailIndex.date, dateTo));
      }

      // Boolean filters
      if (typeof hasAttachments === 'boolean') {
        conditions.push(eq(mailIndex.hasAttachments, hasAttachments));
      }
      if (typeof isRead === 'boolean') {
        conditions.push(eq(mailIndex.isRead, isRead));
      }
      if (typeof isFlagged === 'boolean') {
        conditions.push(eq(mailIndex.isFlagged, isFlagged));
      }
      if (typeof priority === 'number') {
        conditions.push(eq(mailIndex.priority, priority));
      }

      // Search query conditions
      if (query && query.trim()) {
        const searchTerm = `%${query.trim().toLowerCase()}%`;
        const searchConditions = [];

        // Determine which fields to search
        const fieldsToSearch = searchFields.includes('all') 
          ? ['subject', 'from', 'to', 'cc', 'bcc', 'body']
          : searchFields;

        // Add search conditions for each field
        if (fieldsToSearch.includes('subject')) {
          searchConditions.push(ilike(mailIndex.subject, searchTerm));
        }
        if (fieldsToSearch.includes('from')) {
          searchConditions.push(ilike(mailIndex.from, searchTerm));
        }
        if (fieldsToSearch.includes('to')) {
          searchConditions.push(ilike(mailIndex.to, searchTerm));
        }
        if (fieldsToSearch.includes('cc')) {
          searchConditions.push(ilike(mailIndex.cc, searchTerm));
        }
        if (fieldsToSearch.includes('bcc')) {
          searchConditions.push(ilike(mailIndex.bcc, searchTerm));
        }
        if (fieldsToSearch.includes('body')) {
          searchConditions.push(
            or(
              ilike(mailIndex.bodyText, searchTerm),
              ilike(mailIndex.bodyHtml, searchTerm),
              ilike(mailIndex.snippet, searchTerm)
            )
          );
        }

        if (searchConditions.length > 0) {
          conditions.push(or(...searchConditions));
        }
      }

      // Build the complete where clause
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Execute search query with pagination
      const results = await db
        .select()
        .from(mailIndex)
        .where(whereClause)
        .orderBy(desc(mailIndex.date))
        .limit(limit + 1) // Get one extra to check if there are more results
        .offset(offset);

      // Get total count for pagination
      const countQuery = await db
        .select({ count: sql<number>`count(*)` })
        .from(mailIndex)
        .where(whereClause);

      const totalCount = countQuery[0]?.count || 0;
      const hasMore = results.length > limit;
      
      // Remove the extra result if we have more
      if (hasMore) {
        results.pop();
      }

      // Enhance results with search-specific metadata
      const enhancedResults = results.map(email => {
        const result = email as MailMessage & { 
          relevanceScore?: number; 
          highlightedSnippet?: string;
          matchedFields?: string[];
        };

        // Simple relevance scoring based on where the match was found
        let relevanceScore = 0;
        const matchedFields: string[] = [];

        if (query && query.trim()) {
          const searchTerm = query.trim().toLowerCase();
          
          // Higher score for title matches
          if (email.subject?.toLowerCase().includes(searchTerm)) {
            relevanceScore += 10;
            matchedFields.push('subject');
          }
          
          // Medium score for sender matches
          if (email.from?.toLowerCase().includes(searchTerm)) {
            relevanceScore += 5;
            matchedFields.push('from');
          }
          
          // Lower score for body matches
          if (email.bodyText?.toLowerCase().includes(searchTerm) || 
              email.bodyHtml?.toLowerCase().includes(searchTerm) ||
              email.snippet?.toLowerCase().includes(searchTerm)) {
            relevanceScore += 2;
            matchedFields.push('body');
          }

          // Check other fields
          if (email.to?.toLowerCase().includes(searchTerm)) {
            relevanceScore += 3;
            matchedFields.push('to');
          }
          if (email.cc?.toLowerCase().includes(searchTerm)) {
            relevanceScore += 3;
            matchedFields.push('cc');
          }
        }

        result.relevanceScore = relevanceScore;
        result.matchedFields = matchedFields;

        // Create highlighted snippet
        if (query && query.trim() && email.snippet) {
          const snippet = email.snippet;
          const searchTerm = query.trim();
          const regex = new RegExp(`(${searchTerm})`, 'gi');
          result.highlightedSnippet = snippet.replace(regex, '<mark>$1</mark>');
        } else {
          result.highlightedSnippet = email.snippet ?? undefined;
        }

        return result;
      });

      return {
        results: enhancedResults,
        totalCount,
        hasMore
      };

    } catch (error) {
      console.error('Error in searchEmails:', error);
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Draft operations
  async saveDraft(accountId: string, draftData: Partial<InsertMailMessage>): Promise<MailMessage> {
    const draftMessage: InsertMailMessage = {
      accountId,
      folder: 'drafts', // Always save to drafts folder
      messageId: draftData.messageId || `draft-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      threadId: draftData.threadId || undefined,
      subject: draftData.subject || '',
      from: draftData.from || '',
      to: draftData.to || '',
      cc: draftData.cc || '',
      bcc: draftData.bcc || '',
      replyTo: draftData.replyTo || undefined,
      date: new Date(),
      size: draftData.size || 0,
      hasAttachments: draftData.hasAttachments || false,
      isRead: false, // Drafts are unread
      isFlagged: false,
      priority: draftData.priority || 0,
      isStarred: draftData.isStarred || false,
      isArchived: false,
      isDeleted: false,
      snippet: draftData.snippet || draftData.subject || '',
      bodyHtml: draftData.bodyHtml || '',
      bodyText: draftData.bodyText || '',
    };

    const [result] = await db.insert(mailIndex).values(draftMessage).returning();
    return result;
  }

  async getDraft(draftId: string): Promise<MailMessage | undefined> {
    const [draft] = await db.select().from(mailIndex)
      .where(and(eq(mailIndex.id, draftId), sql`UPPER(${mailIndex.folder}) = 'DRAFTS'`));
    return draft;
  }

  async listUserDrafts(userId: string, limit = 50, offset = 0): Promise<MailMessage[]> {
    // Get all account IDs for this user
    const userAccounts = await db.select({ id: accountConnections.id })
      .from(accountConnections)
      .where(eq(accountConnections.userId, userId));
    
    if (userAccounts.length === 0) {
      return [];
    }

    const accountIds = userAccounts.map(acc => acc.id);
    
    return await db.select().from(mailIndex)
      .where(and(
        sql`${mailIndex.accountId} = ANY(${accountIds})`,
        sql`UPPER(${mailIndex.folder}) = 'DRAFTS'`,
        eq(mailIndex.isDeleted, false)
      ))
      .orderBy(desc(mailIndex.updatedAt))
      .limit(limit)
      .offset(offset);
  }

  async listAccountDrafts(accountId: string, limit = 50, offset = 0): Promise<MailMessage[]> {
    return await db.select().from(mailIndex)
      .where(and(
        eq(mailIndex.accountId, accountId),
        sql`UPPER(${mailIndex.folder}) = 'DRAFTS'`,
        eq(mailIndex.isDeleted, false)
      ))
      .orderBy(desc(mailIndex.updatedAt))
      .limit(limit)
      .offset(offset);
  }

  async deleteDraft(draftId: string): Promise<void> {
    // First verify this is actually a draft
    const draft = await this.getDraft(draftId);
    if (!draft) {
      throw new Error('Draft not found');
    }
    
    // Delete attachments first
    await this.deleteEmailAttachments(draftId);
    
    // Then delete the draft
    await db.delete(mailIndex).where(eq(mailIndex.id, draftId));
  }

  async updateDraft(draftId: string, updates: Partial<MailMessage>): Promise<MailMessage | undefined> {
    // Verify this is actually a draft before updating
    const existingDraft = await this.getDraft(draftId);
    if (!existingDraft) {
      return undefined;
    }

    const [result] = await db
      .update(mailIndex)
      .set({ 
        ...updates, 
        updatedAt: new Date(),
        folder: 'drafts' // Ensure it stays in drafts folder
      })
      .where(eq(mailIndex.id, draftId))
      .returning();
    return result;
  }

  // Signature operations
  async getUserSignatures(userId: string, accountId?: string): Promise<Signature[]> {
    const whereClause = accountId
      ? and(eq(signatures.userId, userId), eq(signatures.accountId, accountId))
      : and(eq(signatures.userId, userId), eq(signatures.isActive, true));

    const results = await db
      .select()
      .from(signatures)
      .where(whereClause)
      .orderBy(desc(signatures.isDefault), asc(signatures.sortOrder), asc(signatures.name));

    return results;
  }

  async getSignature(id: string): Promise<Signature | undefined> {
    const [result] = await db
      .select()
      .from(signatures)
      .where(eq(signatures.id, id));
    return result;
  }

  async createSignature(signature: InsertSignature): Promise<Signature> {
    // If this is being set as default, clear other defaults for the same user/account
    if (signature.isDefault) {
      const whereClause = signature.accountId
        ? and(eq(signatures.userId, signature.userId), eq(signatures.accountId, signature.accountId))
        : eq(signatures.userId, signature.userId);

      await db
        .update(signatures)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(whereClause);
    }

    const [result] = await db
      .insert(signatures)
      .values({
        ...signature,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return result;
  }

  async updateSignature(id: string, updates: Partial<Signature>): Promise<Signature | undefined> {
    // If setting as default, clear other defaults for the same user/account
    if (updates.isDefault) {
      const existingSignature = await this.getSignature(id);
      if (existingSignature) {
        const whereClause = existingSignature.accountId
          ? and(
              eq(signatures.userId, existingSignature.userId),
              eq(signatures.accountId, existingSignature.accountId),
              sql`${signatures.id} != ${id}`
            )
          : and(
              eq(signatures.userId, existingSignature.userId),
              sql`${signatures.id} != ${id}`
            );

        await db
          .update(signatures)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(whereClause);
      }
    }

    const [result] = await db
      .update(signatures)
      .set({ 
        ...updates, 
        updatedAt: new Date() 
      })
      .where(eq(signatures.id, id))
      .returning();

    return result;
  }

  async deleteSignature(id: string): Promise<void> {
    await db.delete(signatures).where(eq(signatures.id, id));
  }

  async setDefaultSignature(userId: string, signatureId: string, accountId?: string): Promise<void> {
    // Clear all existing defaults for the user/account
    const whereClause = accountId
      ? and(eq(signatures.userId, userId), eq(signatures.accountId, accountId))
      : eq(signatures.userId, userId);

    await db
      .update(signatures)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(whereClause);

    // Set the specified signature as default
    await db
      .update(signatures)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(signatures.id, signatureId));
  }

  async getDefaultSignature(userId: string, accountId?: string): Promise<Signature | undefined> {
    const whereClause = accountId
      ? and(
          eq(signatures.userId, userId),
          eq(signatures.accountId, accountId),
          eq(signatures.isDefault, true),
          eq(signatures.isActive, true)
        )
      : and(
          eq(signatures.userId, userId),
          eq(signatures.isDefault, true),
          eq(signatures.isActive, true)
        );

    const [result] = await db
      .select()
      .from(signatures)
      .where(whereClause)
      .limit(1);

    return result;
  }

  // Push notification operations
  async getUserPushSubscriptions(userId: string): Promise<PushSubscription[]> {
    return await db.select().from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(desc(pushSubscriptions.lastUsed));
  }

  async createPushSubscription(subscription: InsertPushSubscription): Promise<PushSubscription> {
    const [result] = await db.insert(pushSubscriptions).values(subscription).returning();
    return result;
  }

  async updatePushSubscription(id: string, updates: Partial<PushSubscription>): Promise<PushSubscription | undefined> {
    const [result] = await db
      .update(pushSubscriptions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(pushSubscriptions.id, id))
      .returning();
    return result;
  }

  async deletePushSubscription(id: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  }

  async deletePushSubscriptionByEndpoint(userId: string, endpoint: string): Promise<void> {
    await db.delete(pushSubscriptions).where(
      and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.endpoint, endpoint)
      )
    );
  }

  async getActivePushSubscriptions(userId: string): Promise<PushSubscription[]> {
    return await db.select().from(pushSubscriptions)
      .where(and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.isActive, true),
        or(
          sql`${pushSubscriptions.expirationTime} IS NULL`,
          gte(pushSubscriptions.expirationTime, new Date())
        )
      ))
      .orderBy(desc(pushSubscriptions.lastUsed));
  }

  // Notification preferences operations
  async getNotificationPreferences(userId: string): Promise<NotificationPreferences | undefined> {
    const [prefs] = await db.select().from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));
    return prefs;
  }

  async upsertNotificationPreferences(prefs: InsertNotificationPreferences): Promise<NotificationPreferences> {
    const [result] = await db
      .insert(notificationPreferences)
      .values(prefs)
      .onConflictDoUpdate({
        target: [notificationPreferences.userId],
        set: {
          ...prefs,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  async getAccountNotificationPreferences(userId: string, accountId?: string): Promise<AccountNotificationPreferences[]> {
    let whereCondition = eq(accountNotificationPreferences.userId, userId);
    
    if (accountId) {
      whereCondition = and(whereCondition, eq(accountNotificationPreferences.accountId, accountId)) || eq(accountNotificationPreferences.userId, userId);
    }
    
    return await db.select().from(accountNotificationPreferences)
      .where(whereCondition)
      .orderBy(accountNotificationPreferences.createdAt);
  }

  async upsertAccountNotificationPreferences(prefs: InsertAccountNotificationPreferences): Promise<AccountNotificationPreferences> {
    const [result] = await db
      .insert(accountNotificationPreferences)
      .values(prefs)
      .onConflictDoUpdate({
        target: [accountNotificationPreferences.userId, accountNotificationPreferences.accountId],
        set: {
          ...prefs,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  async deleteAccountNotificationPreferences(userId: string, accountId: string): Promise<void> {
    await db.delete(accountNotificationPreferences)
      .where(and(
        eq(accountNotificationPreferences.userId, userId),
        eq(accountNotificationPreferences.accountId, accountId)
      ));
  }

  // Notification log operations
  async createNotificationLogEntry(entry: InsertNotificationLog): Promise<NotificationLog> {
    const [result] = await db.insert(notificationLog).values(entry).returning();
    return result;
  }

  async updateNotificationLogEntry(id: string, updates: Partial<NotificationLog>): Promise<NotificationLog | undefined> {
    const [result] = await db
      .update(notificationLog)
      .set(updates)
      .where(eq(notificationLog.id, id))
      .returning();
    return result;
  }

  async getUserNotificationHistory(userId: string, limit = 50, offset = 0): Promise<NotificationLog[]> {
    return await db.select().from(notificationLog)
      .where(eq(notificationLog.userId, userId))
      .orderBy(desc(notificationLog.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async deleteOldNotificationLogs(olderThanDays: number): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    
    await db.delete(notificationLog)
      .where(lte(notificationLog.createdAt, cutoffDate));
  }
}

export const storage = new DatabaseStorage();
