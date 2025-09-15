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

// API endpoints to cache
const CACHEABLE_API_PATTERNS = [
  /^\/api\/auth\/user$/,
  /^\/api\/accounts$/,
  /^\/api\/emails/,
  /^\/api\/attachments/,
  /^\/api\/signatures/,
  /^\/api\/preferences/
];

// Offline queue for background sync
let offlineQueue = [];

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
      
      console.log('[SW] Service worker activated');
    })()
  );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
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
  const { type, data } = event.data;
  
  switch (type) {
    case 'QUEUE_OFFLINE_ACTION':
      queueOfflineAction(data);
      break;
    case 'CLEAR_CACHE':
      clearCache(data.cacheType);
      break;
    case 'GET_CACHE_STATUS':
      getCacheStatus().then(status => {
        event.ports[0].postMessage({ type: 'CACHE_STATUS', data: status });
      });
      break;
    case 'PREFETCH_EMAILS':
      prefetchEmails(data.emails);
      break;
  }
});

// Push notification handler
self.addEventListener('push', event => {
  if (!event.data) return;
  
  const data = event.data.json();
  const options = {
    body: data.body || 'New email received',
    icon: '/icons/icon-192.svg',
    badge: '/icons/icon-192.svg',
    tag: 'email-notification',
    requireInteraction: false,
    actions: [
      {
        action: 'view',
        title: 'View Email'
      },
      {
        action: 'dismiss',
        title: 'Dismiss'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'PrismMail', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  if (event.action === 'view') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// Caching strategy implementations

async function cacheFirst(request, cacheName) {
  try {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      // Serve from cache
      return cachedResponse;
    }
    
    // Fallback to network
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Cache successful responses
      await cache.put(request, networkResponse.clone());
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
      // Cache successful responses
      const cache = await caches.open(cacheName);
      await cache.put(request, networkResponse.clone());
      
      // Manage cache size
      await manageCacheSize(cacheName);
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', error.message);
    
    // Fallback to cache
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
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
         CACHEABLE_API_PATTERNS.some(pattern => pattern.test(url.pathname));
}

function isEmailContentRequest(url) {
  return url.pathname.startsWith('/api/emails/') && 
         (url.pathname.includes('/content') || url.pathname.includes('/body'));
}

// Offline queue management

function queueOfflineAction(action) {
  offlineQueue.push({
    ...action,
    timestamp: Date.now(),
    retryCount: 0
  });
  
  // Trigger background sync
  self.registration.sync.register('offline-actions').catch(err => {
    console.error('[SW] Failed to register sync:', err);
  });
}

async function processOfflineQueue() {
  console.log('[SW] Processing offline queue, items:', offlineQueue.length);
  
  const processedActions = [];
  
  for (const action of offlineQueue) {
    try {
      const success = await executeOfflineAction(action);
      if (success) {
        processedActions.push(action);
      } else {
        // Increment retry count
        action.retryCount = (action.retryCount || 0) + 1;
        
        // Remove after 3 failed attempts
        if (action.retryCount >= 3) {
          console.warn('[SW] Removing failed action after 3 retries:', action);
          processedActions.push(action);
        }
      }
    } catch (error) {
      console.error('[SW] Error processing offline action:', error);
      action.retryCount = (action.retryCount || 0) + 1;
      
      if (action.retryCount >= 3) {
        processedActions.push(action);
      }
    }
  }
  
  // Remove processed actions
  offlineQueue = offlineQueue.filter(action => !processedActions.includes(action));
  
  console.log('[SW] Offline queue processed, remaining items:', offlineQueue.length);
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

async function manageCacheSize(cacheName) {
  const cache = await caches.open(cacheName);
  const requests = await cache.keys();
  
  let totalSize = 0;
  const sizePromises = requests.map(async request => {
    const response = await cache.match(request);
    if (response) {
      const blob = await response.blob();
      return { request, size: blob.size };
    }
    return { request, size: 0 };
  });
  
  const sizes = await Promise.all(sizePromises);
  sizes.forEach(({ size }) => totalSize += size);
  
  // Get max size for this cache
  const maxSize = getCacheMaxSize(cacheName);
  
  if (totalSize > maxSize) {
    console.log(`[SW] Cache ${cacheName} exceeds limit (${totalSize}/${maxSize}), cleaning up`);
    
    // Sort by oldest first (LRU eviction)
    sizes.sort((a, b) => {
      // In a real implementation, you'd track access times
      // For now, we'll just remove oldest entries
      return 0;
    });
    
    // Remove oldest entries until under limit
    let removedSize = 0;
    for (const { request, size } of sizes) {
      if (totalSize - removedSize <= maxSize) break;
      
      await cache.delete(request);
      removedSize += size;
    }
    
    console.log(`[SW] Removed ${removedSize} bytes from cache ${cacheName}`);
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

console.log('[SW] Service worker script loaded');