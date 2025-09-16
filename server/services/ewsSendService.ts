import { decryptAccountSettingsWithPassword } from '../crypto';

interface EwsSendOptions {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  attachments?: any[];
}

interface EwsSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Normalize EWS URL to ensure proper format
 */
function normalizeEwsUrl(hostOrUrl: string): string {
  if (!hostOrUrl) {
    throw new Error('Host/URL is required');
  }

  // If it's already a full EWS URL, return as-is
  if (hostOrUrl.includes('/EWS/Exchange.asmx') || hostOrUrl.includes('/ews/exchange.asmx')) {
    return hostOrUrl;
  }

  // Remove protocol if present
  let cleanHost = hostOrUrl.replace(/^https?:\/\//, '');
  
  // Remove trailing slash if present
  cleanHost = cleanHost.replace(/\/$/, '');
  
  // Construct the full EWS URL
  return `https://${cleanHost}/EWS/Exchange.asmx`;
}

/**
 * Service for sending emails via EWS
 */
export class EwsSendService {
  /**
   * Send an email via EWS
   */
  static async sendEmail(
    accountId: string,
    settingsJson: string,
    options: EwsSendOptions
  ): Promise<EwsSendResult> {
    try {
      console.log(`[EwsSendService] Starting email send for account ${accountId}`);
      
      // Decrypt account settings
      const settings = decryptAccountSettingsWithPassword(settingsJson);
      console.log('[EwsSendService] Decrypted settings:', {
        host: settings?.host || 'undefined',
        username: settings?.username || 'undefined',
        hasPassword: !!(settings?.password)
      });
      
      // Dynamic import to avoid require() issues
      const ewsApi = await import('ews-javascript-api');
      const { 
        ExchangeService, 
        ExchangeVersion, 
        WebCredentials, 
        Uri, 
        EmailMessage,
        MessageBody,
        BodyType,
        EmailAddress
      } = ewsApi;

      // Create Exchange service
      const service = new ExchangeService(ExchangeVersion.Exchange2013);
      service.Credentials = new WebCredentials(settings.username, settings.password);
      
      // Use canonical EWS URL normalization
      const ewsUrl = normalizeEwsUrl(settings.host);
      service.Url = new Uri(ewsUrl);
      
      // Enable pre-authentication for better compatibility
      service.PreAuthenticate = true;
      service.UserAgent = 'PrismMail/1.0';

      console.log(`[EwsSendService] Creating email message...`);

      // Create new email message
      const message = new EmailMessage(service);
      
      // Set subject
      message.Subject = options.subject;
      
      // Set body - prefer HTML if available, otherwise use text
      if (options.bodyHtml && options.bodyHtml.trim()) {
        message.Body = new MessageBody(BodyType.HTML, options.bodyHtml);
      } else {
        message.Body = new MessageBody(BodyType.Text, options.bodyText);
      }
      
      // Add To recipients
      for (const toEmail of options.to) {
        message.ToRecipients.Add(toEmail.trim());
      }
      
      // Add CC recipients if specified
      if (options.cc && options.cc.length > 0) {
        for (const ccEmail of options.cc) {
          message.CcRecipients.Add(ccEmail.trim());
        }
      }
      
      // Add BCC recipients if specified
      if (options.bcc && options.bcc.length > 0) {
        for (const bccEmail of options.bcc) {
          message.BccRecipients.Add(bccEmail.trim());
        }
      }

      console.log(`[EwsSendService] Sending email to ${options.to.join(', ')}`);
      console.log(`[EwsSendService] Subject: ${options.subject}`);

      // Send the message
      await message.Send();
      
      console.log(`[EwsSendService] Email sent successfully`);
      
      return {
        success: true,
        messageId: message.Id?.toString() || `ews-sent-${Date.now()}`
      };

    } catch (error: any) {
      console.error('[EwsSendService] Error sending email:', error);
      
      let errorMessage = 'Failed to send email via EWS';
      
      // Extract meaningful error messages
      if (error.message) {
        errorMessage = `EWS send failed: ${error.message}`;
      } else if (typeof error === 'string') {
        errorMessage = `EWS send failed: ${error}`;
      }
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }
}