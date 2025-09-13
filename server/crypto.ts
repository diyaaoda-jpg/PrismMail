import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGORITHM = "aes-256-gcm";

// Get encryption key from environment - required for security
function getEncryptionKey(): Buffer {
  const keyFromEnv = process.env.ENCRYPTION_KEY;
  
  if (!keyFromEnv) {
    const suggestionKey = randomBytes(32).toString("hex");
    console.error("❌ ENCRYPTION_KEY environment variable is required!");
    console.error("   Set this environment variable to secure your email credentials:");
    console.error(`   export ENCRYPTION_KEY=${suggestionKey}`);
    console.error("   Without this key, the application cannot securely store passwords.");
    throw new Error("ENCRYPTION_KEY environment variable is required for secure operation");
  }
  
  try {
    const key = Buffer.from(keyFromEnv, "hex");
    if (key.length !== 32) {
      throw new Error("ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters)");
    }
    return key;
  } catch (error) {
    console.error("❌ Invalid ENCRYPTION_KEY format:", error);
    throw new Error("ENCRYPTION_KEY must be a valid 64-character hex string");
  }
}

const ENCRYPTION_KEY = getEncryptionKey();

export interface EncryptedData {
  encrypted: string;
  iv: string;
  tag: string;
}

/**
 * Encrypts sensitive data using AES-256-GCM
 * @param plaintext - The data to encrypt
 * @returns Object containing encrypted data, IV, and authentication tag
 */
export function encrypt(plaintext: string): EncryptedData {
  try {
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    
    cipher.setAAD(Buffer.from("prismmail-credentials"));
    
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    
    const tag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
    };
  } catch (error) {
    console.error("Encryption failed:", error);
    throw new Error("Failed to encrypt credentials");
  }
}

/**
 * Decrypts data encrypted with the encrypt function
 * @param data - The encrypted data object
 * @returns The decrypted plaintext
 */
export function decrypt(data: EncryptedData): string {
  try {
    const iv = Buffer.from(data.iv, "hex");
    const decipher = createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    
    decipher.setAuthTag(Buffer.from(data.tag, "hex"));
    decipher.setAAD(Buffer.from("prismmail-credentials"));
    
    let decrypted = decipher.update(data.encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    
    return decrypted;
  } catch (error) {
    console.error("Decryption failed:", error);
    throw new Error("Failed to decrypt credentials - data may be corrupted or key changed");
  }
}

/**
 * Encrypts email account settings for secure storage
 * @param settings - The account settings object (IMAP or EWS format)
 * @returns Encrypted settings as JSON string
 */
export function encryptAccountSettings(settings: any): string {
  const plaintext = JSON.stringify(settings);
  const encrypted = encrypt(plaintext);
  return JSON.stringify(encrypted);
}

/**
 * Decrypts account settings from secure storage
 * @param encryptedJson - The encrypted settings JSON string
 * @returns The decrypted settings object (WITHOUT the password for security)
 */
export function decryptAccountSettings(encryptedJson: string): any {
  try {
    const encryptedData: EncryptedData = JSON.parse(encryptedJson);
    const decryptedJson = decrypt(encryptedData);
    const settings = JSON.parse(decryptedJson);
    
    // Remove password from returned object for security
    const { password, ...safeSettings } = settings;
    return safeSettings;
  } catch (error) {
    console.error("Failed to decrypt account settings:", error);
    throw new Error("Failed to decrypt account settings");
  }
}

/**
 * Decrypts account settings including password (for internal use only)
 * @param encryptedJson - The encrypted settings JSON string
 * @returns The full decrypted settings object including password
 */
export function decryptAccountSettingsWithPassword(encryptedJson: string): any {
  try {
    const encryptedData: EncryptedData = JSON.parse(encryptedJson);
    const decryptedJson = decrypt(encryptedData);
    return JSON.parse(decryptedJson);
  } catch (error) {
    console.error("Failed to decrypt account settings with password:", error);
    throw new Error("Failed to decrypt account settings");
  }
}

/**
 * Validates that encrypted data can be successfully decrypted
 * @param encryptedJson - The encrypted data to test
 * @returns True if valid and can be decrypted
 */
export function validateEncryptedData(encryptedJson: string): boolean {
  try {
    const encryptedData: EncryptedData = JSON.parse(encryptedJson);
    decrypt(encryptedData);
    return true;
  } catch {
    return false;
  }
}