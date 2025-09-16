// Offline Status Hook
// Provides online/offline status and offline queue management

import { useState, useEffect, useCallback } from 'react';
import serviceWorkerManager, { type OfflineAction } from '@/lib/serviceWorker';
import { useToast } from '@/hooks/use-toast';

export interface OfflineStatus {
  isOnline: boolean;
  isOfflineCapable: boolean;
  hasQueuedActions: boolean;
  syncInProgress: boolean;
}

export function useOfflineStatus() {
  const [status, setStatus] = useState<OfflineStatus>({
    isOnline: serviceWorkerManager.getOnlineStatus(),
    isOfflineCapable: !!navigator.serviceWorker,
    hasQueuedActions: false,
    syncInProgress: false
  });
  
  const { toast } = useToast();

  useEffect(() => {
    // Listen for online/offline changes
    const unsubscribeOnline = serviceWorkerManager.addOnlineListener((online) => {
      setStatus(prev => ({ ...prev, isOnline: online }));
      
      if (online) {
        toast({
          title: "Back Online",
          description: "Your connection has been restored. Syncing pending actions...",
          variant: "default"
        });
      } else {
        toast({
          title: "Offline Mode",
          description: "You're now offline. Actions will be queued until connection is restored.",
          variant: "destructive"
        });
      }
    });

    // Listen for service worker updates
    const unsubscribeUpdate = serviceWorkerManager.addMessageListener('SW_UPDATE_AVAILABLE', () => {
      toast({
        title: "App Update Available",
        description: "A new version is available. Refresh to update."
      });
    });

    // Listen for sync status changes
    const unsubscribeSync = serviceWorkerManager.addMessageListener('SYNC_STATUS', (data) => {
      setStatus(prev => ({ 
        ...prev, 
        syncInProgress: data.inProgress,
        hasQueuedActions: data.queueSize > 0
      }));
    });

    return () => {
      unsubscribeOnline();
      unsubscribeUpdate();
      unsubscribeSync();
    };
  }, [toast]);

  const queueAction = useCallback((action: OfflineAction) => {
    serviceWorkerManager.queueOfflineAction(action);
    setStatus(prev => ({ ...prev, hasQueuedActions: true }));
    
    if (!status.isOnline) {
      toast({
        title: "Action Queued",
        description: "Your action will be completed when you're back online.",
        variant: "default"
      });
    }
  }, [status.isOnline, toast]);

  const clearCache = useCallback((cacheType?: string) => {
    serviceWorkerManager.clearCache(cacheType || 'all');
    toast({
      title: "Cache Cleared",
      description: "Application cache has been cleared successfully.",
      variant: "default"
    });
  }, [toast]);

  const updateServiceWorker = useCallback(() => {
    serviceWorkerManager.skipWaiting();
  }, []);

  return {
    ...status,
    queueAction,
    clearCache,
    updateServiceWorker
  };
}