import multer from 'multer';
import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { z } from 'zod';

// Security configuration for attachment handling
const SECURITY_CONFIG = {
  // File size limits
  maxFileSize: 25 * 1024 * 1024, // 25MB per file
  maxTotalSizePerEmail: 50 * 1024 * 1024, // 50MB total per email
  maxFilesPerEmail: 10,
  
  // Allowed file types - SECURITY: Only safe MIME types allowed
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
    'application/rtf',
    
    // Images - SECURITY: SVG removed due to XSS risk
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/tiff',
    
    // Archives
    'application/zip',
    'application/x-zip-compressed',
    'application/gzip',
    'application/x-tar',
    
    // SECURITY: XML, HTML, JS, CSS removed due to XSS/XXE/RCE risks
    // Safe data formats only
    'application/json',
  ],
  
  allowedExtensions: [
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.rtf',
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff',
    '.zip', '.tar', '.gz',
    '.json'
    // SECURITY: .xml, .html, .js, .css, .svg removed due to XSS/XXE/RCE risks
  ],
  
  // Dangerous file types to explicitly block
  blockedExtensions: [
    '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js', '.jar',
    '.app', '.deb', '.pkg', '.dmg', '.iso', '.msi', '.dll', '.so', '.dylib',
    '.sh', '.bash', '.ps1', '.php', '.asp', '.aspx', '.jsp',
    // SECURITY: Additional dangerous web formats
    '.html', '.htm', '.xml', '.svg', '.css', '.xhtml', '.jsp', '.jspx'
  ]
};

// File validation schema
export const fileValidationSchema = z.object({
  originalname: z.string().min(1, 'Filename is required'),
  mimetype: z.string().min(1, 'MIME type is required'),
  size: z.number().min(1, 'File size must be greater than 0').max(SECURITY_CONFIG.maxFileSize, `File size must not exceed ${SECURITY_CONFIG.maxFileSize / 1024 / 1024}MB`),
  buffer: z.instanceof(Buffer)
});

export type ValidatedFile = z.infer<typeof fileValidationSchema>;

/**
 * Storage provider interface for attachments
 */
export interface IAttachmentStorageProvider {
  store(fileId: string, buffer: Buffer, metadata: FileMetadata): Promise<string>;
  retrieve(filePath: string): Promise<Buffer>;
  delete(filePath: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  getUrl(filePath: string): Promise<string>;
}

/**
 * File metadata interface
 */
export interface FileMetadata {
  originalName: string;
  mimeType: string;
  size: number;
  userId: string;
  emailId?: string;
}

/**
 * Local file system storage provider
 */
export class LocalStorageProvider implements IAttachmentStorageProvider {
  private baseDir: string;

  constructor(baseDir: string = './uploads/attachments') {
    this.baseDir = baseDir;
    this.ensureDirectoryExists();
  }

  private async ensureDirectoryExists(): Promise<void> {
    try {
      await fs.mkdir(this.baseDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create attachments directory:', error);
      throw new Error('Failed to initialize attachment storage');
    }
  }

  async store(fileId: string, buffer: Buffer, metadata: FileMetadata): Promise<string> {
    const fileName = this.generateFileName(fileId, metadata.originalName);
    const filePath = path.join(this.baseDir, fileName);
    
    try {
      await fs.writeFile(filePath, buffer);
      return fileName; // Return relative path for storage
    } catch (error) {
      console.error('Failed to store file:', error);
      throw new Error('Failed to store attachment');
    }
  }

  async retrieve(filePath: string): Promise<Buffer> {
    const fullPath = path.join(this.baseDir, filePath);
    
    try {
      return await fs.readFile(fullPath);
    } catch (error) {
      console.error('Failed to retrieve file:', error);
      throw new Error('File not found');
    }
  }

  async delete(filePath: string): Promise<void> {
    const fullPath = path.join(this.baseDir, filePath);
    
    try {
      await fs.unlink(fullPath);
    } catch (error) {
      console.error('Failed to delete file:', error);
      // Don't throw error if file doesn't exist
      if ((error as any)?.code !== 'ENOENT') {
        throw new Error('Failed to delete attachment');
      }
    }
  }

  async exists(filePath: string): Promise<boolean> {
    const fullPath = path.join(this.baseDir, filePath);
    
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async getUrl(filePath: string): Promise<string> {
    // Return a URL that can be used to download the file
    return `/api/attachments/download/${encodeURIComponent(filePath)}`;
  }

  private generateFileName(fileId: string, originalName: string): string {
    const ext = path.extname(originalName);
    const timestamp = Date.now();
    return `${fileId}_${timestamp}${ext}`;
  }
}

/**
 * Enhanced attachment service with security and validation
 */
export class AttachmentService {
  private storageProvider: IAttachmentStorageProvider;
  
  constructor(storageProvider?: IAttachmentStorageProvider) {
    this.storageProvider = storageProvider || new LocalStorageProvider();
  }

  /**
   * Get configured multer middleware for file uploads
   */
  getMulterConfig(): multer.Multer {
    return multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: SECURITY_CONFIG.maxFileSize,
        files: SECURITY_CONFIG.maxFilesPerEmail,
      },
      fileFilter: this.createFileFilter(),
    });
  }

  /**
   * Create file filter for multer
   */
  private createFileFilter(): multer.Options['fileFilter'] {
    return (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
      try {
        this.validateFile(file);
        cb(null, true);
      } catch (error) {
        cb(error as Error, false);
      }
    };
  }

  /**
   * Validate uploaded file
   */
  private validateFile(file: Express.Multer.File): void {
    // Check file extension
    const ext = path.extname(file.originalname).toLowerCase();
    
    // Block dangerous extensions
    if (SECURITY_CONFIG.blockedExtensions.includes(ext)) {
      throw new Error(`File type ${ext} is not allowed for security reasons`);
    }
    
    // Check allowed extensions
    if (!SECURITY_CONFIG.allowedExtensions.includes(ext)) {
      throw new Error(`File type ${ext} is not supported`);
    }
    
    // Check MIME type
    if (!SECURITY_CONFIG.allowedMimeTypes.includes(file.mimetype)) {
      throw new Error(`MIME type ${file.mimetype} is not allowed`);
    }
    
    // Check filename safety
    if (this.containsUnsafeCharacters(file.originalname)) {
      throw new Error('Filename contains unsafe characters');
    }
  }

  /**
   * Check if filename contains unsafe characters
   */
  private containsUnsafeCharacters(filename: string): boolean {
    // Block null bytes, path traversal, and other dangerous characters
    const dangerousPatterns = [
      /\x00/, // null byte
      /\.\.\//, // path traversal
      /\.\.\\/, // path traversal (Windows)
      /[<>:"|?*]/, // Windows reserved characters
      /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i, // Windows reserved names
    ];
    
    return dangerousPatterns.some(pattern => pattern.test(filename));
  }

  /**
   * Magic number signatures for file type detection
   */
  private readonly MAGIC_NUMBERS = {
    // Images
    'image/jpeg': [
      [0xFF, 0xD8, 0xFF], // JPEG
    ],
    'image/png': [
      [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], // PNG
    ],
    'image/gif': [
      [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
      [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
    ],
    'image/webp': [
      [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50], // RIFF....WEBP
    ],
    'image/bmp': [
      [0x42, 0x4D], // BMP
    ],
    'image/tiff': [
      [0x49, 0x49, 0x2A, 0x00], // TIFF little-endian
      [0x4D, 0x4D, 0x00, 0x2A], // TIFF big-endian
    ],

    // Documents
    'application/pdf': [
      [0x25, 0x50, 0x44, 0x46], // %PDF
    ],
    'application/zip': [
      [0x50, 0x4B, 0x03, 0x04], // ZIP/DOCX/XLSX/PPTX
      [0x50, 0x4B, 0x05, 0x06], // Empty ZIP
      [0x50, 0x4B, 0x07, 0x08], // Spanned ZIP
    ],
    'application/gzip': [
      [0x1F, 0x8B], // GZIP
    ],
    
    // Microsoft Office (legacy)
    'application/msword': [
      [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], // DOC/XLS/PPT
    ],
    'application/vnd.ms-excel': [
      [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], // DOC/XLS/PPT
    ],
    'application/vnd.ms-powerpoint': [
      [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], // DOC/XLS/PPT
    ],

    // Text files - no reliable magic number, will validate content
    'text/plain': [], // Will validate as text content
    'text/csv': [], // Will validate as text content
    'application/json': [], // Will validate as text content
    'application/rtf': [
      [0x7B, 0x5C, 0x72, 0x74, 0x66], // {\rtf
    ],
  };

  /**
   * Validate file type using magic number detection
   */
  private validateMagicNumber(buffer: Buffer, claimedMimeType: string): boolean {
    const signatures = this.MAGIC_NUMBERS[claimedMimeType as keyof typeof this.MAGIC_NUMBERS];
    
    if (!signatures) {
      console.warn(`No magic number validation for MIME type: ${claimedMimeType}`);
      return false;
    }

    // Text-based files without magic numbers - validate as UTF-8 text
    if (signatures.length === 0) {
      return this.validateTextContent(buffer, claimedMimeType);
    }

    // Check if buffer matches any of the known signatures
    for (const signature of signatures) {
      if (this.matchesSignature(buffer, signature)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if buffer matches a magic number signature
   */
  private matchesSignature(buffer: Buffer, signature: (number | null)[]): boolean {
    if (buffer.length < signature.length) {
      return false;
    }

    for (let i = 0; i < signature.length; i++) {
      if (signature[i] !== null && buffer[i] !== signature[i]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate text-based content
   */
  private validateTextContent(buffer: Buffer, mimeType: string): boolean {
    try {
      const content = buffer.toString('utf8');
      
      // Check for null bytes (indicates binary content)
      if (content.includes('\0')) {
        return false;
      }

      // Additional validation based on MIME type
      switch (mimeType) {
        case 'application/json':
          JSON.parse(content);
          return true;
        case 'text/csv':
          // Basic CSV validation - should contain printable characters
          return /^[\x20-\x7E\r\n\t]*$/.test(content);
        case 'text/plain':
          // Should be valid UTF-8 text
          return content.length > 0;
        default:
          return true;
      }
    } catch (error) {
      return false;
    }
  }

  /**
   * Enhanced file validation with magic number checking
   */
  private validateFileWithMagicNumber(file: Express.Multer.File): void {
    // First run standard validation
    this.validateFile(file);

    // Then validate magic number if buffer is available
    if (file.buffer) {
      if (!this.validateMagicNumber(file.buffer, file.mimetype)) {
        throw new Error(`File content does not match claimed MIME type ${file.mimetype}. This could indicate file type spoofing.`);
      }
    }
  }

  /**
   * Store uploaded files
   */
  async storeFiles(
    files: Express.Multer.File[], 
    userId: string, 
    emailId?: string
  ): Promise<Array<{
    id: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    filePath: string;
  }>> {
    const results = [];
    
    // Validate total size
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > SECURITY_CONFIG.maxTotalSizePerEmail) {
      throw new Error(`Total file size exceeds limit of ${SECURITY_CONFIG.maxTotalSizePerEmail / 1024 / 1024}MB`);
    }
    
    for (const file of files) {
      try {
        // Enhanced validation with magic number checking
        this.validateFileWithMagicNumber(file);
        
        // Schema validation
        const validatedFile = fileValidationSchema.parse(file);
        
        // Generate unique file ID
        const fileId = crypto.randomBytes(16).toString('hex');
        
        // Prepare metadata
        const metadata: FileMetadata = {
          originalName: validatedFile.originalname,
          mimeType: validatedFile.mimetype,
          size: validatedFile.size,
          userId,
          emailId,
        };
        
        // Store file
        const filePath = await this.storageProvider.store(fileId, validatedFile.buffer, metadata);
        
        results.push({
          id: fileId,
          fileName: validatedFile.originalname,
          fileSize: validatedFile.size,
          mimeType: validatedFile.mimetype,
          filePath,
        });
      } catch (error) {
        console.error('Failed to store file:', file.originalname, error);
        throw new Error(`Failed to store file ${file.originalname}: ${error}`);
      }
    }
    
    return results;
  }

  /**
   * Retrieve file for download
   */
  async retrieveFile(filePath: string): Promise<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
  }> {
    try {
      const buffer = await this.storageProvider.retrieve(filePath);
      
      // Extract original filename from stored path
      const filename = this.extractOriginalFilename(filePath);
      const mimeType = this.getMimeTypeFromFilename(filename);
      
      return { buffer, filename, mimeType };
    } catch (error) {
      console.error('Failed to retrieve file:', error);
      throw new Error('File not found or inaccessible');
    }
  }

  /**
   * Delete file from storage
   */
  async deleteFile(filePath: string): Promise<void> {
    try {
      await this.storageProvider.delete(filePath);
    } catch (error) {
      console.error('Failed to delete file:', error);
      throw new Error('Failed to delete file');
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(filePath: string): Promise<boolean> {
    return this.storageProvider.exists(filePath);
  }

  /**
   * Get download URL for file
   */
  async getDownloadUrl(filePath: string): Promise<string> {
    return this.storageProvider.getUrl(filePath);
  }

  /**
   * Extract original filename from stored path
   */
  private extractOriginalFilename(storedPath: string): string {
    // Remove timestamp and ID prefix from filename
    const filename = path.basename(storedPath);
    const parts = filename.split('_');
    if (parts.length >= 3) {
      // Remove fileId and timestamp, keep extension
      const ext = path.extname(filename);
      return parts.slice(2).join('_').replace(/_\d+$/, '') + ext;
    }
    return filename;
  }

  /**
   * Get MIME type from filename extension
   */
  private getMimeTypeFromFilename(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.zip': 'application/zip',
    };
    
    return mimeMap[ext] || 'application/octet-stream';
  }

  /**
   * Clean up expired or orphaned files
   * @param maxAge Maximum age in milliseconds for orphaned files (default: 24 hours)
   * @param storage Storage interface for database operations
   * @returns Number of files cleaned up
   */
  async cleanupExpiredFiles(
    maxAge: number = 24 * 60 * 60 * 1000, 
    storage?: any
  ): Promise<number> {
    let cleanedCount = 0;
    
    try {
      console.log('[AttachmentService] Starting file cleanup...');
      
      const storageDir = this.getStorageDir();
      if (!fs.existsSync(storageDir)) {
        console.log('[AttachmentService] Storage directory does not exist, nothing to clean');
        return 0;
      }

      // Get all files in storage directory
      const allFiles = fs.readdirSync(storageDir);
      const cutoffTime = new Date(Date.now() - maxAge);
      
      console.log(`[AttachmentService] Checking ${allFiles.length} files, cutoff time: ${cutoffTime.toISOString()}`);

      for (const fileName of allFiles) {
        try {
          const filePath = path.join(storageDir, fileName);
          const stats = fs.statSync(filePath);
          
          // Check if file is old enough
          if (stats.mtime < cutoffTime) {
            let isOrphaned = true;
            
            // If storage is provided, check if file is referenced in database
            if (storage) {
              try {
                // Check if any attachment record references this file
                const attachmentRecords = await storage.getAttachmentsByFilePath(filePath);
                isOrphaned = !attachmentRecords || attachmentRecords.length === 0;
              } catch (dbError) {
                console.warn(`[AttachmentService] Database check failed for ${fileName}, assuming orphaned:`, dbError);
                isOrphaned = true;
              }
            }
            
            if (isOrphaned) {
              // Delete the orphaned file
              fs.unlinkSync(filePath);
              cleanedCount++;
              console.log(`[AttachmentService] Deleted orphaned file: ${fileName} (modified: ${stats.mtime.toISOString()})`);
            } else {
              console.log(`[AttachmentService] Keeping referenced file: ${fileName}`);
            }
          }
        } catch (fileError) {
          console.error(`[AttachmentService] Error processing file ${fileName}:`, fileError);
          // Continue with other files
        }
      }
      
      console.log(`[AttachmentService] Cleanup completed: ${cleanedCount} files removed`);
      return cleanedCount;
      
    } catch (error) {
      console.error('[AttachmentService] File cleanup failed:', error);
      throw new Error(`File cleanup failed: ${error.message}`);
    }
  }

  /**
   * Clean up database records for missing files
   * @param storage Storage interface for database operations  
   * @returns Number of database records cleaned up
   */
  async cleanupOrphanedRecords(storage: any): Promise<number> {
    let cleanedCount = 0;
    
    try {
      console.log('[AttachmentService] Starting database record cleanup...');
      
      // Get all attachment records
      const allAttachments = await storage.getAllAttachments();
      
      for (const attachment of allAttachments) {
        try {
          // Check if the file still exists on disk
          if (!fs.existsSync(attachment.filePath)) {
            // Delete the database record for missing file
            await storage.deleteAttachment(attachment.id);
            cleanedCount++;
            console.log(`[AttachmentService] Deleted database record for missing file: ${attachment.fileName} (${attachment.filePath})`);
          }
        } catch (recordError) {
          console.error(`[AttachmentService] Error checking attachment record ${attachment.id}:`, recordError);
          // Continue with other records
        }
      }
      
      console.log(`[AttachmentService] Database cleanup completed: ${cleanedCount} records removed`);
      return cleanedCount;
      
    } catch (error) {
      console.error('[AttachmentService] Database record cleanup failed:', error);
      throw new Error(`Database record cleanup failed: ${error.message}`);
    }
  }

  /**
   * Perform complete cleanup: both files and database records
   * @param storage Storage interface for database operations
   * @param maxAge Maximum age in milliseconds for orphaned files (default: 24 hours)
   * @returns Cleanup summary
   */
  async performFullCleanup(
    storage: any, 
    maxAge: number = 24 * 60 * 60 * 1000
  ): Promise<{ filesRemoved: number; recordsRemoved: number }> {
    console.log('[AttachmentService] Starting full cleanup operation...');
    
    const filesRemoved = await this.cleanupExpiredFiles(maxAge, storage);
    const recordsRemoved = await this.cleanupOrphanedRecords(storage);
    
    console.log(`[AttachmentService] Full cleanup completed: ${filesRemoved} files + ${recordsRemoved} records removed`);
    
    return { filesRemoved, recordsRemoved };
  }
}

// Export singleton instance
export const attachmentService = new AttachmentService();
export default attachmentService;