import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertAccountConnectionSchema, sendEmailRequestSchema, type SendEmailRequest, type SendEmailResponse, type ImapSettings } from "@shared/schema";
import { testConnection, type ConnectionTestResult } from "./connectionTest";
import { discoverImapFolders, appendSentEmailToFolder } from "./emailSync";
import { discoverEwsFolders } from "./ewsSync";
import { getEwsPushService } from "./ewsPushNotifications";
import { getImapIdleService } from "./imapIdle";
import { z } from "zod";
import nodemailer from "nodemailer";
import { decryptAccountSettingsWithPassword } from "./crypto";

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
  let code = ErrorCodes.INTERNAL_SERVER_ERROR;
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
      res.json(createSuccessResponse(accounts, `Retrieved ${accounts.length} email accounts`));
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

      // Enhanced validation with detailed error messages
      const validation = validateAccountData({ protocol, host, username, password, enableCustomSmtp, smtpHost, smtpPort });
      if (!validation.isValid) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid account configuration',
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
      const { folder = 'INBOX', limit = 25, offset = 0 } = req.query;
      
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

      const messages = await storage.getMailMessages(userId, folder as string, limitNum, offsetNum);
      res.json(createSuccessResponse(
        messages,
        `Retrieved ${messages.length} messages from ${folder}`
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

        transporter = nodemailer.createTransporter({
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
        text: emailRequest.textContent,
        html: emailRequest.htmlContent,
        replyTo: emailRequest.replyTo,
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
        textContent: emailRequest.textContent || null,
        htmlContent: emailRequest.htmlContent || null,
        folder: 'Sent',
        flags: ['\\Seen'],
        date: new Date(),
        size: JSON.stringify(mailOptions).length,
        replyTo: emailRequest.replyTo || null,
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
        message: 'Email sent successfully'
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
      const preferences = await storage.getUserPreferences(userId);
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

      const updatedPreferences = await storage.updateUserPreferences(userId, preferences);
      res.json(createSuccessResponse(
        updatedPreferences,
        'User preferences updated successfully'
      ));
    } catch (error) {
      handleApiError(error, res, 'POST /api/preferences', requestId);
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