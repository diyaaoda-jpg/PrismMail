// Service Worker Registration and Management
// Handles registration, updates, and communication with the service worker

export interface ServiceWorkerMessage {
  type: string;
  data?: any;
}

export interface CacheStatus {
  [cacheName: string]: {
    entries: number;
    size: number;
    sizeFormatted: string;
  };
}

export interface OfflineAction {
  type: 'SEND_EMAIL' | 'MARK_READ' | 'STAR_EMAIL' | 'DELETE_EMAIL' | 'SAVE_DRAFT';
  data: any;
  timestamp?: number;
  retryCount?: number;
}

class ServiceWorkerManager {
  private registration: ServiceWorkerRegistration | null = null;
  private isOnline = navigator.onLine;
  private onlineListeners: Array<(online: boolean) => void> = [];
  private messageListeners: Map<string, Array<(data: any) => void>> = new Map();

  constructor() {
    // Listen for online/offline events
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.notifyOnlineChange(true);
      console.log('[SW Manager] Device came online');
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.notifyOnlineChange(false);
      console.log('[SW Manager] Device went offline');
    });

    // Listen for messages from service worker
    navigator.serviceWorker?.addEventListener('message', (event) => {
      const { type, data } = event.data;
      this.notifyMessageListeners(type, data);
    });
  }

  async register(): Promise<boolean> {
    if (!('serviceWorker' in navigator)) {
      console.warn('[SW Manager] Service Workers not supported');
      return false;
    }

    try {
      console.log('[SW Manager] Registering service worker...');
      
      this.registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });

      console.log('[SW Manager] Service worker registered successfully');

      // Handle service worker updates
      this.registration.addEventListener('updatefound', () => {
        const newWorker = this.registration!.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[SW Manager] New service worker available');
              this.notifyMessageListeners('SW_UPDATE_AVAILABLE', {});
            }
          });
        }
      });

      // Check for existing service worker updates
      if (this.registration.waiting) {
        console.log('[SW Manager] Service worker update pending');
        this.notifyMessageListeners('SW_UPDATE_AVAILABLE', {});
      }

      return true;
    } catch (error) {
      console.error('[SW Manager] Service worker registration failed:', error);
      return false;
    }
  }

  async update(): Promise<void> {
    if (!this.registration) {
      console.warn('[SW Manager] No registration available for update');
      return;
    }

    try {
      await this.registration.update();
      console.log('[SW Manager] Service worker update check completed');
    } catch (error) {
      console.error('[SW Manager] Service worker update failed:', error);
    }
  }

  async skipWaiting(): Promise<void> {
    if (!this.registration?.waiting) {
      console.warn('[SW Manager] No waiting service worker to activate');
      return;
    }

    this.sendMessage({ type: 'SKIP_WAITING' });
    
    // Reload the page to use the new service worker
    window.location.reload();
  }

  sendMessage(message: ServiceWorkerMessage): void {
    if (!navigator.serviceWorker.controller) {
      console.warn('[SW Manager] No active service worker to send message to');
      return;
    }

    navigator.serviceWorker.controller.postMessage(message);
  }

  // Queue an action for offline execution
  queueOfflineAction(action: OfflineAction): void {
    console.log('[SW Manager] Queueing offline action:', action.type);
    this.sendMessage({
      type: 'QUEUE_OFFLINE_ACTION',
      data: action
    });
  }

  // Cache management methods
  async getCacheStatus(): Promise<CacheStatus> {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      
      channel.port1.onmessage = (event) => {
        if (event.data.type === 'CACHE_STATUS') {
          resolve(event.data.data);
        }
      };

      this.sendMessage({ type: 'GET_CACHE_STATUS' });
    });
  }

  clearCache(cacheType: string = 'all'): void {
    console.log('[SW Manager] Clearing cache:', cacheType);
    this.sendMessage({
      type: 'CLEAR_CACHE',
      data: { cacheType }
    });
  }

  prefetchEmails(emails: any[]): void {
    console.log('[SW Manager] Prefetching emails:', emails.length);
    this.sendMessage({
      type: 'PREFETCH_EMAILS',
      data: { emails }
    });
  }

  // Online status management
  getOnlineStatus(): boolean {
    return this.isOnline;
  }

  addOnlineListener(callback: (online: boolean) => void): () => void {
    this.onlineListeners.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.onlineListeners.indexOf(callback);
      if (index > -1) {
        this.onlineListeners.splice(index, 1);
      }
    };
  }

  private notifyOnlineChange(online: boolean): void {
    this.onlineListeners.forEach(callback => callback(online));
  }

  // Message listening
  addMessageListener(type: string, callback: (data: any) => void): () => void {
    if (!this.messageListeners.has(type)) {
      this.messageListeners.set(type, []);
    }
    
    this.messageListeners.get(type)!.push(callback);
    
    // Return unsubscribe function
    return () => {
      const listeners = this.messageListeners.get(type);
      if (listeners) {
        const index = listeners.indexOf(callback);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    };
  }

  private notifyMessageListeners(type: string, data: any): void {
    const listeners = this.messageListeners.get(type);
    if (listeners) {
      listeners.forEach(callback => callback(data));
    }
  }

  // Check if app is running from cache (offline mode)
  isRunningOffline(): boolean {
    return !this.isOnline && !!navigator.serviceWorker.controller;
  }
}

// Create global instance
export const serviceWorkerManager = new ServiceWorkerManager();

// Register service worker when module loads
export async function initializeServiceWorker(): Promise<boolean> {
  const registered = await serviceWorkerManager.register();
  
  if (registered) {
    console.log('[SW Manager] Service worker initialized successfully');
  }
  
  return registered;
}

export default serviceWorkerManager;