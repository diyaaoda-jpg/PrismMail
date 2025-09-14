import {
  users,
  accountConnections,
  accountFolders,
  mailIndex,
  priorityRules,
  vipContacts,
  userPrefs,
  priorityAnalytics,
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
  type PriorityAnalytics,
  type InsertPriorityAnalytics,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, sql } from "drizzle-orm";
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
  getFocusModeMessages(userId: string, accountId?: string, limit?: number, offset?: number): Promise<MailMessage[]>;
  createMailMessage(message: InsertMailMessage): Promise<MailMessage>;
  updateMailMessage(id: string, updates: Partial<MailMessage>): Promise<MailMessage | undefined>;
  updateMailPriority(id: string, priority: number, prioritySource: string, ruleId?: string): Promise<MailMessage | undefined>;
  deleteMailMessage(id: string): Promise<void>;
  // Enhanced partitioned mail operations for scalability
  getMailMessagesPartitioned(accountId: string, options?: {
    folder?: string;
    limit?: number;
    cursor?: string;
    priorityRange?: [number, number];
    needsPriorityUpdate?: boolean;
    modifiedSince?: Date;
  }): Promise<{ messages: MailMessage[]; nextCursor?: string; total?: number }>;
  getMailMessagesByIds(messageIds: string[]): Promise<MailMessage[]>;
  bulkUpdateMailPriorities(updates: Array<{
    id: string;
    priority: number;
    prioritySource: string;
    ruleId?: string;
    priorityScore?: number;
    priorityFactors?: any;
    isVip?: boolean;
    autoPriority?: number;
    isInFocus?: boolean;
  }>): Promise<number>;
  getEmailsAffectedByRule(ruleId: string, accountId: string, limit?: number): Promise<MailMessage[]>;
  countEmailsNeedingPriorityUpdate(accountId: string, since?: Date): Promise<number>;
  getUserIdFromAccountId(accountId: string): Promise<string | null>;
  // Enhanced Priority rules
  getPriorityRules(accountId: string): Promise<PriorityRule[]>;
  getPriorityRuleWithOwnership(ruleId: string, userId: string): Promise<PriorityRule | undefined>;
  createPriorityRule(rule: InsertPriorityRule): Promise<PriorityRule>;
  updatePriorityRule(id: string, updates: Partial<PriorityRule>): Promise<PriorityRule | undefined>;
  updatePriorityRuleStats(id: string, matchCount: number): Promise<void>;
  deletePriorityRule(id: string): Promise<void>;
  deletePriorityRuleWithOwnership(ruleId: string, userId: string): Promise<boolean>;
  reorderPriorityRules(ruleUpdates: Array<{id: string, executionOrder: number}>): Promise<void>;
  reorderPriorityRulesWithOwnership(ruleUpdates: Array<{id: string, executionOrder: number}>, userId: string): Promise<{ success: boolean; invalidRuleIds?: string[] }>;
  // Enhanced VIP contacts
  getVipContacts(userId: string): Promise<VipContact[]>;
  getVipContactByEmail(userId: string, email: string): Promise<VipContact | undefined>;
  getVipContactWithOwnership(contactId: string, userId: string): Promise<VipContact | undefined>;
  createVipContact(contact: InsertVipContact): Promise<VipContact>;
  updateVipContact(id: string, updates: Partial<VipContact>): Promise<VipContact | undefined>;
  updateVipInteraction(userId: string, email: string): Promise<void>;
  deleteVipContact(id: string): Promise<void>;
  deleteVipContactWithOwnership(contactId: string, userId: string): Promise<boolean>;
  suggestVipContacts(userId: string, limit?: number): Promise<Array<{email: string, name?: string, interactionCount: number}>>;
  // User preferences
  getUserPrefs(userId: string): Promise<UserPrefs | undefined>;
  upsertUserPrefs(prefs: InsertUserPrefs): Promise<UserPrefs>;
  // Priority analytics
  getPriorityAnalytics(userId: string, metricType?: string, periodStart?: Date, periodEnd?: Date): Promise<PriorityAnalytics[]>;
  createPriorityAnalytics(analytics: InsertPriorityAnalytics): Promise<PriorityAnalytics>;
  getEmailPriorityDistribution(userId: string, days: number): Promise<Array<{priority: number, count: number}>>;
  getVipInteractionStats(userId: string, days: number): Promise<Array<{vipId: string, email: string, name?: string, interactionCount: number}>>;
  getRuleEffectiveness(accountId: string, days: number): Promise<Array<{ruleId: string, name: string, matchCount: number, effectiveness: number}>>;
  // Account folders
  getAccountFolders(accountId: string): Promise<AccountFolder[]>;
  createAccountFolder(folder: InsertAccountFolder): Promise<AccountFolder>;
  updateAccountFolder(id: string, updates: Partial<AccountFolder>): Promise<AccountFolder | undefined>;
  upsertAccountFolder(folder: InsertAccountFolder): Promise<AccountFolder>;
  deleteAccountFolder(id: string): Promise<void>;
  updateFolderCounts(accountId: string, folderId: string, unreadCount: number, totalCount: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // User operations (mandatory for Replit Auth)
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
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

  // Account folder operations
  async getAccountFolders(accountId: string): Promise<AccountFolder[]> {
    return await db.select().from(accountFolders).where(eq(accountFolders.accountId, accountId));
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

  async getFocusModeMessages(userId: string, accountId?: string, limit = 50, offset = 0): Promise<MailMessage[]> {
    // Get user preferences to determine focus criteria
    const [prefs] = await db.select().from(userPrefs).where(eq(userPrefs.userId, userId));
    
    let whereConditions = [
      sql`${mailIndex.accountId} IN (SELECT id FROM ${accountConnections} WHERE user_id = ${userId})`
    ];

    // Filter by account if specified
    if (accountId) {
      whereConditions.push(eq(mailIndex.accountId, accountId));
    }

    // Apply focus mode filters based on user preferences
    if (prefs?.focusMinPriority) {
      whereConditions.push(sql`(${mailIndex.priority} >= ${prefs.focusMinPriority} OR ${mailIndex.autoPriority} >= ${prefs.focusMinPriority})`);
    }

    if (prefs?.focusShowVipOnly) {
      whereConditions.push(eq(mailIndex.isVip, true));
    }

    if (prefs?.focusShowUnreadOnly) {
      whereConditions.push(eq(mailIndex.isRead, false));
    }

    // Always include high priority and VIP emails in focus mode
    whereConditions.push(
      sql`(${mailIndex.priority} >= 2 OR ${mailIndex.autoPriority} >= 2 OR ${mailIndex.isVip} = true OR ${mailIndex.isFlagged} = true)`
    );

    return await db.select().from(mailIndex)
      .where(and(...whereConditions))
      .orderBy(sql`${mailIndex.priority} DESC, ${mailIndex.autoPriority} DESC, ${mailIndex.date} DESC NULLS LAST`)
      .limit(limit)
      .offset(offset);
  }

  async updateMailMessage(id: string, updates: Partial<MailMessage>): Promise<MailMessage | undefined> {
    const [result] = await db
      .update(mailIndex)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(mailIndex.id, id))
      .returning();
    return result;
  }

  async updateMailPriority(id: string, priority: number, prioritySource: string, ruleId?: string): Promise<MailMessage | undefined> {
    const updateData: Partial<MailMessage> = {
      priority,
      prioritySource: prioritySource as any,
      updatedAt: new Date()
    };

    if (ruleId) {
      updateData.ruleId = ruleId;
    }

    const [result] = await db
      .update(mailIndex)
      .set(updateData)
      .where(eq(mailIndex.id, id))
      .returning();
    return result;
  }

  async deleteMailMessage(id: string): Promise<void> {
    await db.delete(mailIndex).where(eq(mailIndex.id, id));
  }

  // Enhanced Priority rules
  async getPriorityRules(accountId: string): Promise<PriorityRule[]> {
    return await db.select().from(priorityRules)
      .where(eq(priorityRules.accountId, accountId))
      .orderBy(priorityRules.executionOrder, priorityRules.createdAt);
  }

  async createPriorityRule(rule: InsertPriorityRule): Promise<PriorityRule> {
    const [result] = await db.insert(priorityRules).values(rule).returning();
    return result;
  }

  async getPriorityRuleWithOwnership(ruleId: string, userId: string): Promise<PriorityRule | undefined> {
    // Join with account connections to verify ownership
    const [result] = await db
      .select({
        id: priorityRules.id,
        accountId: priorityRules.accountId,
        name: priorityRules.name,
        description: priorityRules.description,
        conditionsJson: priorityRules.conditionsJson,
        priority: priorityRules.priority,
        colorTag: priorityRules.colorTag,
        isActive: priorityRules.isActive,
        executionOrder: priorityRules.executionOrder,
        matchCount: priorityRules.matchCount,
        lastMatched: priorityRules.lastMatched,
        createdAt: priorityRules.createdAt,
        updatedAt: priorityRules.updatedAt
      })
      .from(priorityRules)
      .innerJoin(accountConnections, eq(priorityRules.accountId, accountConnections.id))
      .where(and(
        eq(priorityRules.id, ruleId),
        eq(accountConnections.userId, userId)
      ));
    return result;
  }

  async updatePriorityRule(id: string, updates: Partial<PriorityRule>): Promise<PriorityRule | undefined> {
    const [result] = await db
      .update(priorityRules)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(priorityRules.id, id))
      .returning();
    return result;
  }

  async updatePriorityRuleStats(id: string, matchCount: number): Promise<void> {
    await db
      .update(priorityRules)
      .set({ 
        matchCount: sql`${priorityRules.matchCount} + ${matchCount}`,
        lastMatched: new Date(),
        updatedAt: new Date()
      })
      .where(eq(priorityRules.id, id));
  }

  async reorderPriorityRulesWithOwnership(ruleUpdates: Array<{id: string, executionOrder: number}>, userId: string): Promise<{ success: boolean; invalidRuleIds?: string[] }> {
    // First verify all rules belong to user's accounts
    const invalidRuleIds: string[] = [];
    
    for (const { id } of ruleUpdates) {
      const rule = await this.getPriorityRuleWithOwnership(id, userId);
      if (!rule) {
        invalidRuleIds.push(id);
      }
    }
    
    if (invalidRuleIds.length > 0) {
      return { success: false, invalidRuleIds };
    }
    
    // Use a transaction to update all rule orders atomically
    await db.transaction(async (tx) => {
      for (const { id, executionOrder } of ruleUpdates) {
        await tx.update(priorityRules)
          .set({ executionOrder, updatedAt: new Date() })
          .where(eq(priorityRules.id, id));
      }
    });
    
    return { success: true };
  }

  async reorderPriorityRules(ruleUpdates: Array<{id: string, executionOrder: number}>): Promise<void> {
    // Use a transaction to update all rule orders atomically
    await db.transaction(async (tx) => {
      for (const { id, executionOrder } of ruleUpdates) {
        await tx.update(priorityRules)
          .set({ executionOrder, updatedAt: new Date() })
          .where(eq(priorityRules.id, id));
      }
    });
  }

  async deletePriorityRuleWithOwnership(ruleId: string, userId: string): Promise<boolean> {
    // First verify ownership, then delete
    const rule = await this.getPriorityRuleWithOwnership(ruleId, userId);
    if (!rule) {
      return false; // Rule not found or not owned by user
    }
    
    await db.delete(priorityRules).where(eq(priorityRules.id, ruleId));
    return true;
  }

  async deletePriorityRule(id: string): Promise<void> {
    await db.delete(priorityRules).where(eq(priorityRules.id, id));
  }

  // Enhanced VIP contacts
  async getVipContacts(userId: string): Promise<VipContact[]> {
    return await db.select().from(vipContacts)
      .where(and(eq(vipContacts.userId, userId), eq(vipContacts.isActive, true)))
      .orderBy(vipContacts.vipGroup, vipContacts.name);
  }

  async getVipContactByEmail(userId: string, email: string): Promise<VipContact | undefined> {
    const [contact] = await db.select().from(vipContacts)
      .where(and(
        eq(vipContacts.userId, userId), 
        eq(vipContacts.email, email),
        eq(vipContacts.isActive, true)
      ));
    return contact;
  }

  async createVipContact(contact: InsertVipContact): Promise<VipContact> {
    const [result] = await db.insert(vipContacts).values(contact).returning();
    return result;
  }

  async getVipContactWithOwnership(contactId: string, userId: string): Promise<VipContact | undefined> {
    // Verify the contact belongs to the authenticated user
    const [contact] = await db.select().from(vipContacts)
      .where(and(
        eq(vipContacts.id, contactId),
        eq(vipContacts.userId, userId),
        eq(vipContacts.isActive, true)
      ));
    return contact;
  }

  async updateVipContact(id: string, updates: Partial<VipContact>): Promise<VipContact | undefined> {
    const [result] = await db
      .update(vipContacts)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(vipContacts.id, id))
      .returning();
    return result;
  }

  async updateVipInteraction(userId: string, email: string): Promise<void> {
    await db
      .update(vipContacts)
      .set({ 
        interactionCount: sql`${vipContacts.interactionCount} + 1`,
        lastInteraction: new Date(),
        updatedAt: new Date()
      })
      .where(and(
        eq(vipContacts.userId, userId), 
        eq(vipContacts.email, email)
      ));
  }

  async deleteVipContactWithOwnership(contactId: string, userId: string): Promise<boolean> {
    // First verify ownership, then delete
    const contact = await this.getVipContactWithOwnership(contactId, userId);
    if (!contact) {
      return false; // Contact not found or not owned by user
    }
    
    // Soft delete by setting isActive to false
    const [result] = await db
      .update(vipContacts)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(vipContacts.id, contactId))
      .returning();
    
    return !!result;
  }

  async deleteVipContact(id: string): Promise<void> {
    await db.delete(vipContacts).where(eq(vipContacts.id, id));
  }

  async suggestVipContacts(userId: string, limit = 10): Promise<Array<{email: string, name?: string, interactionCount: number}>> {
    // Get frequent email contacts that aren't already VIP
    const results = await db
      .select({
        email: sql`LOWER(TRIM(${mailIndex.from}))`.as('email'),
        name: sql`SPLIT_PART(${mailIndex.from}, '<', 1)`.as('name'),
        interactionCount: sql`COUNT(*)`.as('interactionCount')
      })
      .from(mailIndex)
      .leftJoin(vipContacts, and(
        eq(vipContacts.userId, userId),
        sql`LOWER(${vipContacts.email}) = LOWER(TRIM(${mailIndex.from}))`
      ))
      .where(and(
        sql`${mailIndex.accountId} IN (SELECT id FROM ${accountConnections} WHERE user_id = ${userId})`,
        sql`${vipContacts.id} IS NULL`, // Not already a VIP
        sql`${mailIndex.from} LIKE '%@%'` // Valid email format
      ))
      .groupBy(sql`LOWER(TRIM(${mailIndex.from}))`, sql`SPLIT_PART(${mailIndex.from}, '<', 1)`)
      .having(sql`COUNT(*) >= 3`) // At least 3 interactions
      .orderBy(sql`COUNT(*) DESC`)
      .limit(limit);
    
    return results.map(r => ({
      email: r.email as string,
      name: r.name && r.name.trim() !== r.email ? r.name as string : undefined,
      interactionCount: Number(r.interactionCount)
    }));
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

  // Priority analytics
  async getPriorityAnalytics(userId: string, metricType?: string, periodStart?: Date, periodEnd?: Date): Promise<PriorityAnalytics[]> {
    let whereConditions = [eq(priorityAnalytics.userId, userId)];

    if (metricType) {
      whereConditions.push(eq(priorityAnalytics.metricType, metricType as any));
    }

    if (periodStart) {
      whereConditions.push(sql`${priorityAnalytics.periodStart} >= ${periodStart}`);
    }

    if (periodEnd) {
      whereConditions.push(sql`${priorityAnalytics.periodEnd} <= ${periodEnd}`);
    }

    return await db.select().from(priorityAnalytics)
      .where(and(...whereConditions))
      .orderBy(priorityAnalytics.periodStart);
  }

  async createPriorityAnalytics(analytics: InsertPriorityAnalytics): Promise<PriorityAnalytics> {
    const [result] = await db.insert(priorityAnalytics).values(analytics).returning();
    return result;
  }

  async getEmailPriorityDistribution(userId: string, days: number): Promise<Array<{priority: number, count: number}>> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const results = await db
      .select({
        priority: mailIndex.priority,
        count: sql`COUNT(*)`.as('count')
      })
      .from(mailIndex)
      .innerJoin(accountConnections, eq(mailIndex.accountId, accountConnections.id))
      .where(and(
        eq(accountConnections.userId, userId),
        sql`${mailIndex.date} >= ${startDate}`
      ))
      .groupBy(mailIndex.priority)
      .orderBy(mailIndex.priority);

    return results.map(r => ({
      priority: r.priority || 0,
      count: Number(r.count)
    }));
  }

  async getVipInteractionStats(userId: string, days: number): Promise<Array<{vipId: string, email: string, name?: string, interactionCount: number}>> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const results = await db
      .select({
        vipId: vipContacts.id,
        email: vipContacts.email,
        name: vipContacts.name,
        interactionCount: sql`COUNT(${mailIndex.id})`.as('interactionCount')
      })
      .from(vipContacts)
      .leftJoin(mailIndex, and(
        sql`LOWER(${mailIndex.from}) LIKE LOWER('%' || ${vipContacts.email} || '%')`,
        sql`${mailIndex.date} >= ${startDate}`
      ))
      .innerJoin(accountConnections, eq(vipContacts.userId, userId))
      .where(eq(vipContacts.userId, userId))
      .groupBy(vipContacts.id, vipContacts.email, vipContacts.name)
      .orderBy(sql`COUNT(${mailIndex.id}) DESC`);

    return results.map(r => ({
      vipId: r.vipId,
      email: r.email,
      name: r.name || undefined,
      interactionCount: Number(r.interactionCount)
    }));
  }

  async getRuleEffectiveness(accountId: string, days: number): Promise<Array<{ruleId: string, name: string, matchCount: number, effectiveness: number}>> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const results = await db
      .select({
        ruleId: priorityRules.id,
        name: priorityRules.name,
        matchCount: sql`COUNT(${mailIndex.id})`.as('matchCount'),
        totalMatchCount: priorityRules.matchCount
      })
      .from(priorityRules)
      .leftJoin(mailIndex, and(
        eq(mailIndex.ruleId, priorityRules.id),
        sql`${mailIndex.date} >= ${startDate}`
      ))
      .where(eq(priorityRules.accountId, accountId))
      .groupBy(priorityRules.id, priorityRules.name, priorityRules.matchCount)
      .orderBy(sql`COUNT(${mailIndex.id}) DESC`);

    return results.map(r => ({
      ruleId: r.ruleId,
      name: r.name,
      matchCount: Number(r.matchCount),
      effectiveness: r.totalMatchCount ? (Number(r.matchCount) / r.totalMatchCount) * 100 : 0
    }));
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

  // Enhanced partitioned mail operations for scalability
  async getMailMessagesPartitioned(accountId: string, options: {
    folder?: string;
    limit?: number;
    cursor?: string;
    priorityRange?: [number, number];
    needsPriorityUpdate?: boolean;
    modifiedSince?: Date;
  } = {}): Promise<{ messages: MailMessage[]; nextCursor?: string; total?: number }> {
    const limit = Math.min(options.limit || 100, 500); // Cap limit to prevent memory issues
    
    let query = db.select().from(mailIndex).where(eq(mailIndex.accountId, accountId));
    
    // Add folder filter
    if (options.folder) {
      query = query.where(eq(mailIndex.folder, options.folder));
    }
    
    // Add priority range filter
    if (options.priorityRange) {
      const [minPriority, maxPriority] = options.priorityRange;
      query = query.where(
        and(
          sql`${mailIndex.autoPriority} >= ${minPriority}`,
          sql`${mailIndex.autoPriority} <= ${maxPriority}`
        )
      );
    }
    
    // Add filter for emails needing priority updates
    if (options.needsPriorityUpdate) {
      query = query.where(
        sql`${mailIndex.autoPriority} IS NULL OR ${mailIndex.prioritySource} = 'auto'`
      );
    }
    
    // Add modified since filter
    if (options.modifiedSince) {
      query = query.where(sql`${mailIndex.date} >= ${options.modifiedSince}`);
    }
    
    // Cursor-based pagination for consistent results
    if (options.cursor) {
      // Decode cursor (base64 encoded timestamp:id)
      const decoded = Buffer.from(options.cursor, 'base64').toString();
      const [timestamp, id] = decoded.split(':');
      query = query.where(
        sql`(${mailIndex.date}, ${mailIndex.id}) > (${new Date(timestamp)}, ${id})`
      );
    }
    
    // Order by date and id for consistent pagination
    query = query
      .orderBy(mailIndex.date, mailIndex.id)
      .limit(limit + 1); // Fetch one extra to determine if there's a next page
    
    const results = await query;
    const hasMore = results.length > limit;
    const messages = hasMore ? results.slice(0, limit) : results;
    
    // Generate next cursor if there are more results
    let nextCursor: string | undefined;
    if (hasMore && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      const cursorData = `${lastMessage.date?.toISOString()}:${lastMessage.id}`;
      nextCursor = Buffer.from(cursorData).toString('base64');
    }
    
    return {
      messages,
      nextCursor,
      total: undefined // Don't calculate total for performance - use separate count query if needed
    };
  }
  
  async getMailMessagesByIds(messageIds: string[]): Promise<MailMessage[]> {
    if (messageIds.length === 0) return [];
    
    // Batch in chunks to avoid query size limits
    const chunkSize = 100;
    const chunks: MailMessage[][] = [];
    
    for (let i = 0; i < messageIds.length; i += chunkSize) {
      const chunk = messageIds.slice(i, i + chunkSize);
      const results = await db.select().from(mailIndex).where(
        sql`${mailIndex.id} = ANY(${chunk})`
      );
      chunks.push(results);
    }
    
    return chunks.flat();
  }
  
  async bulkUpdateMailPriorities(updates: Array<{
    id: string;
    priority: number;
    prioritySource: string;
    ruleId?: string;
    priorityScore?: number;
    priorityFactors?: any;
    isVip?: boolean;
    autoPriority?: number;
    isInFocus?: boolean;
  }>): Promise<number> {
    if (updates.length === 0) return 0;
    
    // Batch updates in chunks for performance
    const chunkSize = 50;
    let totalUpdated = 0;
    
    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);
      
      // Build a multi-row update query
      const updateCases: string[] = [];
      const params: any[] = [];
      const ids: string[] = [];
      
      chunk.forEach((update, index) => {
        ids.push(update.id);
        
        // Build CASE statements for each field
        const baseIndex = i + index;
        updateCases.push(`
          priority = CASE WHEN id = $${params.length + 1} THEN $${params.length + 2} ELSE priority END,
          auto_priority = CASE WHEN id = $${params.length + 1} THEN $${params.length + 3} ELSE auto_priority END,
          priority_source = CASE WHEN id = $${params.length + 1} THEN $${params.length + 4} ELSE priority_source END,
          priority_score = CASE WHEN id = $${params.length + 1} THEN $${params.length + 5} ELSE priority_score END,
          is_vip = CASE WHEN id = $${params.length + 1} THEN $${params.length + 6} ELSE is_vip END,
          is_in_focus = CASE WHEN id = $${params.length + 1} THEN $${params.length + 7} ELSE is_in_focus END,
          updated_at = CASE WHEN id = $${params.length + 1} THEN NOW() ELSE updated_at END
        `);
        
        params.push(
          update.id,
          update.priority,
          update.autoPriority || update.priority,
          update.prioritySource,
          update.priorityScore || 0,
          update.isVip || false,
          update.isInFocus || false
        );
      });
      
      // Execute bulk update using raw SQL for performance
      const result = await db.execute(sql`
        UPDATE mail_index SET ${sql.raw(updateCases.join(','))}
        WHERE id = ANY(${ids})
      `);
      
      totalUpdated += result.rowCount || 0;
    }
    
    return totalUpdated;
  }
  
  async getEmailsAffectedByRule(ruleId: string, accountId: string, limit: number = 1000): Promise<MailMessage[]> {
    // Get emails that match the rule conditions or were previously matched by this rule
    const results = await db.select().from(mailIndex)
      .where(
        and(
          eq(mailIndex.accountId, accountId),
          sql`${mailIndex.ruleId} = ${ruleId} OR ${mailIndex.prioritySource} = 'rule'`
        )
      )
      .orderBy(mailIndex.date)
      .limit(limit);
    
    return results;
  }
  
  async countEmailsNeedingPriorityUpdate(accountId: string, since?: Date): Promise<number> {
    let query = db.select({ count: sql<number>`COUNT(*)` }).from(mailIndex)
      .where(
        and(
          eq(mailIndex.accountId, accountId),
          sql`${mailIndex.autoPriority} IS NULL OR ${mailIndex.prioritySource} = 'auto'`
        )
      );
    
    if (since) {
      query = query.where(sql`${mailIndex.date} >= ${since}`);
    }
    
    const [result] = await query;
    return result?.count || 0;
  }

  /**
   * Get userId from accountId for distributed job processing
   */
  async getUserIdFromAccountId(accountId: string): Promise<string | null> {
    const [account] = await db.select({ userId: accountConnections.userId })
      .from(accountConnections)
      .where(eq(accountConnections.id, accountId));
    
    return account?.userId || null;
  }
}

export const storage = new DatabaseStorage();
