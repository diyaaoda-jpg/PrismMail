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
   * Store a file
   */
  store(
    data: Buffer | fs.ReadStream,
    storageKey: string,
    metadata: Partial<StorageMetadata>
  ): Promise<StorageUploadResult>;

  /**
   * Retrieve a file
   */
  retrieve(storageKey: string): Promise<StorageDownloadResult>;

  /**
   * Get a readable stream for the file (for memory efficiency)
   */
  retrieveStream?(storageKey: string): Promise<StorageDownloadResult>;

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
 * Simple local file system storage provider (no encryption)
 */
export class LocalStorageProvider implements IStorageProvider {
  private config: StorageConfig;

  constructor(config: StorageConfig) {
    this.config = config;
    
    // Ensure base path exists and is secure
    this.ensureStorageDirectory();
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
      throw new Error('Unable to initialize storage');
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

      // Calculate hash
      const hash = crypto.createHash('sha256').update(fileData).digest('hex');
      
      // Store file directly (no encryption)
      fs.writeFileSync(filePath, fileData, { mode: 0o640 });

      // Store metadata
      const fullMetadata: StorageMetadata = {
        filename: metadata.filename || 'unknown',
        contentType: metadata.contentType || 'application/octet-stream',
        size: fileData.length,
        hash,
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

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: 'File not found'
        };
      }

      // Read file directly (no decryption needed)
      const data = fs.readFileSync(filePath);
      
      // Read metadata if available
      let metadata: StorageMetadata | undefined;
      if (fs.existsSync(metadataPath)) {
        try {
          const metadataContent = fs.readFileSync(metadataPath, 'utf8');
          metadata = JSON.parse(metadataContent);
        } catch (error) {
          console.warn('Failed to read metadata:', error);
        }
      }

      return {
        success: true,
        data,
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

  async retrieveStream(storageKey: string): Promise<StorageDownloadResult> {
    try {
      const filePath = this.getFilePath(storageKey);
      const metadataPath = this.getMetadataPath(storageKey);

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: 'File not found'
        };
      }

      // Create read stream
      const stream = fs.createReadStream(filePath);
      
      // Read metadata if available
      let metadata: StorageMetadata | undefined;
      if (fs.existsSync(metadataPath)) {
        try {
          const metadataContent = fs.readFileSync(metadataPath, 'utf8');
          metadata = JSON.parse(metadataContent);
        } catch (error) {
          console.warn('Failed to read metadata:', error);
        }
      }

      return {
        success: true,
        stream,
        metadata
      };
    } catch (error) {
      console.error('Error creating file stream:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async generateSignedUrl(storageKey: string, expiresIn: number): Promise<string | null> {
    // Local storage doesn't support signed URLs
    return null;
  }

  async delete(storageKey: string): Promise<{ success: boolean; error?: string }> {
    try {
      const filePath = this.getFilePath(storageKey);
      const metadataPath = this.getMetadataPath(storageKey);

      // Delete file if it exists
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Delete metadata if it exists
      if (fs.existsSync(metadataPath)) {
        fs.unlinkSync(metadataPath);
      }

      return { success: true };
    } catch (error) {
      console.error('Error deleting file:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      const filePath = this.getFilePath(storageKey);
      return fs.existsSync(filePath);
    } catch (error) {
      console.error('Error checking file existence:', error);
      return false;
    }
  }

  async getMetadata(storageKey: string): Promise<StorageMetadata | null> {
    try {
      const metadataPath = this.getMetadataPath(storageKey);
      
      if (!fs.existsSync(metadataPath)) {
        return null;
      }

      const metadataContent = fs.readFileSync(metadataPath, 'utf8');
      return JSON.parse(metadataContent);
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
      const metadataPath = path.join(basePath, '.metadata');
      
      if (!fs.existsSync(metadataPath)) {
        return { deleted: 0, errors: [] };
      }

      const metadataFiles = fs.readdirSync(metadataPath);
      const now = new Date();

      for (const metadataFile of metadataFiles) {
        try {
          const metadataFilePath = path.join(metadataPath, metadataFile);
          const metadataContent = fs.readFileSync(metadataFilePath, 'utf8');
          const metadata = JSON.parse(metadataContent);

          if (metadata.expiresAt && new Date(metadata.expiresAt) < now) {
            // Extract storage key from metadata filename
            const storageKey = metadataFile.replace('.json', '');
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

      return { deleted, errors };
    } catch (error) {
      console.error('Error during cleanup:', error);
      return { deleted, errors: [error.message] };
    }
  }
}

/**
 * Factory function to create storage provider based on config
 */
export function createStorageProvider(config: StorageConfig): IStorageProvider {
  switch (config.type) {
    case 'local':
      return new LocalStorageProvider(config);
    case 's3':
      // TODO: Implement S3 storage provider
      throw new Error('S3 storage provider not yet implemented');
    case 'gcs':
      // TODO: Implement Google Cloud Storage provider
      throw new Error('GCS storage provider not yet implemented');
    default:
      throw new Error(`Unsupported storage type: ${config.type}`);
  }
}

/**
 * Default storage configuration
 */
export const defaultStorageConfig: StorageConfig = {
  type: 'local',
  basePath: path.join(process.cwd(), 'storage', 'attachments')
};