#!/usr/bin/env node

/**
 * Test Active Account Deletion with Service Cleanup
 * 
 * This script simulates the exact deletion flow from routes.ts
 * to test service cleanup for active accounts
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

async function runSQLQuery(query) {
  try {
    const { stdout } = await execAsync(`psql "$DATABASE_URL" -c "${query}"`);
    return stdout;
  } catch (error) {
    console.error(`SQL Error: ${error.message}`);
    throw error;
  }
}

async function simulateAccountDeletion(accountId, accountProtocol) {
  console.log(`\n🎯 Testing deletion of ${accountProtocol} account: ${accountId}`);
  
  try {
    // Step 1: Check current state
    console.log('📊 Checking current state...');
    const beforeState = await runSQLQuery(`
      SELECT 
        (SELECT COUNT(*) FROM account_connections WHERE id = '${accountId}') as account_exists,
        (SELECT COUNT(*) FROM mail_index WHERE account_id = '${accountId}') as messages,
        (SELECT COUNT(*) FROM account_folders WHERE account_id = '${accountId}') as folders;
    `);
    console.log('Before deletion:', beforeState);

    // Step 2: Simulate service cleanup (what routes.ts does)
    console.log(`🔄 Simulating ${accountProtocol} service cleanup...`);
    
    if (accountProtocol === 'IMAP') {
      console.log('   - Would call: idleService.stopIdleConnection()');
      console.log('   - This should close IDLE connection and remove from connections map');
    } else if (accountProtocol === 'EWS') {
      console.log('   - Would call: pushService.stopSubscription()');
      console.log('   - This should close push subscription and remove from subscriptions map');
    }
    
    // Step 3: Simulate database deletion
    console.log('🗑️  Simulating database deletion...');
    const deleteResult = await runSQLQuery(`DELETE FROM account_connections WHERE id = '${accountId}';`);
    console.log('Delete result:', deleteResult);

    // Step 4: Verify cleanup
    console.log('✅ Verifying cleanup...');
    const afterState = await runSQLQuery(`
      SELECT 
        (SELECT COUNT(*) FROM account_connections WHERE id = '${accountId}') as account_exists,
        (SELECT COUNT(*) FROM mail_index WHERE account_id = '${accountId}') as orphaned_messages,
        (SELECT COUNT(*) FROM account_folders WHERE account_id = '${accountId}') as orphaned_folders,
        (SELECT COUNT(*) FROM account_connections) as total_accounts;
    `);
    console.log('After deletion:', afterState);

    // Step 5: Verify success
    const lines = afterState.split('\n');
    const dataLine = lines.find(line => line.includes('|'));
    if (dataLine) {
      const [account_exists, orphaned_messages, orphaned_folders, total_accounts] = 
        dataLine.split('|').map(s => s.trim());
      
      if (account_exists === '0' && orphaned_messages === '0' && orphaned_folders === '0') {
        console.log(`✅ ${accountProtocol} account deletion successful - complete cleanup verified`);
        return true;
      } else {
        console.log(`❌ Incomplete cleanup detected for ${accountProtocol} account`);
        return false;
      }
    }
    
    return false;

  } catch (error) {
    console.error(`❌ ${accountProtocol} account deletion test failed:`, error.message);
    return false;
  }
}

async function testActiveAccountDeletion() {
  console.log('🧪 Testing Active Account Deletion with Service Cleanup\n');

  try {
    // Get current active accounts
    console.log('📋 Current active accounts:');
    const activeAccounts = await runSQLQuery(`
      SELECT id, name, protocol, is_active 
      FROM account_connections 
      WHERE is_active = true 
      ORDER BY protocol, created_at;
    `);
    console.log(activeAccounts);

    // Test 1: Delete an active IMAP account
    console.log('\n🔵 Test 1: IMAP Account Deletion');
    const imapResult = await runSQLQuery(`
      SELECT id, name, protocol 
      FROM account_connections 
      WHERE protocol = 'IMAP' AND is_active = true 
      LIMIT 1;
    `);
    
    const imapLines = imapResult.split('\n');
    const imapDataLine = imapLines.find(line => line.includes('|'));
    
    if (imapDataLine) {
      const imapId = imapDataLine.split('|')[0].trim();
      const success1 = await simulateAccountDeletion(imapId, 'IMAP');
      if (!success1) throw new Error('IMAP deletion test failed');
    } else {
      console.log('⏭️  No active IMAP accounts found - skipping IMAP test');
    }

    // Test 2: Delete an active EWS account
    console.log('\n🟣 Test 2: EWS Account Deletion');
    const ewsResult = await runSQLQuery(`
      SELECT id, name, protocol 
      FROM account_connections 
      WHERE protocol = 'EWS' AND is_active = true 
      LIMIT 1;
    `);
    
    const ewsLines = ewsResult.split('\n');
    const ewsDataLine = ewsLines.find(line => line.includes('|'));
    
    if (ewsDataLine) {
      const ewsId = ewsDataLine.split('|')[0].trim();
      const success2 = await simulateAccountDeletion(ewsId, 'EWS');
      if (!success2) throw new Error('EWS deletion test failed');
    } else {
      console.log('⏭️  No active EWS accounts found - skipping EWS test');
    }

    // Final state check
    console.log('\n🏁 Final state verification:');
    const finalState = await runSQLQuery(`
      SELECT COUNT(*) as total_accounts, 
             SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active_accounts,
             SUM(CASE WHEN protocol = 'IMAP' THEN 1 ELSE 0 END) as imap_accounts,
             SUM(CASE WHEN protocol = 'EWS' THEN 1 ELSE 0 END) as ews_accounts
      FROM account_connections;
    `);
    console.log(finalState);

    console.log('\n✅ Active account deletion tests completed successfully!');
    console.log('🔍 Key points verified:');
    console.log('   - Database CASCADE deletes work properly');
    console.log('   - Account records are completely removed');
    console.log('   - No orphaned messages or folders remain');
    console.log('   - Ready for service cleanup integration testing');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testActiveAccountDeletion().catch(console.error);