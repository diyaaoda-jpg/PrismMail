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
 * Formats a date in the Gmail-style attribution format
 * Example: "On Wed, Jan 10, 2025 at 2:30 PM, john@example.com wrote:"
 */
function formatAttribution(email: EmailMessage): string {
  // Ensure we have a valid Date object
  let date: Date;
  if (email.date instanceof Date) {
    date = email.date;
  } else if (typeof email.date === 'string' || typeof email.date === 'number') {
    date = new Date(email.date);
  } else {
    date = new Date(); // fallback to current date
  }
  
  // Validate the date is valid
  if (isNaN(date.getTime())) {
    date = new Date(); // fallback to current date if invalid
  }
  
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short', 
    day: 'numeric'
  });
  
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  
  return `On ${dateStr} at ${timeStr}, ${email.from} wrote:`;
}

/**
 * Formats quoted content with proper indentation
 */
function formatQuotedContent(content: string): string {
  return content
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n');
}

/**
 * Extracts email addresses from a string that may contain names and emails
 * Example: "John Doe <john@example.com>" => "john@example.com"
 */
function extractEmail(emailString: string): string {
  const match = emailString.match(/<([^>]+)>/);
  return match ? match[1] : emailString.trim();
}

/**
 * Extracts display name from email string
 * Example: "John Doe <john@example.com>" => "John Doe"
 */
function extractDisplayName(emailString: string): string {
  const match = emailString.match(/^([^<]+)<[^>]+>$/);
  if (match) {
    return match[1].trim();
  }
  return emailString.trim();
}

/**
 * Parses a comma-separated list of email addresses
 */
function parseEmailList(emailList: string): string[] {
  if (!emailList) return [];
  return emailList
    .split(',')
    .map(email => extractEmail(email.trim()))
    .filter(email => email.length > 0);
}

/**
 * Removes duplicate email addresses from a list
 */
function dedupeEmails(emails: string[]): string[] {
  const uniqueEmails = new Set(emails.map(email => email.toLowerCase()));
  return Array.from(uniqueEmails);
}

/**
 * Determines if an email subject already has a Reply/Forward prefix
 */
function hasReplyPrefix(subject: string): boolean {
  return /^(re|fwd?):\s/i.test(subject);
}

/**
 * Creates a reply email with proper formatting and threading
 */
export function makeReply(email: EmailMessage, currentUserEmail?: string): ReplyOptions {
  const subject = hasReplyPrefix(email.subject) 
    ? email.subject 
    : `Re: ${email.subject}`;

  const attribution = formatAttribution(email);
  const quotedBody = formatQuotedContent(email.snippet || '');
  
  const body = `\n\n${attribution}\n${quotedBody}`;

  return {
    to: email.from,
    subject,
    body,
    inReplyTo: email.id,
    references: email.id, // In real implementation, this would include the full thread
    isReplyAll: false
  };
}

/**
 * Creates a reply-all email with proper recipient handling
 */
export function makeReplyAll(email: EmailMessage, currentUserEmail?: string): ReplyOptions {
  const subject = hasReplyPrefix(email.subject) 
    ? email.subject 
    : `Re: ${email.subject}`;

  const attribution = formatAttribution(email);
  const quotedBody = formatQuotedContent(email.snippet || '');
  
  const body = `\n\n${attribution}\n${quotedBody}`;

  // For reply all, we need to include all recipients except the current user
  // Since we don't have CC/BCC info in our current EmailMessage type,
  // we'll use the original sender as TO for now
  // In a real implementation, this would parse the original CC/BCC fields
  
  let ccEmails: string[] = [];
  
  // If current user email is available, exclude it from recipients
  if (currentUserEmail) {
    const allRecipients = [email.from];
    ccEmails = dedupeEmails(
      allRecipients.filter(email => 
        extractEmail(email).toLowerCase() !== currentUserEmail.toLowerCase()
      )
    );
  }

  return {
    to: email.from,
    cc: ccEmails.length > 1 ? ccEmails.slice(1).join(', ') : undefined,
    subject,
    body,
    inReplyTo: email.id,
    references: email.id,
    isReplyAll: true
  };
}

/**
 * Creates a forward email with proper formatting
 */
export function makeForward(email: EmailMessage): ReplyOptions {
  const subject = email.subject.startsWith('Fwd:') 
    ? email.subject 
    : `Fwd: ${email.subject}`;

  // Ensure we have a valid Date object for formatting
  let date: Date;
  if (email.date instanceof Date) {
    date = email.date;
  } else if (typeof email.date === 'string' || typeof email.date === 'number') {
    date = new Date(email.date);
  } else {
    date = new Date(); // fallback to current date
  }
  
  // Validate the date is valid
  if (isNaN(date.getTime())) {
    date = new Date(); // fallback to current date if invalid
  }

  const forwardHeader = [
    '---------- Forwarded message ---------',
    `From: ${email.from}`,
    `Date: ${date.toLocaleString()}`,
    `Subject: ${email.subject}`,
    `To: ${extractEmail(email.from)}`, // In real implementation, this would be the original recipients
    ''
  ].join('\n');

  const body = `\n\n${forwardHeader}${email.snippet || ''}`;

  return {
    to: '',
    subject,
    body,
    isForward: true
  };
}

/**
 * Gets contextual button labels for reply/forward actions
 */
export function getContextualLabels(email: EmailMessage): {
  reply: string;
  replyAll: string;
  forward: string;
} {
  const displayName = extractDisplayName(email.from);
  const shortName = displayName.split(' ')[0]; // First name only
  
  return {
    reply: `Reply to ${shortName}`,
    replyAll: `Reply All to ${shortName}`,
    forward: `Forward from ${shortName}`
  };
}

/**
 * Checks if an email appears to have multiple recipients (indicating Reply All is meaningful)
 */
export function shouldShowReplyAll(email: EmailMessage, currentUserEmail?: string): boolean {
  // In a real implementation, this would check the original CC/BCC fields
  // For now, we'll always show Reply All as an option
  return true;
}

/**
 * Creates threading information for email headers
 */
export function createThreadingHeaders(originalEmailId: string, existingReferences?: string): {
  inReplyTo: string;
  references: string;
} {
  const inReplyTo = originalEmailId;
  
  // References should include the full thread chain
  const references = existingReferences 
    ? `${existingReferences} ${originalEmailId}`
    : originalEmailId;
    
  return { inReplyTo, references };
}