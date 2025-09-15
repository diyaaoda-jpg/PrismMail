/**
 * Hook for implementing pull-to-refresh functionality with physics-based animations
 * Provides native-like pull-to-refresh behavior for email list
 */

import * as React from "react";
import {
  GESTURE_CONFIG,
  calculateVelocity,
  calculateSpringProgress,
  triggerHapticFeedback,
  clamp,
  easeOutCubic,
  getSafeAreaInsets,
  type TouchPoint
} from "@/lib/gestureUtils";

// Pull-to-refresh states
export type PullToRefreshState = 'idle' | 'pulling' | 'ready' | 'refreshing' | 'completing';

// Configuration for pull-to-refresh behavior
export interface PullToRefreshConfig {
  threshold: number; // Distance needed to trigger refresh
  maxPullDistance: number; // Maximum pull distance before resistance
  resistance: number; // Resistance factor when exceeding max distance
  snapBackDuration: number; // Animation duration for snap back
  completeDuration: number; // Duration to show completion state
  enableHapticFeedback: boolean;
  refreshingText: string;
  pullText: string;
  readyText: string;
  completedText: string;
}

// Pull state tracking
interface PullState {
  isActive: boolean;
  isPulling: boolean;
  distance: number;
  progress: number; // 0 to 1
  velocity: number;
  state: PullToRefreshState;
  lastTriggerTime: number;
}

// Hook return type
export interface UsePullToRefreshReturn {
  pullState: PullState;
  pullProgress: number;
  isRefreshing: boolean;
  pullDistance: number;
  handlers: {
    onTouchStart: (event: TouchEvent) => void;
    onTouchMove: (event: TouchEvent) => void;
    onTouchEnd: (event: TouchEvent) => void;
    onPointerDown: (event: PointerEvent) => void;
    onPointerMove: (event: PointerEvent) => void;
    onPointerUp: (event: PointerEvent) => void;
    onScroll: (event: Event) => void;
  };
  bind: () => {
    onTouchStart: (event: TouchEvent) => void;
    onTouchMove: (event: TouchEvent) => void;
    onTouchEnd: (event: TouchEvent) => void;
    onPointerDown: (event: PointerEvent) => void;
    onPointerMove: (event: PointerEvent) => void;
    onPointerUp: (event: PointerEvent) => void;
    onScroll: (event: Event) => void;
  };
  refresh: () => Promise<void>;
  completeRefresh: () => void;
  reset: () => void;
  getStatusText: () => string;
}

const DEFAULT_CONFIG: PullToRefreshConfig = {
  threshold: GESTURE_CONFIG.PULL_MIN_DISTANCE,
  maxPullDistance: GESTURE_CONFIG.PULL_MAX_DISTANCE,
  resistance: 0.6,
  snapBackDuration: 300,
  completeDuration: 800,
  enableHapticFeedback: true,
  refreshingText: 'Refreshing emails...',
  pullText: 'Pull to refresh',
  readyText: 'Release to refresh',
  completedText: 'Emails updated',
};

export function usePullToRefresh(
  onRefresh: () => Promise<void>,
  config: Partial<PullToRefreshConfig> = {}
): UsePullToRefreshReturn {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  // Refs for tracking gesture state without re-renders
  const startPointRef = React.useRef<TouchPoint | null>(null);
  const currentPointRef = React.useRef<TouchPoint | null>(null);
  const isActiveRef = React.React.useRef(false);
  const scrollElementRef = React.useRef<HTMLElement | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const refreshPromiseRef = React.useRef<Promise<void> | null>(null);

  // State for component re-renders and animations
  const [pullState, setPullState] = React.useState<PullState>({
    isActive: false,
    isPulling: false,
    distance: 0,
    progress: 0,
    velocity: 0,
    state: 'idle',
    lastTriggerTime: 0,
  });

  // Check if element is at the top and can be pulled
  const canPull = React.useCallback((element: Element): boolean => {
    if (!element) return false;
    return element.scrollTop === 0;
  }, []);

  // Calculate pull distance with resistance
  const calculatePullDistance = React.useCallback((rawDistance: number): number => {
    if (rawDistance <= finalConfig.maxPullDistance) {
      return rawDistance;
    }
    
    // Apply resistance beyond max distance
    const excess = rawDistance - finalConfig.maxPullDistance;
    const resistedExcess = excess * finalConfig.resistance;
    return finalConfig.maxPullDistance + resistedExcess;
  }, [finalConfig.maxPullDistance, finalConfig.resistance]);

  // Update pull state with animation frame optimization
  const updatePullState = React.useCallback((
    distance: number,
    velocity: number,
    state: PullToRefreshState = 'pulling'
  ) => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      const pullDistance = calculatePullDistance(distance);
      const progress = clamp(pullDistance / finalConfig.threshold, 0, 1.5);
      const isReady = pullDistance >= finalConfig.threshold && state === 'pulling';

      setPullState(prev => ({
        ...prev,
        isActive: distance > 0,
        isPulling: state === 'pulling',
        distance: pullDistance,
        progress,
        velocity,
        state: isReady ? 'ready' : state,
      }));
    });
  }, [calculatePullDistance, finalConfig.threshold]);

  // Extract touch point from event
  const getTouchPoint = React.useCallback((event: TouchEvent | PointerEvent): TouchPoint => {
    const touch = 'touches' in event ? event.touches[0] || event.changedTouches[0] : event;
    return {
      x: touch.clientX,
      y: touch.clientY,
      timestamp: Date.now(),
    };
  }, []);

  // Handle gesture start
  const handleStart = React.useCallback((event: TouchEvent | PointerEvent) => {
    // Only handle single touch and when not already refreshing
    if (('touches' in event && event.touches.length > 1) || pullState.state === 'refreshing') {
      return;
    }

    const element = event.currentTarget as HTMLElement;
    const scrollElement = element.scrollTop !== undefined ? element : 
                          element.querySelector('[data-scroll-container]') ||
                          element.querySelector('.scroll-area') ||
                          element;

    if (!canPull(scrollElement)) {
      return;
    }

    const point = getTouchPoint(event);
    
    startPointRef.current = point;
    currentPointRef.current = point;
    scrollElementRef.current = scrollElement as HTMLElement;
    isActiveRef.current = false;
  }, [getTouchPoint, canPull, pullState.state]);

  // Handle gesture move
  const handleMove = React.useCallback((event: TouchEvent | PointerEvent) => {
    if (!startPointRef.current || !scrollElementRef.current || pullState.state === 'refreshing') {
      return;
    }

    const point = getTouchPoint(event);
    const deltaY = point.y - startPointRef.current.y;
    const deltaX = point.x - startPointRef.current.x;
    
    // Check if this is a vertical pull gesture
    const isPullDown = deltaY > 0 && Math.abs(deltaY) > Math.abs(deltaX) * 1.5;
    
    if (isPullDown && deltaY > 10) {
      // Ensure we can still pull (user hasn't scrolled)
      if (!canPull(scrollElementRef.current)) {
        return;
      }

      if (!isActiveRef.current) {
        isActiveRef.current = true;
        // Light haptic feedback on pull start
        if (finalConfig.enableHapticFeedback) {
          triggerHapticFeedback('light');
        }
      }

      // Prevent default scrolling during pull
      event.preventDefault();
      
      const velocity = calculateVelocity(startPointRef.current, point);
      updatePullState(deltaY, velocity, 'pulling');
      
      currentPointRef.current = point;
    } else if (isActiveRef.current && deltaY <= 0) {
      // User pulled up, cancel the pull
      isActiveRef.current = false;
      updatePullState(0, 0, 'idle');
    }
  }, [getTouchPoint, canPull, calculateVelocity, updatePullState, finalConfig.enableHapticFeedback, pullState.state]);

  // Handle gesture end
  const handleEnd = React.useCallback(async (event: TouchEvent | PointerEvent) => {
    if (!isActiveRef.current || !startPointRef.current || pullState.state === 'refreshing') {
      return;
    }

    const point = getTouchPoint(event);
    const deltaY = point.y - startPointRef.current.y;
    const pullDistance = calculatePullDistance(deltaY);
    
    if (pullDistance >= finalConfig.threshold) {
      // Trigger refresh
      if (finalConfig.enableHapticFeedback) {
        triggerHapticFeedback('medium');
      }

      setPullState(prev => ({ 
        ...prev, 
        state: 'refreshing',
        lastTriggerTime: Date.now()
      }));

      try {
        refreshPromiseRef.current = onRefresh();
        await refreshPromiseRef.current;
        
        // Show completion state briefly
        setPullState(prev => ({ ...prev, state: 'completing' }));
        
        setTimeout(() => {
          updatePullState(0, 0, 'idle');
          setPullState(prev => ({ 
            ...prev, 
            isActive: false,
            isPulling: false,
            state: 'idle'
          }));
        }, finalConfig.completeDuration);
        
      } catch (error) {
        console.error('Pull to refresh failed:', error);
        updatePullState(0, 0, 'idle');
        setPullState(prev => ({ 
          ...prev, 
          isActive: false,
          isPulling: false,
          state: 'idle'
        }));
      } finally {
        refreshPromiseRef.current = null;
      }
    } else {
      // Snap back animation
      updatePullState(0, 0, 'idle');
      setPullState(prev => ({ 
        ...prev, 
        isActive: false,
        isPulling: false,
        state: 'idle'
      }));
    }

    // Reset refs
    startPointRef.current = null;
    currentPointRef.current = null;
    scrollElementRef.current = null;
    isActiveRef.current = false;
  }, [getTouchPoint, calculatePullDistance, finalConfig.threshold, finalConfig.enableHapticFeedback, finalConfig.completeDuration, onRefresh, updatePullState, pullState.state]);

  // Handle scroll events (for desktop)
  const handleScroll = React.useCallback((event: Event) => {
    const element = event.currentTarget as HTMLElement;
    
    // If actively pulling, prevent scroll
    if (isActiveRef.current) {
      event.preventDefault();
      return;
    }

    // Reset pull state if user scrolled away from top
    if (!canPull(element) && pullState.isActive) {
      updatePullState(0, 0, 'idle');
    }
  }, [canPull, pullState.isActive, updatePullState]);

  // Manual refresh function
  const refresh = React.useCallback(async (): Promise<void> => {
    if (pullState.state === 'refreshing' || refreshPromiseRef.current) {
      return refreshPromiseRef.current || Promise.resolve();
    }

    setPullState(prev => ({ 
      ...prev, 
      state: 'refreshing',
      isActive: true,
      lastTriggerTime: Date.now()
    }));

    try {
      refreshPromiseRef.current = onRefresh();
      await refreshPromiseRef.current;
      
      setPullState(prev => ({ ...prev, state: 'completing' }));
      
      setTimeout(() => {
        setPullState(prev => ({ 
          ...prev, 
          isActive: false,
          isPulling: false,
          state: 'idle',
          distance: 0,
          progress: 0,
          velocity: 0
        }));
      }, finalConfig.completeDuration);
      
    } catch (error) {
      console.error('Manual refresh failed:', error);
      setPullState(prev => ({ 
        ...prev, 
        isActive: false,
        isPulling: false,
        state: 'idle',
        distance: 0,
        progress: 0,
        velocity: 0
      }));
      throw error;
    } finally {
      refreshPromiseRef.current = null;
    }
  }, [onRefresh, pullState.state, finalConfig.completeDuration]);

  // Complete refresh manually
  const completeRefresh = React.useCallback(() => {
    if (pullState.state === 'refreshing') {
      setPullState(prev => ({ ...prev, state: 'completing' }));
      
      setTimeout(() => {
        setPullState(prev => ({ 
          ...prev, 
          isActive: false,
          isPulling: false,
          state: 'idle',
          distance: 0,
          progress: 0,
          velocity: 0
        }));
      }, finalConfig.completeDuration);
    }
  }, [pullState.state, finalConfig.completeDuration]);

  // Reset pull state
  const reset = React.useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    
    startPointRef.current = null;
    currentPointRef.current = null;
    scrollElementRef.current = null;
    isActiveRef.current = false;
    refreshPromiseRef.current = null;
    
    setPullState({
      isActive: false,
      isPulling: false,
      distance: 0,
      progress: 0,
      velocity: 0,
      state: 'idle',
      lastTriggerTime: 0,
    });
  }, []);

  // Get status text for current state
  const getStatusText = React.useCallback((): string => {
    switch (pullState.state) {
      case 'refreshing':
        return finalConfig.refreshingText;
      case 'ready':
        return finalConfig.readyText;
      case 'completing':
        return finalConfig.completedText;
      case 'pulling':
        return pullState.progress >= 1 ? finalConfig.readyText : finalConfig.pullText;
      default:
        return finalConfig.pullText;
    }
  }, [pullState.state, pullState.progress, finalConfig]);

  // Event handlers - memoized to prevent recreating on every render
  const handlers = useMemo(() => ({
    onTouchStart: handleStart as (event: TouchEvent) => void,
    onTouchMove: handleMove as (event: TouchEvent) => void,
    onTouchEnd: handleEnd as (event: TouchEvent) => void,
    onPointerDown: handleStart as (event: PointerEvent) => void,
    onPointerMove: handleMove as (event: PointerEvent) => void,
    onPointerUp: handleEnd as (event: PointerEvent) => void,
    onScroll: handleScroll,
  }), [handleStart, handleMove, handleEnd, handleScroll]);

  // Convenience method to bind all handlers
  const bind = React.useCallback(() => handlers, [handlers]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      if (refreshPromiseRef.current) {
        // Don't cancel the promise, but clear our reference
        refreshPromiseRef.current = null;
      }
    };
  }, []);

  return {
    pullState,
    pullProgress: pullState.progress,
    isRefreshing: pullState.state === 'refreshing',
    pullDistance: pullState.distance,
    handlers,
    bind,
    refresh,
    completeRefresh,
    reset,
    getStatusText,
  };
}