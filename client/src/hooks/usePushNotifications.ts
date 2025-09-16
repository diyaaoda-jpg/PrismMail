import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import type { 
  PushSubscriptionResponse, 
  NotificationPreferencesResponse, 
  UpdateNotificationPreferencesRequest,
  UpdateAccountNotificationPreferencesRequest 
} from '@shared/schema';

export type NotificationPermission = 'default' | 'granted' | 'denied';

export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    auth: string;
    p256dh: string;
  };
  userAgent?: string;
  deviceType?: 'desktop' | 'mobile' | 'tablet';
}

export interface UsePushNotificationsReturn {
  // Permission state
  permission: NotificationPermission;
  isSupported: boolean;
  
  // Subscription state
  isSubscribed: boolean;
  subscriptionLoading: boolean;
  
  // Preferences
  preferences: NotificationPreferencesResponse | null;
  preferencesLoading: boolean;
  
  // Actions
  requestPermission: () => Promise<boolean>;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
  updateGlobalPreferences: (prefs: Partial<UpdateNotificationPreferencesRequest>) => Promise<void>;
  updateAccountPreferences: (prefs: UpdateAccountNotificationPreferencesRequest) => Promise<void>;
  testNotification: () => Promise<boolean>;
  
  // Utilities
  checkSubscriptionStatus: () => Promise<void>;
  refreshPreferences: () => Promise<void>;
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // Service worker registration reference
  const swRegistration = useRef<ServiceWorkerRegistration | null>(null);
  
  // Check if push notifications are supported
  const isSupported = Boolean(
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );

  // Get VAPID public key
  const { data: publicKeyData } = useQuery<PushSubscriptionResponse>({
    queryKey: ['/api/push/public-key'],
    enabled: isSupported,
    retry: false,
    meta: {
      errorMessage: 'Failed to get push notification configuration'
    }
  });

  // Get notification preferences
  const { 
    data: preferences, 
    isLoading: preferencesLoading,
    refetch: refetchPreferences 
  } = useQuery<NotificationPreferencesResponse>({
    queryKey: ['/api/push/preferences'],
    enabled: isSupported && permission === 'granted',
    retry: false,
    meta: {
      errorMessage: 'Failed to load notification preferences'
    }
  });

  // Initialize push notifications on component mount
  useEffect(() => {
    if (!isSupported) {
      console.log('[Push] Push notifications not supported');
      return;
    }

    initializePushNotifications();
  }, [isSupported]);

  // Monitor permission changes
  useEffect(() => {
    if (!isSupported) return;

    const checkPermission = () => {
      const currentPermission = Notification.permission;
      setPermission(currentPermission);
      
      if (currentPermission === 'granted') {
        checkSubscriptionStatus();
      }
    };

    // Check immediately
    checkPermission();

    // Listen for visibility changes to check permission updates
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        checkPermission();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isSupported]);

  // Initialize push notifications system
  const initializePushNotifications = useCallback(async () => {
    try {
      // Get service worker registration
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        swRegistration.current = registration;
        console.log('[Push] Service worker ready for push notifications');
      }
      
      // Set initial permission state
      setPermission(Notification.permission);
      
      // Check existing subscription if permission is granted
      if (Notification.permission === 'granted') {
        await checkSubscriptionStatus();
      }
      
    } catch (error) {
      console.error('[Push] Failed to initialize push notifications:', error);
    }
  }, []);

  // Check current subscription status
  const checkSubscriptionStatus = useCallback(async () => {
    try {
      if (!swRegistration.current) {
        console.warn('[Push] Service worker not ready');
        return;
      }

      const subscription = await swRegistration.current.pushManager.getSubscription();
      setIsSubscribed(!!subscription);
      
      console.log('[Push] Subscription status checked:', !!subscription);
    } catch (error) {
      console.error('[Push] Failed to check subscription status:', error);
      setIsSubscribed(false);
    }
  }, []);

  // Request notification permission
  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      if (!isSupported) {
        toast({
          title: 'Not Supported',
          description: 'Push notifications are not supported in this browser',
          variant: 'destructive'
        });
        return false;
      }

      if (permission === 'denied') {
        toast({
          title: 'Permission Denied',
          description: 'Please enable notifications in your browser settings and refresh the page',
          variant: 'destructive'
        });
        return false;
      }

      if (permission === 'granted') {
        return true;
      }

      // Request permission
      const result = await Notification.requestPermission();
      setPermission(result);

      if (result === 'granted') {
        toast({
          title: 'Notifications Enabled',
          description: 'You will now receive push notifications for new emails',
          variant: 'default'
        });
        
        // Check subscription status after permission granted
        await checkSubscriptionStatus();
        return true;
      } else {
        toast({
          title: 'Permission Required',
          description: 'Please enable notifications to receive email alerts',
          variant: 'destructive'
        });
        return false;
      }
      
    } catch (error) {
      console.error('[Push] Failed to request permission:', error);
      toast({
        title: 'Permission Error',
        description: 'Failed to request notification permission',
        variant: 'destructive'
      });
      return false;
    }
  }, [isSupported, permission, toast, checkSubscriptionStatus]);

  // Subscribe to push notifications
  const subscribeMutation = useMutation({
    mutationFn: async (): Promise<boolean> => {
      try {
        if (!isSupported) {
          throw new Error('Push notifications not supported');
        }

        if (permission !== 'granted') {
          const permissionGranted = await requestPermission();
          if (!permissionGranted) {
            throw new Error('Permission not granted');
          }
        }

        if (!swRegistration.current) {
          throw new Error('Service worker not ready');
        }

        if (!publicKeyData?.publicKey) {
          throw new Error('VAPID public key not available');
        }

        setSubscriptionLoading(true);

        // Check if already subscribed
        const existingSubscription = await swRegistration.current.pushManager.getSubscription();
        if (existingSubscription) {
          // Update existing subscription
          const subscriptionData = createSubscriptionData(existingSubscription);
          await apiRequest('/api/push/subscribe', {
            method: 'POST',
            body: subscriptionData
          });
          
          setIsSubscribed(true);
          console.log('[Push] Updated existing subscription');
          return true;
        }

        // Create new subscription
        const subscription = await swRegistration.current.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKeyData.publicKey)
        });

        // Send subscription to server
        const subscriptionData = createSubscriptionData(subscription);
        await apiRequest('/api/push/subscribe', {
          method: 'POST',
          body: subscriptionData
        });

        setIsSubscribed(true);
        console.log('[Push] Successfully subscribed to push notifications');
        
        return true;

      } catch (error) {
        console.error('[Push] Failed to subscribe:', error);
        throw error;
      } finally {
        setSubscriptionLoading(false);
      }
    },
    onSuccess: () => {
      toast({
        title: 'Subscribed',
        description: 'Successfully enabled push notifications',
        variant: 'default'
      });
      
      // Refresh preferences after subscription
      refetchPreferences();
    },
    onError: (error: Error) => {
      toast({
        title: 'Subscription Failed',
        description: error.message || 'Failed to enable push notifications',
        variant: 'destructive'
      });
    }
  });

  // Unsubscribe from push notifications
  const unsubscribeMutation = useMutation({
    mutationFn: async (): Promise<boolean> => {
      try {
        if (!swRegistration.current) {
          throw new Error('Service worker not ready');
        }

        setSubscriptionLoading(true);

        const subscription = await swRegistration.current.pushManager.getSubscription();
        
        if (subscription) {
          // Unsubscribe from push service
          await subscription.unsubscribe();
          
          // Remove from server
          await apiRequest('/api/push/unsubscribe', {
            method: 'DELETE',
            body: {
              endpoint: subscription.endpoint
            }
          });
        }

        setIsSubscribed(false);
        console.log('[Push] Successfully unsubscribed from push notifications');
        
        return true;

      } catch (error) {
        console.error('[Push] Failed to unsubscribe:', error);
        throw error;
      } finally {
        setSubscriptionLoading(false);
      }
    },
    onSuccess: () => {
      toast({
        title: 'Unsubscribed',
        description: 'Push notifications have been disabled',
        variant: 'default'
      });
      
      // Clear preferences cache
      queryClient.invalidateQueries({ queryKey: ['/api/push/preferences'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Unsubscribe Failed',
        description: error.message || 'Failed to disable push notifications',
        variant: 'destructive'
      });
    }
  });

  // Update global notification preferences
  const updateGlobalPreferencesMutation = useMutation({
    mutationFn: async (prefs: Partial<UpdateNotificationPreferencesRequest>) => {
      await apiRequest('/api/push/preferences', {
        method: 'PUT',
        body: prefs
      });
    },
    onSuccess: () => {
      toast({
        title: 'Settings Updated',
        description: 'Notification preferences have been saved',
        variant: 'default'
      });
      
      // Refresh preferences
      queryClient.invalidateQueries({ queryKey: ['/api/push/preferences'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Update Failed',
        description: error.message || 'Failed to update notification preferences',
        variant: 'destructive'
      });
    }
  });

  // Update account-specific notification preferences
  const updateAccountPreferencesMutation = useMutation({
    mutationFn: async (prefs: UpdateAccountNotificationPreferencesRequest) => {
      await apiRequest('/api/push/account-preferences', {
        method: 'PUT',
        body: prefs
      });
    },
    onSuccess: () => {
      toast({
        title: 'Account Settings Updated',
        description: 'Account notification preferences have been saved',
        variant: 'default'
      });
      
      // Refresh preferences
      queryClient.invalidateQueries({ queryKey: ['/api/push/preferences'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Update Failed',
        description: error.message || 'Failed to update account preferences',
        variant: 'destructive'
      });
    }
  });

  // Send test notification
  const testNotificationMutation = useMutation({
    mutationFn: async (): Promise<boolean> => {
      const result = await apiRequest<{ delivered: boolean }>('/api/push/test', {
        method: 'POST'
      });
      
      return result.delivered;
    },
    onSuccess: (delivered) => {
      if (delivered) {
        toast({
          title: 'Test Sent',
          description: 'Test notification has been sent',
          variant: 'default'
        });
      } else {
        toast({
          title: 'Test Failed',
          description: 'No active subscriptions found',
          variant: 'destructive'
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Test Failed',
        description: error.message || 'Failed to send test notification',
        variant: 'destructive'
      });
    }
  });

  // Utility functions
  const subscribe = useCallback(() => subscribeMutation.mutateAsync(), [subscribeMutation]);
  const unsubscribe = useCallback(() => unsubscribeMutation.mutateAsync(), [unsubscribeMutation]);
  const updateGlobalPreferences = useCallback(
    (prefs: Partial<UpdateNotificationPreferencesRequest>) => 
      updateGlobalPreferencesMutation.mutateAsync(prefs),
    [updateGlobalPreferencesMutation]
  );
  const updateAccountPreferences = useCallback(
    (prefs: UpdateAccountNotificationPreferencesRequest) => 
      updateAccountPreferencesMutation.mutateAsync(prefs),
    [updateAccountPreferencesMutation]
  );
  const testNotification = useCallback(
    () => testNotificationMutation.mutateAsync(),
    [testNotificationMutation]
  );
  const refreshPreferences = useCallback(
    () => refetchPreferences(),
    [refetchPreferences]
  );

  return {
    // State
    permission,
    isSupported,
    isSubscribed,
    subscriptionLoading: subscriptionLoading || subscribeMutation.isPending || unsubscribeMutation.isPending,
    preferences,
    preferencesLoading,
    
    // Actions
    requestPermission,
    subscribe,
    unsubscribe,
    updateGlobalPreferences,
    updateAccountPreferences,
    testNotification,
    
    // Utilities
    checkSubscriptionStatus,
    refreshPreferences
  };
}

// Helper function to create subscription data for API
function createSubscriptionData(subscription: PushSubscription): PushSubscriptionData {
  const keys = subscription.getKeys();
  
  return {
    endpoint: subscription.endpoint,
    keys: {
      auth: arrayBufferToBase64(keys?.auth),
      p256dh: arrayBufferToBase64(keys?.p256dh)
    },
    userAgent: navigator.userAgent,
    deviceType: getDeviceType()
  };
}

// Helper function to detect device type
function getDeviceType(): 'desktop' | 'mobile' | 'tablet' {
  const userAgent = navigator.userAgent.toLowerCase();
  
  if (/mobile|android|iphone|ipad|phone/i.test(userAgent)) {
    if (/ipad|tablet/i.test(userAgent) || window.screen.width >= 768) {
      return 'tablet';
    }
    return 'mobile';
  }
  
  return 'desktop';
}

// Helper function to convert ArrayBuffer to base64
function arrayBufferToBase64(buffer?: ArrayBuffer | null): string {
  if (!buffer) return '';
  
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Helper function to convert base64 VAPID key to Uint8Array
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  
  return outputArray;
}