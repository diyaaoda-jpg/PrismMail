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
 * Simple date formatting for reply attribution
 */
function formatDate(date: Date): string {
  return date.toLocaleString();
}

/**
 * Simple content formatting with basic quoting
 */
function formatQuotedContent(content: string): string {
  return content
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n');
}

/**
 * Simple reply function
 */
export function makeReply(email: EmailMessage, currentUserEmail?: string): ReplyOptions {
  const subject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;
  const content = email.bodyText || email.bodyHtml || email.snippet || '';
  const body = `\n\n${formatDate(new Date(email.date))}, ${email.from} wrote:\n${formatQuotedContent(content)}`;

  return {
    to: email.from,
    subject,
    body,
    isReplyAll: false
  };
}

/**
 * Simple reply all function 
 */
export function makeReplyAll(email: EmailMessage, currentUserEmail?: string): ReplyOptions {
  const subject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;
  const content = email.bodyText || email.bodyHtml || email.snippet || '';
  const body = `\n\n${formatDate(new Date(email.date))}, ${email.from} wrote:\n${formatQuotedContent(content)}`;

  return {
    to: email.from,
    subject,
    body,
    isReplyAll: true
  };
}

/**
 * Simple forward function
 */
export function makeForward(email: EmailMessage): ReplyOptions {
  const subject = email.subject.startsWith('Fwd:') ? email.subject : `Fwd: ${email.subject}`;
  const content = email.bodyText || email.bodyHtml || email.snippet || '';
  
  const forwardHeader = [
    '---------- Forwarded message ---------',
    `From: ${email.from}`,
    `Date: ${formatDate(new Date(email.date))}`,
    `Subject: ${email.subject}`,
    ''
  ].join('\n');

  const body = `\n\n${forwardHeader}${content}`;

  return {
    to: '',
    subject,
    body,
    isForward: true
  };
}

/**
 * Simple button labels
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
 * Simple reply all logic
 */
export function shouldShowReplyAll(email: EmailMessage, currentUserEmail?: string): boolean {
  return true;
}