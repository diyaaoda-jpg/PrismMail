import {
  users,
  accountConnections,
  mailIndex,
  priorityRules,
  vipContacts,
  userPrefs,
  type User,
  type UpsertUser,
  type AccountConnection,
  type InsertAccountConnection,
  type MailMessage,
  type InsertMailMessage,
  type PriorityRule,
  type InsertPriorityRule,
  type VipContact,
  type InsertVipContact,
  type UserPrefs,
  type InsertUserPrefs,
} from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import { encryptAccountSettings, decryptAccountSettings } from "./crypto";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  // User operations (mandatory for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  // Account connections
  getUserAccountConnections(userId: string): Promise<AccountConnection[]>;
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
      whereCondition = and(eq(mailIndex.accountId, accountId), eq(mailIndex.folder, folder))!;
    }
    
    return await db.select().from(mailIndex).where(whereCondition).limit(limit).offset(offset);
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
        target: userPrefs.userId,
        set: {
          ...prefsData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }
}

export const storage = new DatabaseStorage();
