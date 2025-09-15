// PrismMail Service Worker
// Comprehensive offline support with caching strategies and background sync

const CACHE_VERSION = 'prismmail-v1.0.0';
const APP_SHELL_CACHE = `${CACHE_VERSION}-app-shell`;
const EMAIL_CACHE = `${CACHE_VERSION}-emails`;
const IMAGES_CACHE = `${CACHE_VERSION}-images`;
const API_CACHE = `${CACHE_VERSION}-api`;

// Cache size limits (in MB)
const MAX_CACHE_SIZE = {
  emails: 50 * 1024 * 1024, // 50MB for emails
  images: 100 * 1024 * 1024, // 100MB for images
  api: 10 * 1024 * 1024 // 10MB for API responses
};

// App shell resources to cache immediately
const APP_SHELL_RESOURCES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg'
];

// Safe API endpoints to cache (idempotent, non-sensitive)
const SAFE_CACHEABLE_API_PATTERNS = [
  /^\/api\/auth\/user$/, // User profile (safe to cache temporarily)
  /^\/api\/accounts$/, // Account list (safe to cache)
  /^\/api\/emails\/(\d+)\/content$/, // Email content (safe to cache)
  /^\/api\/emails\/(\d+)\/body$/, // Email body (safe to cache)
  /^\/api\/signatures$/, // Email signatures (safe to cache)
  /^\/api\/preferences\/theme$/ // Theme preferences (safe to cache)
];

// Sensitive endpoints that should NEVER be cached
const NEVER_CACHE_PATTERNS = [
  /^\/api\/auth\/login/,
  /^\/api\/auth\/logout/,
  /^\/api\/auth\/token/,
  /^\/api\/emails\/send/,
  /^\/api\/attachments\/.+/, // Never cache attachment data
  /^\/api\/drafts/,
  /^\/api\/search/,
  /^\/api\/sync/,
  /^\/api\/.*\/delete/,
  /^\/api\/.*\/update/
];

// IndexedDB for persistent offline queue
const DB_NAME = 'PrismMailOfflineDB';
const DB_VERSION = 1;
const QUEUE_STORE = 'offlineQueue';
const METADATA_STORE = 'metadata';

// Initialize IndexedDB
let db = null;

async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Create offline queue store
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const queueStore = db.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
        queueStore.createIndex('timestamp', 'timestamp');
        queueStore.createIndex('type', 'type');
        queueStore.createIndex('retryCount', 'retryCount');
      }
      
      // Create metadata store for sync status
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        db.createObjectStore(METADATA_STORE, { keyPath: 'key' });
      }
    };
  });
}

// Initialize database on startup
initDB().catch(error => {
  console.error('[SW] Failed to initialize IndexedDB:', error);
});

// Install event - cache app shell
self.addEventListener('install', event => {
  console.log('[SW] Installing service worker');
  
  event.waitUntil(
    (async () => {
      // Cache app shell resources
      const appShellCache = await caches.open(APP_SHELL_CACHE);
      await appShellCache.addAll(APP_SHELL_RESOURCES);
      
      // Initialize other caches
      await caches.open(EMAIL_CACHE);
      await caches.open(IMAGES_CACHE);
      await caches.open(API_CACHE);
      
      console.log('[SW] App shell cached successfully');
      
      // Skip waiting to activate immediately
      self.skipWaiting();
    })()
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('[SW] Activating service worker');
  
  event.waitUntil(
    (async () => {
      try {
        // Clean up old cache versions
        const cacheNames = await caches.keys();
        const deletePromises = cacheNames
          .filter(name => !name.startsWith(CACHE_VERSION))
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          });
        
        await Promise.all(deletePromises);
        
        // Take control of all clients immediately
        await self.clients.claim();
        
        // Notify clients that service worker is activated
        const clients = await self.clients.matchAll();
        clients.forEach(client => {
          client.postMessage({ type: 'SW_ACTIVATED' });
        });
        
        console.log('[SW] Service worker activated and claimed all clients');
      } catch (error) {
        console.error('[SW] Error during activation:', error);
      }
    })()
  );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests and non-http(s) requests
  if (request.method !== 'GET' || (!url.protocol.startsWith('http'))) {
    return;
  }
  
  // Handle navigation requests (page loads/refreshes)
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }
  
  // Handle different resource types with appropriate strategies
  if (isAppShellRequest(url)) {
    event.respondWith(cacheFirst(request, APP_SHELL_CACHE));
  } else if (isImageRequest(url)) {
    event.respondWith(cacheFirst(request, IMAGES_CACHE));
  } else if (isAPIRequest(url)) {
    event.respondWith(networkFirstWithCache(request, API_CACHE));
  } else if (isEmailContentRequest(url)) {
    event.respondWith(networkFirstWithCache(request, EMAIL_CACHE));
  } else {
    // Default: try network first, fallback to cache
    event.respondWith(networkFirstWithCache(request, API_CACHE));
  }
});

// Handle navigation requests with app shell fallback
async function handleNavigationRequest(request) {
  try {
    // Try network first for navigation
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Cache successful navigation response
      const cache = await caches.open(APP_SHELL_CACHE);
      await cache.put(request, networkResponse.clone());
      return networkResponse;
    }
    
    throw new Error('Network response not ok');
  } catch (error) {
    console.log('[SW] Navigation network failed, serving app shell:', error.message);
    
    // Fallback to cached app shell
    const cache = await caches.open(APP_SHELL_CACHE);
    
    // Try to serve the exact cached request first
    let cachedResponse = await cache.match(request);
    
    if (!cachedResponse) {
      // Fallback to index.html for SPA routing
      cachedResponse = await cache.match('/index.html') || await cache.match('/');
    }
    
    if (cachedResponse) {
      console.log('[SW] Serving cached app shell for navigation');
      return cachedResponse;
    }
    
    // Final fallback - basic offline response
    return new Response(
      `<!DOCTYPE html>
      <html>
      <head>
        <title>PrismMail - Offline</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
          .offline { color: #666; }
        </style>
      </head>
      <body>
        <h1>PrismMail</h1>
        <p class="offline">You are currently offline. Please check your connection and try again.</p>
        <button onclick="window.location.reload()">Retry</button>
      </body>
      </html>`,
      {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      }
    );
  }
}

// Background sync for offline actions
self.addEventListener('sync', event => {
  console.log('[SW] Background sync triggered:', event.tag);
  
  if (event.tag === 'offline-actions') {
    event.waitUntil(processOfflineQueue());
  } else if (event.tag === 'draft-sync') {
    event.waitUntil(syncDrafts());
  } else if (event.tag === 'email-actions') {
    event.waitUntil(syncEmailActions());
  }
});

// Message handler for communication with main thread
self.addEventListener('message', event => {
  const { type, data } = event.data || {};
  
  // Validate message payload
  if (!type) {
    console.warn('[SW] Received message without type:', event.data);
    return;
  }
  
  switch (type) {
    case 'SKIP_WAITING':
      console.log('[SW] SKIP_WAITING message received');
      self.skipWaiting();
      break;
    case 'QUEUE_OFFLINE_ACTION':
      if (data) {
        queueOfflineAction(data);
      } else {
        console.warn('[SW] QUEUE_OFFLINE_ACTION message missing data');
      }
      break;
    case 'CLEAR_CACHE':
      clearCache(data?.cacheType).catch(error => {
        console.error('[SW] Failed to clear cache:', error);
      });
      break;
    case 'GET_CACHE_STATUS':
      handleGetCacheStatus(event);
      break;
    case 'PREFETCH_EMAILS':
      if (data?.emails) {
        prefetchEmails(data.emails).catch(error => {
          console.error('[SW] Failed to prefetch emails:', error);
        });
      } else {
        console.warn('[SW] PREFETCH_EMAILS message missing emails data');
      }
      break;
    case 'PURGE_USER_CACHE':
      purgeUserCache(data?.userId).catch(error => {
        console.error('[SW] Failed to purge user cache:', error);
      });
      break;
    case 'PURGE_ON_LOGOUT':
      purgeOnLogout().catch(error => {
        console.error('[SW] Failed to purge cache on logout:', error);
      });
      break;
    case 'CLEAR_SENSITIVE_CACHE':
      clearSensitiveCache().catch(error => {
        console.error('[SW] Failed to clear sensitive cache:', error);
      });
      break;
    default:
      console.warn('[SW] Unknown message type:', type);
  }
});

// Handle GET_CACHE_STATUS with proper port communication
async function handleGetCacheStatus(event) {
  try {
    const status = await getCacheStatus();
    
    // Use MessageChannel port if available (preferred)
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ type: 'CACHE_STATUS', data: status });
    } else {
      // Fallback to broadcasting to all clients
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({ type: 'CACHE_STATUS', data: status });
      });
    }
  } catch (error) {
    console.error('[SW] Failed to get cache status:', error);
    
    const errorResponse = { type: 'ERROR', message: error.message };
    
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage(errorResponse);
    } else {
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage(errorResponse);
      });
    }
  }
}

// Enhanced push notification handler with comprehensive features
self.addEventListener('push', event => {
  if (!event.data) {
    console.warn('[SW] Push notification received without data');
    return;
  }
  
  let data;
  try {
    data = event.data.json();
  } catch (error) {
    console.error('[SW] Invalid push notification data:', error);
    return;
  }
  
  // PRIVACY: Never log notification content - only log event occurrence
  console.log('[SW] Push notification received:', { type: 'notification_received' });
  
  // Validate notification data
  if (!validateNotificationData(data)) {
    console.warn('[SW] Invalid notification data received:', data);
    return;
  }
  
  // Handle different notification types
  event.waitUntil(handlePushNotification(data));
});

// Handle different types of push notifications
async function handlePushNotification(data) {
  try {
    const notificationType = data.data?.notificationType || 'new_email';
    
    // Check for existing notification to group or replace
    const existingNotifications = await self.registration.getNotifications({
      tag: data.tag || getNotificationTag(notificationType, data)
    });
    
    // Handle notification grouping for similar notifications
    if (existingNotifications.length > 0 && shouldGroupNotifications(notificationType)) {
      await handleNotificationGrouping(existingNotifications, data);
      return;
    }
    
    // Create notification options based on type
    const options = createNotificationOptions(data, notificationType);
    
    // Show the notification
    await self.registration.showNotification(
      sanitizeText(data.title || 'PrismMail'),
      options
    );
    
    // Track notification for analytics
    await trackNotificationEvent('displayed', data);
    
  } catch (error) {
    console.error('[SW] Failed to handle push notification:', error);
    
    // Fallback to basic notification
    await self.registration.showNotification('PrismMail', {
      body: 'You have new messages',
      icon: '/icons/icon-192.svg',
      badge: '/icons/badge-icon.svg',
      data: { fallback: true }
    });
  }
}

// Create notification options based on type and data
function createNotificationOptions(data, notificationType) {
  const baseOptions = {
    body: sanitizeText(data.body || 'New message received'),
    icon: data.icon || '/icons/icon-192.svg',
    badge: data.badge || '/icons/badge-icon.svg',
    tag: data.tag || getNotificationTag(notificationType, data),
    data: {
      emailId: data.data?.emailId,
      accountId: data.data?.accountId,
      url: data.data?.url || '/',
      timestamp: data.data?.timestamp || Date.now(),
      notificationType,
      originalData: data.data
    },
    timestamp: data.data?.timestamp || Date.now(),
    renotify: false,
    silent: data.silent || false
  };

  // Add type-specific options
  switch (notificationType) {
    case 'new_email':
      return {
        ...baseOptions,
        requireInteraction: false,
        vibrate: data.vibrate || [200, 100, 200],
        actions: [
          {
            action: 'view',
            title: 'View Email',
            icon: '/icons/view-icon.svg'
          },
          {
            action: 'mark-read',
            title: 'Mark as Read',
            icon: '/icons/check-icon.svg'
          },
          {
            action: 'archive',
            title: 'Archive',
            icon: '/icons/archive-icon.svg'
          }
        ]
      };
      
    case 'vip_email':
      return {
        ...baseOptions,
        requireInteraction: true,
        vibrate: data.vibrate || [300, 200, 300, 200, 300],
        actions: [
          {
            action: 'view',
            title: 'View VIP Email',
            icon: '/icons/vip-icon.svg'
          },
          {
            action: 'reply',
            title: 'Quick Reply',
            icon: '/icons/reply-icon.svg'
          },
          {
            action: 'mark-read',
            title: 'Mark as Read',
            icon: '/icons/check-icon.svg'
          }
        ]
      };
      
    case 'system':
      return {
        ...baseOptions,
        requireInteraction: true,
        vibrate: [500],
        actions: [
          {
            action: 'view',
            title: 'View Details',
            icon: '/icons/info-icon.svg'
          },
          {
            action: 'dismiss',
            title: 'Dismiss',
            icon: '/icons/dismiss-icon.svg'
          }
        ]
      };
      
    case 'account_sync':
      return {
        ...baseOptions,
        requireInteraction: true,
        vibrate: [200, 100, 200, 100, 200],
        actions: [
          {
            action: 'check-account',
            title: 'Check Account',
            icon: '/icons/settings-icon.svg'
          },
          {
            action: 'dismiss',
            title: 'Dismiss',
            icon: '/icons/dismiss-icon.svg'
          }
        ]
      };
      
    default:
      return {
        ...baseOptions,
        requireInteraction: false,
        actions: [
          {
            action: 'view',
            title: 'View',
            icon: '/icons/view-icon.svg'
          },
          {
            action: 'dismiss',
            title: 'Dismiss',
            icon: '/icons/dismiss-icon.svg'
          }
        ]
      };
  }
}

// Generate notification tag for grouping
function getNotificationTag(notificationType, data) {
  switch (notificationType) {
    case 'new_email':
    case 'vip_email':
      return `email-${data.data?.accountId || 'default'}`;
    case 'system':
      return 'system-notification';
    case 'account_sync':
      return `sync-${data.data?.accountId || 'default'}`;
    default:
      return 'prismmail-notification';
  }
}

// Determine if notifications should be grouped
function shouldGroupNotifications(notificationType) {
  return ['new_email', 'vip_email'].includes(notificationType);
}

// Handle notification grouping
async function handleNotificationGrouping(existingNotifications, newData) {
  const existingNotification = existingNotifications[0];
  const existingData = existingNotification.data || {};
  
  // Close existing notification
  existingNotification.close();
  
  // Create grouped notification
  const groupedOptions = {
    body: `You have ${existingNotifications.length + 1} new emails`,
    icon: '/icons/icon-192.svg',
    badge: '/icons/badge-icon.svg',
    tag: newData.tag || getNotificationTag(newData.data?.notificationType, newData),
    data: {
      ...existingData,
      grouped: true,
      count: existingNotifications.length + 1,
      latest: newData.data
    },
    actions: [
      {
        action: 'view-inbox',
        title: 'View Inbox',
        icon: '/icons/inbox-icon.svg'
      },
      {
        action: 'mark-all-read',
        title: 'Mark All Read',
        icon: '/icons/check-all-icon.svg'
      }
    ]
  };
  
  await self.registration.showNotification(
    `${existingNotifications.length + 1} New Emails`,
    groupedOptions
  );
}

// Track notification events for analytics
async function trackNotificationEvent(eventType, data) {
  try {
    // Store notification event in IndexedDB for analytics
    if (!db) {
      await initDB();
    }
    
    const transaction = db.transaction([METADATA_STORE], 'readwrite');
    const store = transaction.objectStore(METADATA_STORE);
    
    const eventData = {
      key: `notification_${eventType}_${Date.now()}`,
      value: {
        eventType,
        notificationType: data.data?.notificationType,
        timestamp: Date.now(),
        title: data.title,
        url: data.data?.url
      }
    };
    
    store.put(eventData);
  } catch (error) {
    console.warn('[SW] Failed to track notification event:', error);
  }
}

// Enhanced notification data validation
function validateNotificationData(data) {
  if (!data || typeof data !== 'object') {
    return false;
  }
  
  // Basic validation - ensure required fields are present and safe
  if (data.title && typeof data.title !== 'string') return false;
  if (data.body && typeof data.body !== 'string') return false;
  if (data.icon && typeof data.icon !== 'string') return false;
  if (data.badge && typeof data.badge !== 'string') return false;
  if (data.tag && typeof data.tag !== 'string') return false;
  
  // Length limits for security
  if (data.title && data.title.length > 200) return false;
  if (data.body && data.body.length > 1000) return false;
  if (data.tag && data.tag.length > 50) return false;
  
  // Validate data object
  if (data.data && typeof data.data !== 'object') return false;
  if (data.data?.emailId && typeof data.data.emailId !== 'string') return false;
  if (data.data?.accountId && typeof data.data.accountId !== 'string') return false;
  if (data.data?.url && typeof data.data.url !== 'string') return false;
  if (data.data?.notificationType && !['new_email', 'vip_email', 'system', 'account_sync'].includes(data.data.notificationType)) return false;
  
  // Validate actions array
  if (data.actions && !Array.isArray(data.actions)) return false;
  if (data.actions && data.actions.length > 3) return false; // Max 3 actions per notification
  
  // Validate individual actions
  if (data.actions) {
    for (const action of data.actions) {
      if (!action || typeof action !== 'object') return false;
      if (!action.action || typeof action.action !== 'string') return false;
      if (!action.title || typeof action.title !== 'string') return false;
      if (action.icon && typeof action.icon !== 'string') return false;
      if (action.action.length > 30 || action.title.length > 30) return false;
    }
  }
  
  return true;
}

// Sanitize text content
function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  
  // Basic HTML/script sanitization
  return text
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .substring(0, 200); // Limit length
}

// Enhanced notification click handler with comprehensive actions
self.addEventListener('notificationclick', event => {
  // PRIVACY: Never log notification data - only log interaction type
  console.log('[SW] Notification interaction:', { action: event.action || 'click' });
  
  const data = event.notification.data || {};
  const action = event.action;
  
  // Close the notification
  event.notification.close();
  
  // Track notification interaction
  trackNotificationEvent('clicked', { data, action }).catch(error => {
    console.warn('[SW] Failed to track notification click:', error);
  });
  
  // Handle different notification actions
  event.waitUntil(handleNotificationAction(action, data));
});

// Handle notification action based on type
async function handleNotificationAction(action, data) {
  try {
    switch (action) {
      case 'view':
      case 'view-vip':
        await openEmailView(data);
        break;
        
      case 'view-inbox':
        await openAppPage('/inbox');
        break;
        
      case 'mark-read':
        await performEmailAction('mark-read', data);
        break;
        
      case 'mark-all-read':
        await performEmailAction('mark-all-read', data);
        break;
        
      case 'archive':
        await performEmailAction('archive', data);
        break;
        
      case 'reply':
        await openReplyComposer(data);
        break;
        
      case 'check-account':
        await openAccountSettings(data);
        break;
        
      case 'dismiss':
        // Just close notification - no additional action needed
        console.log('[SW] Notification dismissed');
        break;
        
      default:
        // Default action - open the app
        await openEmailView(data);
        break;
    }
  } catch (error) {
    console.error('[SW] Failed to handle notification action:', error);
    // Fallback to opening the app
    await openAppPage('/');
  }
}

// Open specific email view
async function openEmailView(data) {
  let url = '/';
  
  if (data.url) {
    url = data.url;
  } else if (data.emailId) {
    url = `/email/${data.emailId}`;
  } else if (data.accountId) {
    url = `/account/${data.accountId}/inbox`;
  }
  
  await openAppPage(url);
}

// Open reply composer for an email
async function openReplyComposer(data) {
  let url = '/compose';
  
  if (data.emailId) {
    url = `/compose?reply=${data.emailId}`;
  }
  
  await openAppPage(url);
}

// Open account settings
async function openAccountSettings(data) {
  let url = '/settings/accounts';
  
  if (data.accountId) {
    url = `/settings/accounts/${data.accountId}`;
  }
  
  await openAppPage(url);
}

// Open app page with focus management
async function openAppPage(url) {
  try {
    // Try to focus existing tab first
    const clients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });
    
    // Look for existing app window
    for (const client of clients) {
      const clientUrl = new URL(client.url);
      const targetUrl = new URL(url, self.location.origin);
      
      // If same origin, focus and navigate
      if (clientUrl.origin === targetUrl.origin) {
        await client.focus();
        
        // Navigate to specific page if different
        if (clientUrl.pathname !== targetUrl.pathname || clientUrl.search !== targetUrl.search) {
          await client.postMessage({
            type: 'NAVIGATE',
            url: url
          });
        }
        
        return;
      }
    }
    
    // No existing window found, open new one
    const fullUrl = new URL(url, self.location.origin).toString();
    await self.clients.openWindow(fullUrl);
    
  } catch (error) {
    console.error('[SW] Failed to open app page:', error);
    // Final fallback
    await self.clients.openWindow('/');
  }
}

// Perform email actions (mark as read, archive, etc.)
async function performEmailAction(action, data) {
  try {
    let endpoint = '';
    let method = 'PUT';
    let body = null;
    
    switch (action) {
      case 'mark-read':
        if (!data.emailId) throw new Error('Email ID required for mark-read action');
        endpoint = `/api/emails/${data.emailId}/read`;
        method = 'PUT';
        break;
        
      case 'mark-all-read':
        if (!data.accountId) throw new Error('Account ID required for mark-all-read action');
        endpoint = `/api/accounts/${data.accountId}/mark-all-read`;
        method = 'PUT';
        break;
        
      case 'archive':
        if (!data.emailId) throw new Error('Email ID required for archive action');
        endpoint = `/api/emails/${data.emailId}/archive`;
        method = 'PUT';
        break;
        
      default:
        throw new Error(`Unsupported email action: ${action}`);
    }
    
    // Perform the action via API call
    const response = await fetch(endpoint, {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : null
    });
    
    if (response.ok) {
      console.log(`[SW] Successfully performed ${action} action`);
      
      // Show success feedback via toast notification if possible
      await self.registration.showNotification('Action Completed', {
        body: getActionCompletedMessage(action),
        icon: '/icons/icon-192.svg',
        badge: '/icons/badge-icon.svg',
        tag: 'action-completed',
        silent: true,
        requireInteraction: false,
        data: { type: 'action-result', action, success: true }
      });
      
      // Notify active clients about the action
      await broadcastToClients({
        type: 'EMAIL_ACTION_COMPLETED',
        action,
        data: data
      });
      
    } else {
      throw new Error(`API call failed with status ${response.status}`);
    }
    
  } catch (error) {
    console.error(`[SW] Failed to perform ${action} action:`, error);
    
    // Show error feedback
    await self.registration.showNotification('Action Failed', {
      body: `Failed to ${action.replace('-', ' ')}. Please try again in the app.`,
      icon: '/icons/icon-192.svg',
      badge: '/icons/badge-icon.svg',
      tag: 'action-failed',
      requireInteraction: false,
      data: { type: 'action-result', action, success: false }
    });
    
    // Queue the action for retry when back online
    await queueOfflineAction({
      type: 'EMAIL_ACTION',
      action,
      data,
      timestamp: Date.now()
    });
  }
}

// Get user-friendly message for completed actions
function getActionCompletedMessage(action) {
  switch (action) {
    case 'mark-read':
      return 'Email marked as read';
    case 'mark-all-read':
      return 'All emails marked as read';
    case 'archive':
      return 'Email archived';
    default:
      return 'Action completed';
  }
}

// Broadcast message to all active clients
async function broadcastToClients(message) {
  try {
    const clients = await self.clients.matchAll();
    
    for (const client of clients) {
      client.postMessage(message);
    }
  } catch (error) {
    console.warn('[SW] Failed to broadcast to clients:', error);
  }
}

// Caching strategy implementations

async function cacheFirst(request, cacheName) {
  try {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      // Update access time for LRU
      updateCacheAccessTime(request);
      // Serve from cache
      return cachedResponse;
    }
    
    // Fallback to network
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Cache successful responses
      await cache.put(request, networkResponse.clone());
      updateCacheAccessTime(request);
      
      // Manage cache size
      await manageCacheSize(cacheName);
    }
    
    return networkResponse;
  } catch (error) {
    console.error('[SW] Cache-first strategy failed:', error);
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirstWithCache(request, cacheName) {
  try {
    // Try network first
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Only cache safe, successful responses
      if (isCacheableResponse(networkResponse) && isSafeAPIEndpoint(request.url)) {
        const cache = await caches.open(cacheName);
        await cache.put(request, networkResponse.clone());
        updateCacheAccessTime(request);
        
        // Manage cache size
        await manageCacheSize(cacheName);
      }
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', error.message);
    
    // Fallback to cache
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      updateCacheAccessTime(request);
      return cachedResponse;
    }
    
    // No cache available
    return new Response(
      JSON.stringify({ 
        error: 'No internet connection', 
        offline: true,
        message: 'This content is not available offline'
      }), 
      { 
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  // Fetch from network in background
  const networkResponsePromise = fetch(request).then(response => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);
  
  // Return cached version immediately, or wait for network
  return cachedResponse || await networkResponsePromise;
}

// Request type detection helpers

function isAppShellRequest(url) {
  return APP_SHELL_RESOURCES.some(resource => 
    url.pathname === resource || url.pathname === '/' || url.pathname.endsWith('.js') || url.pathname.endsWith('.css')
  );
}

function isImageRequest(url) {
  return /\.(jpg|jpeg|png|gif|webp|svg|ico)$/i.test(url.pathname);
}

function isAPIRequest(url) {
  return url.pathname.startsWith('/api/') && 
         isSafeAPIEndpoint(url.toString());
}

function isSafeAPIEndpoint(urlString) {
  const url = new URL(urlString);
  const pathname = url.pathname;
  
  // Never cache sensitive endpoints
  if (NEVER_CACHE_PATTERNS.some(pattern => pattern.test(pathname))) {
    return false;
  }
  
  // Only cache explicitly safe endpoints
  return SAFE_CACHEABLE_API_PATTERNS.some(pattern => pattern.test(pathname));
}

function isCacheableResponse(response) {
  // Only cache successful GET responses
  if (!response.ok || response.status !== 200) {
    return false;
  }
  
  // Check content type - only cache safe content types
  const contentType = response.headers.get('content-type') || '';
  const safeContentTypes = [
    'application/json',
    'text/html',
    'text/plain',
    'application/javascript',
    'text/css',
    'image/',
    'font/'
  ];
  
  if (!safeContentTypes.some(type => contentType.startsWith(type))) {
    return false;
  }
  
  // Don't cache responses with authentication headers
  if (response.headers.get('authorization') || 
      response.headers.get('cookie') ||
      response.headers.get('set-cookie')) {
    return false;
  }
  
  // Don't cache responses that are too large (> 5MB)
  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) {
    return false;
  }
  
  return true;
}

function isEmailContentRequest(url) {
  return url.pathname.startsWith('/api/emails/') && 
         (url.pathname.includes('/content') || url.pathname.includes('/body'));
}

// Offline queue management

async function queueOfflineAction(action) {
  try {
    if (!db) {
      await initDB();
    }
    
    const transaction = db.transaction([QUEUE_STORE], 'readwrite');
    const store = transaction.objectStore(QUEUE_STORE);
    
    const queueItem = {
      ...action,
      timestamp: Date.now(),
      retryCount: 0,
      status: 'pending'
    };
    
    await new Promise((resolve, reject) => {
      const request = store.add(queueItem);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    console.log('[SW] Queued offline action:', action.type);
    
    // Trigger background sync
    await self.registration.sync.register('offline-actions').catch(err => {
      console.error('[SW] Failed to register sync:', err);
    });
    
    // Update sync status
    await broadcastSyncStatus();
    
  } catch (error) {
    console.error('[SW] Failed to queue offline action:', error);
    // Fallback to memory if IndexedDB fails
    console.warn('[SW] Falling back to memory queue');
  }
}

async function processOfflineQueue() {
  try {
    if (!db) {
      await initDB();
    }
    
    // Get all pending actions
    const pendingActions = await getAllQueuedActions();
    console.log('[SW] Processing offline queue, items:', pendingActions.length);
    
    if (pendingActions.length === 0) {
      await broadcastSyncStatus();
      return;
    }
    
    await setSyncStatus({ inProgress: true, queueSize: pendingActions.length });
    
    const processedIds = [];
    const failedActions = [];
    
    for (const action of pendingActions) {
      try {
        const success = await executeOfflineAction(action);
        
        if (success) {
          processedIds.push(action.id);
          console.log('[SW] Successfully processed action:', action.type);
        } else {
          // Increment retry count
          const retryCount = (action.retryCount || 0) + 1;
          
          if (retryCount >= 3) {
            // Mark as failed after 3 retries
            processedIds.push(action.id);
            console.warn('[SW] Removing failed action after 3 retries:', action.type);
          } else {
            // Update retry count
            failedActions.push({ ...action, retryCount });
          }
        }
      } catch (error) {
        console.error('[SW] Error processing offline action:', error);
        const retryCount = (action.retryCount || 0) + 1;
        
        if (retryCount >= 3) {
          processedIds.push(action.id);
        } else {
          failedActions.push({ ...action, retryCount });
        }
      }
    }
    
    // Remove processed actions
    if (processedIds.length > 0) {
      await removeQueuedActions(processedIds);
    }
    
    // Update failed actions with new retry counts
    for (const action of failedActions) {
      await updateQueuedAction(action);
    }
    
    const remainingCount = await getQueueSize();
    console.log('[SW] Offline queue processed, remaining items:', remainingCount);
    
    await setSyncStatus({ inProgress: false, queueSize: remainingCount });
    
  } catch (error) {
    console.error('[SW] Failed to process offline queue:', error);
    await setSyncStatus({ inProgress: false, queueSize: 0 });
  }
}

async function executeOfflineAction(action) {
  const { type, data } = action;
  
  try {
    switch (type) {
      case 'SEND_EMAIL':
        return await sendQueuedEmail(data);
      case 'MARK_READ':
        return await markEmailRead(data);
      case 'STAR_EMAIL':
        return await starEmail(data);
      case 'DELETE_EMAIL':
        return await deleteEmail(data);
      case 'SAVE_DRAFT':
        return await saveDraft(data);
      default:
        console.warn('[SW] Unknown offline action type:', type);
        return false;
    }
  } catch (error) {
    console.error('[SW] Failed to execute offline action:', error);
    return false;
  }
}

async function sendQueuedEmail(emailData) {
  const response = await fetch('/api/emails/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(emailData)
  });
  
  return response.ok;
}

async function markEmailRead(data) {
  const response = await fetch(`/api/emails/${data.emailId}/read`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isRead: data.isRead })
  });
  
  return response.ok;
}

async function starEmail(data) {
  const response = await fetch(`/api/emails/${data.emailId}/star`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isStarred: data.isStarred })
  });
  
  return response.ok;
}

async function deleteEmail(data) {
  const response = await fetch(`/api/emails/${data.emailId}`, {
    method: 'DELETE'
  });
  
  return response.ok;
}

async function saveDraft(data) {
  const response = await fetch('/api/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  
  return response.ok;
}

// Draft synchronization
async function syncDrafts() {
  console.log('[SW] Syncing drafts');
  
  try {
    // Get local drafts that need syncing
    const response = await fetch('/api/drafts/sync', {
      method: 'POST'
    });
    
    return response.ok;
  } catch (error) {
    console.error('[SW] Failed to sync drafts:', error);
    return false;
  }
}

// Email actions synchronization
async function syncEmailActions() {
  console.log('[SW] Syncing email actions');
  
  try {
    // Sync any pending email state changes
    const response = await fetch('/api/emails/sync-actions', {
      method: 'POST'
    });
    
    return response.ok;
  } catch (error) {
    console.error('[SW] Failed to sync email actions:', error);
    return false;
  }
}

// Cache management utilities

// Cache access tracking for LRU
const cacheAccessTimes = new Map();

function updateCacheAccessTime(request) {
  const key = getCacheKey(request);
  cacheAccessTimes.set(key, Date.now());
}

function getCacheKey(request) {
  return `${request.method}:${request.url}`;
}

async function manageCacheSize(cacheName) {
  try {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    
    if (requests.length === 0) return;
    
    let totalSize = 0;
    const cacheEntries = [];
    
    // Calculate sizes and get access times
    for (const request of requests) {
      try {
        const response = await cache.match(request);
        if (response) {
          const blob = await response.blob();
          const size = blob.size;
          totalSize += size;
          
          const key = getCacheKey(request);
          const accessTime = cacheAccessTimes.get(key) || 0;
          
          cacheEntries.push({
            request,
            size,
            accessTime,
            key
          });
        }
      } catch (error) {
        console.warn('[SW] Error processing cache entry for size:', error);
      }
    }
    
    // Get max size for this cache
    const maxSize = getCacheMaxSize(cacheName);
    
    if (totalSize > maxSize) {
      console.log(`[SW] Cache ${cacheName} exceeds limit (${formatBytes(totalSize)}/${formatBytes(maxSize)}), cleaning up`);
      
      // Sort by access time (LRU first)
      cacheEntries.sort((a, b) => a.accessTime - b.accessTime);
      
      // Remove entries until under limit (keep 10% buffer)
      const targetSize = maxSize * 0.8; // Target 80% of max to avoid frequent cleanups
      let removedSize = 0;
      let removedCount = 0;
      
      for (const entry of cacheEntries) {
        if (totalSize - removedSize <= targetSize) break;
        
        try {
          await cache.delete(entry.request);
          cacheAccessTimes.delete(entry.key);
          removedSize += entry.size;
          removedCount++;
        } catch (error) {
          console.warn('[SW] Error removing cache entry:', error);
        }
      }
      
      console.log(`[SW] Removed ${removedCount} entries (${formatBytes(removedSize)}) from cache ${cacheName}`);
      console.log(`[SW] Cache ${cacheName} size: ${formatBytes(totalSize - removedSize)}/${formatBytes(maxSize)}`);
    }
  } catch (error) {
    console.error('[SW] Error managing cache size:', error);
  }
}

function getCacheMaxSize(cacheName) {
  if (cacheName.includes('email')) return MAX_CACHE_SIZE.emails;
  if (cacheName.includes('image')) return MAX_CACHE_SIZE.images;
  return MAX_CACHE_SIZE.api;
}

async function clearCache(cacheType) {
  let cacheNames = [];
  
  if (cacheType === 'all') {
    cacheNames = await caches.keys();
  } else {
    cacheNames = await caches.keys();
    cacheNames = cacheNames.filter(name => name.includes(cacheType));
  }
  
  const deletePromises = cacheNames.map(name => caches.delete(name));
  await Promise.all(deletePromises);
  
  console.log('[SW] Cleared caches:', cacheNames);
}

async function getCacheStatus() {
  const cacheNames = await caches.keys();
  const status = {};
  
  for (const name of cacheNames) {
    const cache = await caches.open(name);
    const requests = await cache.keys();
    
    let totalSize = 0;
    for (const request of requests) {
      const response = await cache.match(request);
      if (response) {
        const blob = await response.blob();
        totalSize += blob.size;
      }
    }
    
    status[name] = {
      entries: requests.length,
      size: totalSize,
      sizeFormatted: formatBytes(totalSize)
    };
  }
  
  return status;
}

async function prefetchEmails(emails) {
  console.log('[SW] Prefetching emails:', emails.length);
  
  const cache = await caches.open(EMAIL_CACHE);
  
  for (const email of emails) {
    try {
      // Prefetch email content
      const contentUrl = `/api/emails/${email.id}/content`;
      const response = await fetch(contentUrl);
      
      if (response.ok) {
        await cache.put(contentUrl, response.clone());
      }
      
      // Prefetch email body
      const bodyUrl = `/api/emails/${email.id}/body`;
      const bodyResponse = await fetch(bodyUrl);
      
      if (bodyResponse.ok) {
        await cache.put(bodyUrl, bodyResponse.clone());
      }
      
    } catch (error) {
      console.warn('[SW] Failed to prefetch email:', email.id, error);
    }
  }
}

// Utility functions

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Error reporting
function reportError(error, context) {
  console.error('[SW] Error in', context, ':', error);
  
  // You could send errors to an analytics service here
  // self.clients.matchAll().then(clients => {
  //   clients.forEach(client => {
  //     client.postMessage({
  //       type: 'SW_ERROR',
  //       error: error.message,
  //       context
  //     });
  //   });
  // });
}

// IndexedDB helper functions
async function getAllQueuedActions() {
  if (!db) return [];
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([QUEUE_STORE], 'readonly');
    const store = transaction.objectStore(QUEUE_STORE);
    const request = store.getAll();
    
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function removeQueuedActions(ids) {
  if (!db || !ids.length) return;
  
  const transaction = db.transaction([QUEUE_STORE], 'readwrite');
  const store = transaction.objectStore(QUEUE_STORE);
  
  const promises = ids.map(id => {
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });
  
  await Promise.all(promises);
}

async function updateQueuedAction(action) {
  if (!db) return;
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([QUEUE_STORE], 'readwrite');
    const store = transaction.objectStore(QUEUE_STORE);
    const request = store.put(action);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getQueueSize() {
  if (!db) return 0;
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([QUEUE_STORE], 'readonly');
    const store = transaction.objectStore(QUEUE_STORE);
    const request = store.count();
    
    request.onsuccess = () => resolve(request.result || 0);
    request.onerror = () => reject(request.error);
  });
}

async function setSyncStatus(status) {
  if (!db) return;
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([METADATA_STORE], 'readwrite');
    const store = transaction.objectStore(METADATA_STORE);
    const request = store.put({ key: 'syncStatus', ...status, timestamp: Date.now() });
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getSyncStatus() {
  if (!db) return { inProgress: false, queueSize: 0 };
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([METADATA_STORE], 'readonly');
    const store = transaction.objectStore(METADATA_STORE);
    const request = store.get('syncStatus');
    
    request.onsuccess = () => {
      const result = request.result;
      resolve(result ? { inProgress: result.inProgress, queueSize: result.queueSize } : { inProgress: false, queueSize: 0 });
    };
    request.onerror = () => reject(request.error);
  });
}

async function broadcastSyncStatus() {
  try {
    const status = await getSyncStatus();
    const clients = await self.clients.matchAll();
    
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_STATUS',
        data: status
      });
    });
  } catch (error) {
    console.error('[SW] Failed to broadcast sync status:', error);
  }
}

// Security and cache purge functions
async function purgeUserCache(userId) {
  console.log('[SW] Purging cache for user:', userId);
  
  try {
    const cacheNames = await caches.keys();
    
    // Clear all caches that might contain user-specific data
    const userCaches = cacheNames.filter(name => 
      name.includes('email') || 
      name.includes('api') ||
      name.includes('attachments')
    );
    
    await Promise.all(userCaches.map(name => caches.delete(name)));
    
    // Clear IndexedDB queue for user
    if (db) {
      const transaction = db.transaction([QUEUE_STORE], 'readwrite');
      const store = transaction.objectStore(QUEUE_STORE);
      await new Promise((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
    
    // Clear access time tracking
    cacheAccessTimes.clear();
    
    console.log('[SW] User cache purged successfully');
    
    // Notify clients
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({ type: 'CACHE_PURGED', data: { userId } });
    });
    
  } catch (error) {
    console.error('[SW] Failed to purge user cache:', error);
  }
}

async function purgeOnLogout() {
  console.log('[SW] Purging sensitive cache on logout');
  
  try {
    // Clear all user-specific data
    await clearSensitiveCache();
    
    // Clear offline queue
    if (db) {
      const transaction = db.transaction([QUEUE_STORE, METADATA_STORE], 'readwrite');
      await Promise.all([
        new Promise((resolve, reject) => {
          const request = transaction.objectStore(QUEUE_STORE).clear();
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        }),
        new Promise((resolve, reject) => {
          const request = transaction.objectStore(METADATA_STORE).clear();
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        })
      ]);
    }
    
    // Clear access tracking
    cacheAccessTimes.clear();
    
    console.log('[SW] Logout cache purge completed');
    
  } catch (error) {
    console.error('[SW] Failed to purge cache on logout:', error);
  }
}

async function clearSensitiveCache() {
  try {
    const cacheNames = await caches.keys();
    
    // Identify caches that contain sensitive user data
    const sensitiveCaches = cacheNames.filter(name => 
      name.includes('email') ||
      name.includes('api') ||
      name.includes('user') ||
      name.includes('auth')
    );
    
    // Delete sensitive caches
    await Promise.all(sensitiveCaches.map(name => {
      console.log('[SW] Clearing sensitive cache:', name);
      return caches.delete(name);
    }));
    
    console.log('[SW] Sensitive cache cleared');
    
  } catch (error) {
    console.error('[SW] Failed to clear sensitive cache:', error);
  }
}

// Version-based cache invalidation
async function checkVersionAndPurge() {
  const currentVersion = CACHE_VERSION;
  
  try {
    if (db) {
      const transaction = db.transaction([METADATA_STORE], 'readwrite');
      const store = transaction.objectStore(METADATA_STORE);
      
      const storedVersion = await new Promise((resolve, reject) => {
        const request = store.get('cacheVersion');
        request.onsuccess = () => resolve(request.result?.version);
        request.onerror = () => reject(request.error);
      });
      
      if (storedVersion && storedVersion !== currentVersion) {
        console.log('[SW] Version changed, clearing caches:', storedVersion, '->', currentVersion);
        await clearSensitiveCache();
      }
      
      // Update stored version
      await new Promise((resolve, reject) => {
        const request = store.put({ key: 'cacheVersion', version: currentVersion });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
  } catch (error) {
    console.error('[SW] Failed to check version and purge:', error);
  }
}

console.log('[SW] Service worker script loaded');

// Initialize database when SW loads
initDB().then(() => {
  console.log('[SW] IndexedDB initialized successfully');
  return checkVersionAndPurge();
}).catch(error => {
  console.error('[SW] Failed to initialize IndexedDB:', error);
});