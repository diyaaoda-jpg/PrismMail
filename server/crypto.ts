import { randomBytes, createCipherGCM, createDecipherGCM } from "crypto";

const ALGORITHM = "aes-256-gcm";

// Generate or get encryption key from environment
function getEncryptionKey(): Buffer {
  const keyFromEnv = process.env.ENCRYPTION_KEY;
  
  if (keyFromEnv) {
    return Buffer.from(keyFromEnv, "hex");
  }
  
  // Generate a new key for development
  const newKey = randomBytes(32);
  console.warn("⚠️  ENCRYPTION_KEY not found in environment. Generated temporary key:", newKey.toString("hex"));
  console.warn("⚠️  Add ENCRYPTION_KEY to your environment for persistent encryption:");
  console.warn(`   export ENCRYPTION_KEY=${newKey.toString("hex")}`);
  
  return newKey;
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
    const cipher = createCipherGCM(ALGORITHM, ENCRYPTION_KEY);
    
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
    const decipher = createDecipherGCM(ALGORITHM, ENCRYPTION_KEY);
    
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
 * @param settings - The account settings object
 * @returns Encrypted settings as JSON string
 */
export function encryptAccountSettings(settings: {
  host: string;
  port: number;
  username: string;
  password: string;
  useSSL: boolean;
}): string {
  const plaintext = JSON.stringify(settings);
  const encrypted = encrypt(plaintext);
  return JSON.stringify(encrypted);
}

/**
 * Decrypts account settings from secure storage
 * @param encryptedJson - The encrypted settings JSON string
 * @returns The decrypted settings object (WITHOUT the password for security)
 */
export function decryptAccountSettings(encryptedJson: string): {
  host: string;
  port: number;
  username: string;
  useSSL: boolean;
} {
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
export function decryptAccountSettingsWithPassword(encryptedJson: string): {
  host: string;
  port: number;
  username: string;
  password: string;
  useSSL: boolean;
} {
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
    decrypt(encryptedData.encrypted);
    return true;
  } catch {
    return false;
  }
}