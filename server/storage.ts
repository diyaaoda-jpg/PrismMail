import {
  users,
  accountConnections,
  accountFolders,
  mailIndex,
  priorityRules,
  vipContacts,
  userPrefs,
  attachments,
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
  getAllActiveEwsAccounts(): Promise<AccountConnection[]>;
  getAllActiveImapAccounts(): Promise<AccountConnection[]>;
  createAccountConnection(connection: InsertAccountConnection): Promise<AccountConnection>;
  getAccountConnectionEncrypted(id: string): Promise<{ settingsJson: string } | undefined>;
  updateAccountConnection(id: string, updates: Partial<AccountConnection>): Promise<AccountConnection | undefined>;
  deleteAccountConnection(id: string): Promise<void>;
  // Mail operations
  getMailMessages(accountId: string, folder?: string, limit?: number, offset?: number): Promise<MailMessage[]>;
  createMailMessage(message: InsertMailMessage): Promise<MailMessage>;
  updateMailMessage(id: string, updates: Partial<MailMessage>): Promise<MailMessage | undefined>;
  deleteMailMessage(id: string): Promise<void>;
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
          result.highlightedSnippet = email.snippet;
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
}

export const storage = new DatabaseStorage();
