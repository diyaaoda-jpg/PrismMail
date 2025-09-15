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
}

export const storage = new DatabaseStorage();
