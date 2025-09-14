import EventEmitter from "events";

/**
 * Global event emitter for real-time email notifications
 * Extracted to break circular dependency between index.ts and other modules
 */
export const emailEventEmitter = new EventEmitter();

// Critical: Add error listener to prevent uncaught 'error' events
emailEventEmitter.on('error', (error) => {
  console.error('EmailEventEmitter error occurred:', error);
  // Don't crash the application for EventEmitter errors
  // Log the error and continue running
});

// Set max listeners to prevent memory leak warnings for high-traffic scenarios
emailEventEmitter.setMaxListeners(50);

// Event type definitions for better type safety
export interface EmailReceivedEvent {
  accountId: string;
  folder: string;
  messageId: string;
  subject: string;
  sender: string;
  timestamp: string;
}

export interface EmailSyncedEvent {
  accountId: string;
  folder: string;
  eventCount: number;
  events: string[];
  timestamp: string;
}

// Event name constants
export const EMAIL_EVENTS = {
  EMAIL_RECEIVED: 'emailReceived',
  EMAIL_SYNCED: 'emailSynced'
} as const;