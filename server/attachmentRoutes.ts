import type { Express } from "express";
import multer from 'multer';
import { isAuthenticated } from "./replitAuth";
import { enhancedAttachmentService } from './services/enhancedAttachmentService';
import { attachmentUploadLimiter, attachmentDownloadLimiter, attachmentDeleteLimiter, suspiciousActivityLimiter } from './services/rateLimiter';
import { z } from "zod";

/**
 * Enhanced secure attachment routes with comprehensive security
 * Features:
 * - Magic-number file type detection
 * - Mandatory virus scanning
 * - Comprehensive quota enforcement
 * - Secure download with headers
 * - Rate limiting
 * - Audit logging
 * - Anomaly detection
 */

// Enhanced error handling for attachment operations
class AttachmentApiError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 500,
    public details?: string,
    public securityIncident: boolean = false
  ) {
    super(message);
    this.name = 'AttachmentApiError';
  }
}

// Request validation schemas
const uploadRequestSchema = z.object({
  accountId: z.string().min(1, "Account ID is required"),
  draftId: z.string().optional()
});

const downloadRequestSchema = z.object({
  attachmentId: z.string().min(1, "Attachment ID is required")
});

const deleteRequestSchema = z.object({
  attachmentId: z.string().min(1, "Attachment ID is required")
});

const associateRequestSchema = z.object({
  attachmentId: z.string().min(1, "Attachment ID is required"),
  draftId: z.string().min(1, "Draft ID is required")
});

// Anomaly detection patterns
interface AnomalyPattern {
  name: string;
  check: (req: any, context: any) => boolean;
  severity: 'low' | 'medium' | 'high';
  description: string;
}

const anomalyPatterns: AnomalyPattern[] = [
  {
    name: 'rapid_upload',
    check: (req, context) => {
      // More than 20 files in a single upload
      return req.files && req.files.length > 20;
    },
    severity: 'medium',
    description: 'Unusually large number of files in single upload'
  },
  {
    name: 'suspicious_filename',
    check: (req, context) => {
      if (!req.files) return false;
      const suspiciousPatterns = [
        /payload/i, /exploit/i, /hack/i, /virus/i, /malware/i,
        /\.(exe|bat|cmd|scr|vbs)\.txt$/i, // Double extension
        /^\./  // Hidden files
      ];
      return req.files.some(file => 
        suspiciousPatterns.some(pattern => pattern.test(file.originalname))
      );
    },
    severity: 'high',
    description: 'Suspicious filename patterns detected'
  },
  {
    name: 'high_download_frequency',
    check: (req, context) => {
      // This would be checked against recent download history
      // For now, just a placeholder
      return false;
    },
    severity: 'medium',
    description: 'High frequency download pattern'
  }
];

function detectAnomalies(req: any, context: any = {}): AnomalyPattern[] {
  return anomalyPatterns.filter(pattern => pattern.check(req, context));
}

function logSecurityEvent(
  userId: string,
  event: string,
  details: any,
  severity: 'info' | 'warning' | 'error' | 'critical' = 'info'
) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    userId,
    event,
    severity,
    details,
    source: 'attachment_service'
  }));
}

export function setupAttachmentRoutes(app: Express): void {
  // Configure multer with enhanced security
  const upload = multer(enhancedAttachmentService.getMulterConfig());

  /**
   * Enhanced file upload endpoint with comprehensive security
   */
  app.post('/api/attachments/upload', 
    isAuthenticated,
    attachmentUploadLimiter,
    upload.array('files', 20), // Max 20 files per request
    async (req: any, res) => {
      const requestId = `upload-${Date.now()}`;
      
      try {
        const userId = req.user.claims.sub;
        if (!userId) {
          throw new AttachmentApiError(
            'AUTHENTICATION_FAILED',
            'User ID not found in authentication token',
            401
          );
        }

        // CRITICAL SECURITY: Check virus scanner availability BEFORE processing
        if (!enhancedAttachmentService.isServiceAvailable()) {
          const healthInfo = enhancedAttachmentService.getServiceHealth();
          
          logSecurityEvent(userId, 'UPLOAD_BLOCKED_SCANNER_UNAVAILABLE', {
            requestId,
            healthInfo,
            fileCount: req.files?.length || 0,
            userAgent: req.headers['user-agent']
          }, 'error');
          
          return res.status(503).json({
            success: false,
            error: {
              code: 'VIRUS_SCANNER_UNAVAILABLE',
              message: 'File uploads are temporarily unavailable due to security service maintenance',
              details: 'Virus scanning service is not operational',
              timestamp: new Date().toISOString(),
              retryAfter: '60' // Suggest retry after 60 seconds
            },
            requestId,
            serviceHealth: {
              available: healthInfo.available,
              environment: healthInfo.environment
            }
          });
        }

        // Validate request body
        const validation = uploadRequestSchema.safeParse(req.body);
        if (!validation.success) {
          throw new AttachmentApiError(
            'VALIDATION_ERROR',
            'Invalid upload request',
            400,
            validation.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
          );
        }

        const { accountId, draftId } = validation.data;
        const files = req.files as Express.Multer.File[];

        if (!files || files.length === 0) {
          throw new AttachmentApiError(
            'VALIDATION_ERROR',
            'No files provided for upload',
            400
          );
        }

        // Anomaly detection
        const anomalies = detectAnomalies(req, { userId, accountId });
        if (anomalies.length > 0) {
          const highSeverity = anomalies.filter(a => a.severity === 'high');
          if (highSeverity.length > 0) {
            logSecurityEvent(userId, 'UPLOAD_ANOMALY_BLOCKED', {
              requestId,
              anomalies,
              fileCount: files.length,
              accountId
            }, 'warning');
            
            // Apply suspicious activity rate limiting
            suspiciousActivityLimiter(req, res, () => {});
            
            throw new AttachmentApiError(
              'SECURITY_VIOLATION',
              'Upload blocked due to security concerns',
              403,
              undefined,
              true
            );
          } else {
            // Log but allow medium/low severity anomalies
            logSecurityEvent(userId, 'UPLOAD_ANOMALY_DETECTED', {
              requestId,
              anomalies,
              fileCount: files.length,
              accountId
            }, 'info');
          }
        }

        // Process files with enhanced security
        const result = await enhancedAttachmentService.processMultipleFiles(
          files,
          userId,
          accountId,
          draftId
        );

        // Log successful upload
        logSecurityEvent(userId, 'FILES_UPLOADED', {
          requestId,
          fileCount: result.attachments?.length || 0,
          totalSize: result.totalSize,
          accountId,
          draftId,
          rejectedCount: result.rejectedFiles?.length || 0
        });

        // Return comprehensive response
        res.status(result.success ? 200 : 400).json({
          success: result.success,
          data: {
            attachments: result.attachments,
            quotaInfo: result.quotaInfo,
            totalSize: result.totalSize,
            uploaded: result.attachments?.length || 0,
            rejected: result.rejectedFiles?.length || 0
          },
          warnings: result.warnings,
          errors: result.errors,
          rejectedFiles: result.rejectedFiles,
          requestId,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error(`[${requestId}] Upload error:`, error);
        
        if (error instanceof AttachmentApiError) {
          if (error.securityIncident) {
            logSecurityEvent(req.user?.claims?.sub || 'unknown', 'SECURITY_INCIDENT', {
              requestId,
              error: error.message,
              code: error.code
            }, 'error');
          }
          
          res.status(error.statusCode).json({
            success: false,
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
              timestamp: new Date().toISOString()
            },
            requestId
          });
        } else {
          res.status(500).json({
            success: false,
            error: {
              code: 'INTERNAL_SERVER_ERROR',
              message: 'An unexpected error occurred during upload',
              timestamp: new Date().toISOString()
            },
            requestId
          });
        }
      }
    }
  );

  /**
   * Secure file download endpoint with comprehensive security headers
   */
  app.get('/api/attachments/:attachmentId/download',
    isAuthenticated,
    attachmentDownloadLimiter,
    async (req: any, res) => {
      const requestId = `download-${Date.now()}`;
      
      try {
        const userId = req.user.claims.sub;
        if (!userId) {
          throw new AttachmentApiError(
            'AUTHENTICATION_FAILED',
            'User ID not found in authentication token',
            401
          );
        }

        const { attachmentId } = req.params;
        if (!attachmentId) {
          throw new AttachmentApiError(
            'VALIDATION_ERROR',
            'Attachment ID is required',
            400
          );
        }

        // Get attachment info for download
        const downloadInfo = await enhancedAttachmentService.getAttachmentForDownload(
          attachmentId,
          userId
        );

        if (!downloadInfo) {
          logSecurityEvent(userId, 'DOWNLOAD_UNAUTHORIZED', {
            requestId,
            attachmentId,
            userAgent: req.headers['user-agent']
          }, 'warning');
          
          throw new AttachmentApiError(
            'ATTACHMENT_NOT_FOUND',
            'Attachment not found or access denied',
            404
          );
        }

        // Get file data
        const fileData = await enhancedAttachmentService.getAttachmentData(
          attachmentId,
          userId
        );

        if (!fileData) {
          throw new AttachmentApiError(
            'ATTACHMENT_DATA_UNAVAILABLE',
            'Attachment data could not be retrieved',
            404
          );
        }

        // Set comprehensive security headers
        res.set({
          ...downloadInfo.securityHeaders,
          'Content-Type': downloadInfo.detectedType || downloadInfo.mimeType,
          'Content-Length': downloadInfo.size.toString(),
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'X-Download-Options': 'noopen',
          'X-Permitted-Cross-Domain-Policies': 'none',
          'Referrer-Policy': 'no-referrer'
        });

        // Log successful download
        logSecurityEvent(userId, 'FILE_DOWNLOADED', {
          requestId,
          attachmentId,
          filename: downloadInfo.filename,
          size: downloadInfo.size,
          downloadCount: downloadInfo.downloadCount,
          userAgent: req.headers['user-agent']
        });

        // Send file data
        res.send(fileData);

      } catch (error) {
        console.error(`[${requestId}] Download error:`, error);
        
        if (error instanceof AttachmentApiError) {
          res.status(error.statusCode).json({
            success: false,
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
              timestamp: new Date().toISOString()
            },
            requestId
          });
        } else {
          res.status(500).json({
            success: false,
            error: {
              code: 'INTERNAL_SERVER_ERROR',
              message: 'An unexpected error occurred during download',
              timestamp: new Date().toISOString()
            },
            requestId
          });
        }
      }
    }
  );

  /**
   * Delete attachment endpoint with audit logging
   */
  app.delete('/api/attachments/:attachmentId',
    isAuthenticated,
    attachmentDeleteLimiter,
    async (req: any, res) => {
      const requestId = `delete-${Date.now()}`;
      
      try {
        const userId = req.user.claims.sub;
        if (!userId) {
          throw new AttachmentApiError(
            'AUTHENTICATION_FAILED',
            'User ID not found in authentication token',
            401
          );
        }

        const { attachmentId } = req.params;
        if (!attachmentId) {
          throw new AttachmentApiError(
            'VALIDATION_ERROR',
            'Attachment ID is required',
            400
          );
        }

        const result = await enhancedAttachmentService.deleteAttachment(
          attachmentId,
          userId
        );

        if (!result.success) {
          logSecurityEvent(userId, 'DELETE_UNAUTHORIZED', {
            requestId,
            attachmentId,
            error: result.error
          }, 'warning');
          
          throw new AttachmentApiError(
            'ATTACHMENT_DELETE_FAILED',
            result.error || 'Failed to delete attachment',
            403
          );
        }

        // Log successful deletion
        logSecurityEvent(userId, 'FILE_DELETED', {
          requestId,
          attachmentId
        });

        res.json({
          success: true,
          message: 'Attachment deleted successfully',
          requestId,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error(`[${requestId}] Delete error:`, error);
        
        if (error instanceof AttachmentApiError) {
          res.status(error.statusCode).json({
            success: false,
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
              timestamp: new Date().toISOString()
            },
            requestId
          });
        } else {
          res.status(500).json({
            success: false,
            error: {
              code: 'INTERNAL_SERVER_ERROR',
              message: 'An unexpected error occurred during deletion',
              timestamp: new Date().toISOString()
            },
            requestId
          });
        }
      }
    }
  );

  /**
   * Associate attachment with draft
   */
  app.put('/api/attachments/:attachmentId/associate',
    isAuthenticated,
    async (req: any, res) => {
      const requestId = `associate-${Date.now()}`;
      
      try {
        const userId = req.user.claims.sub;
        if (!userId) {
          throw new AttachmentApiError(
            'AUTHENTICATION_FAILED',
            'User ID not found in authentication token',
            401
          );
        }

        const { attachmentId } = req.params;
        const validation = associateRequestSchema.safeParse(req.body);
        if (!validation.success) {
          throw new AttachmentApiError(
            'VALIDATION_ERROR',
            'Invalid association request',
            400,
            validation.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
          );
        }

        const { draftId } = validation.data;

        const result = await enhancedAttachmentService.associateWithDraft(
          attachmentId,
          draftId,
          userId
        );

        if (!result.success) {
          throw new AttachmentApiError(
            'ASSOCIATION_FAILED',
            result.error || 'Failed to associate attachment with draft',
            400
          );
        }

        // Log successful association
        logSecurityEvent(userId, 'ATTACHMENT_ASSOCIATED', {
          requestId,
          attachmentId,
          draftId
        });

        res.json({
          success: true,
          message: 'Attachment associated with draft successfully',
          requestId,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error(`[${requestId}] Association error:`, error);
        
        if (error instanceof AttachmentApiError) {
          res.status(error.statusCode).json({
            success: false,
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
              timestamp: new Date().toISOString()
            },
            requestId
          });
        } else {
          res.status(500).json({
            success: false,
            error: {
              code: 'INTERNAL_SERVER_ERROR',
              message: 'An unexpected error occurred during association',
              timestamp: new Date().toISOString()
            },
            requestId
          });
        }
      }
    }
  );

  /**
   * Get user attachments with filtering
   */
  app.get('/api/attachments',
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = req.user.claims.sub;
        if (!userId) {
          throw new AttachmentApiError(
            'AUTHENTICATION_FAILED',
            'User ID not found in authentication token',
            401
          );
        }

        const { draftId, messageId, limit = 50, offset = 0 } = req.query;

        const attachments = await enhancedAttachmentService.getAttachmentForDownload.storage.getEmailAttachments(
          userId,
          draftId,
          messageId,
          parseInt(limit),
          parseInt(offset)
        );

        res.json({
          success: true,
          data: {
            attachments,
            total: attachments.length
          },
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('Get attachments error:', error);
        
        if (error instanceof AttachmentApiError) {
          res.status(error.statusCode).json({
            success: false,
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
              timestamp: new Date().toISOString()
            }
          });
        } else {
          res.status(500).json({
            success: false,
            error: {
              code: 'INTERNAL_SERVER_ERROR',
              message: 'An unexpected error occurred',
              timestamp: new Date().toISOString()
            }
          });
        }
      }
    }
  );

  /**
   * Get attachment quota and statistics
   */
  app.get('/api/attachments/quota',
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = req.user.claims.sub;
        if (!userId) {
          throw new AttachmentApiError(
            'AUTHENTICATION_FAILED',
            'User ID not found in authentication token',
            401
          );
        }

        const stats = await enhancedAttachmentService.getAttachmentForDownload.storage.getAttachmentStats(userId);
        
        // Get quota limits from config
        const quotaInfo = {
          used: {
            totalSize: stats.totalSize,
            totalCount: stats.totalCount,
            averageSize: stats.avgSize
          },
          limits: {
            maxTotalSize: 1073741824, // 1GB
            maxTotalFiles: 500,
            maxFileSize: 26214400, // 25MB
            maxFilesPerDraft: 20
          },
          percentages: {
            sizeUsed: (stats.totalSize / 1073741824) * 100,
            filesUsed: (stats.totalCount / 500) * 100
          }
        };

        res.json({
          success: true,
          data: quotaInfo,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('Get quota error:', error);
        
        res.status(500).json({
          success: false,
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'An unexpected error occurred',
            timestamp: new Date().toISOString()
          }
        });
      }
    }
  );

  console.log('Enhanced attachment routes with comprehensive security configured');
}