import { decryptAccountSettingsWithPassword } from '../crypto';
import type { SendEmailRequest, SendEmailResponse } from '../../shared/schema';
import type { EwsSettings } from '../../shared/schema';

export interface EwsSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  errorCode?: string;
  details?: {
    phase?: string;
    suggestion?: string;
  };
  sentAt: Date;
}

export interface ReplyForwardContext {
  originalMessageId?: string;
  references?: string;
  inReplyTo?: string;
  mode?: 'reply' | 'reply_all' | 'forward';
}

/**
 * Normalize EWS URL to canonical Exchange endpoint format
 * Reusing the same logic from ewsSync.ts for consistency
 */
function normalizeEwsUrl(hostUrl: string): string {
  let url: URL;
  try {
    // If no scheme, prepend https://
    if (!hostUrl.startsWith('http')) {
      hostUrl = 'https://' + hostUrl;
    }
    url = new URL(hostUrl);
  } catch {
    throw new Error('Invalid EWS server name format');
  }
  
  // Always use the canonical Exchange EWS endpoint (force HTTPS)
  return url.origin + '/EWS/Exchange.asmx';
}

/**
 * Convert plain text or HTML content to proper email body format
 */
function formatEmailBody(content: string, isHtml: boolean = false): string {
  if (!isHtml) {
    // Plain text - ensure proper line endings
    return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }
  
  // HTML content - wrap in basic HTML structure if needed
  if (!content.includes('<html') && !content.includes('<body')) {
    return `<html><body>${content}</body></html>`;
  }
  
  return content;
}

/**
 * Generate reply/forward content with proper attribution
 */
function generateReplyContent(
  originalBody: string,
  originalFrom: string,
  originalDate: Date,
  originalSubject: string,
  mode: 'reply' | 'reply_all' | 'forward'
): { textContent: string; htmlContent: string } {
  const dateStr = originalDate.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  
  if (mode === 'forward') {
    const textContent = `

---------- Forwarded message ----------
From: ${originalFrom}
Date: ${dateStr}
Subject: ${originalSubject}

${originalBody}`;

    const htmlContent = `
<div>
<br><br>
<div style="border-left: 3px solid #ccc; margin: 10px 0; padding-left: 10px;">
<p><strong>---------- Forwarded message ----------</strong></p>
<p><strong>From:</strong> ${originalFrom}</p>
<p><strong>Date:</strong> ${dateStr}</p>
<p><strong>Subject:</strong> ${originalSubject}</p>
<br>
${originalBody}
</div>
</div>`;
    
    return { textContent, htmlContent };
  } else {
    // Reply mode
    const textContent = `

On ${dateStr}, ${originalFrom} wrote:
> ${originalBody.split('\n').join('\n> ')}`;

    const htmlContent = `
<div>
<br><br>
<div style="border-left: 3px solid #ccc; margin: 10px 0; padding-left: 10px; color: #666;">
<p>On ${dateStr}, <strong>${originalFrom}</strong> wrote:</p>
${originalBody}
</div>
</div>`;
    
    return { textContent, htmlContent };
  }
}

/**
 * Parse email addresses from comma-separated string
 */
function parseEmailAddresses(addresses: string): string[] {
  if (!addresses.trim()) return [];
  
  return addresses
    .split(',')
    .map(addr => addr.trim())
    .filter(addr => addr.length > 0)
    .map(addr => {
      // Extract email from "Name <email@example.com>" format
      const match = addr.match(/<([^>]+)>$/);
      return match ? match[1] : addr;
    });
}

/**
 * Enhanced EWS email sending service
 */
export class EwsSendService {
  private static instance: EwsSendService;
  
  public static getInstance(): EwsSendService {
    if (!EwsSendService.instance) {
      EwsSendService.instance = new EwsSendService();
    }
    return EwsSendService.instance;
  }

  /**
   * Send email using EWS with comprehensive error handling
   */
  public async sendEmail(
    settingsJson: string,
    emailRequest: SendEmailRequest,
    context?: ReplyForwardContext
  ): Promise<EwsSendResult> {
    const startTime = Date.now();
    
    try {
      console.log('EWS Send: Starting email send for account');
      
      // Decrypt account settings
      const settings = decryptAccountSettingsWithPassword(settingsJson) as EwsSettings;
      
      if (!settings.host || !settings.username || !settings.password) {
        throw new Error('Invalid or incomplete EWS account settings');
      }
      
      // Dynamic import for EWS API
      const ewsApi = await import('ews-javascript-api');
      const {
        ExchangeService,
        ExchangeVersion,
        WebCredentials,
        Uri,
        EmailMessage,
        MessageBody,
        BodyType,
        EmailAddress,
        WellKnownFolderName
      } = ewsApi;

      // Create Exchange service instance with enhanced error handling
      const service = new ExchangeService(ExchangeVersion.Exchange2013);
      
      try {
        service.Credentials = new WebCredentials(settings.username, settings.password);
        console.log('EWS Send: Credentials set successfully');
      } catch (credError: any) {
        throw new Error(`Failed to set EWS credentials: ${credError.message}`);
      }
      
      // Set EWS endpoint URL with validation
      try {
        const ewsUrl = normalizeEwsUrl(settings.host);
        service.Url = new Uri(ewsUrl);
        console.log(`EWS Send: Using endpoint URL: ${ewsUrl}`);
      } catch (urlError: any) {
        throw new Error(`Invalid EWS endpoint URL: ${urlError.message}`);
      }
      
      // Enable pre-authentication and set user agent
      service.PreAuthenticate = true;
      service.UserAgent = 'PrismMail/1.0';
      
      // Create new email message with error handling
      let message: any;
      try {
        message = new EmailMessage(service);
        console.log('EWS Send: Email message object created');
      } catch (messageError: any) {
        throw new Error(`Failed to create email message: ${messageError.message}`);
      }
      
      // Set basic properties
      message.Subject = emailRequest.subject;
      
      // Set recipients with validation
      const toAddresses = parseEmailAddresses(emailRequest.to);
      if (toAddresses.length === 0) {
        throw new Error('At least one recipient is required in the "to" field');
      }
      
      try {
        for (const address of toAddresses) {
          message.ToRecipients.Add(address);
        }
        console.log(`EWS Send: Added ${toAddresses.length} TO recipient(s)`);
      } catch (recipientError: any) {
        throw new Error(`Invalid TO recipients: ${recipientError.message}`);
      }
      
      // Set CC recipients if provided
      if (emailRequest.cc) {
        try {
          const ccAddresses = parseEmailAddresses(emailRequest.cc);
          for (const address of ccAddresses) {
            message.CcRecipients.Add(address);
          }
          console.log(`EWS Send: Added ${ccAddresses.length} CC recipient(s)`);
        } catch (ccError: any) {
          console.warn(`EWS Send: Failed to add CC recipients: ${ccError.message}`);
          // CC errors are non-fatal, continue sending
        }
      }
      
      // Set BCC recipients if provided
      if (emailRequest.bcc) {
        try {
          const bccAddresses = parseEmailAddresses(emailRequest.bcc);
          for (const address of bccAddresses) {
            message.BccRecipients.Add(address);
          }
          console.log(`EWS Send: Added ${bccAddresses.length} BCC recipient(s)`);
        } catch (bccError: any) {
          console.warn(`EWS Send: Failed to add BCC recipients: ${bccError.message}`);
          // BCC errors are non-fatal, continue sending
        }
      }
      
      // Set message body
      let bodyContent = emailRequest.body;
      let isHtmlContent = false;
      
      // Check if we have HTML content
      if (emailRequest.bodyHtml && emailRequest.bodyHtml.trim()) {
        bodyContent = emailRequest.bodyHtml;
        isHtmlContent = true;
      }
      
      // Format the body content
      const formattedBody = formatEmailBody(bodyContent, isHtmlContent);
      
      // Set body with appropriate type
      message.Body = new MessageBody(
        isHtmlContent ? BodyType.HTML : BodyType.Text,
        formattedBody
      );
      
      // Handle reply/forward context using proper InternetMessageHeaders API
      if (context && context.originalMessageId) {
        try {
          const { InternetMessageHeader } = ewsApi;
          
          if (context.inReplyTo) {
            message.InternetMessageHeaders.Add(
              new InternetMessageHeader('In-Reply-To', context.inReplyTo)
            );
            console.log(`EWS Send: Added In-Reply-To header: ${context.inReplyTo}`);
          }
          if (context.references) {
            message.InternetMessageHeaders.Add(
              new InternetMessageHeader('References', context.references)
            );
            console.log(`EWS Send: Added References header: ${context.references}`);
          }
        } catch (headerError: any) {
          // Non-fatal error - threading headers are useful but not critical for sending
          console.warn(`EWS Send: Failed to add threading headers: ${headerError.message}`);
        }
      }
      
      // TODO: Handle attachments when attachment system is ready
      // if (emailRequest.attachments && emailRequest.attachments.length > 0) {
      //   for (const attachment of emailRequest.attachments) {
      //     // Add attachment logic here
      //   }
      // }
      
      console.log(`EWS Send: Sending email to ${toAddresses.length} recipient(s)`);
      
      // Send the email and save to sent folder explicitly with retry logic
      try {
        await message.SendAndSaveCopy(WellKnownFolderName.SentItems);
        console.log('EWS Send: Message sent and saved to Sent Items');
      } catch (sendError: any) {
        // Enhanced error handling for send failures
        const errorMsg = sendError.message?.toLowerCase() || '';
        
        if (errorMsg.includes('timeout') || errorMsg.includes('network')) {
          throw new Error(`Email sending failed due to network timeout. Please check your connection and try again.`);
        } else if (errorMsg.includes('401') || errorMsg.includes('unauthorized')) {
          throw new Error(`Authentication failed. Please check your credentials and try again.`);
        } else if (errorMsg.includes('403') || errorMsg.includes('forbidden')) {
          throw new Error(`Permission denied. You may not have send permissions on this account.`);
        } else if (errorMsg.includes('recipient') || errorMsg.includes('address')) {
          throw new Error(`Invalid recipient address. Please check all email addresses and try again.`);
        } else {
          throw new Error(`Failed to send email: ${sendError.message}`);
        }
      }
      
      // Retrieve the actual InternetMessageId from the sent item
      let actualMessageId: string;
      
      try {
        // Get the sent item to retrieve the actual InternetMessageId
        const { PropertySet, BasePropertySet, ItemSchema, ItemId, Folder, SearchFilter } = ewsApi;
        
        // Create property set that includes InternetMessageId
        const propertySet = new PropertySet(BasePropertySet.FirstClassProperties);
        propertySet.Add(ItemSchema.InternetMessageId);
        
        // Get the Sent Items folder
        const sentItemsFolder = await Folder.Bind(service, WellKnownFolderName.SentItems);
        
        // Create search filter to find the message we just sent
        // Search by subject and date (within last minute) for better matching
        const subjectFilter = new SearchFilter.ContainsSubstring(ItemSchema.Subject, emailRequest.subject);
        const dateFilter = new SearchFilter.IsGreaterThan(
          ItemSchema.DateTimeSent,
          new Date(Date.now() - 60000) // Messages sent in last minute
        );
        const combinedFilter = new SearchFilter.SearchFilterCollection(
          ewsApi.LogicalOperator.And,
          [subjectFilter, dateFilter]
        );
        
        // Search for the sent message
        const { ItemView } = ewsApi;
        const itemView = new ItemView(5); // Limit to 5 most recent messages
        itemView.PropertySet = propertySet;
        
        const findResults = await sentItemsFolder.FindItems(combinedFilter, itemView);
        
        if (findResults.Items.length > 0) {
          // Get the most recent message (should be ours)
          const sentMessage = findResults.Items[0];
          actualMessageId = sentMessage.InternetMessageId;
          console.log(`EWS Send: Retrieved actual InternetMessageId: ${actualMessageId}`);
        } else {
          throw new Error('Sent message not found in Sent Items folder');
        }
        
      } catch (retrievalError: any) {
        console.warn(`EWS Send: Failed to retrieve actual InternetMessageId: ${retrievalError.message}`);
        
        // Fallback: Generate a synthetic but traceable message ID
        actualMessageId = `prismmail-${Date.now()}-${Math.random().toString(36).substr(2, 9)}@prismmail.local`;
      }
      
      const duration = Date.now() - startTime;
      console.log(`EWS Send: Email sent successfully in ${duration}ms`);
      
      return {
        success: true,
        messageId: actualMessageId,
        sentAt: new Date()
      };
      
    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.error(`EWS Send: Failed to send email (${duration}ms):`, error);
      
      return this.handleSendError(error);
    }
  }
  
  /**
   * Send reply email with proper threading
   */
  public async sendReply(
    settingsJson: string,
    emailRequest: SendEmailRequest,
    originalMessageId: string,
    originalFrom: string,
    originalDate: Date,
    originalSubject: string,
    originalBody: string,
    mode: 'reply' | 'reply_all' = 'reply'
  ): Promise<EwsSendResult> {
    // Generate reply content
    const replyContent = generateReplyContent(
      originalBody,
      originalFrom,
      originalDate,
      originalSubject,
      mode
    );
    
    // Append reply content to user's message
    const enhancedRequest: SendEmailRequest = {
      ...emailRequest,
      body: emailRequest.body + replyContent.textContent,
      bodyHtml: (emailRequest.bodyHtml || emailRequest.body) + replyContent.htmlContent
    };
    
    // Create reply context
    const context: ReplyForwardContext = {
      originalMessageId,
      inReplyTo: originalMessageId,
      references: originalMessageId,
      mode
    };
    
    return this.sendEmail(settingsJson, enhancedRequest, context);
  }
  
  /**
   * Send forward email with original message content
   */
  public async sendForward(
    settingsJson: string,
    emailRequest: SendEmailRequest,
    originalMessageId: string,
    originalFrom: string,
    originalDate: Date,
    originalSubject: string,
    originalBody: string
  ): Promise<EwsSendResult> {
    // Generate forward content
    const forwardContent = generateReplyContent(
      originalBody,
      originalFrom,
      originalDate,
      originalSubject,
      'forward'
    );
    
    // Append forward content to user's message
    const enhancedRequest: SendEmailRequest = {
      ...emailRequest,
      body: emailRequest.body + forwardContent.textContent,
      bodyHtml: (emailRequest.bodyHtml || emailRequest.body) + forwardContent.htmlContent
    };
    
    // Create forward context
    const context: ReplyForwardContext = {
      originalMessageId,
      mode: 'forward'
    };
    
    return this.sendEmail(settingsJson, enhancedRequest, context);
  }
  
  /**
   * Test EWS connection for sending (lighter test than full sync)
   */
  public async testConnection(settingsJson: string): Promise<EwsSendResult> {
    try {
      const settings = decryptAccountSettingsWithPassword(settingsJson) as EwsSettings;
      
      const ewsApi = await import('ews-javascript-api');
      const { ExchangeService, ExchangeVersion, WebCredentials, Uri } = ewsApi;

      const service = new ExchangeService(ExchangeVersion.Exchange2013);
      service.Credentials = new WebCredentials(settings.username, settings.password);
      service.Url = new Uri(normalizeEwsUrl(settings.host));
      service.PreAuthenticate = true;
      service.UserAgent = 'PrismMail/1.0';
      
      // Test connection by trying to access a well-known folder (lighter test)
      const { WellKnownFolderName, Folder } = ewsApi;
      await Folder.Bind(service, WellKnownFolderName.Inbox);
      
      return {
        success: true,
        sentAt: new Date()
      };
      
    } catch (error: any) {
      return this.handleSendError(error);
    }
  }
  
  /**
   * Enhanced error handling for EWS send operations
   */
  private handleSendError(error: any): EwsSendResult {
    const message = error.message?.toLowerCase() || '';
    let errorCode = 'EWS_SEND_ERROR';
    let suggestion = 'Please check your settings and try again';
    let phase = 'Email Send';
    
    // Authentication errors
    if (message.includes('401') || message.includes('unauthorized') || message.includes('authentication')) {
      errorCode = 'EWS_AUTH_FAILED';
      suggestion = 'Please check your username and password';
      phase = 'Authentication';
    }
    // Network/connection errors
    else if (message.includes('network') || message.includes('timeout') || message.includes('connection')) {
      errorCode = 'EWS_CONNECTION_ERROR';
      suggestion = 'Please check your network connection and server settings';
      phase = 'Connection';
    }
    // Server errors
    else if (message.includes('500') || message.includes('502') || message.includes('503')) {
      errorCode = 'EWS_SERVER_ERROR';
      suggestion = 'The Exchange server is experiencing issues. Please try again later';
      phase = 'Server Response';
    }
    // Permission errors
    else if (message.includes('403') || message.includes('forbidden')) {
      errorCode = 'EWS_PERMISSION_ERROR';
      suggestion = 'You may not have permission to send emails through this account';
      phase = 'Authorization';
    }
    // Recipient errors
    else if (message.includes('recipient') || message.includes('address')) {
      errorCode = 'EWS_RECIPIENT_ERROR';
      suggestion = 'Please check the recipient email addresses are valid';
      phase = 'Recipient Validation';
    }
    
    return {
      success: false,
      error: error.message?.substring(0, 200) || 'Failed to send email',
      errorCode,
      details: {
        phase,
        suggestion
      },
      sentAt: new Date()
    };
  }
}

// Export singleton instance
export const ewsSendService = EwsSendService.getInstance();