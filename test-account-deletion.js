#!/usr/bin/env node

// Use CommonJS require syntax for this environment
const { DatabaseStorage } = require('./server/storage.ts');
const { getEwsPushService } = require('./server/ewsPushNotifications.ts');
const { getImapIdleService } = require('./server/imapIdle.ts');
const { db } = require('./server/db.ts');
const { accountConnections, mailIndex, accountFolders } = require('./shared/schema.ts');
const { eq } = require('drizzle-orm');

// Initialize storage instance
const storage = new DatabaseStorage();

/**
 * Comprehensive Account Deletion Test Script
 * 
 * This script tests the complete account deletion flow including:
 * - Service cleanup (IDLE connections, push subscriptions)
 * - Database cascade cleanup
 * - Error handling
 */

async function testAccountDeletion() {
  console.log('🧪 Starting Comprehensive Account Deletion Tests\n');

  try {
    // 1. Get current accounts state
    console.log('📊 Current Database State:');
    await showCurrentState();

    // 2. Test deletion of inactive accounts first
    console.log('\n🔄 Testing Inactive Account Deletion...');
    await testInactiveAccountDeletion();

    // 3. Test deletion of active IMAP account
    console.log('\n📧 Testing IMAP Account Deletion...');
    await testImapAccountDeletion();

    // 4. Test deletion of active EWS account  
    console.log('\n🔄 Testing EWS Account Deletion...');
    await testEwsAccountDeletion();

    // 5. Verify final cleanup
    console.log('\n🏁 Final State Verification:');
    await showCurrentState();

    console.log('\n✅ All tests completed successfully!');

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

async function showCurrentState() {
  try {
    // Check accounts using Drizzle ORM
    const accounts = await db.select({
      id: accountConnections.id,
      name: accountConnections.name,
      protocol: accountConnections.protocol,
      isActive: accountConnections.isActive,
      lastError: accountConnections.lastError
    }).from(accountConnections).orderBy(accountConnections.createdAt);
    
    console.log(`   Accounts: ${accounts.length} total`);
    accounts.forEach(acc => {
      console.log(`     - ${acc.name} (${acc.protocol}) - ${acc.isActive ? 'Active' : 'Inactive'}`);
    });

    // Check messages using storage method
    const allMessages = await db.select().from(mailIndex);
    const messagesByAccount = allMessages.reduce((acc, msg) => {
      acc[msg.accountId] = (acc[msg.accountId] || 0) + 1;
      return acc;
    }, {});
    
    console.log(`   Messages: ${allMessages.length} total`);
    Object.entries(messagesByAccount).forEach(([accountId, count]) => {
      console.log(`     - Account ${accountId}: ${count} messages`);
    });

    // Check folders
    const allFolders = await db.select().from(accountFolders);
    const foldersByAccount = allFolders.reduce((acc, folder) => {
      acc[folder.accountId] = (acc[folder.accountId] || 0) + 1;
      return acc;
    }, {});
    
    console.log(`   Folders: ${allFolders.length} total`);
    if (Object.keys(foldersByAccount).length > 0) {
      Object.entries(foldersByAccount).forEach(([accountId, count]) => {
        console.log(`     - Account ${accountId}: ${count} folders`);
      });
    } else {
      console.log('     - No folders found');
    }

  } catch (error) {
    console.error('   Error showing state:', error.message);
  }
}

async function testInactiveAccountDeletion() {
  try {
    // Find an inactive account to delete
    const inactiveAccounts = await db.select()
      .from(accountConnections)
      .where(eq(accountConnections.isActive, false))
      .limit(1);

    if (inactiveAccounts.length === 0) {
      console.log('   ⏭️  No inactive accounts found - skipping test');
      return;
    }

    const account = inactiveAccounts[0];
    console.log(`   🎯 Testing deletion of: ${account.name} (${account.protocol})`);

    // Count related data before deletion
    const beforeMessages = await db.select().from(mailIndex).where(eq(mailIndex.accountId, account.id));
    const beforeFolders = await db.select().from(accountFolders).where(eq(accountFolders.accountId, account.id));

    console.log(`   📊 Before deletion: ${beforeMessages.length} messages, ${beforeFolders.length} folders`);

    // Delete the account
    await storage.deleteAccountConnection(account.id);

    // Verify cleanup
    const afterMessages = await db.select().from(mailIndex).where(eq(mailIndex.accountId, account.id));
    const afterFolders = await db.select().from(accountFolders).where(eq(accountFolders.accountId, account.id));
    const accountExists = await db.select().from(accountConnections).where(eq(accountConnections.id, account.id));

    console.log(`   📊 After deletion: ${afterMessages.length} messages, ${afterFolders.length} folders`);
    console.log(`   🗑️  Account record deleted: ${accountExists.length === 0 ? 'Yes' : 'No'}`);

    if (accountExists.length === 0 && afterMessages.length === 0 && afterFolders.length === 0) {
      console.log('   ✅ Inactive account deletion successful - complete cleanup verified');
    } else {
      throw new Error('Incomplete cleanup detected for inactive account');
    }

  } catch (error) {
    console.error('   ❌ Inactive account deletion test failed:', error.message);
    throw error;
  }
}

async function testImapAccountDeletion() {
  try {
    // Find an active IMAP account
    const { rows: imapAccounts } = await storage.db.execute(`
      SELECT id, name, protocol, is_active 
      FROM account_connections 
      WHERE protocol = 'IMAP' AND is_active = true 
      LIMIT 1
    `);

    if (imapAccounts.length === 0) {
      console.log('   ⏭️  No active IMAP accounts found - skipping test');
      return;
    }

    const account = imapAccounts[0];
    console.log(`   🎯 Testing deletion of IMAP account: ${account.name}`);

    // Get IMAP IDLE service and check if connection exists
    const idleService = getImapIdleService(storage);
    const hasIdleConnection = idleService.connections && idleService.connections.has(account.id);
    console.log(`   📡 IDLE connection active: ${hasIdleConnection ? 'Yes' : 'No'}`);

    // Count related data before deletion
    const { rows: beforeMessages } = await storage.db.execute(`
      SELECT COUNT(*) as count FROM mail_index WHERE account_id = ?
    `, [account.id]);

    console.log(`   📊 Before deletion: ${beforeMessages[0].count} messages`);

    // Simulate the complete deletion flow (same as routes.ts)
    console.log('   🔄 Stopping IDLE connection...');
    try {
      await idleService.stopIdleConnection(account.id);
      console.log('   ✅ IDLE connection cleanup completed');
    } catch (error) {
      console.log(`   ⚠️  IDLE cleanup failed (may be expected): ${error.message}`);
    }

    console.log('   🗑️  Deleting account record...');
    await storage.deleteAccountConnection(account.id);

    // Verify cleanup
    const { rows: afterMessages } = await storage.db.execute(`
      SELECT COUNT(*) as count FROM mail_index WHERE account_id = ?
    `, [account.id]);

    const { rows: accountExists } = await storage.db.execute(`
      SELECT COUNT(*) as count FROM account_connections WHERE id = ?
    `, [account.id]);

    const stillHasIdleConnection = idleService.connections && idleService.connections.has(account.id);

    console.log(`   📊 After deletion: ${afterMessages[0].count} messages`);
    console.log(`   🗑️  Account record deleted: ${accountExists[0].count === 0 ? 'Yes' : 'No'}`);
    console.log(`   📡 IDLE connection removed: ${!stillHasIdleConnection ? 'Yes' : 'No'}`);

    if (accountExists[0].count === 0 && afterMessages[0].count === 0 && !stillHasIdleConnection) {
      console.log('   ✅ IMAP account deletion successful - complete cleanup verified');
    } else {
      throw new Error('Incomplete cleanup detected for IMAP account');
    }

  } catch (error) {
    console.error('   ❌ IMAP account deletion test failed:', error.message);
    throw error;
  }
}

async function testEwsAccountDeletion() {
  try {
    // Find an active EWS account
    const { rows: ewsAccounts } = await storage.db.execute(`
      SELECT id, name, protocol, is_active 
      FROM account_connections 
      WHERE protocol = 'EWS' AND is_active = true 
      LIMIT 1
    `);

    if (ewsAccounts.length === 0) {
      console.log('   ⏭️  No active EWS accounts found - skipping test');
      return;
    }

    const account = ewsAccounts[0];
    console.log(`   🎯 Testing deletion of EWS account: ${account.name}`);

    // Get EWS push service and check if subscription exists
    const pushService = getEwsPushService(storage);
    const hasSubscription = pushService.subscriptions && pushService.subscriptions.has(account.id);
    console.log(`   🔔 Push subscription active: ${hasSubscription ? 'Yes' : 'No'}`);

    // Count related data before deletion
    const { rows: beforeMessages } = await storage.db.execute(`
      SELECT COUNT(*) as count FROM mail_index WHERE account_id = ?
    `, [account.id]);

    console.log(`   📊 Before deletion: ${beforeMessages[0].count} messages`);

    // Simulate the complete deletion flow (same as routes.ts)
    console.log('   🔄 Stopping push subscription...');
    try {
      await pushService.stopSubscription(account.id);
      console.log('   ✅ Push subscription cleanup completed');
    } catch (error) {
      console.log(`   ⚠️  Push subscription cleanup failed (may be expected): ${error.message}`);
    }

    console.log('   🗑️  Deleting account record...');
    await storage.deleteAccountConnection(account.id);

    // Verify cleanup
    const { rows: afterMessages } = await storage.db.execute(`
      SELECT COUNT(*) as count FROM mail_index WHERE account_id = ?
    `, [account.id]);

    const { rows: accountExists } = await storage.db.execute(`
      SELECT COUNT(*) as count FROM account_connections WHERE id = ?
    `, [account.id]);

    const stillHasSubscription = pushService.subscriptions && pushService.subscriptions.has(account.id);

    console.log(`   📊 After deletion: ${afterMessages[0].count} messages`);
    console.log(`   🗑️  Account record deleted: ${accountExists[0].count === 0 ? 'Yes' : 'No'}`);
    console.log(`   🔔 Push subscription removed: ${!stillHasSubscription ? 'Yes' : 'No'}`);

    if (accountExists[0].count === 0 && afterMessages[0].count === 0 && !stillHasSubscription) {
      console.log('   ✅ EWS account deletion successful - complete cleanup verified');
    } else {
      throw new Error('Incomplete cleanup detected for EWS account');
    }

  } catch (error) {
    console.error('   ❌ EWS account deletion test failed:', error.message);
    throw error;
  }
}

// Run the tests
testAccountDeletion().catch(console.error);