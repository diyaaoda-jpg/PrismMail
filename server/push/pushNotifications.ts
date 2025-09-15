import webpush from "web-push";
import { storage } from "../storage";
import type { 
  PushSubscription,
  NotificationLog,
  InsertNotificationLog,
  PushNotificationPayload 
} from "@shared/schema";

// VAPID key management
class VAPIDKeyManager {
  private publicKey: string;
  private privateKey: string;
  private initialized: boolean = false;

  constructor() {
    this.publicKey = process.env.VAPID_PUBLIC_KEY || "";
    this.privateKey = process.env.VAPID_PRIVATE_KEY || "";
    this.initialize();
  }

  private initialize() {
    try {
      // In production, VAPID keys MUST be provided via environment variables
      if (process.env.NODE_ENV === 'production' && (!this.publicKey || !this.privateKey)) {
        console.error("🚨 PRODUCTION ERROR: VAPID keys not found in environment variables!");
        console.error("Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables.");
        throw new Error("VAPID keys are required in production environment");
      }

      if (!this.publicKey || !this.privateKey) {
        console.warn("⚠️  DEVELOPMENT: VAPID keys not found in environment variables.");
        console.warn("Generating temporary keys for development. These will not persist across restarts.");
        this.generateVAPIDKeys();
      } else {
        console.log("✅ Using VAPID keys from environment variables");
      }

      webpush.setVapidDetails(
        `mailto:${process.env.CONTACT_EMAIL || "admin@prismmail.com"}`,
        this.publicKey,
        this.privateKey
      );

      this.initialized = true;
      console.log("✅ Push notification service initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize VAPID keys:", error);
      this.initialized = false;
      
      // In production, this is a fatal error
      if (process.env.NODE_ENV === 'production') {
        throw error;
      }
    }
  }

  private generateVAPIDKeys() {
    const keys = webpush.generateVAPIDKeys();
    this.publicKey = keys.publicKey;
    this.privateKey = keys.privateKey;
    
    // SECURITY: Never log private keys - this is a critical security violation!
    console.log("Generated new VAPID keys for development");
    console.log("Public Key:", this.publicKey);
    console.log("⚠️  IMPORTANT: Set these environment variables for production:");
    console.log(`VAPID_PUBLIC_KEY=${this.publicKey}`);
    console.log(`VAPID_PRIVATE_KEY=[REDACTED - Check server logs or regenerate]`);
    console.warn("🚨 WARNING: These keys will be regenerated on next restart unless saved to environment variables!");
  }

  getPublicKey(): string {
    return this.publicKey;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

// Push notification manager
export class PushNotificationManager {
  private vapidManager: VAPIDKeyManager;
  private defaultOptions = {
    TTL: 60 * 60 * 24, // 24 hours
    urgency: 'normal' as const,
    timeout: 10000,
  };

  constructor() {
    this.vapidManager = new VAPIDKeyManager();
  }

  /**
   * Get the server's VAPID public key for client subscription
   */
  getPublicKey(): string {
    return this.vapidManager.getPublicKey();
  }

  /**
   * Send push notification to a specific user
   */
  async sendNotificationToUser(
    userId: string,
    payload: PushNotificationPayload,
    options: {
      urgency?: 'very-low' | 'low' | 'normal' | 'high';
      TTL?: number;
      topic?: string;
      silent?: boolean;
    } = {}
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    if (!this.vapidManager.isInitialized()) {
      throw new Error("VAPID keys not initialized. Cannot send push notifications.");
    }

    try {
      // Get active push subscriptions for the user
      const subscriptions = await storage.getActivePushSubscriptions(userId);
      
      if (subscriptions.length === 0) {
        console.log(`No active push subscriptions found for user ${userId}`);
        return { success: 0, failed: 0, errors: [] };
      }

      // Create notification log entry
      const logEntry: InsertNotificationLog = {
        userId,
        notificationType: payload.data?.notificationType || 'system',
        title: payload.title,
        body: payload.body,
        status: 'pending',
        emailId: payload.data?.emailId,
        accountId: payload.data?.accountId,
      };

      const notificationRecord = await storage.createNotificationLogEntry(logEntry);

      // Send to all subscriptions
      const results = await this.sendToSubscriptions(
        subscriptions,
        payload,
        { ...this.defaultOptions, ...options }
      );

      // Update notification log with results
      await storage.updateNotificationLogEntry(notificationRecord.id, {
        status: results.failed > 0 ? (results.success > 0 ? 'partial_success' : 'failed') : 'sent',
        deliveredAt: results.success > 0 ? new Date() : undefined,
        error: results.errors.length > 0 ? results.errors.join('; ') : undefined,
        recipientCount: subscriptions.length,
        successCount: results.success,
        failureCount: results.failed,
      });

      return results;
    } catch (error) {
      console.error("Error sending push notification:", error);
      throw error;
    }
  }

  /**
   * Send notification to multiple users
   */
  async sendNotificationToUsers(
    userIds: string[],
    payload: PushNotificationPayload,
    options: {
      urgency?: 'very-low' | 'low' | 'normal' | 'high';
      TTL?: number;
      topic?: string;
      silent?: boolean;
    } = {}
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    const promises = userIds.map(userId => 
      this.sendNotificationToUser(userId, payload, options)
        .catch(error => ({ success: 0, failed: 1, errors: [error.message] }))
    );

    const results = await Promise.all(promises);
    
    return results.reduce(
      (total, result) => ({
        success: total.success + result.success,
        failed: total.failed + result.failed,
        errors: [...total.errors, ...result.errors],
      }),
      { success: 0, failed: 0, errors: [] as string[] }
    );
  }

  /**
   * Send push notifications to an array of subscriptions
   */
  private async sendToSubscriptions(
    subscriptions: PushSubscription[],
    payload: PushNotificationPayload,
    options: any
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    const promises = subscriptions.map(async (subscription) => {
      try {
        const pushSubscription = {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dhKey,
            auth: subscription.authKey,
          },
        };

        await webpush.sendNotification(
          pushSubscription,
          JSON.stringify(payload),
          {
            urgency: options.urgency,
            TTL: options.TTL,
            topic: options.topic,
          }
        );

        // Update last used timestamp
        await storage.updatePushSubscription(subscription.id, {
          lastUsed: new Date(),
        });

        return { success: true, error: null };
      } catch (error) {
        console.error(`Failed to send notification to subscription ${subscription.id}:`, error);
        
        // Handle subscription expiry or invalid subscription
        if (error instanceof Error && (
          error.message.includes('expired') ||
          error.message.includes('invalid') ||
          error.message.includes('410') ||
          error.message.includes('404')
        )) {
          await storage.updatePushSubscription(subscription.id, {
            isActive: false,
            lastError: error.message,
          });
        }

        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    const results = await Promise.all(promises);
    
    return results.reduce(
      (total, result) => ({
        success: total.success + (result.success ? 1 : 0),
        failed: total.failed + (result.success ? 0 : 1),
        errors: result.error ? [...total.errors, result.error] : total.errors,
      }),
      { success: 0, failed: 0, errors: [] as string[] }
    );
  }

  /**
   * Clean up expired or invalid subscriptions
   */
  async cleanupExpiredSubscriptions(): Promise<{ removed: number; deactivated: number }> {
    try {
      console.log("🧹 Starting push subscription cleanup...");
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30); // Remove subscriptions not used in 30 days
      
      let removed = 0;
      let deactivated = 0;

      // Get all active subscriptions
      const allSubscriptions = await storage.getAllPushSubscriptions();
      console.log(`📊 Found ${allSubscriptions.length} total subscriptions to review`);

      for (const subscription of allSubscriptions) {
        try {
          // Check if subscription hasn't been used in 30 days
          if (subscription.lastUsed && subscription.lastUsed < cutoffDate) {
            console.log(`⏰ Subscription ${subscription.id} last used ${subscription.lastUsed}, marking inactive`);
            
            await storage.updatePushSubscription(subscription.id, {
              isActive: false,
              lastError: 'Expired due to inactivity (30 days)'
            });
            
            deactivated++;
            continue;
          }

          // Test subscription validity with a minimal test notification
          if (subscription.isActive) {
            try {
              const testResult = await this.testSubscriptionValidity(subscription);
              if (!testResult.isValid) {
                console.log(`❌ Subscription ${subscription.id} failed validation: ${testResult.error}`);
                
                if (testResult.shouldRemove) {
                  // Completely remove subscriptions that returned 410 Gone or 404 Not Found
                  await storage.deletePushSubscription(subscription.id);
                  removed++;
                } else {
                  // Deactivate subscriptions with other errors (temporary failures)
                  await storage.updatePushSubscription(subscription.id, {
                    isActive: false,
                    lastError: `Validation failed: ${testResult.error}`
                  });
                  deactivated++;
                }
              }
            } catch (error) {
              // If we can't test the subscription, mark it as errored but don't remove
              console.warn(`⚠️  Could not test subscription ${subscription.id}: ${error}`);
              await storage.updatePushSubscription(subscription.id, {
                lastError: `Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
              });
            }
          }

          // Small delay to avoid overwhelming the push service
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error) {
          console.error(`❌ Error processing subscription ${subscription.id}:`, error);
          // Continue with next subscription
        }
      }

      console.log(`✅ Subscription cleanup completed: ${removed} removed, ${deactivated} deactivated`);
      return { removed, deactivated };
      
    } catch (error) {
      console.error("❌ Critical error during subscription cleanup:", error);
      throw error;
    }
  }

  /**
   * Test if a push subscription is still valid
   */
  private async testSubscriptionValidity(subscription: any): Promise<{
    isValid: boolean;
    error?: string;
    shouldRemove: boolean;
  }> {
    try {
      const pushSubscription = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dhKey,
          auth: subscription.authKey,
        },
      };

      // Send a minimal test payload
      await webpush.sendNotification(
        pushSubscription,
        JSON.stringify({
          title: "Test",
          body: "Subscription validation",
          data: { test: true },
          silent: true
        }),
        {
          urgency: 'very-low',
          TTL: 30, // Very short TTL for test
        }
      );

      return { isValid: true, shouldRemove: false };
      
    } catch (error: any) {
      const statusCode = error.statusCode || error.status;
      const shouldRemove = statusCode === 410 || statusCode === 404; // Gone or Not Found
      
      return {
        isValid: false,
        error: error.message || 'Unknown error',
        shouldRemove
      };
    }
  }

  /**
   * Schedule periodic subscription cleanup
   */
  startPeriodicCleanup(intervalHours: number = 24): NodeJS.Timeout {
    console.log(`🔄 Starting periodic subscription cleanup (every ${intervalHours} hours)`);
    
    return setInterval(async () => {
      try {
        console.log("⏲️  Running scheduled subscription cleanup...");
        const result = await this.cleanupExpiredSubscriptions();
        console.log(`📈 Cleanup stats: ${result.removed} removed, ${result.deactivated} deactivated`);
      } catch (error) {
        console.error("❌ Scheduled cleanup failed:", error);
      }
    }, intervalHours * 60 * 60 * 1000);
  }

  /**
   * Test notification sending to verify VAPID setup
   */
  async testNotification(userId: string): Promise<boolean> {
    try {
      const testPayload: PushNotificationPayload = {
        title: "PrismMail Test Notification",
        body: "If you see this, push notifications are working correctly!",
        icon: "/favicon.ico",
        data: {
          notificationType: 'system',
          timestamp: Date.now(),
        },
      };

      const result = await this.sendNotificationToUser(userId, testPayload, {
        urgency: 'low',
        TTL: 300, // 5 minutes
      });

      return result.success > 0;
    } catch (error) {
      console.error("Test notification failed:", error);
      return false;
    }
  }

  /**
   * Get notification statistics for a user
   */
  async getNotificationStats(userId: string, days = 7): Promise<{
    sent: number;
    delivered: number;
    failed: number;
    activeSubscriptions: number;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const history = await storage.getUserNotificationHistory(userId, 1000);
    const recentHistory = history.filter(log => log.createdAt >= startDate);
    const activeSubscriptions = await storage.getActivePushSubscriptions(userId);

    return {
      sent: recentHistory.length,
      delivered: recentHistory.filter(log => log.status === 'sent' || log.status === 'partial_success').length,
      failed: recentHistory.filter(log => log.status === 'failed').length,
      activeSubscriptions: activeSubscriptions.length,
    };
  }
}

// Singleton instance
export const pushNotificationManager = new PushNotificationManager();

// Privacy-aware notification payload builder
class PrivacyAwareNotificationBuilder {
  /**
   * Sanitize sender name for notifications
   * Removes potentially sensitive information and truncates long names
   */
  private static sanitizeSenderName(sender: string): string {
    // Extract display name or email local part
    const emailMatch = sender.match(/(.*?)\s*<(.+)>/);
    if (emailMatch) {
      const displayName = emailMatch[1].trim();
      if (displayName && displayName.length > 0 && displayName !== '"') {
        return displayName.length > 30 ? `${displayName.slice(0, 30)}...` : displayName;
      }
      // Fall back to email local part
      const emailParts = emailMatch[2].split('@');
      return emailParts[0];
    }
    
    // Handle plain email addresses
    if (sender.includes('@')) {
      const emailParts = sender.split('@');
      return emailParts[0];
    }
    
    // Return truncated sender as-is for other formats
    return sender.length > 30 ? `${sender.slice(0, 30)}...` : sender;
  }

  /**
   * Sanitize subject line for notifications
   * Removes potentially sensitive content and truncates
   */
  private static sanitizeSubject(subject: string): string {
    if (!subject || subject.trim().length === 0) {
      return "New Email";
    }
    
    // Remove common sensitive patterns
    let sanitized = subject
      .replace(/\b(?:confidential|secret|private|internal|password|login)\b/gi, '[REDACTED]')
      .replace(/\b\d{3,}\b/g, '[NUMBER]') // Replace long number sequences
      .trim();
    
    // Truncate long subjects
    if (sanitized.length > 60) {
      sanitized = `${sanitized.slice(0, 60)}...`;
    }
    
    return sanitized || "New Email";
  }

  /**
   * Create privacy-compliant notification payload
   */
  static createSafeEmailNotification(
    emailData: {
      id: string;
      accountId: string;
      from: string;
      subject: string;
      isVip?: boolean;
    },
    privacySettings: {
      showSender?: boolean;
      showSubject?: boolean;
      showPreview?: boolean;
    } = {}
  ): PushNotificationPayload {
    const isVip = emailData.isVip || false;
    
    // Apply privacy settings with secure defaults
    const showSender = privacySettings.showSender ?? true;
    const showSubject = privacySettings.showSubject ?? true;
    
    // Sanitize content
    const sanitizedSender = showSender ? 
      this.sanitizeSenderName(emailData.from) : 
      "Someone";
    
    const sanitizedSubject = showSubject ? 
      this.sanitizeSubject(emailData.subject) : 
      "New Email";

    return {
      title: isVip ? `📧 VIP: ${sanitizedSender}` : `New: ${sanitizedSender}`,
      body: sanitizedSubject,
      icon: "/favicon.ico",
      badge: "/favicon.ico", 
      tag: `email-${emailData.accountId}`, // Allows notification grouping
      data: {
        // SECURITY: Never include email content, only metadata for navigation
        emailId: emailData.id,
        accountId: emailData.accountId,
        url: `/email/${emailData.id}`,
        timestamp: Date.now(),
        notificationType: isVip ? 'vip_email' : 'new_email',
        // DO NOT include: email body, full sender info, or other sensitive data
      },
      actions: [
        {
          action: 'view',
          title: 'View',
          icon: '/icons/eye.svg',
        },
        {
          action: 'mark-read', 
          title: 'Mark Read',
          icon: '/icons/check.svg',
        },
      ],
      requireInteraction: isVip,
      silent: false,
      renotify: false, // Don't re-notify for same email
    };
  }
}

// Email notification helper functions
export class EmailNotificationHelper {
  /**
   * Create a notification payload for new email with privacy controls
   */
  static createNewEmailNotification(
    emailData: {
      id: string;
      accountId: string;
      from: string;
      subject: string;
      preview?: string;
      isVip?: boolean;
    },
    privacySettings?: {
      showSender?: boolean;
      showSubject?: boolean; 
      showPreview?: boolean;
    }
  ): PushNotificationPayload {
    // Use privacy-aware builder - NEVER expose sensitive content
    return PrivacyAwareNotificationBuilder.createSafeEmailNotification(emailData, privacySettings);
  }

  /**
   * Create a notification payload for account sync issues
   */
  static createSyncErrorNotification(
    accountData: {
      accountId: string;
      accountName: string;
      error: string;
    }
  ): PushNotificationPayload {
    return {
      title: `Email Sync Issue - ${accountData.accountName}`,
      body: `Unable to sync emails: ${accountData.error}`,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      tag: `sync-error-${accountData.accountId}`,
      data: {
        accountId: accountData.accountId,
        url: `/accounts/${accountData.accountId}/settings`,
        timestamp: Date.now(),
        notificationType: 'account_sync',
      },
      actions: [
        {
          action: 'check-account',
          title: 'Check Account',
          icon: '/icons/settings.svg',
        },
      ],
      requireInteraction: true,
      silent: false,
    };
  }

  /**
   * Create a grouped notification for multiple emails
   */
  static createGroupedEmailNotification(
    emails: Array<{
      id: string;
      accountId: string;
      from: string;
      subject: string;
    }>,
    accountName: string
  ): PushNotificationPayload {
    const emailCount = emails.length;
    const senders = [...new Set(emails.map(email => email.from))];
    
    let body: string;
    if (senders.length === 1) {
      body = `${emailCount} new emails from ${senders[0]}`;
    } else if (senders.length <= 3) {
      body = `${emailCount} new emails from ${senders.join(', ')}`;
    } else {
      body = `${emailCount} new emails from ${senders.length} senders`;
    }

    return {
      title: `${emailCount} New Emails - ${accountName}`,
      body,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      tag: `emails-grouped-${emails[0].accountId}`,
      data: {
        accountId: emails[0].accountId,
        url: `/inbox`,
        timestamp: Date.now(),
        notificationType: 'new_email',
      },
      actions: [
        {
          action: 'view-inbox',
          title: 'View Inbox',
          icon: '/icons/inbox.svg',
        },
        {
          action: 'mark-all-read',
          title: 'Mark All Read',
          icon: '/icons/check-all.svg',
        },
      ],
      requireInteraction: false,
      silent: false,
    };
  }
}