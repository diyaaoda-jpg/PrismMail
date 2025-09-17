import type { EmailMessage } from '@shared/schema';

export interface ConversationThread {
  id: string; // Thread identifier - either threadId or generated from subject
  subject: string; // Normalized subject (without Re:, Fwd: prefixes)
  originalSubject: string; // Original subject from the first email
  emails: EmailMessage[]; // All emails in this conversation, sorted by date
  latestEmail: EmailMessage; // Most recent email (for sorting conversations)
  earliestEmail: EmailMessage; // First email in the conversation
  unreadCount: number; // Number of unread emails in conversation
  totalCount: number; // Total number of emails
  isExpanded: boolean; // UI state for showing/hiding emails
  participants: string[]; // Unique email addresses involved
  hasAttachments: boolean; // True if any email has attachments
  priority: number; // Highest priority of emails in conversation
  isFlagged: boolean; // True if any email is flagged
}

/**
 * Normalize email subject by removing common prefixes
 */
function normalizeSubject(subject: string): string {
  if (!subject) return '';
  
  // Remove common reply/forward prefixes (case insensitive)
  return subject
    .replace(/^(re|fw|fwd|forward):\s*/gi, '')
    .trim()
    .toLowerCase();
}

/**
 * Generate a consistent thread ID from subject and participants
 */
function generateThreadId(subject: string, participants: string[]): string {
  const normalizedSubject = normalizeSubject(subject);
  const sortedParticipants = [...participants].sort().join(',');
  
  // Create a simple hash-like identifier
  const combined = `${normalizedSubject}:${sortedParticipants}`;
  return btoa(combined).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
}

/**
 * Extract all email addresses from email participants (from, to, cc, bcc)
 */
function extractParticipants(email: EmailMessage): string[] {
  const participants: string[] = [];
  
  if (email.from) participants.push(email.from.toLowerCase());
  if (email.to) {
    email.to.split(',').forEach((addr: string) => {
      const cleaned = addr.trim().toLowerCase();
      if (cleaned && !participants.includes(cleaned)) {
        participants.push(cleaned);
      }
    });
  }
  if (email.cc) {
    email.cc.split(',').forEach((addr: string) => {
      const cleaned = addr.trim().toLowerCase();
      if (cleaned && !participants.includes(cleaned)) {
        participants.push(cleaned);
      }
    });
  }
  if (email.bcc) {
    email.bcc.split(',').forEach((addr: string) => {
      const cleaned = addr.trim().toLowerCase();
      if (cleaned && !participants.includes(cleaned)) {
        participants.push(cleaned);
      }
    });
  }
  
  return participants;
}

/**
 * Group emails into conversation threads
 */
export function groupEmailsIntoConversations(
  emails: EmailMessage[],
  expandedConversations: Set<string> = new Set()
): ConversationThread[] {
  const conversationMap = new Map<string, ConversationThread>();
  
  // Sort emails by date (newest first for processing)
  const sortedEmails = [...emails].sort((a, b) => b.date.getTime() - a.date.getTime());
  
  for (const email of sortedEmails) {
    let threadId = email.threadId;
    
    // If no threadId from server, generate one based on subject and participants
    if (!threadId) {
      const participants = extractParticipants(email);
      threadId = generateThreadId(email.subject, participants);
    }
    
    let conversation = conversationMap.get(threadId);
    
    if (!conversation) {
      // Create new conversation
      const participants = extractParticipants(email);
      conversation = {
        id: threadId,
        subject: normalizeSubject(email.subject),
        originalSubject: email.subject,
        emails: [],
        latestEmail: email,
        earliestEmail: email,
        unreadCount: 0,
        totalCount: 0,
        isExpanded: expandedConversations.has(threadId),
        participants,
        hasAttachments: false,
        priority: 0,
        isFlagged: false,
      };
      
      conversationMap.set(threadId, conversation);
    }
    
    // Add email to conversation
    conversation.emails.push(email);
    conversation.totalCount++;
    
    // Update conversation metadata
    if (!email.isRead) {
      conversation.unreadCount++;
    }
    
    if (email.hasAttachments) {
      conversation.hasAttachments = true;
    }
    
    if (email.isFlagged) {
      conversation.isFlagged = true;
    }
    
    if (email.priority > conversation.priority) {
      conversation.priority = email.priority;
    }
    
    // Update latest/earliest emails
    if (email.date > conversation.latestEmail.date) {
      conversation.latestEmail = email;
    }
    
    if (email.date < conversation.earliestEmail.date) {
      conversation.earliestEmail = email;
    }
    
    // Update participants list
    const emailParticipants = extractParticipants(email);
    for (const participant of emailParticipants) {
      if (!conversation.participants.includes(participant)) {
        conversation.participants.push(participant);
      }
    }
    
    // Use the original subject from the earliest email
    if (email.date <= conversation.earliestEmail.date) {
      conversation.originalSubject = email.subject;
    }
  }
  
  // Sort emails within each conversation by date (oldest first for display)
  for (const conversation of Array.from(conversationMap.values())) {
    conversation.emails.sort((a: EmailMessage, b: EmailMessage) => a.date.getTime() - b.date.getTime());
  }
  
  // Return conversations sorted by latest email date (newest first)
  return Array.from(conversationMap.values())
    .sort((a: ConversationThread, b: ConversationThread) => b.latestEmail.date.getTime() - a.latestEmail.date.getTime());
}

/**
 * Toggle conversation expansion state
 */
export function toggleConversationExpansion(
  conversations: ConversationThread[],
  conversationId: string
): ConversationThread[] {
  return conversations.map(conversation => 
    conversation.id === conversationId
      ? { ...conversation, isExpanded: !conversation.isExpanded }
      : conversation
  );
}

/**
 * Get conversation summary text for display
 */
export function getConversationSummary(conversation: ConversationThread): string {
  const { totalCount, unreadCount } = conversation;
  
  if (totalCount === 1) {
    return conversation.latestEmail.snippet;
  }
  
  const parts: string[] = [];
  
  if (unreadCount > 0) {
    parts.push(`${unreadCount} unread`);
  }
  
  if (totalCount > 1) {
    parts.push(`${totalCount} messages`);
  }
  
  if (parts.length > 0) {
    return `${parts.join(', ')} - ${conversation.latestEmail.snippet}`;
  }
  
  return conversation.latestEmail.snippet;
}

/**
 * Get formatted participant list for display
 */
export function getConversationParticipants(
  conversation: ConversationThread, 
  currentUserEmail?: string,
  maxDisplay: number = 3
): string {
  let participants = conversation.participants.filter(email => 
    !currentUserEmail || email.toLowerCase() !== currentUserEmail.toLowerCase()
  );
  
  if (participants.length === 0) {
    participants = conversation.participants;
  }
  
  // For single email conversations, show the sender
  if (conversation.totalCount === 1) {
    return conversation.latestEmail.from;
  }
  
  // For multi-email conversations, show unique participants
  if (participants.length <= maxDisplay) {
    return participants.join(', ');
  }
  
  const displayed = participants.slice(0, maxDisplay - 1);
  const remaining = participants.length - (maxDisplay - 1);
  return `${displayed.join(', ')} +${remaining} more`;
}

/**
 * Check if conversation contains unread emails
 */
export function hasUnreadEmails(conversation: ConversationThread): boolean {
  return conversation.unreadCount > 0;
}

/**
 * Get the most recent unread email in a conversation
 */
export function getLatestUnreadEmail(conversation: ConversationThread): EmailMessage | null {
  const unreadEmails = conversation.emails
    .filter(email => !email.isRead)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
    
  return unreadEmails[0] || null;
}