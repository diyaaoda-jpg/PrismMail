// Offline Status Indicator Component
// Shows online/offline status and sync progress

import { Cloud, CloudOff, Wifi, WifiOff, Loader2, Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useOfflineStatus } from '@/hooks/useOfflineStatus';
import { cn } from '@/lib/utils';

interface OfflineIndicatorProps {
  variant?: 'badge' | 'card' | 'minimal';
  className?: string;
}

export function OfflineIndicator({ variant = 'badge', className }: OfflineIndicatorProps) {
  const { isOnline, isOfflineCapable, hasQueuedActions, syncInProgress, clearCache } = useOfflineStatus();

  if (variant === 'minimal') {
    return (
      <div className={cn('flex items-center gap-1', className)} data-testid="offline-indicator-minimal">
        {isOnline ? (
          <Wifi className="h-4 w-4 text-green-500" />
        ) : (
          <WifiOff className="h-4 w-4 text-red-500" />
        )}
      </div>
    );
  }

  if (variant === 'badge') {
    return (
      <Badge 
        variant={isOnline ? 'default' : 'destructive'} 
        className={cn('flex items-center gap-1', className)}
        data-testid="offline-indicator-badge"
      >
        {syncInProgress ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : isOnline ? (
          <Cloud className="h-3 w-3" />
        ) : (
          <CloudOff className="h-3 w-3" />
        )}
        {syncInProgress ? 'Syncing...' : isOnline ? 'Online' : 'Offline'}
        {hasQueuedActions && !syncInProgress && (
          <span className="ml-1 text-xs">(Actions Queued)</span>
        )}
      </Badge>
    );
  }

  // Card variant for settings/debug view
  return (
    <Card className={cn('w-full max-w-md', className)} data-testid="offline-indicator-card">
      <CardContent className="p-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isOnline ? (
                <Cloud className="h-5 w-5 text-green-500" />
              ) : (
                <CloudOff className="h-5 w-5 text-red-500" />
              )}
              <span className="font-medium">
                {isOnline ? 'Online' : 'Offline Mode'}
              </span>
            </div>
            {syncInProgress && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Syncing
              </div>
            )}
          </div>

          <div className="text-sm text-muted-foreground">
            {isOnline ? (
              <span>Connected to the internet. All features available.</span>
            ) : (
              <span>
                {isOfflineCapable 
                  ? 'Working offline. Actions will sync when reconnected.' 
                  : 'Limited functionality in offline mode.'}
              </span>
            )}
          </div>

          {hasQueuedActions && (
            <div className="flex items-center gap-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-md">
              <Loader2 className="h-4 w-4 text-yellow-600" />
              <span className="text-sm text-yellow-700 dark:text-yellow-300">
                Actions queued for sync
              </span>
            </div>
          )}

          {!isOnline && isOfflineCapable && (
            <div className="flex items-center gap-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-md">
              <Check className="h-4 w-4 text-blue-600" />
              <span className="text-sm text-blue-700 dark:text-blue-300">
                Offline reading enabled
              </span>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => clearCache()}
              data-testid="button-clear-cache"
            >
              Clear Cache
            </Button>
            {!isOnline && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => window.location.reload()}
                data-testid="button-retry-connection"
              >
                Retry Connection
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}