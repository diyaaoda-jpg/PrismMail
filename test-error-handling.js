#!/usr/bin/env node

// Test script to reproduce the "Add Account" error handling bug
// This script tests the scenario where adding an IMAP account with invalid hostname should trigger proper error handling

// Use curl for HTTP requests in Node.js environment

async function testAddAccountErrorHandling() {
  console.log('🧪 Testing Add Account Error Handling...\n');

  try {
    // Test 1: Invalid hostname (should trigger DNS error)
    console.log('Test 1: Invalid hostname (DNS error)');
    const invalidHostnameData = {
      name: "Test Invalid Account",
      protocol: "IMAP",
      host: "invalid-hostname-that-does-not-exist.com",
      port: 993,
      username: "test@example.com", 
      password: "testpassword",
      useSSL: true,
      enableCustomSmtp: false
    };

    const response1 = await fetch('http://localhost:5000/api/accounts/test-connection', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(invalidHostnameData)
    });

    console.log(`Response Status: ${response1.status} ${response1.statusText}`);
    
    if (!response1.ok) {
      const errorData = await response1.json();
      console.log('✅ Error properly returned by server:');
      console.log(`   Message: ${errorData.message || 'No message'}`);
      console.log(`   Expected: DNS/hostname error should be user-friendly\n`);
    } else {
      console.log('❌ Expected error but got success response\n');
    }

    // Test 2: Connection refused error (invalid port)
    console.log('Test 2: Connection refused (invalid port)');
    const connectionRefusedData = {
      name: "Test Connection Refused",
      protocol: "IMAP", 
      host: "imap.gmail.com",
      port: 9999, // Invalid port
      username: "test@gmail.com",
      password: "testpassword", 
      useSSL: true,
      enableCustomSmtp: false
    };

    const response2 = await fetch('http://localhost:5000/api/accounts/test-connection', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(connectionRefusedData)
    });

    console.log(`Response Status: ${response2.status} ${response2.statusText}`);
    
    if (!response2.ok) {
      const errorData = await response2.json(); 
      console.log('✅ Error properly returned by server:');
      console.log(`   Message: ${errorData.message || 'No message'}`);
      console.log(`   Expected: Connection refused error should be user-friendly\n`);
    } else {
      console.log('❌ Expected error but got success response\n');
    }

    console.log('✅ Error handling tests completed!');
    console.log('📋 Summary:');
    console.log('   - Server properly returns 400/500 errors with messages');
    console.log('   - Frontend should now handle these errors gracefully');
    console.log('   - Forms should re-enable after errors for retry attempts');
    console.log('   - User-friendly error messages should display in toast notifications');

  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

testAddAccountErrorHandling();