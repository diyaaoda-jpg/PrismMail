import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertAccountConnectionSchema, sendEmailRequestSchema, type SendEmailRequest, type SendEmailResponse, type ImapSettings, insertPriorityRuleSchema, insertVipContactSchema, insertUserPrefsSchema, updatePriorityRuleSchema, updateVipContactSchema, updateUserPrefsSchema, reorderRulesSchema, insertMailDraftSchema, insertMailSentSchema } from "@shared/schema";
import { apiRateLimiter, strictRateLimiter, composeRateLimiter } from "./middleware/security";
import { testConnection, type ConnectionTestResult } from "./connectionTest";
import { discoverImapFolders, appendSentEmailToFolder, syncAllUserAccounts, syncImapEmails } from "./emailSync";
import { discoverEwsFolders, syncEwsEmails } from "./ewsSync";
import { getEwsPushService } from "./ewsPushNotifications";
import { getImapIdleService } from "./imapIdle";
import { priorityEngine } from "./services/priorityEngine";
import { backgroundJobService } from "./services/backgroundJobs";
import { ewsSendService } from "./services/ewsSendService";
import { messageFormatter } from "./services/messageFormatter";
import { z } from "zod";
import nodemailer from "nodemailer";
import { decryptAccountSettingsWithPassword } from "./crypto";

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
  FORBIDDEN_ERROR: 'FORBIDDEN_ERROR',
  
  // Server errors
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  
  // Business logic errors
  UNSUPPORTED_PROTOCOL: 'UNSUPPORTED_PROTOCOL',
  INVALID_ACCOUNT_STATE: 'INVALID_ACCOUNT_STATE',
  
  // Email sending errors
  EMAIL_SEND_FAILED: 'EMAIL_SEND_FAILED',
  EMAIL_VALIDATION_FAILED: 'EMAIL_VALIDATION_FAILED'
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
            ErrorCodes.FORBIDDEN_ERROR,
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

      let sendResult: any;
      let messageId: string;
      
      if (account.protocol === 'EWS') {
        // Use EWS to send email directly
        console.log(`[${requestId}] Using EWS to send email`);
        
        // Format the message content using the message formatter
        const formattedMessage = messageFormatter.formatMessage(emailRequest.body);
        
        // Prepare enhanced email request with formatted content
        const enhancedEmailRequest: SendEmailRequest = {
          ...emailRequest,
          body: formattedMessage.text,
          bodyHtml: formattedMessage.html || undefined
        };
        
        // Send via EWS service
        const ewsResult = await ewsSendService.sendEmail(
          encryptedAccount.settingsJson,
          enhancedEmailRequest
        );
        
        if (!ewsResult.success) {
          throw new ApiError(
            ErrorCodes.EMAIL_SEND_FAILED,
            'Failed to send email via EWS',
            500,
            ewsResult.error || 'EWS email sending failed',
            undefined,
            ewsResult.details?.suggestion ? [ewsResult.details.suggestion] : [
              'Check your EWS server connection',
              'Verify your Exchange credentials are correct',
              'Ensure you have permission to send emails'
            ]
          );
        }
        
        sendResult = {
          messageId: ewsResult.messageId,
          accepted: [emailRequest.to],
          rejected: [],
          response: 'EWS email sent successfully'
        };
        messageId = ewsResult.messageId || `ews-${Date.now()}`;
        
        console.log(`[${requestId}] EWS email sent successfully: ${messageId}`);
        
      } else if (account.protocol === 'IMAP') {
        // Configure SMTP transport for IMAP accounts
        console.log(`[${requestId}] Using SMTP to send email`);
        
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
        
        // Configure SMTP transporter
        const transporter = nodemailer.createTransport({
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
        
        // Prepare email message for SMTP
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

        // Send the email via SMTP
        try {
          sendResult = await transporter.sendMail(mailOptions);
          messageId = sendResult.messageId;
          console.log(`[${requestId}] SMTP email sent successfully: ${messageId}`);
        } catch (error: any) {
          console.error(`[${requestId}] Failed to send SMTP email:`, error);
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
        
      } else {
        throw new ApiError(
          ErrorCodes.UNSUPPORTED_PROTOCOL,
          'Unsupported protocol for email sending',
          400,
          `Protocol "${account.protocol}" does not support email sending`
        );
      }

      // Store sent email in database for record keeping
      const sentEmailData = {
        userId,
        accountId: emailRequest.accountId,
        messageId: messageId || `sent-${Date.now()}`,
        from: `"${account.name}" <${accountSettings.username}>`,
        to: emailRequest.to,
        cc: emailRequest.cc || null,
        bcc: emailRequest.bcc || null,
        subject: emailRequest.subject,
        textContent: emailRequest.body || null,
        htmlContent: emailRequest.bodyHtml || null,
        folder: 'Sent',
        flags: ['\\Seen'],
        date: new Date(),
        size: (emailRequest.body || '').length + (emailRequest.bodyHtml || '').length,
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
        messageId: messageId,
        sentAt: new Date()
      };

      res.json(createSuccessResponse(response, 'Email sent successfully'));

    } catch (error) {
      handleApiError(error, res, 'POST /api/mail/send', requestId);
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

  // ====================================
  // PRIORITY SYSTEM API ENDPOINTS
  // ====================================

  // Priority Rules Management
  app.get('/api/priority/rules/:accountId', isAuthenticated, async (req: any, res) => {
    const requestId = `get-priority-rules-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const accountId = req.params.accountId;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      // Verify account belongs to user
      const accounts = await storage.getUserAccountConnections(userId);
      const account = accounts.find(acc => acc.id === accountId);
      if (!account) {
        throw new ApiError(ErrorCodes.ACCOUNT_NOT_FOUND, 'Account not found', 404);
      }

      const rules = await storage.getPriorityRules(accountId);
      res.json(createSuccessResponse(rules));
    } catch (error) {
      handleApiError(error, res, `GET /api/priority/rules/${req.params.accountId}`, requestId);
    }
  });

  app.post('/api/priority/rules', isAuthenticated, async (req: any, res) => {
    const requestId = `create-priority-rule-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const ruleData = insertPriorityRuleSchema.parse(req.body);

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      // Verify account belongs to user
      const accounts = await storage.getUserAccountConnections(userId);
      const account = accounts.find(acc => acc.id === ruleData.accountId);
      if (!account) {
        throw new ApiError(ErrorCodes.ACCOUNT_NOT_FOUND, 'Account not found', 404);
      }

      const rule = await storage.createPriorityRule(ruleData);
      res.json(createSuccessResponse(rule, 'Priority rule created successfully'));
    } catch (error) {
      handleApiError(error, res, 'POST /api/priority/rules', requestId);
    }
  });

  app.put('/api/priority/rules/:ruleId', isAuthenticated, async (req: any, res) => {
    const requestId = `update-priority-rule-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const ruleId = req.params.ruleId;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      // Validate input data with Zod schema
      const updates = updatePriorityRuleSchema.parse(req.body);

      // Verify ownership first
      const existingRule = await storage.getPriorityRuleWithOwnership(ruleId, userId);
      if (!existingRule) {
        throw new ApiError(
          ErrorCodes.AUTHORIZATION_FAILED, 
          'Priority rule not found or access denied',
          403,
          `Rule ${ruleId} does not exist or you don't have permission to modify it`,
          undefined,
          ['Ensure the rule exists and belongs to one of your email accounts']
        );
      }

      // Now perform the update with validated data
      const rule = await storage.updatePriorityRule(ruleId, updates);
      if (!rule) {
        throw new ApiError(ErrorCodes.INTERNAL_SERVER_ERROR, 'Failed to update priority rule', 500);
      }

      // Queue background job to rescore emails when rules change
      try {
        const jobId = await backgroundJobService.queueEmailRescoring(userId, existingRule.accountId, ruleId);
        console.log(`Queued email rescoring job ${jobId} after rule update`);
      } catch (jobError) {
        console.error('Failed to queue background rescoring job:', jobError);
        // Don't fail the rule update if background job fails
      }

      res.json(createSuccessResponse(rule, 'Priority rule updated successfully'));
    } catch (error) {
      handleApiError(error, res, `PUT /api/priority/rules/${req.params.ruleId}`, requestId);
    }
  });

  app.post('/api/priority/rules/reorder', isAuthenticated, async (req: any, res) => {
    const requestId = `reorder-priority-rules-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      // Validate input data with Zod schema
      const { ruleUpdates } = reorderRulesSchema.parse(req.body);

      // Verify ownership of all rules before reordering
      const result = await storage.reorderPriorityRulesWithOwnership(ruleUpdates, userId);
      if (!result.success) {
        throw new ApiError(
          ErrorCodes.AUTHORIZATION_FAILED,
          'Access denied for some priority rules',
          403,
          `The following rule IDs are not owned by you: ${result.invalidRuleIds?.join(', ')}`,
          undefined,
          ['Ensure all rules belong to your email accounts before reordering']
        );
      }

      // Queue background job to rescore emails when rule order changes
      try {
        const jobId = await backgroundJobService.queueEmailRescoring(userId);
        console.log(`Queued email rescoring job ${jobId} after rule reordering`);
      } catch (jobError) {
        console.error('Failed to queue background rescoring job:', jobError);
        // Don't fail the reorder if background job fails
      }

      res.json(createSuccessResponse(null, 'Priority rules reordered successfully'));
    } catch (error) {
      handleApiError(error, res, 'POST /api/priority/rules/reorder', requestId);
    }
  });

  app.delete('/api/priority/rules/:ruleId', isAuthenticated, async (req: any, res) => {
    const requestId = `delete-priority-rule-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const ruleId = req.params.ruleId;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      // Use ownership-verified deletion
      const deleted = await storage.deletePriorityRuleWithOwnership(ruleId, userId);
      if (!deleted) {
        throw new ApiError(
          ErrorCodes.AUTHORIZATION_FAILED,
          'Priority rule not found or access denied',
          403,
          `Rule ${ruleId} does not exist or you don't have permission to delete it`,
          undefined,
          ['Ensure the rule exists and belongs to one of your email accounts']
        );
      }

      // Queue background job to rescore emails when rule is deleted
      try {
        const jobId = await backgroundJobService.queueEmailRescoring(userId);
        console.log(`Queued email rescoring job ${jobId} after rule deletion`);
      } catch (jobError) {
        console.error('Failed to queue background rescoring job:', jobError);
        // Don't fail the deletion if background job fails
      }

      res.json(createSuccessResponse(null, 'Priority rule deleted successfully'));
    } catch (error) {
      handleApiError(error, res, `DELETE /api/priority/rules/${req.params.ruleId}`, requestId);
    }
  });

  // VIP Contact Management
  app.get('/api/vip/contacts', isAuthenticated, async (req: any, res) => {
    const requestId = `get-vip-contacts-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      const contacts = await storage.getVipContacts(userId);
      res.json(createSuccessResponse(contacts));
    } catch (error) {
      handleApiError(error, res, 'GET /api/vip/contacts', requestId);
    }
  });

  app.post('/api/vip/contacts', isAuthenticated, async (req: any, res) => {
    const requestId = `create-vip-contact-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const contactData = insertVipContactSchema.parse({
        ...req.body,
        userId
      });

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      const contact = await storage.createVipContact(contactData);
      res.json(createSuccessResponse(contact, 'VIP contact created successfully'));
    } catch (error) {
      handleApiError(error, res, 'POST /api/vip/contacts', requestId);
    }
  });

  app.put('/api/vip/contacts/:contactId', isAuthenticated, async (req: any, res) => {
    const requestId = `update-vip-contact-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const contactId = req.params.contactId;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      // Validate input data with Zod schema
      const updates = updateVipContactSchema.parse(req.body);

      // Verify ownership first
      const existingContact = await storage.getVipContactWithOwnership(contactId, userId);
      if (!existingContact) {
        throw new ApiError(
          ErrorCodes.AUTHORIZATION_FAILED,
          'VIP contact not found or access denied',
          403,
          `Contact ${contactId} does not exist or you don't have permission to modify it`,
          undefined,
          ['Ensure the contact exists and belongs to your account']
        );
      }

      // Now perform the update with validated data
      const contact = await storage.updateVipContact(contactId, updates);
      if (!contact) {
        throw new ApiError(ErrorCodes.INTERNAL_SERVER_ERROR, 'Failed to update VIP contact', 500);
      }

      res.json(createSuccessResponse(contact, 'VIP contact updated successfully'));
    } catch (error) {
      handleApiError(error, res, `PUT /api/vip/contacts/${req.params.contactId}`, requestId);
    }
  });

  app.delete('/api/vip/contacts/:contactId', isAuthenticated, async (req: any, res) => {
    const requestId = `delete-vip-contact-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const contactId = req.params.contactId;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      // Use ownership-verified deletion
      const deleted = await storage.deleteVipContactWithOwnership(contactId, userId);
      if (!deleted) {
        throw new ApiError(
          ErrorCodes.AUTHORIZATION_FAILED,
          'VIP contact not found or access denied',
          403,
          `Contact ${contactId} does not exist or you don't have permission to delete it`,
          undefined,
          ['Ensure the contact exists and belongs to your account']
        );
      }

      res.json(createSuccessResponse(null, 'VIP contact deleted successfully'));
    } catch (error) {
      handleApiError(error, res, `DELETE /api/vip/contacts/${req.params.contactId}`, requestId);
    }
  });

  app.get('/api/vip/suggestions', isAuthenticated, async (req: any, res) => {
    const requestId = `get-vip-suggestions-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const limit = parseInt(req.query.limit as string) || 10;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      const suggestions = await storage.suggestVipContacts(userId, limit);
      res.json(createSuccessResponse(suggestions));
    } catch (error) {
      handleApiError(error, res, 'GET /api/vip/suggestions', requestId);
    }
  });

  // Focus Mode Functionality
  app.get('/api/mail/focus', isAuthenticated, async (req: any, res) => {
    const requestId = `get-focus-mail-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const accountId = req.query.accountId as string;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      const messages = await storage.getFocusModeMessages(userId, accountId, limit, offset);
      res.json(createSuccessResponse(messages));
    } catch (error) {
      handleApiError(error, res, 'GET /api/mail/focus', requestId);
    }
  });

  // Priority Calculation
  app.post('/api/priority/calculate/:emailId', isAuthenticated, async (req: any, res) => {
    const requestId = `calculate-priority-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const emailId = req.params.emailId;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      // Get the email
      const emails = await storage.getMailMessages('', undefined, 1000); // TODO: Optimize this query
      const email = emails.find(e => e.id === emailId);
      
      if (!email) {
        throw new ApiError(ErrorCodes.RESOURCE_NOT_FOUND, 'Email not found', 404);
      }

      const priorityData = await priorityEngine.calculatePriority(email, email.accountId, userId);
      
      // Update email with calculated priority
      await storage.updateMailMessage(emailId, {
        priority: priorityData.priority,
        autoPriority: priorityData.autoPriority,
        priorityScore: priorityData.priorityScore,
        priorityFactors: priorityData.priorityFactors,
        prioritySource: priorityData.prioritySource as "manual" | "rule" | "vip" | "thread" | "auto",
        ruleId: priorityData.ruleId,
        isVip: priorityData.isVip
      });

      res.json(createSuccessResponse(priorityData, 'Priority calculated successfully'));
    } catch (error) {
      handleApiError(error, res, `POST /api/priority/calculate/${req.params.emailId}`, requestId);
    }
  });

  // Priority Analytics
  app.get('/api/priority/analytics/distribution', isAuthenticated, async (req: any, res) => {
    const requestId = `get-priority-distribution-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const days = parseInt(req.query.days as string) || 30;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      const distribution = await storage.getEmailPriorityDistribution(userId, days);
      res.json(createSuccessResponse(distribution));
    } catch (error) {
      handleApiError(error, res, 'GET /api/priority/analytics/distribution', requestId);
    }
  });

  app.get('/api/priority/analytics/vip-stats', isAuthenticated, async (req: any, res) => {
    const requestId = `get-vip-stats-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const days = parseInt(req.query.days as string) || 30;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      const stats = await storage.getVipInteractionStats(userId, days);
      res.json(createSuccessResponse(stats));
    } catch (error) {
      handleApiError(error, res, 'GET /api/priority/analytics/vip-stats', requestId);
    }
  });

  app.get('/api/priority/analytics/rule-effectiveness/:accountId', isAuthenticated, async (req: any, res) => {
    const requestId = `get-rule-effectiveness-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const accountId = req.params.accountId;
      const days = parseInt(req.query.days as string) || 30;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      // Verify account belongs to user
      const accounts = await storage.getUserAccountConnections(userId);
      const account = accounts.find(acc => acc.id === accountId);
      if (!account) {
        throw new ApiError(ErrorCodes.ACCOUNT_NOT_FOUND, 'Account not found', 404);
      }

      const effectiveness = await storage.getRuleEffectiveness(accountId, days);
      res.json(createSuccessResponse(effectiveness));
    } catch (error) {
      handleApiError(error, res, `GET /api/priority/analytics/rule-effectiveness/${req.params.accountId}`, requestId);
    }
  });

  // Enhanced preferences with focus mode settings
  app.get('/api/preferences/focus', isAuthenticated, async (req: any, res) => {
    const requestId = `get-focus-preferences-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      const prefs = await storage.getUserPrefs(userId);
      
      const focusPrefs = {
        focusModeEnabled: prefs?.focusModeEnabled || false,
        focusMinPriority: prefs?.focusMinPriority || 2,
        focusShowVipOnly: prefs?.focusShowVipOnly || false,
        focusShowUnreadOnly: prefs?.focusShowUnreadOnly || false,
        autoPriorityEnabled: prefs?.autoPriorityEnabled || true,
        priorityNotifications: prefs?.priorityNotifications || true,
        vipNotificationsEnabled: prefs?.vipNotificationsEnabled || true
      };

      res.json(createSuccessResponse(focusPrefs));
    } catch (error) {
      handleApiError(error, res, 'GET /api/preferences/focus', requestId);
    }
  });

  app.post('/api/preferences/focus', isAuthenticated, async (req: any, res) => {
    const requestId = `update-focus-preferences-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      // Get current preferences
      const currentPrefs = await storage.getUserPrefs(userId);
      
      // Update with new focus settings
      const updatedPrefs = {
        ...currentPrefs,
        ...req.body,
        userId
      };

      const prefs = await storage.upsertUserPrefs(updatedPrefs);
      res.json(createSuccessResponse(prefs, 'Focus preferences updated successfully'));
    } catch (error) {
      handleApiError(error, res, 'POST /api/preferences/focus', requestId);
    }
  });

  // Background Job Status Endpoints
  app.get('/api/background-jobs/:jobId', isAuthenticated, async (req: any, res) => {
    const requestId = `get-job-status-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const jobId = req.params.jobId;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      const job = backgroundJobService.getJobStatus(jobId);
      if (!job || job.userId !== userId) {
        throw new ApiError(ErrorCodes.RESOURCE_NOT_FOUND, 'Background job not found', 404);
      }

      res.json(createSuccessResponse(job, 'Job status retrieved successfully'));
    } catch (error) {
      handleApiError(error, res, `GET /api/background-jobs/${req.params.jobId}`, requestId);
    }
  });

  app.get('/api/background-jobs', isAuthenticated, async (req: any, res) => {
    const requestId = `get-user-jobs-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      const jobs = backgroundJobService.getUserJobs(userId);
      res.json(createSuccessResponse(jobs, 'User jobs retrieved successfully'));
    } catch (error) {
      handleApiError(error, res, 'GET /api/background-jobs', requestId);
    }
  });

  // Manual trigger for email rescoring (admin/testing purposes)
  app.post('/api/priority/rescore-all', isAuthenticated, async (req: any, res) => {
    const requestId = `manual-rescore-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const { accountId } = req.body;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      // Queue background job for manual rescoring
      const jobId = await backgroundJobService.queueEmailRescoring(userId, accountId);
      
      res.json(createSuccessResponse(
        { jobId }, 
        'Email rescoring queued successfully. Use the job ID to track progress.'
      ));
    } catch (error) {
      handleApiError(error, res, 'POST /api/priority/rescore-all', requestId);
    }
  });

  // Draft Management Endpoints for Email Composition
  app.get('/api/drafts', isAuthenticated, async (req: any, res) => {
    const requestId = `get-drafts-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const { accountId, limit = 50, offset = 0 } = req.query;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      const drafts = await storage.getUserDrafts(userId, accountId, parseInt(limit), parseInt(offset));
      res.json(createSuccessResponse(drafts, 'Drafts retrieved successfully'));
    } catch (error) {
      handleApiError(error, res, 'GET /api/drafts', requestId);
    }
  });

  app.get('/api/drafts/:id', isAuthenticated, async (req: any, res) => {
    const requestId = `get-draft-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const { id } = req.params;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      const draft = await storage.getDraftById(id, userId);
      if (!draft) {
        throw new ApiError(ErrorCodes.RESOURCE_NOT_FOUND, 'Draft not found', 404);
      }

      res.json(createSuccessResponse(draft, 'Draft retrieved successfully'));
    } catch (error) {
      handleApiError(error, res, `GET /api/drafts/${req.params.id}`, requestId);
    }
  });

  app.post('/api/drafts', isAuthenticated, async (req: any, res) => {
    const requestId = `create-draft-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      // Validate request body
      const validatedData = insertMailDraftSchema.parse({ ...req.body, userId });
      
      const draft = await storage.createDraft(validatedData);
      res.json(createSuccessResponse(draft, 'Draft created successfully'));
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }));
        throw new ApiError(ErrorCodes.VALIDATION_ERROR, 'Validation failed', 400, JSON.stringify(fieldErrors));
      }
      handleApiError(error, res, 'POST /api/drafts', requestId);
    }
  });

  app.put('/api/drafts/:id', isAuthenticated, async (req: any, res) => {
    const requestId = `update-draft-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const { id } = req.params;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      // Don't include id and userId in updates
      const { id: _, userId: __, ...updateData } = req.body;
      
      const draft = await storage.updateDraft(id, updateData, userId);
      if (!draft) {
        throw new ApiError(ErrorCodes.RESOURCE_NOT_FOUND, 'Draft not found', 404);
      }

      res.json(createSuccessResponse(draft, 'Draft updated successfully'));
    } catch (error) {
      handleApiError(error, res, `PUT /api/drafts/${req.params.id}`, requestId);
    }
  });

  app.delete('/api/drafts/:id', isAuthenticated, async (req: any, res) => {
    const requestId = `delete-draft-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const { id } = req.params;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      const deleted = await storage.deleteDraft(id, userId);
      if (!deleted) {
        throw new ApiError(ErrorCodes.RESOURCE_NOT_FOUND, 'Draft not found', 404);
      }

      res.json(createSuccessResponse({ deleted: true }, 'Draft deleted successfully'));
    } catch (error) {
      handleApiError(error, res, `DELETE /api/drafts/${req.params.id}`, requestId);
    }
  });

  app.post('/api/drafts/auto-save', isAuthenticated, apiRateLimiter.middleware(), async (req: any, res) => {
    const requestId = `auto-save-draft-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const { accountId, ...draftData } = req.body;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      if (!accountId) {
        throw new ApiError(ErrorCodes.VALIDATION_ERROR, 'Account ID is required', 400);
      }

      const draft = await storage.autoSaveDraft(userId, accountId, draftData);
      res.json(createSuccessResponse(draft, 'Draft auto-saved successfully'));
    } catch (error) {
      handleApiError(error, res, 'POST /api/drafts/auto-save', requestId);
    }
  });

  // Contact Suggestions for Autocomplete (with rate limiting for security)
  app.get('/api/contacts/suggestions', isAuthenticated, apiRateLimiter.middleware(), async (req: any, res) => {
    const requestId = `get-contact-suggestions-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const { query, limit = 10 } = req.query;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      if (!query || typeof query !== 'string' || query.trim().length < 2) {
        throw new ApiError(ErrorCodes.VALIDATION_ERROR, 'Query must be at least 2 characters', 400);
      }

      const suggestions = await storage.getContactSuggestions(userId, query.trim(), parseInt(limit));
      res.json(createSuccessResponse(suggestions, 'Contact suggestions retrieved successfully'));
    } catch (error) {
      handleApiError(error, res, 'GET /api/contacts/suggestions', requestId);
    }
  });

  // Sent Emails Tracking
  app.get('/api/sent-emails', isAuthenticated, apiRateLimiter.middleware(), async (req: any, res) => {
    const requestId = `get-sent-emails-${Date.now()}`;
    try {
      const userId = req.user.claims.sub;
      const { accountId, limit = 50, offset = 0 } = req.query;

      if (!userId) {
        throw new ApiError(ErrorCodes.AUTHENTICATION_FAILED, 'User ID not found', 401);
      }

      const sentEmails = await storage.getSentEmails(userId, accountId, parseInt(limit), parseInt(offset));
      res.json(createSuccessResponse(sentEmails, 'Sent emails retrieved successfully'));
    } catch (error) {
      handleApiError(error, res, 'GET /api/sent-emails', requestId);
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