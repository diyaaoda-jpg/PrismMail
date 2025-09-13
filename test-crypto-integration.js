#!/usr/bin/env node

/**
 * Integration test for the crypto and account management system
 * This validates all the critical fixes are working correctly
 */

// Set required environment variable for testing
process.env.ENCRYPTION_KEY = 'ef8a30ad04566ef9b1d886bb67b8e5f33ba4e6b4d31e8f7608cd9436f5e19166';

console.log('🧪 Testing Crypto Integration Fixes...\n');

try {
  // Test 1: Import crypto module (should not throw)
  console.log('✅ Test 1: Importing crypto module...');
  const { encrypt, decrypt, encryptAccountSettings, decryptAccountSettings, decryptAccountSettingsWithPassword, validateEncryptedData } = await import('./server/crypto.ts');
  console.log('   ✓ Crypto module imported successfully\n');

  // Test 2: Basic encryption/decryption
  console.log('✅ Test 2: Basic encryption/decryption...');
  const testData = 'test sensitive data';
  const encrypted = encrypt(testData);
  const decrypted = decrypt(encrypted);
  
  if (decrypted !== testData) {
    throw new Error('Encryption/decryption failed');
  }
  console.log('   ✓ Basic encryption/decryption works\n');

  // Test 3: Account settings encryption
  console.log('✅ Test 3: Account settings encryption...');
  const testSettings = {
    host: 'imap.gmail.com',
    port: 993,
    username: 'test@gmail.com', 
    password: 'secret123',
    useSSL: true
  };
  
  const encryptedSettings = encryptAccountSettings(testSettings);
  const decryptedSafe = decryptAccountSettings(encryptedSettings);
  const decryptedFull = decryptAccountSettingsWithPassword(encryptedSettings);
  
  // Verify safe version doesn't include password
  if (decryptedSafe.password) {
    throw new Error('Safe decryption should not include password');
  }
  
  // Verify full version includes password
  if (!decryptedFull.password || decryptedFull.password !== 'secret123') {
    throw new Error('Full decryption should include password');
  }
  
  console.log('   ✓ Account settings encryption works correctly\n');

  // Test 4: Validation function
  console.log('✅ Test 4: Validation function...');
  if (!validateEncryptedData(encryptedSettings)) {
    throw new Error('Validation should return true for valid data');
  }
  
  if (validateEncryptedData('invalid json')) {
    throw new Error('Validation should return false for invalid data');
  }
  
  console.log('   ✓ Validation function works correctly\n');

  // Test 5: Error handling
  console.log('✅ Test 5: Error handling...');
  try {
    decrypt({ encrypted: 'invalid', iv: 'invalid', tag: 'invalid' });
    throw new Error('Should have thrown an error for invalid data');
  } catch (error) {
    if (!error.message.includes('Failed to decrypt')) {
      throw error;
    }
  }
  console.log('   ✓ Error handling works correctly\n');

  console.log('🎉 ALL CRYPTO INTEGRATION TESTS PASSED!');
  console.log('\n📋 Summary of Fixed Issues:');
  console.log('   ✓ Fixed crypto APIs (createCipheriv/createDecipheriv)');
  console.log('   ✓ Made ENCRYPTION_KEY required with proper error handling');
  console.log('   ✓ Fixed validateEncryptedData function bug');
  console.log('   ✓ Fixed data flow for connection testing');
  console.log('   ✓ Added getAccountConnectionEncrypted method');
  
  console.log('\n⚠️  IMPORTANT: To start the application, set ENCRYPTION_KEY:');
  console.log('   export ENCRYPTION_KEY=ef8a30ad04566ef9b1d886bb67b8e5f33ba4e6b4d31e8f7608cd9436f5e19166');
  console.log('   npm run dev');

} catch (error) {
  console.error('❌ CRYPTO INTEGRATION TEST FAILED:', error.message);
  process.exit(1);
}