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

export interface ParsedEmailAddress {
  name?: string;
  email: string;
}

/**
 * Parse email address strings into structured format
 * Handles formats like:
 * - "email@example.com"
 * - "Name <email@example.com>"
 * - "email@example.com, another@example.com"
 */
export function parseEmailAddresses(addressString?: string): ParsedEmailAddress[] {
  if (!addressString?.trim()) return [];
  
  const addresses: ParsedEmailAddress[] = [];
  
  // Split by comma, but be careful about commas in quoted names
  const parts = addressString.split(',').map(part => part.trim());
  
  for (const part of parts) {
    if (!part) continue;
    
    // Match "Name <email@example.com>" format
    const nameEmailMatch = part.match(/^(.+?)\s*<([^>]+)>$/);
    if (nameEmailMatch) {
      const name = nameEmailMatch[1].replace(/^"|"$/g, '').trim(); // Remove quotes
      const email = nameEmailMatch[2].trim();
      if (isValidEmail(email)) {
        addresses.push({ name: name || undefined, email });
      }
      continue;
    }
    
    // Match plain email format
    const emailOnlyMatch = part.match(/^[^\s<>]+@[^\s<>]+\.[^\s<>]+$/);
    if (emailOnlyMatch && isValidEmail(part)) {
      addresses.push({ email: part });
    }
  }
  
  return addresses;
}

/**
 * Format parsed email addresses back to string format
 */
export function formatEmailAddresses(addresses: ParsedEmailAddress[]): string {
  return addresses
    .map(addr => addr.name ? `${addr.name} <${addr.email}>` : addr.email)
    .join(', ');
}

/**
 * Basic email validation
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

/**
 * Remove duplicate email addresses from a list
 */
export function removeDuplicateEmails(addresses: ParsedEmailAddress[]): ParsedEmailAddress[] {
  const seen = new Set<string>();
  return addresses.filter(addr => {
    const email = addr.email.toLowerCase();
    if (seen.has(email)) return false;
    seen.add(email);
    return true;
  });
}

/**
 * Remove current user's email from recipient lists
 */
export function excludeCurrentUser(addresses: ParsedEmailAddress[], currentUserEmail?: string): ParsedEmailAddress[] {
  if (!currentUserEmail) return addresses;
  const userEmail = currentUserEmail.toLowerCase();
  return addresses.filter(addr => addr.email.toLowerCase() !== userEmail);
}

/**
 * Combine and deduplicate email addresses from multiple sources
 */
export function combineEmailAddresses(
  ...addressLists: (ParsedEmailAddress[] | undefined)[]
): ParsedEmailAddress[] {
  const combined = addressLists.reduce<ParsedEmailAddress[]>((acc, list) => {
    if (list) acc.push(...list);
    return acc;
  }, []);
  
  return removeDuplicateEmails(combined);
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
<div style="border-top: 1px solid #ccc; padding-top: 10px; margin-top: 20px;">
<p><strong>---------- Forwarded message ----------</strong></p>
<p><strong>From:</strong> ${email.from}</p>
<p><strong>Date:</strong> ${formattedDate}</p>
<p><strong>Subject:</strong> ${email.subject}</p>
</div>`;
    
    const plainAttribution = `\n\n---------- Forwarded message ----------\nFrom: ${email.from}\nDate: ${formattedDate}\nSubject: ${email.subject}\n\n`;
    
    return { html: htmlAttribution, plain: plainAttribution };
  } else {
    const htmlAttribution = `
<div style="border-top: 1px solid #ccc; padding-top: 10px; margin-top: 20px;">
<p>On ${formattedDate}, ${email.from} wrote:</p>
</div>`;
    
    const plainAttribution = `\n\nOn ${formattedDate}, ${email.from} wrote:\n\n`;
    
    return { html: htmlAttribution, plain: plainAttribution };
  }
}

/**
 * Enhanced reply function with proper recipient handling
 * Standard reply logic: Send to Reply-To if present, otherwise to From address
 * No CC or BCC recipients, exclude current user
 */
export function makeReply(email: EmailMessage, currentUserEmail?: string): ReplyOptions {
  const subject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;
  const { content, isHtml } = getEmailContent(email);
  const attribution = createReplyAttribution(email, false);
  
  // Create HTML body with proper quote formatting
  const quotedContent = formatHtmlQuotedContent(content, isHtml);
  const htmlBody = `${attribution.html}${quotedContent}`;
  
  // Determine reply recipient: Reply-To takes precedence over From
  const replyToAddress = email.replyTo?.trim() || email.from;
  console.log('makeReply DEBUG - replyToAddress:', replyToAddress);
  const replyRecipients = parseEmailAddresses(replyToAddress);
  console.log('makeReply DEBUG - replyRecipients:', replyRecipients);

  // For regular reply, we want to reply to the sender, not filter them out
  // Just use the reply recipients directly
  const finalRecipients = replyRecipients.length > 0 ? replyRecipients : parseEmailAddresses(email.from);
  console.log('makeReply DEBUG - finalRecipients:', finalRecipients);

  return {
    to: formatEmailAddresses(finalRecipients),
    subject,
    body: htmlBody,
    isReplyAll: false,
    inReplyTo: email.id,
    references: email.id
  };
}

/**
 * Enhanced reply all function with proper recipient handling
 * Reply All logic: Send to Reply-To (or From) plus all To/CC recipients from original email
 * Exclude current user, preserve CC structure
 */
export function makeReplyAll(email: EmailMessage, currentUserEmail?: string): ReplyOptions {
  const subject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;
  const { content, isHtml } = getEmailContent(email);
  const attribution = createReplyAttribution(email, false);
  
  // Create HTML body with proper quote formatting
  const quotedContent = formatHtmlQuotedContent(content, isHtml);
  const htmlBody = `${attribution.html}${quotedContent}`;
  
  // Parse all recipients from the original email
  const fromRecipients = parseEmailAddresses(email.replyTo?.trim() || email.from);
  const toRecipients = parseEmailAddresses(email.to);
  const ccRecipients = parseEmailAddresses(email.cc);
  
  // Combine To recipients: Reply-To/From + original To recipients
  const allToRecipients = combineEmailAddresses(fromRecipients, toRecipients);
  
  // Exclude current user from all recipient lists
  const filteredToRecipients = excludeCurrentUser(allToRecipients, currentUserEmail);
  const filteredCcRecipients = excludeCurrentUser(ccRecipients, currentUserEmail);
  
  // If no To recipients remain after filtering, fallback to original From
  const finalToRecipients = filteredToRecipients.length > 0 ? filteredToRecipients : parseEmailAddresses(email.from);

  return {
    to: formatEmailAddresses(finalToRecipients),
    cc: filteredCcRecipients.length > 0 ? formatEmailAddresses(filteredCcRecipients) : undefined,
    subject,
    body: htmlBody,
    isReplyAll: true,
    inReplyTo: email.id,
    references: email.id
  };
}

/**
 * Enhanced forward function with proper forwarding logic
 * Forward logic: Start with empty recipients, user manually fills them
 * Include comprehensive message headers in forward attribution
 */
export function makeForward(email: EmailMessage): ReplyOptions {
  const subject = email.subject.startsWith('Fwd:') ? email.subject : `Fwd: ${email.subject}`;
  const { content, isHtml } = getEmailContent(email);
  
  // Enhanced forward attribution with more details
  const date = email.date instanceof Date ? email.date : new Date(email.date);
  const formattedDate = formatDate(date);
  
  const htmlAttribution = `
<div style="border-top: 1px solid #ccc; padding-top: 10px; margin-top: 20px;">
<p><strong>---------- Forwarded message ----------</strong></p>
<p><strong>From:</strong> ${email.from}</p>
${email.to ? `<p><strong>To:</strong> ${email.to}</p>` : ''}
${email.cc ? `<p><strong>Cc:</strong> ${email.cc}</p>` : ''}
<p><strong>Date:</strong> ${formattedDate}</p>
<p><strong>Subject:</strong> ${email.subject}</p>
</div>`;
  
  // For forwarding, include the content as-is without additional quoting
  const htmlBody = `${htmlAttribution}${content}`;

  return {
    to: '', // Empty - user fills this manually
    cc: undefined,
    bcc: undefined,
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
 * Show Reply All if there are multiple recipients or CC recipients beyond current user
 */
export function shouldShowReplyAll(email: EmailMessage, currentUserEmail?: string): boolean {
  // Parse all recipients
  const toRecipients = parseEmailAddresses(email.to);
  const ccRecipients = parseEmailAddresses(email.cc);
  const fromRecipients = parseEmailAddresses(email.from);
  
  // Combine all recipients and exclude current user
  const allRecipients = combineEmailAddresses(toRecipients, ccRecipients, fromRecipients);
  const filteredRecipients = excludeCurrentUser(allRecipients, currentUserEmail);
  
  // Show Reply All if there are multiple recipients after excluding current user
  // or if there are any CC recipients
  return filteredRecipients.length > 1 || ccRecipients.length > 0;
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