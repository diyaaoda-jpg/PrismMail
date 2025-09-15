/**
 * Hook for handling swipe gestures on email items with smooth animations
 * Provides iOS/Android-style swipe-to-action functionality
 */

import * as React from "react";
import { 
  GESTURE_CONFIG, 
  analyzeGesture, 
  triggerHapticFeedback, 
  getActionColor,
  getActionIcon,
  calculateSpringProgress,
  clamp,
  isTouchDevice,
  type GestureEvent,
  type TouchPoint,
  type GestureType
} from "@/lib/gestureUtils";

// Swipe action configuration
export interface SwipeAction {
  type: 'archive' | 'read' | 'star' | 'delete' | 'flag' | 'snooze' | 'previous' | 'next' | 'menu' | 'compose';
  icon: string;
  color: string;
  label: string;
  threshold: number; // Distance threshold to trigger
  callback: () => void;
}

// Swipe gesture configuration per email item
export interface SwipeConfig {
  leftActions: SwipeAction[];
  rightActions: SwipeAction[];
  longSwipeThreshold?: number;
  enableHapticFeedback?: boolean;
  preventScrolling?: boolean;
  animationDuration?: number;
}

// Gesture state tracking
interface SwipeState {
  isActive: boolean;
  direction: 'left' | 'right' | null;
  distance: number;
  velocity: number;
  progress: number; // 0 to 1
  activeAction: SwipeAction | null;
  startTime: number;
  element: HTMLElement | null;
}

// Hook return type
export interface UseSwipeGesturesReturn {
  swipeState: SwipeState;
  handlers: {
    onTouchStart: (event: React.TouchEvent) => void;
    onTouchMove: (event: React.TouchEvent) => void;
    onTouchEnd: (event: React.TouchEvent) => void;
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerUp: (event: React.PointerEvent) => void;
  };
  bind: () => {
    onTouchStart: (event: React.TouchEvent) => void;
    onTouchMove: (event: React.TouchEvent) => void;
    onTouchEnd: (event: React.TouchEvent) => void;
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerUp: (event: React.PointerEvent) => void;
  };
  resetSwipe: () => void;
  triggerAction: (action: SwipeAction) => void;
  getActionFeedback: () => { icon: string; color: string; progress: number } | null;
}

const DEFAULT_CONFIG: SwipeConfig = {
  leftActions: [],
  rightActions: [],
  longSwipeThreshold: GESTURE_CONFIG.LONG_SWIPE_DISTANCE,
  enableHapticFeedback: GESTURE_CONFIG.HAPTIC_FEEDBACK_ENABLED,
  preventScrolling: true,
  animationDuration: GESTURE_CONFIG.SWIPE_ANIMATION_DURATION,
};

export function useSwipeGestures(config: SwipeConfig = DEFAULT_CONFIG): UseSwipeGesturesReturn {
  const startPointRef = useRef<TouchPoint | null>(null);
  const currentPointRef = useRef<TouchPoint | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const isActiveRef = React.useRef(false);
  const rafRef = useRef<number | null>(null);
  
  // State for component re-renders and animations
  const [swipeState, setSwipeState] = React.useState<SwipeState>({
    isActive: false,
    direction: null,
    distance: 0,
    velocity: 0,
    progress: 0,
    activeAction: null,
    startTime: 0,
    element: null,
  });

  // Reset swipe state
  const resetSwipe = React.useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    
    startPointRef.current = null;
    currentPointRef.current = null;
    elementRef.current = null;
    isActiveRef.current = false;
    
    setSwipeState({
      isActive: false,
      direction: null,
      distance: 0,
      velocity: 0,
      progress: 0,
      activeAction: null,
      startTime: 0,
      element: null,
    });
  }, []);

  // Get the appropriate action based on distance and direction
  const getActiveAction = React.useCallback((direction: 'left' | 'right', distance: number): SwipeAction | null => {
    const actions = direction === 'left' ? config.leftActions : config.rightActions;
    
    // Find the action with the highest threshold that's been exceeded
    let activeAction: SwipeAction | null = null;
    for (const action of actions) {
      if (distance >= action.threshold) {
        activeAction = action;
      }
    }
    
    return activeAction;
  }, [config.leftActions, config.rightActions]);

  // Update swipe state with animation frame optimization
  const updateSwipeState = React.useCallback((
    direction: 'left' | 'right' | null,
    distance: number,
    velocity: number,
    element: HTMLElement | null
  ) => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    
    rafRef.current = requestAnimationFrame(() => {
      const activeAction = direction ? getActiveAction(direction, distance) : null;
      const maxDistance = config.longSwipeThreshold || GESTURE_CONFIG.LONG_SWIPE_DISTANCE;
      const progress = clamp(distance / maxDistance, 0, 1);
      
      setSwipeState(prev => ({
        ...prev,
        isActive: distance > 0,
        direction,
        distance,
        velocity,
        progress,
        activeAction,
        element,
      }));
    });
  }, [getActiveAction, config.longSwipeThreshold]);

  // Extract touch point from event
  const getTouchPoint = React.useCallback((event: React.TouchEvent | React.PointerEvent | TouchEvent | PointerEvent): TouchPoint => {
    const touch = 'touches' in event ? event.touches[0] || event.changedTouches[0] : event;
    return {
      x: touch.clientX,
      y: touch.clientY,
      timestamp: Date.now(),
    };
  }, []);

  // Handle gesture start
  const handleStart = React.useCallback((event: React.TouchEvent | React.PointerEvent | TouchEvent | PointerEvent) => {
    // Only handle single touch/pointer
    if ('touches' in event && event.touches.length > 1) return;
    
    const element = event.currentTarget as HTMLElement;
    const point = getTouchPoint(event);
    
    startPointRef.current = point;
    currentPointRef.current = point;
    elementRef.current = element;
    isActiveRef.current = false; // Will be set to true on first move
    
    setSwipeState(prev => ({
      ...prev,
      startTime: point.timestamp,
      element,
    }));

    // Prevent text selection during swipe
    if (config.preventScrolling) {
      event.preventDefault();
    }
  }, [getTouchPoint, config.preventScrolling]);

  // Handle gesture move
  const handleMove = React.useCallback((event: React.TouchEvent | React.PointerEvent | TouchEvent | PointerEvent) => {
    if (!startPointRef.current || !elementRef.current) return;
    
    const point = getTouchPoint(event);
    currentPointRef.current = point;
    
    const deltaX = point.x - startPointRef.current.x;
    const deltaY = point.y - startPointRef.current.y;
    const distance = Math.abs(deltaX);
    const velocity = Math.abs(deltaX) / (point.timestamp - startPointRef.current.timestamp);
    
    // Determine if this is a horizontal swipe
    const isHorizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY) && 
                              distance > GESTURE_CONFIG.SWIPE_MIN_DISTANCE / 3;
    
    if (isHorizontalSwipe) {
      if (!isActiveRef.current) {
        isActiveRef.current = true;
        // Trigger light haptic feedback on swipe start
        if (config.enableHapticFeedback) {
          triggerHapticFeedback('light');
        }
      }
      
      const direction: 'left' | 'right' = deltaX < 0 ? 'left' : 'right';
      
      // Prevent scrolling during horizontal swipe
      if (config.preventScrolling) {
        event.preventDefault();
      }
      
      updateSwipeState(direction, distance, velocity, elementRef.current);
    } else if (!isActiveRef.current) {
      // Allow vertical scrolling if not swiping horizontally
      resetSwipe();
    }
  }, [getTouchPoint, config.preventScrolling, config.enableHapticFeedback, updateSwipeState, resetSwipe]);

  // Handle gesture end
  const handleEnd = React.useCallback((event: React.TouchEvent | React.PointerEvent | TouchEvent | PointerEvent) => {
    if (!startPointRef.current || !isActiveRef.current) {
      resetSwipe();
      return;
    }
    
    const point = getTouchPoint(event);
    const gesture = analyzeGesture(startPointRef.current, point);
    
    if (gesture && (gesture.type === 'swipe-left' || gesture.type === 'swipe-right' || 
                   gesture.type === 'long-swipe-left' || gesture.type === 'long-swipe-right')) {
      
      const direction = gesture.direction as 'left' | 'right';
      const activeAction = getActiveAction(direction, gesture.distance);
      
      if (activeAction) {
        // Trigger haptic feedback for action
        if (config.enableHapticFeedback) {
          triggerHapticFeedback('medium');
        }
        
        // Execute action after a short delay for visual feedback
        setTimeout(() => {
          activeAction.callback();
          resetSwipe();
        }, 100);
        
        return;
      }
    }
    
    // No action triggered, reset state
    resetSwipe();
  }, [getTouchPoint, getActiveAction, config.enableHapticFeedback, resetSwipe]);

  // Trigger action manually
  const triggerAction = React.useCallback((action: SwipeAction) => {
    if (config.enableHapticFeedback) {
      triggerHapticFeedback('medium');
    }
    action.callback();
  }, [config.enableHapticFeedback]);

  // Get current action feedback for UI
  const getActionFeedback = React.useCallback(() => {
    if (!swipeState.isActive || !swipeState.activeAction) return null;
    
    return {
      icon: swipeState.activeAction.icon,
      color: swipeState.activeAction.color,
      progress: swipeState.progress,
    };
  }, [swipeState]);

  // Event handlers for different input types
  const handlers = {
    onTouchStart: handleStart as (event: React.TouchEvent) => void,
    onTouchMove: handleMove as (event: React.TouchEvent) => void, 
    onTouchEnd: handleEnd as (event: React.TouchEvent) => void,
    onPointerDown: handleStart as (event: React.PointerEvent) => void,
    onPointerMove: handleMove as (event: React.PointerEvent) => void,
    onPointerUp: handleEnd as (event: React.PointerEvent) => void,
  };

  // Convenience method to bind all handlers
  const bind = React.useCallback(() => handlers, [handlers]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return {
    swipeState,
    handlers,
    bind,
    resetSwipe,
    triggerAction,
    getActionFeedback,
  };
}

// Utility function to create common email swipe actions
export function createEmailSwipeActions(
  email: { id: string; isRead: boolean; isStarred: boolean; isArchived: boolean },
  callbacks: {
    onArchive: (id: string) => void;
    onDelete: (id: string) => void;
    onToggleRead: (id: string) => void;
    onToggleStar: (id: string) => void;
    onFlag: (id: string) => void;
    onSnooze?: (id: string) => void;
  }
): SwipeConfig {
  return {
    leftActions: [
      {
        type: 'archive',
        icon: 'Archive',
        color: 'hsl(var(--chart-1))',
        label: 'Archive',
        threshold: 80,
        callback: () => callbacks.onArchive(email.id),
      },
      {
        type: 'delete',
        icon: 'Trash',
        color: 'hsl(var(--destructive))',
        label: 'Delete',
        threshold: 160,
        callback: () => callbacks.onDelete(email.id),
      },
    ],
    rightActions: [
      {
        type: 'read',
        icon: email.isRead ? 'EyeOff' : 'Eye',
        color: 'hsl(var(--chart-2))',
        label: email.isRead ? 'Mark Unread' : 'Mark Read',
        threshold: 80,
        callback: () => callbacks.onToggleRead(email.id),
      },
      {
        type: 'star',
        icon: email.isStarred ? 'StarOff' : 'Star',
        color: 'hsl(var(--chart-4))',
        label: email.isStarred ? 'Remove Star' : 'Add Star',
        threshold: 160,
        callback: () => callbacks.onToggleStar(email.id),
      },
    ],
    enableHapticFeedback: true,
    preventScrolling: true,
  };
}