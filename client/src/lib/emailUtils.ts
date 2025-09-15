import type { EmailMessage } from '@/components/EmailListItem';

export interface ReplyOptions {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  isReplyAll?: boolean;
  isForward?: boolean;
}

/**
 * Enhanced date formatting for reply attribution
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric', 
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Extract the best available content from an email message
 * Prefers full body content over snippets
 */
function getEmailContent(email: EmailMessage): { content: string; isHtml: boolean } {
  // Prefer full body content over snippet
  if (email.bodyHtml && email.bodyHtml.trim().length > 0) {
    return { content: email.bodyHtml, isHtml: true };
  }
  
  if (email.bodyText && email.bodyText.trim().length > 0) {
    return { content: email.bodyText, isHtml: false };
  }
  
  // Fallback to snippet if no body content available
  return { content: email.snippet || '', isHtml: false };
}

/**
 * Convert HTML content to plain text for quoting
 */
function htmlToPlainText(html: string): string {
  // Remove HTML tags and decode entities
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  
  // Clean up excess whitespace
  text = text.replace(/\n\s*\n/g, '\n\n').trim();
  
  return text;
}

/**
 * Format content for HTML quoting using blockquote
 */
function formatHtmlQuotedContent(content: string, isHtml: boolean): string {
  if (isHtml) {
    // For HTML content, wrap in a styled blockquote
    return `<blockquote style="margin: 0 0 0 0.8ex; border-left: 1px solid #ccc; padding-left: 1ex;">${content}</blockquote>`;
  } else {
    // For plain text content, convert to HTML with line breaks and wrap in blockquote
    const htmlContent = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    return `<blockquote style="margin: 0 0 0 0.8ex; border-left: 1px solid #ccc; padding-left: 1ex;">${htmlContent}</blockquote>`;
  }
}

/**
 * Format content for plain text quoting with > prefix
 */
function formatPlainTextQuotedContent(content: string, isHtml: boolean): string {
  let plainContent = isHtml ? htmlToPlainText(content) : content;
  
  return plainContent
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n');
}

/**
 * Create comprehensive reply attribution header
 */
function createReplyAttribution(email: EmailMessage, isForward: boolean = false): { html: string; plain: string } {
  const date = email.date instanceof Date ? email.date : new Date(email.date);
  const formattedDate = formatDate(date);
  
  if (isForward) {
    const htmlAttribution = `
<br><br>
<div style="border-top: 1px solid #ccc; padding-top: 10px; margin-top: 10px;">
<p><strong>---------- Forwarded message ----------</strong></p>
<p><strong>From:</strong> ${email.from}</p>
<p><strong>Date:</strong> ${formattedDate}</p>
<p><strong>Subject:</strong> ${email.subject}</p>
</div>
<br>`;
    
    const plainAttribution = `\n\n---------- Forwarded message ----------\nFrom: ${email.from}\nDate: ${formattedDate}\nSubject: ${email.subject}\n\n`;
    
    return { html: htmlAttribution, plain: plainAttribution };
  } else {
    const htmlAttribution = `
<br><br>
<div style="border-top: 1px solid #ccc; padding-top: 10px; margin-top: 10px;">
<p>On ${formattedDate}, ${email.from} wrote:</p>
</div>
<br>`;
    
    const plainAttribution = `\n\nOn ${formattedDate}, ${email.from} wrote:\n\n`;
    
    return { html: htmlAttribution, plain: plainAttribution };
  }
}

/**
 * Enhanced reply function with proper HTML/text handling
 */
export function makeReply(email: EmailMessage, currentUserEmail?: string): ReplyOptions {
  const subject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;
  const { content, isHtml } = getEmailContent(email);
  const attribution = createReplyAttribution(email, false);
  
  // Create HTML body with proper quote formatting
  const quotedContent = formatHtmlQuotedContent(content, isHtml);
  const htmlBody = `${attribution.html}${quotedContent}`;

  return {
    to: email.from,
    subject,
    body: htmlBody,
    isReplyAll: false,
    inReplyTo: email.id,
    references: email.id
  };
}

/**
 * Enhanced reply all function with proper HTML/text handling
 */
export function makeReplyAll(email: EmailMessage, currentUserEmail?: string): ReplyOptions {
  const subject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;
  const { content, isHtml } = getEmailContent(email);
  const attribution = createReplyAttribution(email, false);
  
  // Create HTML body with proper quote formatting
  const quotedContent = formatHtmlQuotedContent(content, isHtml);
  const htmlBody = `${attribution.html}${quotedContent}`;

  return {
    to: email.from,
    subject,
    body: htmlBody,
    isReplyAll: true,
    inReplyTo: email.id,
    references: email.id
  };
}

/**
 * Enhanced forward function with proper HTML/text handling
 */
export function makeForward(email: EmailMessage): ReplyOptions {
  const subject = email.subject.startsWith('Fwd:') ? email.subject : `Fwd: ${email.subject}`;
  const { content, isHtml } = getEmailContent(email);
  const attribution = createReplyAttribution(email, true);
  
  // For forwarding, we include the content as-is without additional quoting
  const htmlBody = `${attribution.html}${content}`;

  return {
    to: '',
    subject,
    body: htmlBody,
    isForward: true
  };
}

/**
 * Generate contextual labels for reply actions
 */
export function getContextualLabels(email: EmailMessage): {
  reply: string;
  replyAll: string;
  forward: string;
} {
  return {
    reply: 'Reply',
    replyAll: 'Reply All',
    forward: 'Forward'
  };
}

/**
 * Determine if Reply All should be shown
 * Show Reply All if there are multiple recipients or CC recipients
 */
export function shouldShowReplyAll(email: EmailMessage, currentUserEmail?: string): boolean {
  // For now, always show Reply All - in a real implementation,
  // this would check if the email has multiple recipients
  return true;
}

/**
 * Utility function to create a plain text version for fallback
 */
export function createPlainTextReply(email: EmailMessage, isReplyAll: boolean = false, isForward: boolean = false): string {
  const subject = isForward 
    ? (email.subject.startsWith('Fwd:') ? email.subject : `Fwd: ${email.subject}`)
    : (email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`);
    
  const { content, isHtml } = getEmailContent(email);
  const attribution = createReplyAttribution(email, isForward);
  
  if (isForward) {
    const plainContent = isHtml ? htmlToPlainText(content) : content;
    return `${attribution.plain}${plainContent}`;
  } else {
    const quotedContent = formatPlainTextQuotedContent(content, isHtml);
    return `${attribution.plain}${quotedContent}`;
  }
}