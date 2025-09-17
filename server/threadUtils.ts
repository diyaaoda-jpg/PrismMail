import crypto from 'crypto';

/**
 * Server-side email threading utilities
 * Implements proper conversation threading based on subject and participants
 */

/**
 * Normalize email subject for threading by removing common prefixes and suffixes
 */
function normalizeSubject(subject: string): string {
  if (!subject) return '';
  
  return subject
    .toLowerCase()
    .trim()
    // Remove common reply/forward prefixes (case insensitive)
    .replace(/^(re|fwd?|fw):\s*/gi, '')
    .replace(/^\[.*?\]\s*/, '') // Remove [EXTERNAL], [SPAM] etc.
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Extract email addresses from a comma-separated string
 */
function extractEmails(emailString: string): string[] {
  if (!emailString) return [];
  
  // Simple regex to extract email addresses
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = emailString.match(emailRegex) || [];
  
  return matches.map(email => email.toLowerCase().trim());
}

/**
 * Generate a consistent threadId based on normalized subject and participants
 * This ensures emails in the same conversation get the same threadId
 */
export function generateThreadId(
  subject: string,
  from: string,
  to: string,
  cc?: string,
  replyTo?: string
): string {
  const normalizedSubject = normalizeSubject(subject);
  
  // Collect all participants
  const participants = new Set<string>();
  
  // Add all email addresses from all fields
  extractEmails(from).forEach(email => participants.add(email));
  extractEmails(to).forEach(email => participants.add(email));
  extractEmails(cc || '').forEach(email => participants.add(email));
  extractEmails(replyTo || '').forEach(email => participants.add(email));
  
  // Sort participants for consistent ordering
  const sortedParticipants = Array.from(participants).sort().join(',');
  
  // Create deterministic thread identifier
  const combined = `${normalizedSubject}:${sortedParticipants}`;
  
  // Use SHA-256 to create a consistent, URL-safe thread ID
  const hash = crypto.createHash('sha256').update(combined, 'utf8').digest('hex');
  
  // Return first 16 characters for compact thread ID
  return `thread_${hash.substring(0, 16)}`;
}

/**
 * Check if an email appears to be a reply based on subject
 */
export function isReplyMessage(subject: string): boolean {
  if (!subject) return false;
  return /^(re|fwd?|fw):\s*/i.test(subject.trim());
}

/**
 * Check if two emails should be in the same thread
 * Based on normalized subject and participant overlap
 */
export function shouldBeInSameThread(
  email1: { subject: string; from: string; to: string; cc?: string },
  email2: { subject: string; from: string; to: string; cc?: string }
): boolean {
  // Same normalized subject is primary indicator
  const subject1 = normalizeSubject(email1.subject);
  const subject2 = normalizeSubject(email2.subject);
  
  if (subject1 !== subject2) return false;
  
  // Check if participants overlap significantly
  const participants1 = new Set([
    ...extractEmails(email1.from),
    ...extractEmails(email1.to),
    ...extractEmails(email1.cc || '')
  ]);
  
  const participants2 = new Set([
    ...extractEmails(email2.from),
    ...extractEmails(email2.to),
    ...extractEmails(email2.cc || '')
  ]);
  
  // Calculate intersection
  const intersection = new Set(Array.from(participants1).filter(x => participants2.has(x)));
  const union = new Set([...Array.from(participants1), ...Array.from(participants2)]);
  
  // Require at least 50% participant overlap
  return intersection.size / union.size >= 0.5;
}