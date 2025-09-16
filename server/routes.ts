import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage, type SearchEmailsParams } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertAccountConnectionSchema, sendEmailRequestSchema, type SendEmailRequest, type SendEmailResponse, type ImapSettings, insertAttachmentSchema, saveDraftRequestSchema, type SaveDraftRequest, type SaveDraftResponse, type LoadDraftResponse, type ListDraftsResponse, type DeleteDraftResponse, createSignatureRequestSchema, updateSignatureRequestSchema, type CreateSignatureRequest, type UpdateSignatureRequest, type SignatureResponse, type ListSignaturesResponse, type DeleteSignatureResponse, pushSubscriptionRequestSchema, updateNotificationPreferencesRequestSchema, updateAccountNotificationPreferencesRequestSchema, type PushSubscriptionRequest, type PushSubscriptionResponse, type UpdateNotificationPreferencesRequest, type UpdateAccountNotificationPreferencesRequest, type NotificationPreferencesResponse } from "@shared/schema";
import { testConnection, type ConnectionTestResult } from "./connectionTest";
import { discoverImapFolders, appendSentEmailToFolder, syncAllUserAccounts, syncImapEmails } from "./emailSync";
import { discoverEwsFolders, syncEwsEmails } from "./ewsSync";
import { getEwsPushService } from "./ewsPushNotifications";
import { getImapIdleService } from "./imapIdle";
import { pushNotificationManager } from "./push/pushNotifications";
import { z } from "zod";
import nodemailer from "nodemailer";
import { decryptAccountSettingsWithPassword } from "./crypto";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { existsSync, mkdirSync } from "fs";

/**
 * Map folder types to icon names for frontend display
 */
function getFolderIcon(folderType: string): string {
  switch (folderType.toLowerCase()) {
    case 'inbox':
      return 'Inbox';
    case 'sent':
      return 'Send';
    case 'drafts':
      return 'FileText';
    case 'deleted':
      return 'Trash';
    case 'archive':
      return 'Archive';
    case 'spam':
      return 'ShieldAlert';
    default:
      return 'Folder';
  }
}

// Standardized error response interface
interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: string;
    field?: string;
    suggestions?: string[];
    timestamp: string;
  };
  requestId?: string;
}

interface ApiSuccessResponse<T = any> {
  success: true;
  data: T;
  message?: string;
  timestamp: string;
}

type ApiResponse<T = any> = ApiSuccessResponse<T> | ApiErrorResponse;

// Error codes for different types of errors
const ErrorCodes = {
  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
  INVALID_INPUT_FORMAT: 'INVALID_INPUT_FORMAT',
  
  // Authentication/Authorization errors
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  AUTHORIZATION_FAILED: 'AUTHORIZATION_FAILED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  
  // Connection errors
  CONNECTION_TEST_FAILED: 'CONNECTION_TEST_FAILED',
  IMAP_CONNECTION_FAILED: 'IMAP_CONNECTION_FAILED',
  EWS_CONNECTION_FAILED: 'EWS_CONNECTION_FAILED',
  SMTP_CONNECTION_FAILED: 'SMTP_CONNECTION_FAILED',
  
  // Resource errors
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  
  // Server errors
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  
  // Business logic errors
  UNSUPPORTED_PROTOCOL: 'UNSUPPORTED_PROTOCOL',
  INVALID_ACCOUNT_STATE: 'INVALID_ACCOUNT_STATE',
  
  // Email sending errors
  EMAIL_SEND_FAILED: 'EMAIL_SEND_FAILED',
  EMAIL_VALIDATION_FAILED: 'EMAIL_VALIDATION_FAILED',
  
  // File handling errors
  FILE_UPLOAD_FAILED: 'FILE_UPLOAD_FAILED',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_SIZE_EXCEEDED: 'FILE_SIZE_EXCEEDED',
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
  ATTACHMENT_NOT_FOUND: 'ATTACHMENT_NOT_FOUND',
  
  // Draft errors
  DRAFT_NOT_FOUND: 'DRAFT_NOT_FOUND',
  DRAFT_SAVE_FAILED: 'DRAFT_SAVE_FAILED',
  DRAFT_DELETE_FAILED: 'DRAFT_DELETE_FAILED',
  INVALID_DRAFT_DATA: 'INVALID_DRAFT_DATA',
  
  // Push notification errors
  PUSH_SUBSCRIPTION_FAILED: 'PUSH_SUBSCRIPTION_FAILED',
  PUSH_UNSUBSCRIBE_FAILED: 'PUSH_UNSUBSCRIBE_FAILED',
  PUSH_NOTIFICATION_SEND_FAILED: 'PUSH_NOTIFICATION_SEND_FAILED',
  NOTIFICATION_PREFERENCES_UPDATE_FAILED: 'NOTIFICATION_PREFERENCES_UPDATE_FAILED',
  VAPID_NOT_CONFIGURED: 'VAPID_NOT_CONFIGURED',
  INVALID_PUSH_SUBSCRIPTION: 'INVALID_PUSH_SUBSCRIPTION',
  PUSH_NOT_SUPPORTED: 'PUSH_NOT_SUPPORTED'
} as const;

/**
 * Enhanced error handling utility class
 */
class ApiError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 500,
    public details?: string,
    public field?: string,
    public suggestions?: string[]
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Create standardized error response
 */
function createErrorResponse(
  error: ApiError | Error,
  requestId?: string
): { statusCode: number; response: ApiErrorResponse } {
  let statusCode = 500;
  let code: string = ErrorCodes.INTERNAL_SERVER_ERROR;
  let message = 'An unexpected error occurred';
  let details: string | undefined;
  let field: string | undefined;
  let suggestions: string[] | undefined;

  if (error instanceof ApiError) {
    statusCode = error.statusCode;
    code = error.code;
    message = error.message;
    details = error.details;
    field = error.field;
    suggestions = error.suggestions;
  } else if (error instanceof z.ZodError) {
    statusCode = 400;
    code = ErrorCodes.VALIDATION_ERROR;
    message = 'Validation failed';
    details = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    suggestions = ['Please check your input and try again', 'Ensure all required fields are provided'];
  } else {
    // Log unexpected errors for debugging
    console.error('Unexpected error:', error);
    message = process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred';
  }

  return {
    statusCode,
    response: {
      success: false,
      error: {
        code,
        message,
        details,
        field,
        suggestions,
        timestamp: new Date().toISOString()
      },
      requestId
    }
  };
}

/**
 * Create standardized success response
 */
function createSuccessResponse<T>(data: T, message?: string): ApiSuccessResponse<T> {
  return {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString()
  };
}

/**
 * Enhanced error handler middleware
 */
function handleApiError(error: any, res: any, operation: string, requestId?: string) {
  console.error(`[${operation}] Error:`, {
    error: error.message,
    stack: error.stack,
    requestId,
    timestamp: new Date().toISOString()
  });

  const { statusCode, response } = createErrorResponse(error, requestId);
  res.status(statusCode).json(response);
}

/**
 * Validation helper for account connection data
 */
function validateAccountData(data: any): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!data.name?.trim()) {
    errors.push('Account name is required and cannot be empty');
  }
  
  if (!data.protocol || !['IMAP', 'EWS'].includes(data.protocol)) {
    errors.push('Protocol must be either IMAP or EWS');
  }
  
  if (!data.host?.trim()) {
    errors.push('Mail server host is required');
  }
  
  if (!data.username?.trim()) {
    errors.push('Username is required');
  }
  
  if (!data.password?.trim()) {
    errors.push('Password is required');
  }
  
  // Protocol-specific validation
  if (data.protocol === 'IMAP') {
    if (data.enableCustomSmtp && (!data.smtpHost?.trim() || !data.smtpPort?.trim())) {
      errors.push('SMTP host and port are required when custom SMTP is enabled');
    }
  }
  
  if (data.protocol === 'EWS') {
    // Basic URL validation for EWS
    const hostUrl = data.host.trim();
    if (!hostUrl.includes('.') && !hostUrl.startsWith('http')) {
      errors.push('EWS server should be a domain name (e.g., mail.company.com) or full URL');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

// Separate validation function for connection testing (doesn't require account name)
function validateConnectionData(data: any): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!data.protocol || !['IMAP', 'EWS'].includes(data.protocol)) {
    errors.push('Protocol must be either IMAP or EWS');
  }
  
  if (!data.host?.trim()) {
    errors.push('Mail server host is required');
  }
  
  if (!data.username?.trim()) {
    errors.push('Username is required');
  }
  
  if (!data.password?.trim()) {
    errors.push('Password is required');
  }
  
  // Protocol-specific validation
  if (data.protocol === 'IMAP') {
    if (data.enableCustomSmtp && (!data.smtpHost?.trim() || !data.smtpPort?.trim())) {
      errors.push('SMTP host and port are required when custom SMTP is enabled');
    }
  }
  
  if (data.protocol === 'EWS') {
    // Basic URL validation for EWS
    const hostUrl = data.host.trim();
    if (!hostUrl.includes('.') && !hostUrl.startsWith('http')) {
      errors.push('EWS server should be a domain name (e.g., mail.company.com) or full URL');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Add comprehensive debugging middleware for API routes
  app.use('/api/*', (req, res, next) => {
    console.log(`[ROUTES] ===== ${req.method} ${req.originalUrl} =====`);
    console.log(`[ROUTES] Host: ${req.hostname}`);
    console.log(`[ROUTES] IP: ${req.ip}`);
    console.log(`[ROUTES] User-Agent: ${req.get('User-Agent')}`);
    
    if (Object.keys(req.query).length > 0) {
      console.log(`[ROUTES] Query:`, req.query);
    }
    if (req.body && Object.keys(req.body).length > 0) {
      console.log(`[ROUTES] Body:`, req.body);
    }
    
    // Mark that this is an API route to ensure it's handled by backend
    req.isApiRoute = true;
    next();
  });
  
  // Add specific debug middleware for callback routes
  app.use('/api/callback*', (req, res, next) => {
    console.log(`[CALLBACK-DEBUG] ===== CALLBACK ROUTE HIT =====`);
    console.log(`[CALLBACK-DEBUG] ${req.method} ${req.originalUrl}`);
    console.log(`[CALLBACK-DEBUG] Hostname: ${req.hostname}`);
    console.log(`[CALLBACK-DEBUG] Full URL: ${req.protocol}://${req.get('host')}${req.originalUrl}`);
    console.log(`[CALLBACK-DEBUG] Referer: ${req.get('Referer')}`);
    console.log(`[CALLBACK-DEBUG] Query params:`, req.query);
    console.log(`[CALLBACK-DEBUG] Timestamp: ${new Date().toISOString()}`);
    next();
  });

  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    const requestId = `user-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401,
          'Authentication token is missing required user information'
        );
      }
      
      const user = await storage.getUser(userId);
      if (!user) {
        throw new ApiError(
          ErrorCodes.RESOURCE_NOT_FOUND,
          'User not found',
          404,
          `User with ID ${userId} does not exist`
        );
      }
      
      res.json(createSuccessResponse(user, 'User retrieved successfully'));
    } catch (error) {
      handleApiError(error, res, 'GET /api/auth/user', requestId);
    }
  });

  // Account connection routes
  app.get('/api/accounts', isAuthenticated, async (req: any, res) => {
    const requestId = `accounts-list-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }
      
      const accounts = await storage.getUserAccountConnections(userId);
      
      // Enhance accounts with folder information for sidebar display
      const accountsWithFolders = await Promise.all(
        accounts.map(async (account) => {
          try {
            // Get discovered folders for this account
            const accountFolders = await storage.getAccountFolders(account.id);
            
            // Transform to MailSidebar folder format
            const folders = accountFolders.map(folder => {
              // Map folder type to icon name
              let iconName = 'Folder';
              switch (folder.folderType.toLowerCase()) {
                case 'inbox':
                  iconName = 'Inbox';
                  break;
                case 'sent':
                  iconName = 'Send';
                  break;
                case 'drafts':
                  iconName = 'FileText';
                  break;
                case 'deleted':
                  iconName = 'Trash';
                  break;
                case 'archive':
                  iconName = 'Archive';
                  break;
                case 'spam':
                  iconName = 'ShieldAlert';
                  break;
              }
              
              return {
                id: folder.folderType,
                name: folder.displayName,
                icon: iconName,
                count: folder.unreadCount || 0
              };
            });
            
            return {
              ...account,
              folders: folders.length > 0 ? folders : undefined
            };
          } catch (error) {
            console.error(`Error fetching folders for account ${account.id}:`, error);
            return account; // Return account without folders if there's an error
          }
        })
      );
      
      res.json(createSuccessResponse(accountsWithFolders, `Retrieved ${accountsWithFolders.length} email accounts with folder information`));
    } catch (error) {
      handleApiError(error, res, 'GET /api/accounts', requestId);
    }
  });

  // Enhanced connection test endpoint with detailed validation and error handling
  app.post('/api/accounts/test-connection', isAuthenticated, async (req: any, res) => {
    const requestId = `test-connection-${Date.now()}`;
    try {
      const { 
        protocol, host, port, username, password, useSSL,
        // SMTP settings for IMAP accounts
        enableCustomSmtp, smtpHost, smtpPort, smtpSecure, smtpUsername, smtpPassword
      } = req.body;

      // Enhanced validation with detailed error messages (for connection testing)
      const validation = validateConnectionData({ protocol, host, username, password, enableCustomSmtp, smtpHost, smtpPort });
      if (!validation.isValid) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid connection configuration',
          400,
          validation.errors.join('; '),
          undefined,
          [
            'Check that all required fields are filled out correctly',
            'Ensure the server address is correct',
            'Verify your username and password are accurate',
            'For IMAP accounts, use port 993 with SSL enabled'
          ]
        );
      }

      // Create temporary settings JSON for testing
      let settingsJson: string;
      let testSmtp = false;
      
      if (protocol === 'IMAP') {
        testSmtp = true;
        const settings: any = {
          host: host.trim(),
          port: 993, // Always use 993 for IMAP
          username: username.trim(),
          password: password.trim(),
          useSSL: true // Always use SSL for IMAP
        };

        // Add SMTP configuration
        if (enableCustomSmtp) {
          if (!smtpHost?.trim() || !smtpPort?.trim()) {
            throw new ApiError(
              ErrorCodes.VALIDATION_ERROR,
              'SMTP configuration is incomplete',
              400,
              'SMTP host and port are required when custom SMTP is enabled',
              'smtpHost',
              [
                'Provide a valid SMTP server hostname',
                'Use common SMTP ports: 587 (STARTTLS) or 465 (SSL)',
                'Ensure SMTP credentials are correct'
              ]
            );
          }
          settings.smtp = {
            host: smtpHost.trim(),
            port: parseInt(smtpPort),
            secure: smtpSecure ?? (parseInt(smtpPort) === 465),
            username: (smtpUsername || username).trim(),
            password: smtpPassword || password
          };
        } else {
          // Auto-configure SMTP based on IMAP settings
          const autoSmtpHost = host.replace(/^imap\./, 'smtp.');
          settings.smtp = {
            host: autoSmtpHost,
            port: 587,
            secure: false, // STARTTLS on port 587
            username: username.trim(),
            password: password.trim()
          };
        }

        settingsJson = JSON.stringify(settings);
      } else if (protocol === 'EWS') {
        settingsJson = JSON.stringify({
          host: host.trim(),
          username: username.trim(),
          password: password.trim()
        });
      } else {
        throw new ApiError(
          ErrorCodes.UNSUPPORTED_PROTOCOL,
          'Unsupported email protocol',
          400,
          `Protocol "${protocol}" is not supported`,
          'protocol',
          [
            'Use "IMAP" for most email providers (Gmail, Outlook.com, Yahoo)',
            'Use "EWS" for corporate Exchange servers',
            'Contact your email provider if unsure which protocol to use'
          ]
        );
      }

      console.log(`[${requestId}] Starting connection test for ${protocol} account`);
      
      // Test the connection with retry logic
      const testResult: ConnectionTestResult = await testConnection(
        protocol as 'IMAP' | 'EWS',
        settingsJson,
        testSmtp,
        2 // Retry once for transient failures
      );

      if (testResult.success) {
        const response = createSuccessResponse(
          {
            protocol,
            testDuration: testResult.testDuration,
            details: testResult.details
          },
          `${protocol} connection test successful${testSmtp ? ' (including SMTP)' : ''}`
        );
        console.log(`[${requestId}] Connection test successful in ${testResult.testDuration}ms`);
        res.json(response);
      } else {
        console.warn(`[${requestId}] Connection test failed: ${testResult.error}`);
        throw new ApiError(
          testResult.errorCode || ErrorCodes.CONNECTION_TEST_FAILED,
          testResult.error || `${protocol} connection test failed`,
          400,
          testResult.details?.diagnostics?.join('; '),
          undefined,
          testResult.details?.suggestions || [
            'Verify your server settings are correct',
            'Check your internet connection',
            'Ensure your credentials are valid',
            'Try again in a few minutes'
          ]
        );
      }

    } catch (error) {
      handleApiError(error, res, 'POST /api/accounts/test-connection', requestId);
    }
  });

  // Enhanced account creation endpoint
  app.post('/api/accounts', isAuthenticated, async (req: any, res) => {
    const requestId = `create-account-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      const { 
        name, protocol, host, port, username, password, useSSL,
        // SMTP settings for IMAP accounts
        enableCustomSmtp, smtpHost, smtpPort, smtpSecure, smtpUsername, smtpPassword
      } = req.body;
      
      // Enhanced validation
      const validation = validateAccountData({
        name, protocol, host, username, password, enableCustomSmtp, smtpHost, smtpPort
      });
      if (!validation.isValid) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid account data',
          400,
          validation.errors.join('; '),
          undefined,
          [
            'Fill out all required fields',
            'Ensure account name is descriptive',
            'Verify server and credential information is correct'
          ]
        );
      }

      // Create settingsJson based on protocol
      let settingsJson: string;
      
      if (protocol === 'IMAP') {
        const settings: any = {
          host: host.trim(),
          port: 993, // Always use 993 for IMAP
          username: username.trim(),
          password: password.trim(),
          useSSL: true // Always use SSL for IMAP
        };

        // Add SMTP configuration
        if (enableCustomSmtp) {
          if (!smtpHost?.trim() || !smtpPort?.trim()) {
            throw new ApiError(
              ErrorCodes.VALIDATION_ERROR,
              'SMTP configuration is incomplete',
              400,
              'SMTP host and port are required when custom SMTP is enabled',
              'smtpHost'
            );
          }
          settings.smtp = {
            host: smtpHost.trim(),
            port: parseInt(smtpPort),
            secure: smtpSecure ?? (parseInt(smtpPort) === 465),
            username: (smtpUsername || username).trim(),
            password: smtpPassword || password
          };
        } else {
          // Auto-configure SMTP based on IMAP settings
          const autoSmtpHost = host.replace(/^imap\./, 'smtp.');
          settings.smtp = {
            host: autoSmtpHost,
            port: 587,
            secure: false, // STARTTLS on port 587
            username: username.trim(),
            password: password.trim()
          };
        }

        settingsJson = JSON.stringify(settings);
      } else if (protocol === 'EWS') {
        settingsJson = JSON.stringify({
          host: host.trim(),
          username: username.trim(),
          password: password.trim()
        });
      } else {
        throw new ApiError(
          ErrorCodes.UNSUPPORTED_PROTOCOL,
          'Unsupported email protocol',
          400,
          `Protocol "${protocol}" is not supported`,
          'protocol'
        );
      }

      console.log(`[${requestId}] Creating new ${protocol} account: ${name}`);

      // Prepare account data for storage
      const accountData = {
        userId,
        name: name.trim(),
        protocol,
        settingsJson
      };
      
      // Create the account first
      const account = await storage.createAccountConnection(accountData);
      console.log(`[${requestId}] Account created with ID: ${account.id}`);
      
      // Get encrypted settings for connection testing
      const encryptedAccount = await storage.getAccountConnectionEncrypted(account.id);
      if (!encryptedAccount) {
        throw new ApiError(
          ErrorCodes.DATABASE_ERROR,
          'Failed to retrieve account for connection testing',
          500,
          'Account was created but could not be retrieved for validation'
        );
      }
      
      // Test the connection in the background (include SMTP test for IMAP)
      const testSmtp = protocol === 'IMAP';
      console.log(`[${requestId}] Starting background connection test`);
      
      testConnection(protocol as 'IMAP' | 'EWS', encryptedAccount.settingsJson, testSmtp, 2)
        .then(async (result) => {
          console.log(`[${requestId}] Background connection test result:`, result.success ? 'SUCCESS' : 'FAILED');
          
          // Update the account with connection test results
          await storage.updateAccountConnection(account.id, {
            isActive: result.success,
            lastChecked: result.lastChecked,
            lastError: result.error || null,
          });
          
          // If EWS account and successfully connected, discover folders first, then start push notifications
          if (result.success && protocol === 'EWS') {
            try {
              console.log(`[${requestId}] Discovering EWS folders for new account`);
              
              const folderDiscoveryResult = await discoverEwsFolders(account.id, encryptedAccount.settingsJson, storage);
              
              if (folderDiscoveryResult.success) {
                console.log(`[${requestId}] Folder discovery successful: ${folderDiscoveryResult.folderCount} folders discovered`);
                
                // Only start push notifications after successful folder discovery
                const pushService = getEwsPushService(storage);
                const subscriptionResult = await pushService.startSubscription(account.id);
                console.log(`[${requestId}] Push subscription result:`, subscriptionResult);
              } else {
                console.error(`[${requestId}] Folder discovery failed: ${folderDiscoveryResult.error}`);
                await storage.updateAccountConnection(account.id, {
                  lastError: `Folder discovery failed: ${folderDiscoveryResult.error}`
                });
              }
            } catch (error) {
              console.error(`[${requestId}] Failed to setup EWS account:`, error);
              await storage.updateAccountConnection(account.id, {
                lastError: `EWS setup failed: ${(error as Error).message}`
              });
            }
          }
          
          // If IMAP account and successfully connected, start IDLE connection
          if (result.success && protocol === 'IMAP') {
            try {
              const idleService = getImapIdleService(storage);
              const idleResult = await idleService.startIdleConnection(account.id, 'INBOX');
              console.log(`[${requestId}] IDLE connection result:`, idleResult);
            } catch (error) {
              console.error(`[${requestId}] Failed to start IDLE connection:`, error);
            }
          }
        })
        .catch(async (error) => {
          console.error(`[${requestId}] Background connection test failed:`, error);
          
          // Update with failure status
          await storage.updateAccountConnection(account.id, {
            isActive: false,
            lastChecked: new Date(),
            lastError: 'Connection test failed: ' + error.message,
          });
          
          // Stop services for failed accounts
          if (protocol === 'EWS') {
            try {
              const pushService = getEwsPushService(storage);
              await pushService.stopSubscription(account.id);
            } catch (cleanupError) {
              console.error(`[${requestId}] Failed to stop push subscription for failed account:`, cleanupError);
            }
          }
          
          if (protocol === 'IMAP') {
            try {
              const idleService = getImapIdleService(storage);
              await idleService.stopIdleConnection(account.id);
            } catch (cleanupError) {
              console.error(`[${requestId}] Failed to stop IDLE connection for failed account:`, cleanupError);
            }
          }
        });
      
      res.json(createSuccessResponse(account, 'Email account created successfully'));
    } catch (error) {
      handleApiError(error, res, 'POST /api/accounts', requestId);
    }
  });

  // Enhanced account update endpoint
  app.put('/api/accounts/:id', isAuthenticated, async (req: any, res) => {
    const requestId = `update-account-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const accountId = req.params.id;
      
      // Validate the ID format
      if (!accountId || typeof accountId !== 'string' || accountId.trim().length === 0) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid account ID',
          400,
          'Account ID must be a valid non-empty string',
          'id'
        );
      }
      
      // Check if account exists and belongs to user
      const existingAccount = await storage.getUserAccountConnections(userId);
      const accountToUpdate = existingAccount.find(acc => acc.id === accountId);
      
      if (!accountToUpdate) {
        throw new ApiError(
          ErrorCodes.ACCOUNT_NOT_FOUND,
          'Account not found',
          404,
          `Account with ID ${accountId} does not exist or does not belong to the user`,
          'id',
          [
            'Verify the account ID is correct',
            'Ensure you have permission to modify this account',
            'Check if the account was deleted'
          ]
        );
      }

      const { 
        name, protocol, host, port, username, password, useSSL,
        enableCustomSmtp, smtpHost, smtpPort, smtpSecure, smtpUsername, smtpPassword
      } = req.body;
      
      // Enhanced validation
      const validation = validateAccountData({
        name, protocol, host, username, password, enableCustomSmtp, smtpHost, smtpPort
      });
      if (!validation.isValid) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid account data',
          400,
          validation.errors.join('; ')
        );
      }

      // Create updated settingsJson
      let settingsJson: string;
      
      if (protocol === 'IMAP') {
        const settings: any = {
          host: host.trim(),
          port: 993,
          username: username.trim(),
          password: password.trim(),
          useSSL: true
        };

        if (enableCustomSmtp) {
          if (!smtpHost?.trim() || !smtpPort?.trim()) {
            throw new ApiError(
              ErrorCodes.VALIDATION_ERROR,
              'SMTP configuration is incomplete',
              400,
              'SMTP host and port are required when custom SMTP is enabled'
            );
          }
          settings.smtp = {
            host: smtpHost.trim(),
            port: parseInt(smtpPort),
            secure: smtpSecure ?? (parseInt(smtpPort) === 465),
            username: (smtpUsername || username).trim(),
            password: smtpPassword || password
          };
        } else {
          const autoSmtpHost = host.replace(/^imap\./, 'smtp.');
          settings.smtp = {
            host: autoSmtpHost,
            port: 587,
            secure: false,
            username: username.trim(),
            password: password.trim()
          };
        }

        settingsJson = JSON.stringify(settings);
      } else if (protocol === 'EWS') {
        settingsJson = JSON.stringify({
          host: host.trim(),
          username: username.trim(),
          password: password.trim()
        });
      } else {
        throw new ApiError(
          ErrorCodes.UNSUPPORTED_PROTOCOL,
          'Unsupported email protocol',
          400,
          `Protocol "${protocol}" is not supported`
        );
      }

      console.log(`[${requestId}] Updating account ${accountId} (${name})`);

      // Update the account
      const updatedAccount = await storage.updateAccountConnection(accountId, {
        name: name.trim(),
        protocol,
        settingsJson,
        isActive: false, // Will be updated after connection test
        lastError: null,
        lastChecked: new Date()
      });

      // Test connection in background
      const encryptedAccount = await storage.getAccountConnectionEncrypted(accountId);
      if (encryptedAccount) {
        const testSmtp = protocol === 'IMAP';
        testConnection(protocol as 'IMAP' | 'EWS', encryptedAccount.settingsJson, testSmtp, 2)
          .then(async (result) => {
            await storage.updateAccountConnection(accountId, {
              isActive: result.success,
              lastChecked: result.lastChecked,
              lastError: result.error || null,
            });
            console.log(`[${requestId}] Account update connection test result:`, result.success ? 'SUCCESS' : 'FAILED');
          })
          .catch(async (error) => {
            console.error(`[${requestId}] Account update connection test failed:`, error);
            await storage.updateAccountConnection(accountId, {
              isActive: false,
              lastError: 'Connection test failed: ' + error.message,
            });
          });
      }

      res.json(createSuccessResponse(updatedAccount, 'Account updated successfully'));
    } catch (error) {
      handleApiError(error, res, `PUT /api/accounts/${req.params.id}`, requestId);
    }
  });

  // Enhanced account deletion endpoint
  app.delete('/api/accounts/:id', isAuthenticated, async (req: any, res) => {
    const requestId = `delete-account-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const accountId = req.params.id;
      
      if (!accountId || typeof accountId !== 'string' || accountId.trim().length === 0) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid account ID',
          400,
          'Account ID must be a valid non-empty string'
        );
      }
      
      // Check if account exists and belongs to user
      const existingAccounts = await storage.getUserAccountConnections(userId);
      const accountToDelete = existingAccounts.find(acc => acc.id === accountId);
      
      if (!accountToDelete) {
        throw new ApiError(
          ErrorCodes.ACCOUNT_NOT_FOUND,
          'Account not found',
          404,
          `Account with ID ${accountId} does not exist or does not belong to the user`
        );
      }

      console.log(`[${requestId}] Deleting account ${accountId} (${accountToDelete.name})`);

      // Stop services before deletion
      if (accountToDelete.protocol === 'EWS') {
        try {
          const pushService = getEwsPushService(storage);
          await pushService.stopSubscription(accountId);
          console.log(`[${requestId}] EWS push subscription stopped`);
        } catch (error) {
          console.warn(`[${requestId}] Failed to stop EWS push subscription:`, error);
        }
      }
      
      if (accountToDelete.protocol === 'IMAP') {
        try {
          const idleService = getImapIdleService(storage);
          await idleService.stopIdleConnection(accountId);
          console.log(`[${requestId}] IMAP IDLE connection stopped`);
        } catch (error) {
          console.warn(`[${requestId}] Failed to stop IMAP IDLE connection:`, error);
        }
      }

      // Delete the account
      await storage.deleteAccountConnection(accountId);
      
      res.json(createSuccessResponse(
        { deletedAccountId: accountId },
        `Account "${accountToDelete.name}" deleted successfully`
      ));
    } catch (error) {
      handleApiError(error, res, `DELETE /api/accounts/${req.params.id}`, requestId);
    }
  });

  // Mail routes with enhanced error handling
  app.get('/api/mail', isAuthenticated, async (req: any, res) => {
    const requestId = `mail-list-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const { accountId, folder = 'INBOX', limit = 25, offset = 0 } = req.query;
      
      // Validate query parameters
      const limitNum = parseInt(limit as string);
      const offsetNum = parseInt(offset as string);
      
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 200) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid limit parameter',
          400,
          'Limit must be a number between 1 and 200',
          'limit'
        );
      }
      
      if (isNaN(offsetNum) || offsetNum < 0) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid offset parameter',
          400,
          'Offset must be a non-negative number',
          'offset'
        );
      }

      // If accountId is provided, get messages for that specific account
      // Otherwise, get messages across all user's accounts (legacy behavior)
      let messages;
      if (accountId) {
        // Verify user owns this account
        const userAccounts = await storage.getUserAccountConnections(userId);
        const account = userAccounts.find(acc => acc.id === accountId);
        if (!account) {
          throw new ApiError(
            ErrorCodes.AUTHORIZATION_FAILED,
            'Account not found or not owned by user',
            403,
            `Account ${accountId} not found or not accessible`
          );
        }
        
        // Map common folder names to protocol-specific names
        let mappedFolder = folder as string;
        if (account.protocol === 'EWS') {
          const ewsFolderMap: Record<string, string> = {
            'sent': 'SentItems',
            'drafts': 'Drafts', 
            'deleted': 'DeletedItems',
            'trash': 'DeletedItems',
            'spam': 'JunkEmail',
            'junk': 'JunkEmail',
            'archive': 'Archive'
          };
          mappedFolder = ewsFolderMap[folder.toLowerCase()] || folder as string;
        } else if (account.protocol === 'IMAP') {
          const imapFolderMap: Record<string, string> = {
            'sent': 'Sent',
            'drafts': 'Drafts',
            'deleted': 'Trash', 
            'trash': 'Trash',
            'spam': 'Spam',
            'junk': 'Spam'
          };
          mappedFolder = imapFolderMap[folder.toLowerCase()] || folder as string;
        }
        
        messages = await storage.getMailMessages(accountId as string, mappedFolder, limitNum, offsetNum);
      } else {
        // Legacy: get all messages for user across accounts (fallback for unified view)
        messages = await storage.getMailMessages(userId, folder as string, limitNum, offsetNum);
      }
      
      res.json(createSuccessResponse(
        messages,
        `Retrieved ${messages.length} messages from ${folder}${accountId ? ` (account ${accountId})` : ''}`
      ));
    } catch (error) {
      handleApiError(error, res, 'GET /api/mail', requestId);
    }
  });

  // Email search endpoint
  app.get('/api/mail/search', isAuthenticated, async (req: any, res) => {
    const requestId = `mail-search-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      // Extract and validate query parameters
      const {
        q: query,
        accountId,
        folder,
        searchFields,
        dateFrom,
        dateTo,
        hasAttachments,
        isRead,
        isFlagged,
        priority,
        limit = 50,
        offset = 0
      } = req.query;

      // Validate required query parameter
      if (!query || typeof query !== 'string' || !query.trim()) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Search query is required',
          400,
          'Please provide a search query using the "q" parameter',
          'q',
          ['Use the "q" parameter to specify your search query', 'Search query cannot be empty']
        );
      }

      // Validate numeric parameters
      const limitNum = parseInt(limit as string);
      const offsetNum = parseInt(offset as string);
      
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid limit parameter',
          400,
          'Limit must be a number between 1 and 100',
          'limit'
        );
      }
      
      if (isNaN(offsetNum) || offsetNum < 0) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid offset parameter',
          400,
          'Offset must be a non-negative number',
          'offset'
        );
      }

      // Parse search fields
      let searchFieldsArray: ('subject' | 'from' | 'to' | 'cc' | 'bcc' | 'body' | 'all')[] = ['all'];
      if (searchFields && typeof searchFields === 'string') {
        const fields = searchFields.split(',').map(f => f.trim()).filter(Boolean);
        const validFields = ['subject', 'from', 'to', 'cc', 'bcc', 'body', 'all'];
        const invalidFields = fields.filter(f => !validFields.includes(f));
        
        if (invalidFields.length > 0) {
          throw new ApiError(
            ErrorCodes.VALIDATION_ERROR,
            'Invalid search fields',
            400,
            `Invalid search fields: ${invalidFields.join(', ')}. Valid fields are: ${validFields.join(', ')}`,
            'searchFields'
          );
        }
        
        searchFieldsArray = fields as ('subject' | 'from' | 'to' | 'cc' | 'bcc' | 'body' | 'all')[];
      }

      // Parse date parameters
      let dateFromParsed: Date | undefined;
      let dateToParsed: Date | undefined;
      
      if (dateFrom && typeof dateFrom === 'string') {
        dateFromParsed = new Date(dateFrom);
        if (isNaN(dateFromParsed.getTime())) {
          throw new ApiError(
            ErrorCodes.VALIDATION_ERROR,
            'Invalid dateFrom parameter',
            400,
            'dateFrom must be a valid ISO date string',
            'dateFrom'
          );
        }
      }
      
      if (dateTo && typeof dateTo === 'string') {
        dateToParsed = new Date(dateTo);
        if (isNaN(dateToParsed.getTime())) {
          throw new ApiError(
            ErrorCodes.VALIDATION_ERROR,
            'Invalid dateTo parameter',
            400,
            'dateTo must be a valid ISO date string',
            'dateTo'
          );
        }
      }

      // Parse boolean parameters
      let hasAttachmentsParsed: boolean | undefined;
      let isReadParsed: boolean | undefined;
      let isFlaggedParsed: boolean | undefined;
      
      if (hasAttachments !== undefined) {
        if (hasAttachments === 'true') hasAttachmentsParsed = true;
        else if (hasAttachments === 'false') hasAttachmentsParsed = false;
        else {
          throw new ApiError(
            ErrorCodes.VALIDATION_ERROR,
            'Invalid hasAttachments parameter',
            400,
            'hasAttachments must be "true" or "false"',
            'hasAttachments'
          );
        }
      }
      
      if (isRead !== undefined) {
        if (isRead === 'true') isReadParsed = true;
        else if (isRead === 'false') isReadParsed = false;
        else {
          throw new ApiError(
            ErrorCodes.VALIDATION_ERROR,
            'Invalid isRead parameter',
            400,
            'isRead must be "true" or "false"',
            'isRead'
          );
        }
      }
      
      if (isFlagged !== undefined) {
        if (isFlagged === 'true') isFlaggedParsed = true;
        else if (isFlagged === 'false') isFlaggedParsed = false;
        else {
          throw new ApiError(
            ErrorCodes.VALIDATION_ERROR,
            'Invalid isFlagged parameter',
            400,
            'isFlagged must be "true" or "false"',
            'isFlagged'
          );
        }
      }

      // Parse priority parameter
      let priorityParsed: number | undefined;
      if (priority !== undefined) {
        priorityParsed = parseInt(priority as string);
        if (isNaN(priorityParsed) || priorityParsed < 0 || priorityParsed > 3) {
          throw new ApiError(
            ErrorCodes.VALIDATION_ERROR,
            'Invalid priority parameter',
            400,
            'Priority must be a number between 0 and 3',
            'priority'
          );
        }
      }

      // Build search parameters
      const searchParams: SearchEmailsParams = {
        userId,
        query: query.trim(),
        accountId: accountId as string | undefined,
        folder: folder as string | undefined,
        searchFields: searchFieldsArray,
        dateFrom: dateFromParsed,
        dateTo: dateToParsed,
        hasAttachments: hasAttachmentsParsed,
        isRead: isReadParsed,
        isFlagged: isFlaggedParsed,
        priority: priorityParsed,
        limit: limitNum,
        offset: offsetNum
      };

      console.log(`[${requestId}] Performing search: "${query}" with filters:`, {
        accountId,
        folder,
        searchFields: searchFieldsArray,
        limit: limitNum,
        offset: offsetNum
      });

      // Perform the search
      const searchResult = await storage.searchEmails(searchParams);

      res.json(createSuccessResponse(
        searchResult,
        `Found ${searchResult.totalCount} emails matching "${query}"${searchResult.hasMore ? ' (showing first batch)' : ''}`
      ));

    } catch (error) {
      handleApiError(error, res, 'GET /api/mail/search', requestId);
    }
  });

  // Enhanced email sending endpoint
  app.post('/api/mail/send', isAuthenticated, async (req: any, res) => {
    const requestId = `send-email-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      
      // Validate request body using Zod schema
      const emailRequest = sendEmailRequestSchema.parse(req.body);
      console.log(`[${requestId}] Sending email from account ${emailRequest.accountId}`);

      // Get and validate the account
      const accounts = await storage.getUserAccountConnections(userId);
      const account = accounts.find(acc => acc.id === emailRequest.accountId);
      
      if (!account) {
        throw new ApiError(
          ErrorCodes.ACCOUNT_NOT_FOUND,
          'Email account not found',
          404,
          `Account with ID ${emailRequest.accountId} does not exist or does not belong to the user`,
          'accountId',
          [
            'Verify the account ID is correct',
            'Ensure the account still exists',
            'Check if you have permission to send from this account'
          ]
        );
      }

      if (!account.isActive) {
        throw new ApiError(
          ErrorCodes.INVALID_ACCOUNT_STATE,
          'Cannot send email from inactive account',
          400,
          'The selected account has connection issues and cannot send emails',
          'accountId',
          [
            'Check the account connection status',
            'Test the account connection in settings',
            'Fix any configuration issues before sending'
          ]
        );
      }

      // Get encrypted account settings for SMTP configuration
      const encryptedAccount = await storage.getAccountConnectionEncrypted(emailRequest.accountId);
      if (!encryptedAccount) {
        throw new ApiError(
          ErrorCodes.DATABASE_ERROR,
          'Failed to retrieve account settings',
          500,
          'Account settings could not be loaded for email sending'
        );
      }

      // Decrypt and parse account settings
      let accountSettings: any;
      try {
        accountSettings = decryptAccountSettingsWithPassword(encryptedAccount.settingsJson);
      } catch (decryptError) {
        throw new ApiError(
          ErrorCodes.INTERNAL_SERVER_ERROR,
          'Failed to decrypt account settings',
          500,
          'Account settings could not be decrypted'
        );
      }

      // Validate email addresses
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(emailRequest.to)) {
        throw new ApiError(
          ErrorCodes.EMAIL_VALIDATION_FAILED,
          'Invalid recipient email address',
          400,
          `"${emailRequest.to}" is not a valid email address`,
          'to'
        );
      }

      // Configure transport for the account protocol
      let transporter: nodemailer.Transporter;
      
      if (account.protocol === 'EWS') {
        throw new ApiError(
          ErrorCodes.EMAIL_SEND_FAILED,
          'Email sending via EWS is not yet supported',
          501,
          'EWS email sending functionality is under development',
          undefined,
          [
            'Use an IMAP account for sending emails',
            'Contact support for EWS sending updates'
          ]
        );
      } else if (account.protocol === 'IMAP') {
        // Use SMTP settings from account configuration
        const smtpSettings = accountSettings.smtp;
        if (!smtpSettings || !smtpSettings.host) {
          throw new ApiError(
            ErrorCodes.EMAIL_SEND_FAILED,
            'SMTP configuration missing',
            500,
            'Account does not have proper SMTP settings configured'
          );
        }

        transporter = nodemailer.createTransport({
          host: smtpSettings.host,
          port: smtpSettings.port || 587,
          secure: smtpSettings.secure || false,
          auth: {
            user: smtpSettings.username || accountSettings.username,
            pass: smtpSettings.password || accountSettings.password,
          },
          connectionTimeout: 30000,
          greetingTimeout: 30000,
          socketTimeout: 30000,
        });

        // Verify SMTP connection
        try {
          await transporter.verify();
          console.log(`[${requestId}] SMTP connection verified`);
        } catch (error: any) {
          console.error(`[${requestId}] SMTP verification failed:`, error);
          throw new ApiError(
            ErrorCodes.SMTP_CONNECTION_FAILED,
            'SMTP connection failed',
            500,
            `Cannot connect to SMTP server: ${error.message}`,
            undefined,
            [
              'Check SMTP server settings in account configuration',
              'Verify SMTP credentials are correct',
              'Ensure SMTP server is reachable'
            ]
          );
        }
      } else {
        throw new ApiError(
          ErrorCodes.UNSUPPORTED_PROTOCOL,
          'Unsupported protocol for email sending',
          400,
          `Protocol "${account.protocol}" does not support email sending`
        );
      }

      // Prepare email message
      const mailOptions = {
        from: `"${account.name}" <${accountSettings.username}>`,
        to: emailRequest.to,
        cc: emailRequest.cc,
        bcc: emailRequest.bcc,
        subject: emailRequest.subject,
        text: emailRequest.body,
        html: emailRequest.bodyHtml,
        replyTo: undefined,
        attachments: emailRequest.attachments?.map(att => ({
          filename: att.filename,
          content: Buffer.from(att.content, 'base64'),
          contentType: att.contentType
        }))
      };

      // Send the email
      let sendResult: any;
      try {
        sendResult = await transporter.sendMail(mailOptions);
        console.log(`[${requestId}] Email sent successfully:`, sendResult.messageId);
      } catch (error: any) {
        console.error(`[${requestId}] Failed to send email:`, error);
        throw new ApiError(
          ErrorCodes.EMAIL_SEND_FAILED,
          'Failed to send email',
          500,
          `Email sending failed: ${error.message}`,
          undefined,
          [
            'Check your internet connection',
            'Verify recipient email addresses are correct',
            'Ensure account SMTP settings are valid',
            'Try sending the email again'
          ]
        );
      }

      // Store sent email in database for record keeping
      const sentEmailData = {
        userId,
        accountId: emailRequest.accountId,
        messageId: sendResult.messageId || `sent-${Date.now()}`,
        from: mailOptions.from,
        to: emailRequest.to,
        cc: emailRequest.cc || null,
        bcc: emailRequest.bcc || null,
        subject: emailRequest.subject,
        textContent: emailRequest.body || null,
        htmlContent: emailRequest.bodyHtml || null,
        folder: 'Sent',
        flags: ['\\Seen'],
        date: new Date(),
        size: JSON.stringify(mailOptions).length,
        replyTo: null,
        attachments: emailRequest.attachments || []
      };

      try {
        await storage.createMailMessage(sentEmailData);
        console.log(`[${requestId}] Sent email stored in database`);
      } catch (error) {
        console.error(`[${requestId}] Failed to store sent email in database:`, error);
        // Don't fail the entire request if database storage fails
      }

      const response: SendEmailResponse = {
        success: true,
        messageId: sendResult.messageId,
        sentAt: new Date()
      };

      res.json(createSuccessResponse(response, 'Email sent successfully'));

    } catch (error) {
      handleApiError(error, res, 'POST /api/mail/send', requestId);
    }
  });

  // Configure secure upload directory with randomized path
  const baseUploadDir = path.join(process.cwd(), 'uploads');
  const uploadDir = path.join(baseUploadDir, 'attachments', Date.now().toString());
  if (!existsSync(uploadDir)) {
    mkdirSync(uploadDir, { recursive: true, mode: 0o700 }); // Restrict permissions
  }

  const storage_multer = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      // Generate completely random filename for security (no original filename preserved)
      const randomBytes = require('crypto').randomBytes(16).toString('hex');
      const timestamp = Date.now();
      const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv'];
      const originalExt = path.extname(file.originalname).toLowerCase();
      
      // Only use extension if it's in our allowed list
      const safeExtension = allowedExtensions.includes(originalExt) ? originalExt : '.bin';
      
      cb(null, `attachment_${timestamp}_${randomBytes}${safeExtension}`);
    }
  });

  // Secure file filter with comprehensive validation
  const fileFilter = (req: any, file: any, cb: any) => {
    // Allowed file types - restrictive whitelist for security
    const allowedMimeTypes = [
      // Safe image formats (excluding SVG which can contain scripts)
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      // Documents
      'application/pdf',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      // Text files
      'text/plain', 'text/csv'
      // Removed: SVG (can contain JavaScript), ZIP (can contain executables)
    ];
    
    // Dangerous extensions to block regardless of MIME type
    const blockedExtensions = [
      '.exe', '.bat', '.cmd', '.scr', '.com', '.pif', '.vbs', '.js', '.jar',
      '.app', '.deb', '.pkg', '.dmg', '.sh', '.ps1', '.msi', '.dll', '.so',
      '.svg' // Blocked due to potential script content
    ];
    
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    // Check blocked extensions first
    if (blockedExtensions.includes(fileExtension)) {
      cb(new ApiError(
        ErrorCodes.INVALID_FILE_TYPE,
        'File extension not allowed',
        400,
        `Files with ${fileExtension} extension are blocked for security`,
        'file',
        ['Please upload only safe file types: images (PNG, JPG, GIF, WebP), PDFs, Office documents, or text files']
      ));
      return;
    }
    
    // Check MIME type
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ApiError(
        ErrorCodes.INVALID_FILE_TYPE,
        'File type not allowed',
        400,
        `File type ${file.mimetype} is not supported`,
        'file',
        ['Please upload only safe file types: images (PNG, JPG, GIF, WebP), PDFs, Office documents, or text files']
      ));
    }
  };

  const upload = multer({
    storage: storage_multer,
    fileFilter,
    limits: {
      fileSize: 25 * 1024 * 1024, // 25MB max file size
      files: 10 // Max 10 files per upload
    }
  });

  // Attachment endpoints
  
  // Upload attachments
  app.post('/api/attachments/upload', isAuthenticated, upload.array('attachments', 10), async (req: any, res) => {
    const requestId = `upload-attachments-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const files = req.files as Express.Multer.File[];
      
      if (!files || files.length === 0) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'No files provided',
          400,
          'At least one file must be uploaded',
          'attachments',
          ['Please select one or more files to upload']
        );
      }

      // Optional: Associate with specific email (for draft attachments)
      const { emailId } = req.body;

      const attachments = [];
      for (const file of files) {
        // Additional server-side validation
        if (file.size > 25 * 1024 * 1024) {
          throw new ApiError(
            ErrorCodes.FILE_SIZE_EXCEEDED,
            'File size exceeds limit',
            400,
            `File ${file.originalname} is ${Math.round(file.size / 1024 / 1024)}MB, maximum allowed is 25MB`
          );
        }
        
        // Sanitize original filename to prevent path traversal
        const sanitizedFileName = file.originalname
          .replace(/[^a-zA-Z0-9.-]/g, '_')
          .substring(0, 100); // Limit filename length
        
        const attachmentData = {
          emailId: emailId || null, // Can be null for temporary uploads
          fileName: sanitizedFileName, // Store sanitized version of original name for user display
          fileSize: file.size,
          mimeType: file.mimetype,
          filePath: file.path,
          isInline: false,
          contentId: null,
          uploadedBy: userId // Track who uploaded the file
        };

        const attachment = await storage.createAttachment(attachmentData);
        attachments.push({
          id: attachment.id,
          fileName: attachment.fileName,
          fileSize: attachment.fileSize,
          mimeType: attachment.mimeType,
          uploadedAt: attachment.createdAt
        });
      }

      res.json(createSuccessResponse(
        attachments,
        `Successfully uploaded ${attachments.length} file(s)`
      ));

    } catch (error) {
      // Clean up uploaded files on error
      if (req.files) {
        const files = req.files as Express.Multer.File[];
        for (const file of files) {
          try {
            await fs.unlink(file.path);
          } catch (unlinkError) {
            console.error(`Failed to delete uploaded file ${file.path}:`, unlinkError);
          }
        }
      }
      handleApiError(error, res, 'POST /api/attachments/upload', requestId);
    }
  });

  // Download attachment
  app.get('/api/attachments/:id/download', isAuthenticated, async (req: any, res) => {
    const requestId = `download-attachment-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const attachmentId = req.params.id;

      const attachment = await storage.getAttachment(attachmentId);
      if (!attachment) {
        throw new ApiError(
          ErrorCodes.ATTACHMENT_NOT_FOUND,
          'Attachment not found',
          404,
          `Attachment with ID ${attachmentId} does not exist`
        );
      }

      // Security check: Verify user has access to this attachment
      if (attachment.emailId) {
        // Get the email and verify ownership
        const email = await storage.getMailMessage(attachment.emailId);
        if (!email) {
          throw new ApiError(
            ErrorCodes.AUTHORIZATION_FAILED,
            'Access denied',
            403,
            'You do not have permission to access this attachment'
          );
        }

        // Verify user owns the account this email belongs to
        const accounts = await storage.getUserAccountConnections(userId);
        const hasAccess = accounts.some(acc => acc.id === email.accountId);
        if (!hasAccess) {
          throw new ApiError(
            ErrorCodes.AUTHORIZATION_FAILED,
            'Access denied',
            403,
            'You do not have permission to access this attachment'
          );
        }
      }

      // Check if file exists
      if (!existsSync(attachment.filePath)) {
        throw new ApiError(
          ErrorCodes.FILE_NOT_FOUND,
          'File not found on server',
          404,
          'The attachment file could not be found on the server',
          undefined,
          ['The file may have been deleted or moved', 'Please contact support if this persists']
        );
      }

      // Set proper headers for file download
      res.setHeader('Content-Type', attachment.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${attachment.fileName}"`);
      res.setHeader('Content-Length', attachment.fileSize.toString());

      // Stream the file
      const fileStream = await fs.readFile(attachment.filePath);
      res.send(fileStream);

    } catch (error) {
      handleApiError(error, res, 'GET /api/attachments/:id/download', requestId);
    }
  });

  // Delete attachment
  app.delete('/api/attachments/:id', isAuthenticated, async (req: any, res) => {
    const requestId = `delete-attachment-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const attachmentId = req.params.id;

      const attachment = await storage.getAttachment(attachmentId);
      if (!attachment) {
        throw new ApiError(
          ErrorCodes.ATTACHMENT_NOT_FOUND,
          'Attachment not found',
          404,
          `Attachment with ID ${attachmentId} does not exist`
        );
      }

      // Security check: Verify user has access to delete this attachment
      if (attachment.emailId) {
        const email = await storage.getMailMessage(attachment.emailId);
        if (email) {
          const accounts = await storage.getUserAccountConnections(userId);
          const hasAccess = accounts.some(acc => acc.id === email.accountId);
          if (!hasAccess) {
            throw new ApiError(
              ErrorCodes.AUTHORIZATION_FAILED,
              'Access denied',
              403,
              'You do not have permission to delete this attachment'
            );
          }
        }
      }

      // Delete file from filesystem
      try {
        if (existsSync(attachment.filePath)) {
          await fs.unlink(attachment.filePath);
        }
      } catch (error) {
        console.error(`Failed to delete file ${attachment.filePath}:`, error);
        // Continue with database deletion even if file deletion fails
      }

      // Delete from database
      await storage.deleteAttachment(attachmentId);

      res.json(createSuccessResponse(
        { id: attachmentId },
        'Attachment deleted successfully'
      ));

    } catch (error) {
      handleApiError(error, res, 'DELETE /api/attachments/:id', requestId);
    }
  });

  // Get attachments for an email
  app.get('/api/emails/:emailId/attachments', isAuthenticated, async (req: any, res) => {
    const requestId = `get-email-attachments-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const emailId = req.params.emailId;

      // Verify user has access to this email
      const email = await storage.getMailMessage(emailId);
      if (!email) {
        throw new ApiError(
          ErrorCodes.RESOURCE_NOT_FOUND,
          'Email not found',
          404,
          `Email with ID ${emailId} does not exist`
        );
      }

      const accounts = await storage.getUserAccountConnections(userId);
      const hasAccess = accounts.some(acc => acc.id === email.accountId);
      if (!hasAccess) {
        throw new ApiError(
          ErrorCodes.AUTHORIZATION_FAILED,
          'Access denied',
          403,
          'You do not have permission to access this email'
        );
      }

      const attachments = await storage.getEmailAttachments(emailId);

      // Return attachment metadata (without file paths for security)
      const attachmentList = attachments.map(att => ({
        id: att.id,
        fileName: att.fileName,
        fileSize: att.fileSize,
        mimeType: att.mimeType,
        isInline: att.isInline,
        contentId: att.contentId,
        createdAt: att.createdAt
      }));

      res.json(createSuccessResponse(
        attachmentList,
        `Found ${attachmentList.length} attachment(s)`
      ));

    } catch (error) {
      handleApiError(error, res, 'GET /api/emails/:emailId/attachments', requestId);
    }
  });

  // Email organization routes
  // Star/Unstar email
  app.patch('/api/mail/:emailId/star', isAuthenticated, async (req: any, res) => {
    const requestId = `star-email-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const emailId = req.params.emailId;
      const { starred } = req.body;

      if (typeof starred !== 'boolean') {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid starred parameter',
          400,
          'starred must be a boolean value',
          'starred'
        );
      }

      // Verify user has access to this email
      const email = await storage.getMailMessage(emailId);
      if (!email) {
        throw new ApiError(
          ErrorCodes.RESOURCE_NOT_FOUND,
          'Email not found',
          404,
          `Email with ID ${emailId} does not exist`
        );
      }

      const accounts = await storage.getUserAccountConnections(userId);
      const hasAccess = accounts.some(acc => acc.id === email.accountId);
      if (!hasAccess) {
        throw new ApiError(
          ErrorCodes.AUTHORIZATION_FAILED,
          'Access denied',
          403,
          'You do not have permission to modify this email'
        );
      }

      // Update star status
      const updatedEmail = starred 
        ? await storage.starEmail(emailId)
        : await storage.unstarEmail(emailId);

      if (!updatedEmail) {
        throw new ApiError(
          ErrorCodes.DATABASE_ERROR,
          'Failed to update email star status',
          500,
          'Email star status could not be updated'
        );
      }

      res.json(createSuccessResponse(
        updatedEmail,
        `Email ${starred ? 'starred' : 'unstarred'} successfully`
      ));

    } catch (error) {
      handleApiError(error, res, 'PATCH /api/mail/:emailId/star', requestId);
    }
  });

  // Archive/Unarchive email
  app.patch('/api/mail/:emailId/archive', isAuthenticated, async (req: any, res) => {
    const requestId = `archive-email-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const emailId = req.params.emailId;
      const { archived } = req.body;

      if (typeof archived !== 'boolean') {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid archived parameter',
          400,
          'archived must be a boolean value',
          'archived'
        );
      }

      // Verify user has access to this email
      const email = await storage.getMailMessage(emailId);
      if (!email) {
        throw new ApiError(
          ErrorCodes.RESOURCE_NOT_FOUND,
          'Email not found',
          404,
          `Email with ID ${emailId} does not exist`
        );
      }

      const accounts = await storage.getUserAccountConnections(userId);
      const hasAccess = accounts.some(acc => acc.id === email.accountId);
      if (!hasAccess) {
        throw new ApiError(
          ErrorCodes.AUTHORIZATION_FAILED,
          'Access denied',
          403,
          'You do not have permission to modify this email'
        );
      }

      // Update archive status
      const updatedEmail = archived 
        ? await storage.archiveEmail(emailId)
        : await storage.unarchiveEmail(emailId);

      if (!updatedEmail) {
        throw new ApiError(
          ErrorCodes.DATABASE_ERROR,
          'Failed to update email archive status',
          500,
          'Email archive status could not be updated'
        );
      }

      res.json(createSuccessResponse(
        updatedEmail,
        `Email ${archived ? 'archived' : 'unarchived'} successfully`
      ));

    } catch (error) {
      handleApiError(error, res, 'PATCH /api/mail/:emailId/archive', requestId);
    }
  });

  // Delete/Restore email (soft delete)
  app.patch('/api/mail/:emailId/delete', isAuthenticated, async (req: any, res) => {
    const requestId = `delete-email-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const emailId = req.params.emailId;
      const { deleted } = req.body;

      if (typeof deleted !== 'boolean') {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid deleted parameter',
          400,
          'deleted must be a boolean value',
          'deleted'
        );
      }

      // Verify user has access to this email
      const email = await storage.getMailMessage(emailId);
      if (!email) {
        throw new ApiError(
          ErrorCodes.RESOURCE_NOT_FOUND,
          'Email not found',
          404,
          `Email with ID ${emailId} does not exist`
        );
      }

      const accounts = await storage.getUserAccountConnections(userId);
      const hasAccess = accounts.some(acc => acc.id === email.accountId);
      if (!hasAccess) {
        throw new ApiError(
          ErrorCodes.AUTHORIZATION_FAILED,
          'Access denied',
          403,
          'You do not have permission to modify this email'
        );
      }

      // Update delete status
      const updatedEmail = deleted 
        ? await storage.softDeleteEmail(emailId)
        : await storage.restoreEmail(emailId);

      if (!updatedEmail) {
        throw new ApiError(
          ErrorCodes.DATABASE_ERROR,
          'Failed to update email delete status',
          500,
          'Email delete status could not be updated'
        );
      }

      res.json(createSuccessResponse(
        updatedEmail,
        `Email ${deleted ? 'deleted' : 'restored'} successfully`
      ));

    } catch (error) {
      handleApiError(error, res, 'PATCH /api/mail/:emailId/delete', requestId);
    }
  });

  // Get starred emails
  app.get('/api/mail/starred', isAuthenticated, async (req: any, res) => {
    const requestId = `get-starred-emails-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const { limit = 25, offset = 0 } = req.query;
      
      const limitNum = parseInt(limit as string);
      const offsetNum = parseInt(offset as string);
      
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 200) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid limit parameter',
          400,
          'Limit must be a number between 1 and 200',
          'limit'
        );
      }
      
      if (isNaN(offsetNum) || offsetNum < 0) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid offset parameter',
          400,
          'Offset must be a non-negative number',
          'offset'
        );
      }

      const emails = await storage.getStarredEmails(userId, limitNum, offsetNum);
      
      res.json(createSuccessResponse(
        emails,
        `Found ${emails.length} starred email(s)`
      ));

    } catch (error) {
      handleApiError(error, res, 'GET /api/mail/starred', requestId);
    }
  });

  // Get archived emails
  app.get('/api/mail/archived', isAuthenticated, async (req: any, res) => {
    const requestId = `get-archived-emails-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const { limit = 25, offset = 0 } = req.query;
      
      const limitNum = parseInt(limit as string);
      const offsetNum = parseInt(offset as string);
      
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 200) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid limit parameter',
          400,
          'Limit must be a number between 1 and 200',
          'limit'
        );
      }
      
      if (isNaN(offsetNum) || offsetNum < 0) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid offset parameter',
          400,
          'Offset must be a non-negative number',
          'offset'
        );
      }

      const emails = await storage.getArchivedEmails(userId, limitNum, offsetNum);
      
      res.json(createSuccessResponse(
        emails,
        `Found ${emails.length} archived email(s)`
      ));

    } catch (error) {
      handleApiError(error, res, 'GET /api/mail/archived', requestId);
    }
  });

  // Get deleted emails (trash)
  app.get('/api/mail/deleted', isAuthenticated, async (req: any, res) => {
    const requestId = `get-deleted-emails-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const { limit = 25, offset = 0 } = req.query;
      
      const limitNum = parseInt(limit as string);
      const offsetNum = parseInt(offset as string);
      
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 200) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid limit parameter',
          400,
          'Limit must be a number between 1 and 200',
          'limit'
        );
      }
      
      if (isNaN(offsetNum) || offsetNum < 0) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid offset parameter',
          400,
          'Offset must be a non-negative number',
          'offset'
        );
      }

      const emails = await storage.getDeletedEmails(userId, limitNum, offsetNum);
      
      res.json(createSuccessResponse(
        emails,
        `Found ${emails.length} deleted email(s)`
      ));

    } catch (error) {
      handleApiError(error, res, 'GET /api/mail/deleted', requestId);
    }
  });

  // User preferences routes with enhanced error handling
  app.get('/api/preferences', isAuthenticated, async (req: any, res) => {
    const requestId = `preferences-get-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const preferences = await storage.getUserPrefs(userId);
      res.json(createSuccessResponse(preferences, 'User preferences retrieved'));
    } catch (error) {
      handleApiError(error, res, 'GET /api/preferences', requestId);
    }
  });

  app.post('/api/preferences', isAuthenticated, async (req: any, res) => {
    const requestId = `preferences-update-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const preferences = req.body;
      
      // Basic validation
      if (preferences.syncInterval && (preferences.syncInterval < 60 || preferences.syncInterval > 3600)) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid sync interval',
          400,
          'Sync interval must be between 60 and 3600 seconds',
          'syncInterval'
        );
      }

      const updatedPreferences = await storage.upsertUserPrefs({ ...preferences, userId });
      res.json(createSuccessResponse(
        updatedPreferences,
        'User preferences updated successfully'
      ));
    } catch (error) {
      handleApiError(error, res, 'POST /api/preferences', requestId);
    }
  });

  // Unified message aggregation endpoint for All Accounts view
  app.get('/api/mail/unified/:folder?', isAuthenticated, async (req: any, res) => {
    const requestId = `unified-mail-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const { limit = 50, offset = 0 } = req.query;
      const folder = req.params.folder || 'INBOX';
      
      console.log(`[${requestId}] Fetching unified messages for user ${userId}, folder: ${folder}`);
      
      // Get all user's accounts
      const accounts = await storage.getUserAccountConnections(userId);
      
      if (accounts.length === 0) {
        res.json(createSuccessResponse([], 'No accounts found'));
        return;
      }
      
      console.log(`[${requestId}] Found ${accounts.length} accounts for user`);
      
      // Fetch messages from all accounts in parallel
      const messagePromises = accounts.map(async (account) => {
        try {
          // Map common folder names to protocol-specific names for each account
          let mappedFolder = folder;
          if (account.protocol === 'EWS') {
            const ewsFolderMap: Record<string, string> = {
              'sent': 'SentItems',
              'drafts': 'Drafts', 
              'deleted': 'DeletedItems',
              'trash': 'DeletedItems',
              'spam': 'JunkEmail',
              'junk': 'JunkEmail',
              'archive': 'Archive'
            };
            mappedFolder = ewsFolderMap[folder.toLowerCase()] || folder;
          } else if (account.protocol === 'IMAP') {
            const imapFolderMap: Record<string, string> = {
              'sent': 'Sent',
              'drafts': 'Drafts',
              'deleted': 'Trash', 
              'trash': 'Trash',
              'spam': 'Spam',
              'junk': 'Spam'
            };
            mappedFolder = imapFolderMap[folder.toLowerCase()] || folder;
          }
          
          console.log(`[${requestId}] Fetching messages for account ${account.id} (${account.name}), folder: ${folder} → ${mappedFolder}`);
          const messages = await storage.getMailMessages(account.id, mappedFolder, Number(limit), Number(offset));
          console.log(`[${requestId}] Found ${messages.length} messages for account ${account.id}`);
          
          // Add account info to each message for frontend display
          return messages.map(msg => ({
            ...msg,
            accountName: account.name,
            accountProtocol: account.protocol,
            accountId: account.id
          }));
        } catch (error) {
          console.error(`[${requestId}] Failed to fetch messages for account ${account.id}:`, error);
          return []; // Return empty array on failure to not break the aggregation
        }
      });
      
      const accountMessages = await Promise.all(messagePromises);
      
      // Flatten and sort all messages by date (newest first)
      const allMessages = accountMessages
        .flat()
        .sort((a, b) => {
          const dateA = a.date ? new Date(a.date).getTime() : 0;
          const dateB = b.date ? new Date(b.date).getTime() : 0;
          return dateB - dateA;
        })
        .slice(0, Number(limit)); // Apply limit after sorting
      
      console.log(`[${requestId}] Returning ${allMessages.length} unified messages`);
      
      res.json(createSuccessResponse(allMessages, `Retrieved ${allMessages.length} unified messages`));
      
    } catch (error) {
      handleApiError(error, res, 'GET /api/mail/unified', requestId);
    }
  });

  // Unified message count aggregation for folder badges
  app.get('/api/mail/unified-counts', isAuthenticated, async (req: any, res) => {
    const requestId = `unified-counts-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      
      console.log(`[${requestId}] Fetching unified message counts for user ${userId}`);
      
      // Get all user's accounts
      const accounts = await storage.getUserAccountConnections(userId);
      
      if (accounts.length === 0) {
        res.json(createSuccessResponse({}, 'No accounts found'));
        return;
      }
      
      // Get folder counts from all accounts
      const countPromises = accounts.map(async (account) => {
        try {
          const folders = await storage.getAccountFolders(account.id);
          return {
            accountId: account.id,
            accountName: account.name,
            folders: folders.reduce((acc, folder) => {
              acc[folder.folderType] = {
                unread: folder.unreadCount || 0,
                total: folder.totalCount || 0
              };
              return acc;
            }, {} as Record<string, { unread: number; total: number }>)
          };
        } catch (error) {
          console.error(`[${requestId}] Failed to fetch folder counts for account ${account.id}:`, error);
          return { accountId: account.id, accountName: account.name, folders: {} };
        }
      });
      
      const accountCounts = await Promise.all(countPromises);
      
      // Aggregate counts by folder type across all accounts
      const unifiedCounts = accountCounts.reduce((acc, account) => {
        Object.entries(account.folders).forEach(([folderType, counts]) => {
          if (!acc[folderType]) {
            acc[folderType] = { unread: 0, total: 0 };
          }
          acc[folderType].unread += counts.unread;
          acc[folderType].total += counts.total;
        });
        return acc;
      }, {} as Record<string, { unread: number; total: number }>);
      
      console.log(`[${requestId}] Returning unified counts for ${Object.keys(unifiedCounts).length} folder types`);
      
      res.json(createSuccessResponse({
        unified: unifiedCounts,
        accounts: accountCounts
      }, 'Unified message counts retrieved'));
      
    } catch (error) {
      handleApiError(error, res, 'GET /api/mail/unified-counts', requestId);
    }
  });

  // Manual folder discovery endpoint
  app.post('/api/accounts/:accountId/discover-folders', isAuthenticated, async (req: any, res) => {
    const requestId = `discover-folders-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const accountId = req.params.accountId;
      
      if (!accountId) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Account ID is required',
          400,
          'Account ID parameter is missing'
        );
      }

      // Verify account belongs to user
      const accounts = await storage.getUserAccountConnections(userId);
      const account = accounts.find(acc => acc.id === accountId);
      
      if (!account) {
        throw new ApiError(
          ErrorCodes.ACCOUNT_NOT_FOUND,
          'Account not found',
          404,
          `Account with ID ${accountId} does not exist or does not belong to the user`
        );
      }

      const encryptedAccount = await storage.getAccountConnectionEncrypted(accountId);
      if (!encryptedAccount) {
        throw new ApiError(
          ErrorCodes.DATABASE_ERROR,
          'Failed to retrieve account settings',
          500
        );
      }
      
      console.log(`[${requestId}] Starting manual folder discovery for account ${accountId}`);

      let result: any;
      if (account.protocol === 'EWS') {
        result = await discoverEwsFolders(accountId, encryptedAccount.settingsJson, storage);
      } else if (account.protocol === 'IMAP') {
        result = await discoverImapFolders(accountId, encryptedAccount.settingsJson, storage);
      } else {
        throw new ApiError(
          ErrorCodes.UNSUPPORTED_PROTOCOL,
          'Folder discovery not supported for this protocol',
          400,
          `Protocol "${account.protocol}" does not support folder discovery`
        );
      }
      
      if (result.success) {
        res.json(createSuccessResponse(
          result,
          `Discovered ${result.folderCount || 0} folders successfully`
        ));
      } else {
        throw new ApiError(
          ErrorCodes.INTERNAL_SERVER_ERROR,
          'Folder discovery failed',
          500,
          result.error || 'Unknown error during folder discovery'
        );
      }
    } catch (error) {
      handleApiError(error, res, `POST /api/accounts/${req.params.accountId}/discover-folders`, requestId);
    }
  });

  // Email sync endpoints - CRITICAL MISSING ROUTES
  app.post('/api/sync/all', isAuthenticated, async (req: any, res) => {
    const requestId = `sync-all-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      console.log(`[${requestId}] Starting sync for all accounts for user ${userId}`);
      
      const results = await syncAllUserAccounts(userId, storage);
      
      console.log(`[${requestId}] Sync completed for ${results.length} accounts`);
      
      res.json(createSuccessResponse(
        results,
        `Synchronization completed for ${results.length} accounts`
      ));
    } catch (error) {
      handleApiError(error, res, 'POST /api/sync/all', requestId);
    }
  });

  app.post('/api/accounts/:accountId/sync', isAuthenticated, async (req: any, res) => {
    const requestId = `sync-account-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const accountId = req.params.accountId;
      const { folder = 'INBOX', limit = 50 } = req.body;
      
      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      if (!accountId) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Account ID is required',
          400,
          'Account ID parameter is missing'
        );
      }

      // Verify account belongs to user
      const accounts = await storage.getUserAccountConnections(userId);
      const account = accounts.find(acc => acc.id === accountId);
      
      if (!account) {
        throw new ApiError(
          ErrorCodes.ACCOUNT_NOT_FOUND,
          'Account not found',
          404,
          `Account with ID ${accountId} does not exist or does not belong to the user`
        );
      }

      if (!account.isActive) {
        throw new ApiError(
          ErrorCodes.INVALID_ACCOUNT_STATE,
          'Cannot sync inactive account',
          400,
          'The account is not active and cannot be synchronized'
        );
      }

      console.log(`[${requestId}] Starting sync for account ${accountId} (${account.protocol})`);

      // Get encrypted account settings
      const encryptedAccount = await storage.getAccountConnectionEncrypted(accountId);
      if (!encryptedAccount) {
        throw new ApiError(
          ErrorCodes.DATABASE_ERROR,
          'Failed to retrieve account settings',
          500
        );
      }

      let result: any;
      
      if (account.protocol === 'EWS') {
        // For EWS, check if folders exist first, discover if needed
        const existingFolders = await storage.getAccountFolders(accountId);
        if (existingFolders.length === 0) {
          console.log(`[${requestId}] Discovering folders for EWS account before sync`);
          const folderResult = await discoverEwsFolders(accountId, encryptedAccount.settingsJson, storage);
          if (!folderResult.success) {
            throw new ApiError(
              ErrorCodes.INTERNAL_SERVER_ERROR,
              'Folder discovery failed',
              500,
              folderResult.error || 'Could not discover EWS folders'
            );
          }
        }
        
        // Sync multiple important folders for EWS
        const foldersToSync = ['INBOX', 'SentItems', 'Drafts'];
        let overallSuccess = true;
        let lastError: string | null = null;
        let totalMessageCount = 0;
        
        for (const folderName of foldersToSync) {
          try {
            console.log(`[${requestId}] Syncing EWS folder: ${folderName} for account ${account.name}`);
            const syncResult = await syncEwsEmails(storage, accountId, folderName, limit);
            
            if (syncResult.success) {
              totalMessageCount += syncResult.messageCount || 0;
              console.log(`[${requestId}] Successfully synced ${syncResult.messageCount || 0} messages from ${folderName}`);
            } else {
              console.log(`[${requestId}] Failed to sync folder ${folderName}: ${syncResult.error}`);
              if (folderName === 'INBOX') {
                // INBOX failure is critical
                overallSuccess = false;
                lastError = syncResult.error || `Failed to sync ${folderName}`;
              }
            }
          } catch (error) {
            console.log(`[${requestId}] Error syncing folder ${folderName}: ${(error as Error).message}`);
            if (folderName === 'INBOX') {
              overallSuccess = false;
              lastError = `Failed to sync ${folderName}: ${(error as Error).message}`;
            }
          }
        }
        
        result = {
          success: overallSuccess,
          messageCount: totalMessageCount,
          lastSync: new Date(),
          error: lastError
        };
      } else if (account.protocol === 'IMAP') {
        // Sync multiple important folders for IMAP
        const foldersToSync = ['INBOX', 'Sent', 'Sent Items', 'Drafts'];
        let overallSuccess = true;
        let lastError: string | null = null;
        let totalMessageCount = 0;
        
        for (const folderName of foldersToSync) {
          try {
            console.log(`[${requestId}] Syncing IMAP folder: ${folderName} for account ${account.name}`);
            const syncResult = await syncImapEmails(accountId, encryptedAccount.settingsJson, storage, { folder: folderName, limit });
            
            if (syncResult.success) {
              totalMessageCount += syncResult.messageCount || 0;
              console.log(`[${requestId}] Successfully synced ${syncResult.messageCount || 0} messages from ${folderName}`);
            } else {
              console.log(`[${requestId}] Failed to sync folder ${folderName}: ${syncResult.error}`);
              if (folderName === 'INBOX') {
                // INBOX failure is critical
                overallSuccess = false;
                lastError = syncResult.error || `Failed to sync ${folderName}`;
              }
            }
          } catch (error) {
            console.log(`[${requestId}] Error syncing folder ${folderName}: ${(error as Error).message}`);
            if (folderName === 'INBOX') {
              overallSuccess = false;
              lastError = `Failed to sync ${folderName}: ${(error as Error).message}`;
            }
          }
        }
        
        result = {
          success: overallSuccess,
          messageCount: totalMessageCount,
          lastSync: new Date(),
          error: lastError
        };
      } else {
        throw new ApiError(
          ErrorCodes.UNSUPPORTED_PROTOCOL,
          'Sync not supported for this protocol',
          400,
          `Protocol "${account.protocol}" does not support synchronization`
        );
      }

      console.log(`[${requestId}] Sync completed for account ${accountId}: ${result.success ? 'success' : 'failed'}`);

      if (result.success) {
        // Update account sync status
        await storage.updateAccountConnection(accountId, {
          lastError: null,
          lastChecked: result.lastSync || new Date()
        });

        res.json(createSuccessResponse(
          result,
          `Account synchronized successfully. ${result.messageCount || 0} messages processed.`
        ));
      } else {
        // Update account with error
        await storage.updateAccountConnection(accountId, {
          lastError: result.error || 'Sync failed',
          lastChecked: result.lastSync || new Date()
        });

        throw new ApiError(
          ErrorCodes.INTERNAL_SERVER_ERROR,
          'Synchronization failed',
          500,
          result.error || 'Unknown error during synchronization'
        );
      }
    } catch (error) {
      handleApiError(error, res, `POST /api/accounts/${req.params.accountId}/sync`, requestId);
    }
  });

  // Draft management routes
  app.post('/api/accounts/:accountId/drafts', isAuthenticated, async (req: any, res) => {
    const requestId = `save-draft-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const accountId = req.params.accountId;

      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      // Verify account belongs to user
      const accounts = await storage.getUserAccountConnections(userId);
      const account = accounts.find(acc => acc.id === accountId);
      
      if (!account) {
        throw new ApiError(
          ErrorCodes.ACCOUNT_NOT_FOUND,
          'Account not found',
          404,
          `Account with ID ${accountId} does not exist or does not belong to the user`
        );
      }

      // Validate request body
      const validationResult = saveDraftRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid draft data',
          400,
          validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
          undefined,
          ['Ensure all required fields are provided', 'Check data format and types']
        );
      }

      const draftData = validationResult.data;

      // Extract account email for the "from" field
      let fromEmail = '';
      try {
        const settings = JSON.parse(account.settingsJson);
        if (account.protocol === 'IMAP') {
          fromEmail = settings.username;
        } else if (account.protocol === 'EWS') {
          const username = settings.username;
          fromEmail = username.includes('@') ? username : username;
        }
      } catch (error) {
        console.error('Error parsing account settings:', error);
        fromEmail = account.name; // Fallback to account name
      }

      // Create draft message
      const draft = await storage.saveDraft(accountId, {
        to: draftData.to || '',
        cc: draftData.cc || '',
        bcc: draftData.bcc || '',
        subject: draftData.subject || '',
        from: fromEmail,
        bodyHtml: draftData.bodyHtml || draftData.body || '',
        bodyText: draftData.body || '',
        snippet: draftData.subject || (draftData.body ? draftData.body.substring(0, 100) : ''),
        hasAttachments: draftData.attachmentIds && draftData.attachmentIds.length > 0
      });

      // Handle attachments if provided
      if (draftData.attachmentIds && draftData.attachmentIds.length > 0) {
        for (const attachmentId of draftData.attachmentIds) {
          try {
            // Update attachment to reference this draft
            await storage.updateMailMessage(draft.id, { hasAttachments: true });
          } catch (error) {
            console.warn(`Failed to link attachment ${attachmentId} to draft:`, error);
          }
        }
      }

      const response: SaveDraftResponse = {
        success: true,
        draftId: draft.id,
        savedAt: draft.updatedAt || draft.createdAt!
      };

      res.json(createSuccessResponse(response, 'Draft saved successfully'));
    } catch (error) {
      handleApiError(error, res, `POST /api/accounts/${req.params.accountId}/drafts`, requestId);
    }
  });

  app.put('/api/accounts/:accountId/drafts/:draftId', isAuthenticated, async (req: any, res) => {
    const requestId = `update-draft-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const { accountId, draftId } = req.params;

      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      // Verify account belongs to user
      const accounts = await storage.getUserAccountConnections(userId);
      const account = accounts.find(acc => acc.id === accountId);
      
      if (!account) {
        throw new ApiError(
          ErrorCodes.ACCOUNT_NOT_FOUND,
          'Account not found',
          404,
          `Account with ID ${accountId} does not exist or does not belong to the user`
        );
      }

      // Validate request body
      const validationResult = saveDraftRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid draft data',
          400,
          validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
        );
      }

      const draftData = validationResult.data;

      // Update draft
      const updatedDraft = await storage.updateDraft(draftId, {
        to: draftData.to || '',
        cc: draftData.cc || '',
        bcc: draftData.bcc || '',
        subject: draftData.subject || '',
        bodyHtml: draftData.bodyHtml || draftData.body || '',
        bodyText: draftData.body || '',
        snippet: draftData.subject || (draftData.body ? draftData.body.substring(0, 100) : ''),
        hasAttachments: draftData.attachmentIds && draftData.attachmentIds.length > 0
      });

      if (!updatedDraft) {
        throw new ApiError(
          ErrorCodes.DRAFT_NOT_FOUND,
          'Draft not found',
          404,
          `Draft with ID ${draftId} does not exist or is not a draft`
        );
      }

      const response: SaveDraftResponse = {
        success: true,
        draftId: updatedDraft.id,
        savedAt: updatedDraft.updatedAt!
      };

      res.json(createSuccessResponse(response, 'Draft updated successfully'));
    } catch (error) {
      handleApiError(error, res, `PUT /api/accounts/${req.params.accountId}/drafts/${req.params.draftId}`, requestId);
    }
  });

  app.get('/api/accounts/:accountId/drafts', isAuthenticated, async (req: any, res) => {
    const requestId = `list-account-drafts-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const accountId = req.params.accountId;
      const { limit = 50, offset = 0 } = req.query;

      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      // Validate parameters
      const limitNum = parseInt(limit as string);
      const offsetNum = parseInt(offset as string);
      
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid limit parameter',
          400,
          'Limit must be a number between 1 and 100',
          'limit'
        );
      }
      
      if (isNaN(offsetNum) || offsetNum < 0) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid offset parameter',
          400,
          'Offset must be a non-negative number',
          'offset'
        );
      }

      // Verify account belongs to user
      const accounts = await storage.getUserAccountConnections(userId);
      const account = accounts.find(acc => acc.id === accountId);
      
      if (!account) {
        throw new ApiError(
          ErrorCodes.ACCOUNT_NOT_FOUND,
          'Account not found',
          404,
          `Account with ID ${accountId} does not exist or does not belong to the user`
        );
      }

      const drafts = await storage.listAccountDrafts(accountId, limitNum, offsetNum);
      
      const response: ListDraftsResponse = {
        success: true,
        drafts: drafts.map(draft => ({
          id: draft.id,
          accountId: draft.accountId,
          to: draft.to || undefined,
          cc: draft.cc || undefined,
          subject: draft.subject || undefined,
          snippet: draft.snippet || undefined,
          hasAttachments: draft.hasAttachments ?? false,
          createdAt: draft.createdAt!,
          updatedAt: draft.updatedAt!
        }))
      };

      res.json(createSuccessResponse(response, `Retrieved ${drafts.length} drafts`));
    } catch (error) {
      handleApiError(error, res, `GET /api/accounts/${req.params.accountId}/drafts`, requestId);
    }
  });

  app.get('/api/accounts/:accountId/drafts/:draftId', isAuthenticated, async (req: any, res) => {
    const requestId = `get-draft-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const { accountId, draftId } = req.params;

      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      // Verify account belongs to user
      const accounts = await storage.getUserAccountConnections(userId);
      const account = accounts.find(acc => acc.id === accountId);
      
      if (!account) {
        throw new ApiError(
          ErrorCodes.ACCOUNT_NOT_FOUND,
          'Account not found',
          404,
          `Account with ID ${accountId} does not exist or does not belong to the user`
        );
      }

      const draft = await storage.getDraft(draftId);
      
      if (!draft || draft.accountId !== accountId) {
        throw new ApiError(
          ErrorCodes.DRAFT_NOT_FOUND,
          'Draft not found',
          404,
          `Draft with ID ${draftId} does not exist in this account`
        );
      }

      const response: LoadDraftResponse = {
        success: true,
        draft: {
          id: draft.id,
          accountId: draft.accountId,
          to: draft.to || undefined,
          cc: draft.cc || undefined,
          bcc: draft.bcc || undefined,
          subject: draft.subject || undefined,
          body: draft.bodyText || undefined,
          bodyHtml: draft.bodyHtml || undefined,
          attachmentIds: [], // TODO: Implement attachment linking
          createdAt: draft.createdAt!,
          updatedAt: draft.updatedAt!
        }
      };

      res.json(createSuccessResponse(response, 'Draft retrieved successfully'));
    } catch (error) {
      handleApiError(error, res, `GET /api/accounts/${req.params.accountId}/drafts/${req.params.draftId}`, requestId);
    }
  });

  app.delete('/api/accounts/:accountId/drafts/:draftId', isAuthenticated, async (req: any, res) => {
    const requestId = `delete-draft-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const { accountId, draftId } = req.params;

      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      // Verify account belongs to user
      const accounts = await storage.getUserAccountConnections(userId);
      const account = accounts.find(acc => acc.id === accountId);
      
      if (!account) {
        throw new ApiError(
          ErrorCodes.ACCOUNT_NOT_FOUND,
          'Account not found',
          404,
          `Account with ID ${accountId} does not exist or does not belong to the user`
        );
      }

      // Verify draft exists and belongs to account
      const draft = await storage.getDraft(draftId);
      if (!draft || draft.accountId !== accountId) {
        throw new ApiError(
          ErrorCodes.DRAFT_NOT_FOUND,
          'Draft not found',
          404,
          `Draft with ID ${draftId} does not exist in this account`
        );
      }

      await storage.deleteDraft(draftId);

      const response: DeleteDraftResponse = {
        success: true
      };

      res.json(createSuccessResponse(response, 'Draft deleted successfully'));
    } catch (error) {
      handleApiError(error, res, `DELETE /api/accounts/${req.params.accountId}/drafts/${req.params.draftId}`, requestId);
    }
  });

  app.get('/api/drafts', isAuthenticated, async (req: any, res) => {
    const requestId = `list-user-drafts-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const { limit = 50, offset = 0 } = req.query;

      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      // Validate parameters
      const limitNum = parseInt(limit as string);
      const offsetNum = parseInt(offset as string);
      
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid limit parameter',
          400,
          'Limit must be a number between 1 and 100',
          'limit'
        );
      }
      
      if (isNaN(offsetNum) || offsetNum < 0) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid offset parameter',
          400,
          'Offset must be a non-negative number',
          'offset'
        );
      }

      const drafts = await storage.listUserDrafts(userId, limitNum, offsetNum);
      
      const response: ListDraftsResponse = {
        success: true,
        drafts: drafts.map(draft => ({
          id: draft.id,
          accountId: draft.accountId,
          to: draft.to || undefined,
          cc: draft.cc || undefined,
          subject: draft.subject || undefined,
          snippet: draft.snippet || undefined,
          hasAttachments: draft.hasAttachments ?? false,
          createdAt: draft.createdAt!,
          updatedAt: draft.updatedAt!
        }))
      };

      res.json(createSuccessResponse(response, `Retrieved ${drafts.length} drafts across all accounts`));
    } catch (error) {
      handleApiError(error, res, 'GET /api/drafts', requestId);
    }
  });

  // Signature management endpoints
  
  // Get user signatures
  app.get('/api/signatures', isAuthenticated, async (req: any, res) => {
    const requestId = `get-signatures-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const { accountId } = req.query;

      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      const signatures = await storage.getUserSignatures(userId, accountId);
      
      const response: ListSignaturesResponse = {
        success: true,
        signatures: signatures.map(sig => ({
          id: sig.id,
          userId: sig.userId,
          accountId: sig.accountId || undefined,
          name: sig.name,
          contentHtml: sig.contentHtml || undefined,
          contentText: sig.contentText || undefined,
          isDefault: sig.isDefault ?? false,
          isActive: sig.isActive ?? false,
          sortOrder: sig.sortOrder ?? 0,
          templateType: sig.templateType || undefined,
          createdAt: sig.createdAt!,
          updatedAt: sig.updatedAt!
        }))
      };

      res.json(createSuccessResponse(response, `Retrieved ${signatures.length} signatures`));
    } catch (error) {
      handleApiError(error, res, 'GET /api/signatures', requestId);
    }
  });

  // Get specific signature
  app.get('/api/signatures/:id', isAuthenticated, async (req: any, res) => {
    const requestId = `get-signature-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const signatureId = req.params.id;

      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      const signature = await storage.getSignature(signatureId);
      if (!signature) {
        throw new ApiError(
          ErrorCodes.RESOURCE_NOT_FOUND,
          'Signature not found',
          404,
          `Signature with ID ${signatureId} does not exist`
        );
      }

      // Verify ownership
      if (signature.userId !== userId) {
        throw new ApiError(
          ErrorCodes.AUTHORIZATION_FAILED,
          'Access denied',
          403,
          'You do not have permission to access this signature'
        );
      }

      const response: SignatureResponse = {
        success: true,
        signature: {
          id: signature.id,
          userId: signature.userId,
          accountId: signature.accountId || undefined,
          name: signature.name,
          contentHtml: signature.contentHtml || undefined,
          contentText: signature.contentText || undefined,
          isDefault: signature.isDefault ?? false,
          isActive: signature.isActive ?? false,
          sortOrder: signature.sortOrder ?? 0,
          templateType: signature.templateType || undefined,
          createdAt: signature.createdAt!,
          updatedAt: signature.updatedAt!
        }
      };

      res.json(createSuccessResponse(response, 'Signature retrieved successfully'));
    } catch (error) {
      handleApiError(error, res, 'GET /api/signatures/:id', requestId);
    }
  });

  // Create new signature
  app.post('/api/signatures', isAuthenticated, async (req: any, res) => {
    const requestId = `create-signature-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;

      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      // Validate request body
      const signatureData = createSignatureRequestSchema.parse(req.body);

      // If accountId is provided, verify user owns it
      if (signatureData.accountId) {
        const accounts = await storage.getUserAccountConnections(userId);
        const hasAccess = accounts.some(acc => acc.id === signatureData.accountId);
        if (!hasAccess) {
          throw new ApiError(
            ErrorCodes.AUTHORIZATION_FAILED,
            'Invalid account ID',
            403,
            'You do not have permission to create signatures for this account'
          );
        }
      }

      const signature = await storage.createSignature({
        ...signatureData,
        userId
      });

      const response: SignatureResponse = {
        success: true,
        signature: {
          id: signature.id,
          userId: signature.userId,
          accountId: signature.accountId || undefined,
          name: signature.name,
          contentHtml: signature.contentHtml || undefined,
          contentText: signature.contentText || undefined,
          isDefault: signature.isDefault ?? false,
          isActive: signature.isActive ?? false,
          sortOrder: signature.sortOrder ?? 0,
          templateType: signature.templateType || undefined,
          createdAt: signature.createdAt!,
          updatedAt: signature.updatedAt!
        }
      };

      res.json(createSuccessResponse(response, 'Signature created successfully'));
    } catch (error) {
      handleApiError(error, res, 'POST /api/signatures', requestId);
    }
  });

  // Update signature
  app.put('/api/signatures/:id', isAuthenticated, async (req: any, res) => {
    const requestId = `update-signature-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const signatureId = req.params.id;

      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      // Validate request body
      const updates = updateSignatureRequestSchema.parse(req.body);

      // Verify signature exists and belongs to user
      const existingSignature = await storage.getSignature(signatureId);
      if (!existingSignature) {
        throw new ApiError(
          ErrorCodes.RESOURCE_NOT_FOUND,
          'Signature not found',
          404,
          `Signature with ID ${signatureId} does not exist`
        );
      }

      if (existingSignature.userId !== userId) {
        throw new ApiError(
          ErrorCodes.AUTHORIZATION_FAILED,
          'Access denied',
          403,
          'You do not have permission to modify this signature'
        );
      }

      // If accountId is being changed, verify user owns the new account
      if (updates.accountId && updates.accountId !== existingSignature.accountId) {
        const accounts = await storage.getUserAccountConnections(userId);
        const hasAccess = accounts.some(acc => acc.id === updates.accountId);
        if (!hasAccess) {
          throw new ApiError(
            ErrorCodes.AUTHORIZATION_FAILED,
            'Invalid account ID',
            403,
            'You do not have permission to assign signatures to this account'
          );
        }
      }

      const signature = await storage.updateSignature(signatureId, updates);
      if (!signature) {
        throw new ApiError(
          ErrorCodes.INTERNAL_SERVER_ERROR,
          'Failed to update signature',
          500,
          'Signature update operation failed'
        );
      }

      const response: SignatureResponse = {
        success: true,
        signature: {
          id: signature.id,
          userId: signature.userId,
          accountId: signature.accountId || undefined,
          name: signature.name,
          contentHtml: signature.contentHtml || undefined,
          contentText: signature.contentText || undefined,
          isDefault: signature.isDefault ?? false,
          isActive: signature.isActive ?? false,
          sortOrder: signature.sortOrder ?? 0,
          templateType: signature.templateType || undefined,
          createdAt: signature.createdAt!,
          updatedAt: signature.updatedAt!
        }
      };

      res.json(createSuccessResponse(response, 'Signature updated successfully'));
    } catch (error) {
      handleApiError(error, res, 'PUT /api/signatures/:id', requestId);
    }
  });

  // Delete signature
  app.delete('/api/signatures/:id', isAuthenticated, async (req: any, res) => {
    const requestId = `delete-signature-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const signatureId = req.params.id;

      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      // Verify signature exists and belongs to user
      const existingSignature = await storage.getSignature(signatureId);
      if (!existingSignature) {
        throw new ApiError(
          ErrorCodes.RESOURCE_NOT_FOUND,
          'Signature not found',
          404,
          `Signature with ID ${signatureId} does not exist`
        );
      }

      if (existingSignature.userId !== userId) {
        throw new ApiError(
          ErrorCodes.AUTHORIZATION_FAILED,
          'Access denied',
          403,
          'You do not have permission to delete this signature'
        );
      }

      await storage.deleteSignature(signatureId);

      const response: DeleteSignatureResponse = {
        success: true
      };

      res.json(createSuccessResponse(response, 'Signature deleted successfully'));
    } catch (error) {
      handleApiError(error, res, 'DELETE /api/signatures/:id', requestId);
    }
  });

  // Set default signature
  app.post('/api/signatures/:id/set-default', isAuthenticated, async (req: any, res) => {
    const requestId = `set-default-signature-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const signatureId = req.params.id;
      const { accountId } = req.body;

      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      // Verify signature exists and belongs to user
      const existingSignature = await storage.getSignature(signatureId);
      if (!existingSignature) {
        throw new ApiError(
          ErrorCodes.RESOURCE_NOT_FOUND,
          'Signature not found',
          404,
          `Signature with ID ${signatureId} does not exist`
        );
      }

      if (existingSignature.userId !== userId) {
        throw new ApiError(
          ErrorCodes.AUTHORIZATION_FAILED,
          'Access denied',
          403,
          'You do not have permission to modify this signature'
        );
      }

      // If accountId is provided, verify user owns it
      if (accountId) {
        const accounts = await storage.getUserAccountConnections(userId);
        const hasAccess = accounts.some(acc => acc.id === accountId);
        if (!hasAccess) {
          throw new ApiError(
            ErrorCodes.AUTHORIZATION_FAILED,
            'Invalid account ID',
            403,
            'You do not have permission to set defaults for this account'
          );
        }
      }

      await storage.setDefaultSignature(userId, signatureId, accountId);

      res.json(createSuccessResponse({}, 'Default signature set successfully'));
    } catch (error) {
      handleApiError(error, res, 'POST /api/signatures/:id/set-default', requestId);
    }
  });

  // Get default signature
  app.get('/api/signatures/default', isAuthenticated, async (req: any, res) => {
    const requestId = `get-default-signature-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const { accountId } = req.query;

      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      // If accountId is provided, verify user owns it
      if (accountId) {
        const accounts = await storage.getUserAccountConnections(userId);
        const hasAccess = accounts.some(acc => acc.id === accountId);
        if (!hasAccess) {
          throw new ApiError(
            ErrorCodes.AUTHORIZATION_FAILED,
            'Invalid account ID',
            403,
            'You do not have permission to access this account'
          );
        }
      }

      const signature = await storage.getDefaultSignature(userId, accountId as string);

      const response: SignatureResponse = {
        success: true,
        signature: signature ? {
          id: signature.id,
          userId: signature.userId,
          accountId: signature.accountId || undefined,
          name: signature.name,
          contentHtml: signature.contentHtml || undefined,
          contentText: signature.contentText || undefined,
          isDefault: signature.isDefault ?? false,
          isActive: signature.isActive ?? false,
          sortOrder: signature.sortOrder ?? 0,
          templateType: signature.templateType || undefined,
          createdAt: signature.createdAt!,
          updatedAt: signature.updatedAt!
        } : undefined
      };

      res.json(createSuccessResponse(response, signature ? 'Default signature retrieved' : 'No default signature set'));
    } catch (error) {
      handleApiError(error, res, 'GET /api/signatures/default', requestId);
    }
  });

  // PUSH NOTIFICATION ROUTES

  // Get VAPID public key for client subscription
  app.get('/api/push/public-key', async (req: any, res) => {
    const requestId = `get-vapid-key-${Date.now()}`;
    try {
      const publicKey = pushNotificationManager.getPublicKey();
      
      if (!publicKey) {
        throw new ApiError(
          ErrorCodes.VAPID_NOT_CONFIGURED,
          'Push notifications not available',
          503,
          'VAPID keys are not configured on the server',
          undefined,
          ['Contact system administrator to configure push notifications']
        );
      }

      const response: PushSubscriptionResponse = {
        success: true,
        publicKey,
      };

      res.json(createSuccessResponse(response, 'VAPID public key retrieved'));
    } catch (error) {
      handleApiError(error, res, 'GET /api/push/public-key', requestId);
    }
  });

  // Subscribe to push notifications
  app.post('/api/push/subscribe', isAuthenticated, async (req: any, res) => {
    const requestId = `push-subscribe-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      // Validate subscription data
      const subscriptionData = pushSubscriptionRequestSchema.parse(req.body);

      // Check if this subscription already exists
      const existingSubscriptions = await storage.getUserPushSubscriptions(userId);
      const existingSubscription = existingSubscriptions.find(
        sub => sub.endpoint === subscriptionData.endpoint
      );

      if (existingSubscription) {
        // Update existing subscription
        const updated = await storage.updatePushSubscription(existingSubscription.id, {
          p256dhKey: subscriptionData.keys.p256dh,
          authKey: subscriptionData.keys.auth,
          userAgent: subscriptionData.userAgent,
          deviceType: subscriptionData.deviceType,
          isActive: true,
          lastUsed: new Date(),
        });

        if (!updated) {
          throw new ApiError(
            ErrorCodes.PUSH_SUBSCRIPTION_FAILED,
            'Failed to update push subscription',
            500
          );
        }

        const response: PushSubscriptionResponse = {
          success: true,
          subscriptionId: updated.id,
          publicKey: pushNotificationManager.getPublicKey(),
        };

        res.json(createSuccessResponse(response, 'Push subscription updated'));
      } else {
        // Create new subscription
        const subscription = await storage.createPushSubscription({
          userId,
          endpoint: subscriptionData.endpoint,
          p256dhKey: subscriptionData.keys.p256dh,
          authKey: subscriptionData.keys.auth,
          userAgent: subscriptionData.userAgent,
          deviceType: subscriptionData.deviceType || 'desktop',
          isActive: true,
          lastUsed: new Date(),
        });

        const response: PushSubscriptionResponse = {
          success: true,
          subscriptionId: subscription.id,
          publicKey: pushNotificationManager.getPublicKey(),
        };

        res.json(createSuccessResponse(response, 'Push subscription created'));
      }
    } catch (error) {
      handleApiError(error, res, 'POST /api/push/subscribe', requestId);
    }
  });

  // Unsubscribe from push notifications
  app.delete('/api/push/unsubscribe', isAuthenticated, async (req: any, res) => {
    const requestId = `push-unsubscribe-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      const { endpoint } = req.body;
      
      if (!endpoint) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Endpoint is required',
          400,
          'Push subscription endpoint must be provided'
        );
      }

      await storage.deletePushSubscriptionByEndpoint(userId, endpoint);

      res.json(createSuccessResponse({}, 'Push subscription removed'));
    } catch (error) {
      handleApiError(error, res, 'DELETE /api/push/unsubscribe', requestId);
    }
  });

  // Get notification preferences
  app.get('/api/push/preferences', isAuthenticated, async (req: any, res) => {
    const requestId = `get-push-preferences-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      const globalPrefs = await storage.getNotificationPreferences(userId);
      const accountPrefs = await storage.getAccountNotificationPreferences(userId);

      // Get user's account connections for account names
      const accounts = await storage.getUserAccountConnections(userId);

      const response: NotificationPreferencesResponse = {
        success: true,
        preferences: {
          global: globalPrefs ? {
            enableNotifications: globalPrefs.enableNotifications,
            enableNewEmailNotifications: globalPrefs.enableNewEmailNotifications,
            enableVipNotifications: globalPrefs.enableVipNotifications,
            enableSystemNotifications: globalPrefs.enableSystemNotifications,
            enableQuietHours: globalPrefs.enableQuietHours,
            quietStartHour: globalPrefs.quietStartHour,
            quietEndHour: globalPrefs.quietEndHour,
            quietTimezone: globalPrefs.quietTimezone,
            enableGrouping: globalPrefs.enableGrouping,
            enableSound: globalPrefs.enableSound,
            enableVibration: globalPrefs.enableVibration,
            priorityFilter: globalPrefs.priorityFilter,
            batchDelaySeconds: globalPrefs.batchDelaySeconds,
            maxNotificationsPerHour: globalPrefs.maxNotificationsPerHour,
          } : {
            enableNotifications: true,
            enableNewEmailNotifications: true,
            enableVipNotifications: true,
            enableSystemNotifications: true,
            enableQuietHours: false,
            quietStartHour: 22,
            quietEndHour: 8,
            quietTimezone: 'America/New_York',
            enableGrouping: true,
            enableSound: true,
            enableVibration: true,
            priorityFilter: 'all',
            batchDelaySeconds: 30,
            maxNotificationsPerHour: 20,
          },
          accounts: accountPrefs.map(pref => {
            const account = accounts.find(acc => acc.id === pref.accountId);
            return {
              accountId: pref.accountId,
              accountName: account?.name || 'Unknown Account',
              enableNotifications: pref.enableNotifications,
              notifyForFolders: pref.notifyForFolders,
              enableVipFiltering: pref.enableVipFiltering,
              enablePriorityFiltering: pref.enablePriorityFiltering,
              minimumPriority: pref.minimumPriority,
            };
          }),
        },
      };

      res.json(createSuccessResponse(response, 'Notification preferences retrieved'));
    } catch (error) {
      handleApiError(error, res, 'GET /api/push/preferences', requestId);
    }
  });

  // Update global notification preferences
  app.put('/api/push/preferences', isAuthenticated, async (req: any, res) => {
    const requestId = `update-push-preferences-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      const prefsData = updateNotificationPreferencesRequestSchema.parse(req.body);

      // Get existing preferences or create defaults
      const existingPrefs = await storage.getNotificationPreferences(userId);
      
      const updatedPrefs = await storage.upsertNotificationPreferences({
        userId,
        enableNotifications: prefsData.enableNotifications ?? existingPrefs?.enableNotifications ?? true,
        enableNewEmailNotifications: prefsData.enableNewEmailNotifications ?? existingPrefs?.enableNewEmailNotifications ?? true,
        enableVipNotifications: prefsData.enableVipNotifications ?? existingPrefs?.enableVipNotifications ?? true,
        enableSystemNotifications: prefsData.enableSystemNotifications ?? existingPrefs?.enableSystemNotifications ?? true,
        enableQuietHours: prefsData.enableQuietHours ?? existingPrefs?.enableQuietHours ?? false,
        quietStartHour: prefsData.quietStartHour ?? existingPrefs?.quietStartHour ?? 22,
        quietEndHour: prefsData.quietEndHour ?? existingPrefs?.quietEndHour ?? 8,
        quietTimezone: prefsData.quietTimezone ?? existingPrefs?.quietTimezone ?? 'America/New_York',
        enableGrouping: prefsData.enableGrouping ?? existingPrefs?.enableGrouping ?? true,
        enableSound: prefsData.enableSound ?? existingPrefs?.enableSound ?? true,
        enableVibration: prefsData.enableVibration ?? existingPrefs?.enableVibration ?? true,
        priorityFilter: prefsData.priorityFilter ?? existingPrefs?.priorityFilter ?? 'all',
        batchDelaySeconds: prefsData.batchDelaySeconds ?? existingPrefs?.batchDelaySeconds ?? 30,
        maxNotificationsPerHour: prefsData.maxNotificationsPerHour ?? existingPrefs?.maxNotificationsPerHour ?? 20,
      });

      res.json(createSuccessResponse(updatedPrefs, 'Notification preferences updated'));
    } catch (error) {
      handleApiError(error, res, 'PUT /api/push/preferences', requestId);
    }
  });

  // Update account-specific notification preferences
  app.put('/api/push/account-preferences', isAuthenticated, async (req: any, res) => {
    const requestId = `update-account-push-preferences-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      const prefsData = updateAccountNotificationPreferencesRequestSchema.parse(req.body);

      // Verify user owns this account
      const accounts = await storage.getUserAccountConnections(userId);
      const hasAccess = accounts.some(acc => acc.id === prefsData.accountId);
      if (!hasAccess) {
        throw new ApiError(
          ErrorCodes.AUTHORIZATION_FAILED,
          'Invalid account ID',
          403,
          'You do not have permission to modify preferences for this account'
        );
      }

      // Get existing account preferences or create defaults
      const existingAccountPrefs = await storage.getAccountNotificationPreferences(userId, prefsData.accountId);
      const existing = existingAccountPrefs[0];

      const updatedPrefs = await storage.upsertAccountNotificationPreferences({
        userId,
        accountId: prefsData.accountId,
        enableNotifications: prefsData.enableNotifications ?? existing?.enableNotifications ?? true,
        notifyForFolders: prefsData.notifyForFolders ?? existing?.notifyForFolders ?? 'inbox,sent',
        enableVipFiltering: prefsData.enableVipFiltering ?? existing?.enableVipFiltering ?? true,
        enablePriorityFiltering: prefsData.enablePriorityFiltering ?? existing?.enablePriorityFiltering ?? false,
        minimumPriority: prefsData.minimumPriority ?? existing?.minimumPriority ?? 0,
      });

      res.json(createSuccessResponse(updatedPrefs, 'Account notification preferences updated'));
    } catch (error) {
      handleApiError(error, res, 'PUT /api/push/account-preferences', requestId);
    }
  });

  // Send test notification
  app.post('/api/push/test', isAuthenticated, async (req: any, res) => {
    const requestId = `test-push-notification-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      const success = await pushNotificationManager.testNotification(userId);
      
      if (!success) {
        throw new ApiError(
          ErrorCodes.PUSH_NOTIFICATION_SEND_FAILED,
          'Failed to send test notification',
          500,
          'No active push subscriptions found or notification delivery failed',
          undefined,
          ['Make sure push notifications are enabled', 'Try subscribing again']
        );
      }

      res.json(createSuccessResponse({ delivered: success }, 'Test notification sent'));
    } catch (error) {
      handleApiError(error, res, 'POST /api/push/test', requestId);
    }
  });

  // Get push notification statistics
  app.get('/api/push/stats', isAuthenticated, async (req: any, res) => {
    const requestId = `get-push-stats-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      const { days = '7' } = req.query;
      const daysNum = parseInt(days as string, 10) || 7;

      const stats = await pushNotificationManager.getNotificationStats(userId, daysNum);

      res.json(createSuccessResponse(stats, `Notification statistics for last ${daysNum} days`));
    } catch (error) {
      handleApiError(error, res, 'GET /api/push/stats', requestId);
    }
  });

  // Get notification history
  app.get('/api/push/history', isAuthenticated, async (req: any, res) => {
    const requestId = `get-push-history-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      if (!userId) {
        throw new ApiError(
          ErrorCodes.AUTHENTICATION_FAILED,
          'User ID not found in authentication token',
          401
        );
      }

      const { limit = '50', offset = '0' } = req.query;
      const limitNum = Math.min(parseInt(limit as string, 10) || 50, 100);
      const offsetNum = Math.max(parseInt(offset as string, 10) || 0, 0);

      const history = await storage.getUserNotificationHistory(userId, limitNum, offsetNum);

      res.json(createSuccessResponse(history, 'Notification history retrieved'));
    } catch (error) {
      handleApiError(error, res, 'GET /api/push/history', requestId);
    }
  });

  // Global error handler for unhandled errors
  app.use((error: any, req: any, res: any, next: any) => {
    const requestId = `global-error-${Date.now()}`;
    console.error(`[${requestId}] Unhandled error:`, {
      error: error.message,
      stack: error.stack,
      url: req.url,
      method: req.method
    });

    const { statusCode, response } = createErrorResponse(error, requestId);
    res.status(statusCode).json(response);
  });

  const httpServer = createServer(app);
  return httpServer;
}