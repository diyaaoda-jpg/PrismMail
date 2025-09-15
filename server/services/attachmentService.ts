import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { promisify } from 'util';
import { pipeline } from 'stream';
import multer from 'multer';
import { Request } from 'express';
import { storage } from '../storage';
import { type InsertEmailAttachment, type EmailAttachment } from '@shared/schema';

const streamPipeline = promisify(pipeline);

/**
 * Comprehensive attachment management service for production email client
 * 
 * Features:
 * - Secure file upload with validation
 * - File type and size restrictions
 * - Virus scan preparation
 * - User authorization and multi-tenant security
 * - Deduplication support
 * - Cleanup and lifecycle management
 */

export interface AttachmentUploadResult {
  success: boolean;
  attachments?: EmailAttachment[];
  errors?: string[];
  totalSize?: number;
  rejectedFiles?: Array<{
    filename: string;
    reason: string;
    size?: number;
    mimeType?: string;
  }>;
}

export interface AttachmentDownloadInfo {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  storagePath: string;
  downloadCount: number;
  isActive: boolean;
}

export interface AttachmentValidationConfig {
  maxFileSize: number; // bytes
  maxTotalSize: number; // bytes
  maxFilesPerUpload: number;
  allowedMimeTypes: string[];
  allowedExtensions: string[];
  requiredVirusScan: boolean;
}

// Default secure configuration
const DEFAULT_CONFIG: AttachmentValidationConfig = {
  maxFileSize: 26214400, // 25MB per file
  maxTotalSize: 104857600, // 100MB total per email
  maxFilesPerUpload: 10,
  allowedMimeTypes: [
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'application/json',
    'application/xml',
    'text/xml',
    'application/rtf',
    'text/calendar',
    // Images
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/bmp',
    'image/webp',
    'image/tiff',
    // Archives (commonly needed)
    'application/zip',
    'application/x-rar-compressed',
    'application/x-7z-compressed'
  ],
  allowedExtensions: [
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.txt', '.csv', '.json', '.xml', '.rtf', '.ics',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff',
    '.zip', '.rar', '.7z'
  ],
  requiredVirusScan: false // Set to true when virus scanner is integrated
};

class AttachmentService {
  private config: AttachmentValidationConfig;
  private uploadDir: string;

  constructor(config: Partial<AttachmentValidationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.uploadDir = process.env.ATTACHMENT_STORAGE_DIR || '/tmp/prismmail-attachments';
    this.ensureUploadDirectoryExists();
  }

  /**
   * Ensure upload directory exists with proper permissions
   */
  private ensureUploadDirectoryExists(): void {
    try {
      if (!fs.existsSync(this.uploadDir)) {
        fs.mkdirSync(this.uploadDir, { recursive: true, mode: 0o750 });
      }
      
      // Create year/month subdirectories for organization
      const now = new Date();
      const yearMonth = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
      const monthDir = path.join(this.uploadDir, yearMonth);
      
      if (!fs.existsSync(monthDir)) {
        fs.mkdirSync(monthDir, { recursive: true, mode: 0o750 });
      }
    } catch (error) {
      console.error('Failed to create attachment upload directory:', error);
      throw new Error('Unable to initialize attachment storage');
    }
  }

  /**
   * Generate secure file path with deduplication support
   */
  private generateSecureFilePath(originalFilename: string, userId: string): string {
    const ext = path.extname(originalFilename).toLowerCase();
    const basename = path.basename(originalFilename, ext);
    const sanitizedBasename = basename.replace(/[^a-zA-Z0-9._-]/g, '_');
    
    // Generate unique ID for the file
    const fileId = crypto.randomUUID();
    const timestamp = Date.now();
    
    // Organize by year/month for better file system performance
    const now = new Date();
    const yearMonth = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    // Create secure filename: {userId}_{timestamp}_{fileId}_{sanitizedName}{ext}
    const secureFilename = `${userId}_${timestamp}_${fileId}_${sanitizedBasename}${ext}`;
    
    return path.join(this.uploadDir, yearMonth, secureFilename);
  }

  /**
   * Calculate file hash for deduplication and integrity
   */
  private async calculateFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Validate file against security and business rules
   */
  private validateFile(file: Express.Multer.File): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // File size validation
    if (file.size > this.config.maxFileSize) {
      errors.push(`File "${file.originalname}" exceeds maximum size of ${Math.round(this.config.maxFileSize / 1024 / 1024)}MB`);
    }

    if (file.size === 0) {
      errors.push(`File "${file.originalname}" is empty`);
    }

    // MIME type validation (primary security check)
    if (!this.config.allowedMimeTypes.includes(file.mimetype.toLowerCase())) {
      errors.push(`File type "${file.mimetype}" is not allowed for file "${file.originalname}"`);
    }

    // File extension validation (secondary security check)
    const ext = path.extname(file.originalname).toLowerCase();
    if (!this.config.allowedExtensions.includes(ext)) {
      errors.push(`File extension "${ext}" is not allowed for file "${file.originalname}"`);
    }

    // Filename validation
    if (file.originalname.length > 255) {
      errors.push(`Filename "${file.originalname}" is too long (max 255 characters)`);
    }

    // Basic security check for dangerous filenames
    const dangerousPatterns = [
      /\.(exe|bat|cmd|com|scr|pif|vbs|js|jar|wsf)$/i,
      /\.\./,
      /[<>:"|?*]/,
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(file.originalname)) {
        errors.push(`Filename "${file.originalname}" contains unsafe characters or patterns`);
        break;
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Prepare file for virus scanning (placeholder for future ClamAV integration)
   */
  private async performVirusScan(filePath: string): Promise<{ status: 'clean' | 'infected' | 'error' | 'skipped'; result?: string }> {
    // TODO: Integrate with ClamAV or similar virus scanner
    // For now, return skipped status
    if (!this.config.requiredVirusScan) {
      return { status: 'skipped' };
    }

    // Placeholder implementation - in production, integrate with actual virus scanner
    try {
      // const scanResult = await clamav.scanFile(filePath);
      return { status: 'clean', result: 'File scan passed (placeholder)' };
    } catch (error) {
      console.error('Virus scan failed:', error);
      return { status: 'error', result: `Scan failed: ${error.message}` };
    }
  }

  /**
   * Process and store uploaded file securely
   */
  async processUploadedFile(
    file: Express.Multer.File,
    userId: string,
    accountId: string,
    draftId?: string
  ): Promise<{ attachment?: EmailAttachment; errors: string[] }> {
    const errors: string[] = [];

    try {
      // Validate file
      const validation = this.validateFile(file);
      if (!validation.isValid) {
        return { errors: validation.errors };
      }

      // Generate secure storage path
      const storagePath = this.generateSecureFilePath(file.originalname, userId);
      
      // Ensure directory exists
      const storageDir = path.dirname(storagePath);
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true, mode: 0o750 });
      }

      // Move file to secure location
      if (file.path) {
        // File was uploaded to temporary location, move it
        fs.renameSync(file.path, storagePath);
      } else if (file.buffer) {
        // File is in memory buffer, write it
        fs.writeFileSync(storagePath, file.buffer, { mode: 0o640 });
      } else {
        throw new Error('No file data available');
      }

      // Calculate file hash for integrity and deduplication
      const fileHash = await this.calculateFileHash(storagePath);

      // Perform virus scan
      const virusScanResult = await this.performVirusScan(storagePath);
      
      if (virusScanResult.status === 'infected') {
        // Delete infected file immediately
        fs.unlinkSync(storagePath);
        return { errors: [`File "${file.originalname}" failed virus scan and was removed`] };
      }

      // Generate upload token for verification
      const uploadToken = crypto.randomBytes(32).toString('hex');

      // Sanitize filename for storage
      const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9._\-\s()]/g, '_');

      // Create attachment record
      const attachmentData: InsertEmailAttachment = {
        userId,
        accountId,
        filename: sanitizedFilename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        storagePath,
        uploadToken,
        fileHash,
        draftId,
        virusScanStatus: virusScanResult.status,
        virusScanResult: virusScanResult.result,
        isActive: true,
        isOrphaned: !draftId, // Mark as orphaned if not associated with draft
        expiresAt: !draftId ? new Date(Date.now() + 24 * 60 * 60 * 1000) : undefined // 24h expiry for orphaned files
      };

      const attachment = await storage.createEmailAttachment(attachmentData);

      return { attachment, errors: [] };

    } catch (error) {
      console.error('Error processing uploaded file:', error);
      
      // Cleanup on error
      if (file.path && fs.existsSync(file.path)) {
        try {
          fs.unlinkSync(file.path);
        } catch (cleanupError) {
          console.error('Error cleaning up failed upload:', cleanupError);
        }
      }

      return { errors: [`Failed to process file "${file.originalname}": ${error.message}`] };
    }
  }

  /**
   * Process multiple uploaded files with total size validation
   */
  async processMultipleFiles(
    files: Express.Multer.File[],
    userId: string,
    accountId: string,
    draftId?: string
  ): Promise<AttachmentUploadResult> {
    const results: EmailAttachment[] = [];
    const errors: string[] = [];
    const rejectedFiles: AttachmentUploadResult['rejectedFiles'] = [];

    // Validate total file count
    if (files.length > this.config.maxFilesPerUpload) {
      return {
        success: false,
        errors: [`Cannot upload more than ${this.config.maxFilesPerUpload} files at once`]
      };
    }

    // Validate total size
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > this.config.maxTotalSize) {
      return {
        success: false,
        errors: [`Total file size (${Math.round(totalSize / 1024 / 1024)}MB) exceeds maximum of ${Math.round(this.config.maxTotalSize / 1024 / 1024)}MB`]
      };
    }

    // Process each file
    for (const file of files) {
      try {
        const result = await this.processUploadedFile(file, userId, accountId, draftId);
        
        if (result.attachment) {
          results.push(result.attachment);
        }
        
        if (result.errors.length > 0) {
          errors.push(...result.errors);
          rejectedFiles.push({
            filename: file.originalname,
            reason: result.errors.join(', '),
            size: file.size,
            mimeType: file.mimetype
          });
        }
      } catch (error) {
        const errorMessage = `Failed to process ${file.originalname}: ${error.message}`;
        errors.push(errorMessage);
        rejectedFiles.push({
          filename: file.originalname,
          reason: errorMessage,
          size: file.size,
          mimeType: file.mimetype
        });
      }
    }

    return {
      success: results.length > 0,
      attachments: results,
      errors: errors.length > 0 ? errors : undefined,
      totalSize,
      rejectedFiles: rejectedFiles.length > 0 ? rejectedFiles : undefined
    };
  }

  /**
   * Get attachment for secure download
   */
  async getAttachmentForDownload(attachmentId: string, userId: string): Promise<AttachmentDownloadInfo | null> {
    try {
      const attachment = await storage.getEmailAttachmentWithOwnership(attachmentId, userId);
      
      if (!attachment || !attachment.isActive) {
        return null;
      }

      // Verify file exists on disk
      if (!fs.existsSync(attachment.storagePath)) {
        console.error(`Attachment file not found: ${attachment.storagePath}`);
        return null;
      }

      // Update download count
      await storage.updateEmailAttachment(attachmentId, {
        downloadCount: attachment.downloadCount + 1,
        lastDownloaded: new Date()
      });

      return {
        id: attachment.id,
        filename: attachment.filename,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        storagePath: attachment.storagePath,
        downloadCount: attachment.downloadCount + 1,
        isActive: attachment.isActive
      };
    } catch (error) {
      console.error('Error getting attachment for download:', error);
      return null;
    }
  }

  /**
   * Delete attachment and associated file
   */
  async deleteAttachment(attachmentId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const attachment = await storage.getEmailAttachmentWithOwnership(attachmentId, userId);
      
      if (!attachment) {
        return { success: false, error: 'Attachment not found or access denied' };
      }

      // Delete file from disk
      if (fs.existsSync(attachment.storagePath)) {
        try {
          fs.unlinkSync(attachment.storagePath);
        } catch (fileError) {
          console.error('Error deleting attachment file:', fileError);
          // Continue with database deletion even if file deletion fails
        }
      }

      // Soft delete in database
      await storage.deleteEmailAttachment(attachmentId);

      return { success: true };
    } catch (error) {
      console.error('Error deleting attachment:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Associate attachment with draft or email
   */
  async associateWithDraft(attachmentId: string, draftId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const attachment = await storage.getEmailAttachmentWithOwnership(attachmentId, userId);
      
      if (!attachment) {
        return { success: false, error: 'Attachment not found or access denied' };
      }

      await storage.updateEmailAttachment(attachmentId, {
        draftId,
        isOrphaned: false,
        expiresAt: null // Remove expiration when associated
      });

      return { success: true };
    } catch (error) {
      console.error('Error associating attachment with draft:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cleanup orphaned attachments (for background job)
   */
  async cleanupOrphanedAttachments(): Promise<{ cleaned: number; errors: string[] }> {
    const errors: string[] = [];
    let cleaned = 0;

    try {
      const orphanedAttachments = await storage.getOrphanedEmailAttachments();

      for (const attachment of orphanedAttachments) {
        try {
          // Delete file from disk
          if (fs.existsSync(attachment.storagePath)) {
            fs.unlinkSync(attachment.storagePath);
          }

          // Delete from database
          await storage.deleteEmailAttachment(attachment.id);
          cleaned++;
        } catch (error) {
          errors.push(`Failed to cleanup attachment ${attachment.id}: ${error.message}`);
        }
      }

      console.log(`Cleaned up ${cleaned} orphaned attachments`);
      return { cleaned, errors };
    } catch (error) {
      console.error('Error during orphaned attachment cleanup:', error);
      return { cleaned, errors: [error.message] };
    }
  }

  /**
   * Get multer configuration for secure uploads
   */
  getMulterConfig(): multer.Options {
    return {
      storage: multer.memoryStorage(), // Use memory storage for better control
      limits: {
        fileSize: this.config.maxFileSize,
        files: this.config.maxFilesPerUpload
      },
      fileFilter: (req: Request, file: Express.Multer.File, callback) => {
        const validation = this.validateFile(file);
        if (validation.isValid) {
          callback(null, true);
        } else {
          callback(new Error(validation.errors.join(', ')));
        }
      }
    };
  }
}

// Export singleton instance
export const attachmentService = new AttachmentService();
export default attachmentService;