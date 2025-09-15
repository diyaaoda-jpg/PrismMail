import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Storage abstraction interface for attachment files
 * Supports local storage initially with cloud storage expansion capability
 */

export interface StorageConfig {
  type: 'local' | 's3' | 'gcs';
  basePath?: string; // For local storage
  bucketName?: string; // For cloud storage
  region?: string; // For cloud storage
  encryptionKey?: Buffer; // For server-side encryption
  credentials?: {
    accessKeyId?: string;
    secretAccessKey?: string;
    projectId?: string; // For GCS
  };
}

export interface StorageMetadata {
  filename: string;
  contentType: string;
  size: number;
  hash: string;
  encrypted: boolean;
  uploadedAt: Date;
  expiresAt?: Date;
}

export interface StorageUploadResult {
  success: boolean;
  storageKey: string;
  metadata: StorageMetadata;
  error?: string;
}

export interface StorageDownloadResult {
  success: boolean;
  data?: Buffer;
  stream?: fs.ReadStream;
  metadata?: StorageMetadata;
  signedUrl?: string; // For cloud storage
  error?: string;
}

export interface IStorageProvider {
  /**
   * Store a file with optional encryption
   */
  store(
    data: Buffer | fs.ReadStream,
    storageKey: string,
    metadata: Partial<StorageMetadata>
  ): Promise<StorageUploadResult>;

  /**
   * Retrieve a file with automatic decryption
   */
  retrieve(storageKey: string): Promise<StorageDownloadResult>;

  /**
   * Generate a signed URL for secure downloads (cloud providers)
   */
  generateSignedUrl(storageKey: string, expiresIn: number): Promise<string | null>;

  /**
   * Delete a file
   */
  delete(storageKey: string): Promise<{ success: boolean; error?: string }>;

  /**
   * Check if a file exists
   */
  exists(storageKey: string): Promise<boolean>;

  /**
   * Get file metadata without downloading
   */
  getMetadata(storageKey: string): Promise<StorageMetadata | null>;

  /**
   * Clean up expired files (for background jobs)
   */
  cleanupExpired(): Promise<{ deleted: number; errors: string[] }>;
}

/**
 * Secure local file system storage provider with encryption
 */
export class LocalStorageProvider implements IStorageProvider {
  private config: StorageConfig;
  private encryptionKey: Buffer;
  private algorithm = 'aes-256-gcm';

  constructor(config: StorageConfig) {
    this.config = config;
    
    // Use provided encryption key or generate one
    this.encryptionKey = config.encryptionKey || this.generateEncryptionKey();
    
    // Ensure base path exists and is secure
    this.ensureStorageDirectory();
  }

  private generateEncryptionKey(): Buffer {
    // In production, this should come from secure key management
    const keyMaterial = process.env.ATTACHMENT_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
    return crypto.scryptSync(keyMaterial, 'prismmail-salt', 32);
  }

  private ensureStorageDirectory(): void {
    const basePath = this.config.basePath || path.join(process.cwd(), 'storage', 'attachments');
    
    try {
      if (!fs.existsSync(basePath)) {
        fs.mkdirSync(basePath, { recursive: true, mode: 0o750 });
      }
      
      // Ensure proper permissions
      fs.chmodSync(basePath, 0o750);
      
      // Create metadata directory
      const metadataPath = path.join(basePath, '.metadata');
      if (!fs.existsSync(metadataPath)) {
        fs.mkdirSync(metadataPath, { mode: 0o750 });
      }
    } catch (error) {
      console.error('Failed to create storage directory:', error);
      throw new Error('Unable to initialize secure storage');
    }
  }

  private getFilePath(storageKey: string): string {
    const basePath = this.config.basePath || path.join(process.cwd(), 'storage', 'attachments');
    // Ensure the storage key doesn't contain path traversal attempts
    const sanitizedKey = storageKey.replace(/[\.\/\\]/g, '_');
    return path.join(basePath, sanitizedKey);
  }

  private getMetadataPath(storageKey: string): string {
    const basePath = this.config.basePath || path.join(process.cwd(), 'storage', 'attachments');
    const sanitizedKey = storageKey.replace(/[\.\/\\]/g, '_');
    return path.join(basePath, '.metadata', `${sanitizedKey}.json`);
  }

  private encrypt(data: Buffer): { encrypted: Buffer; iv: Buffer; tag: Buffer } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(this.algorithm, this.encryptionKey);
    cipher.setAAD(Buffer.from('prismmail-attachment'));
    
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    
    return { encrypted, iv, tag };
  }

  private decrypt(encryptedData: Buffer, iv: Buffer, tag: Buffer): Buffer {
    const decipher = crypto.createDecipher(this.algorithm, this.encryptionKey);
    decipher.setAAD(Buffer.from('prismmail-attachment'));
    decipher.setAuthTag(tag);
    
    return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  }

  async store(
    data: Buffer | fs.ReadStream,
    storageKey: string,
    metadata: Partial<StorageMetadata>
  ): Promise<StorageUploadResult> {
    try {
      const filePath = this.getFilePath(storageKey);
      const metadataPath = this.getMetadataPath(storageKey);
      
      // Ensure directory exists
      const fileDir = path.dirname(filePath);
      if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true, mode: 0o750 });
      }

      let fileData: Buffer;
      
      if (data instanceof Buffer) {
        fileData = data;
      } else {
        // Convert stream to buffer
        const chunks: Buffer[] = [];
        for await (const chunk of data) {
          chunks.push(chunk);
        }
        fileData = Buffer.concat(chunks);
      }

      // Calculate hash before encryption
      const hash = crypto.createHash('sha256').update(fileData).digest('hex');
      
      // Encrypt the file data
      const { encrypted, iv, tag } = this.encrypt(fileData);
      
      // Store encrypted file with IV and tag prepended
      const fileToStore = Buffer.concat([iv, tag, encrypted]);
      fs.writeFileSync(filePath, fileToStore, { mode: 0o640 });

      // Store metadata
      const fullMetadata: StorageMetadata = {
        filename: metadata.filename || 'unknown',
        contentType: metadata.contentType || 'application/octet-stream',
        size: fileData.length, // Store original size
        hash,
        encrypted: true,
        uploadedAt: new Date(),
        expiresAt: metadata.expiresAt
      };

      fs.writeFileSync(metadataPath, JSON.stringify(fullMetadata, null, 2), { mode: 0o640 });

      return {
        success: true,
        storageKey,
        metadata: fullMetadata
      };
    } catch (error) {
      console.error('Error storing file:', error);
      return {
        success: false,
        storageKey,
        metadata: {} as StorageMetadata,
        error: error.message
      };
    }
  }

  async retrieve(storageKey: string): Promise<StorageDownloadResult> {
    try {
      const filePath = this.getFilePath(storageKey);
      const metadataPath = this.getMetadataPath(storageKey);

      if (!fs.existsSync(filePath) || !fs.existsSync(metadataPath)) {
        return {
          success: false,
          error: 'File not found'
        };
      }

      // Load metadata
      const metadataJson = fs.readFileSync(metadataPath, 'utf8');
      const metadata: StorageMetadata = JSON.parse(metadataJson);

      // Check if file has expired
      if (metadata.expiresAt && new Date() > new Date(metadata.expiresAt)) {
        return {
          success: false,
          error: 'File has expired'
        };
      }

      // Read encrypted file
      const encryptedFile = fs.readFileSync(filePath);
      
      // Extract IV, tag, and encrypted data
      const iv = encryptedFile.slice(0, 16);
      const tag = encryptedFile.slice(16, 32);
      const encrypted = encryptedFile.slice(32);

      // Decrypt
      const decrypted = this.decrypt(encrypted, iv, tag);

      return {
        success: true,
        data: decrypted,
        metadata
      };
    } catch (error) {
      console.error('Error retrieving file:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async generateSignedUrl(storageKey: string, expiresIn: number): Promise<string | null> {
    // Local storage doesn't support signed URLs
    // Files are served through the API with proper authentication
    return null;
  }

  async delete(storageKey: string): Promise<{ success: boolean; error?: string }> {
    try {
      const filePath = this.getFilePath(storageKey);
      const metadataPath = this.getMetadataPath(storageKey);

      // Delete both file and metadata
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      
      if (fs.existsSync(metadataPath)) {
        fs.unlinkSync(metadataPath);
      }

      return { success: true };
    } catch (error) {
      console.error('Error deleting file:', error);
      return { success: false, error: error.message };
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    const filePath = this.getFilePath(storageKey);
    const metadataPath = this.getMetadataPath(storageKey);
    return fs.existsSync(filePath) && fs.existsSync(metadataPath);
  }

  async getMetadata(storageKey: string): Promise<StorageMetadata | null> {
    try {
      const metadataPath = this.getMetadataPath(storageKey);
      
      if (!fs.existsSync(metadataPath)) {
        return null;
      }

      const metadataJson = fs.readFileSync(metadataPath, 'utf8');
      return JSON.parse(metadataJson);
    } catch (error) {
      console.error('Error reading metadata:', error);
      return null;
    }
  }

  async cleanupExpired(): Promise<{ deleted: number; errors: string[] }> {
    const errors: string[] = [];
    let deleted = 0;

    try {
      const basePath = this.config.basePath || path.join(process.cwd(), 'storage', 'attachments');
      const metadataDir = path.join(basePath, '.metadata');
      
      if (!fs.existsSync(metadataDir)) {
        return { deleted: 0, errors: [] };
      }

      const metadataFiles = fs.readdirSync(metadataDir);
      const now = new Date();

      for (const metadataFile of metadataFiles) {
        if (!metadataFile.endsWith('.json')) continue;

        try {
          const metadataPath = path.join(metadataDir, metadataFile);
          const metadataJson = fs.readFileSync(metadataPath, 'utf8');
          const metadata: StorageMetadata = JSON.parse(metadataJson);

          if (metadata.expiresAt && now > new Date(metadata.expiresAt)) {
            const storageKey = path.basename(metadataFile, '.json');
            const result = await this.delete(storageKey);
            
            if (result.success) {
              deleted++;
            } else {
              errors.push(`Failed to delete expired file ${storageKey}: ${result.error}`);
            }
          }
        } catch (error) {
          errors.push(`Failed to process metadata file ${metadataFile}: ${error.message}`);
        }
      }
    } catch (error) {
      errors.push(`Failed to cleanup expired files: ${error.message}`);
    }

    return { deleted, errors };
  }
}

/**
 * Factory function to create storage provider based on configuration
 */
export function createStorageProvider(config: StorageConfig): IStorageProvider {
  switch (config.type) {
    case 'local':
      return new LocalStorageProvider(config);
    case 's3':
      throw new Error('S3 storage provider not yet implemented');
    case 'gcs':
      throw new Error('GCS storage provider not yet implemented');
    default:
      throw new Error(`Unsupported storage type: ${config.type}`);
  }
}

// Default configuration for local development and production
export const defaultStorageConfig: StorageConfig = {
  type: 'local',
  basePath: process.env.ATTACHMENT_STORAGE_PATH || path.join(process.cwd(), 'storage', 'attachments'),
  encryptionKey: process.env.ATTACHMENT_ENCRYPTION_KEY ? 
    crypto.scryptSync(process.env.ATTACHMENT_ENCRYPTION_KEY, 'prismmail-salt', 32) : 
    undefined
};