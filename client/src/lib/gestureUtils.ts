/**
 * Gesture recognition utilities for touch-based interactions
 * Provides cross-platform gesture detection with physics and animations
 */

// Gesture configuration constants
export const GESTURE_CONFIG = {
  // Swipe thresholds
  SWIPE_MIN_DISTANCE: 50, // Minimum distance to register as swipe
  SWIPE_MAX_TIME: 300, // Maximum time for swipe gesture (ms)
  SWIPE_MIN_VELOCITY: 0.3, // Minimum velocity for swipe detection
  
  // Long swipe thresholds (for actions like delete)
  LONG_SWIPE_DISTANCE: 120,
  LONG_SWIPE_MIN_VELOCITY: 0.5,
  
  // Pull to refresh
  PULL_MIN_DISTANCE: 60, // Minimum pull distance to trigger refresh
  PULL_MAX_DISTANCE: 100, // Maximum pull distance before clamping
  PULL_TRIGGER_RATIO: 0.7, // Ratio of max distance to trigger refresh
  
  // Edge swipes
  EDGE_SWIPE_ZONE: 20, // Pixel zone from edge for edge swipes
  EDGE_SWIPE_MIN_DISTANCE: 80,
  
  // Animation durations
  SWIPE_ANIMATION_DURATION: 200,
  SPRING_ANIMATION_CONFIG: { 
    type: "spring" as const, 
    stiffness: 400, 
    damping: 30,
    mass: 1
  },
  
  // Visual feedback
  HAPTIC_FEEDBACK_ENABLED: true,
  VISUAL_FEEDBACK_OPACITY: 0.1,
  ACTION_ICON_SIZE: 20,
};

// Gesture types
export type GestureType = 'swipe-left' | 'swipe-right' | 'swipe-up' | 'swipe-down' | 
                         'long-swipe-left' | 'long-swipe-right' | 'pull-down' | 
                         'edge-swipe-left' | 'edge-swipe-right' | 'pinch' | 'double-tap';

export type GestureDirection = 'left' | 'right' | 'up' | 'down';

// Gesture event data
export interface GestureEvent {
  type: GestureType;
  direction: GestureDirection;
  distance: number;
  velocity: number;
  deltaX: number;
  deltaY: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  duration: number;
  target: HTMLElement;
}

// Touch point data
export interface TouchPoint {
  x: number;
  y: number;
  timestamp: number;
}

// Gesture state for tracking
export interface GestureState {
  isGesturing: boolean;
  startPoint: TouchPoint | null;
  currentPoint: TouchPoint | null;
  lastPoint: TouchPoint | null;
  gestureType: GestureType | null;
  progress: number; // 0 to 1
}

/**
 * Calculate distance between two points
 */
export function calculateDistance(point1: TouchPoint, point2: TouchPoint): number {
  const dx = point2.x - point1.x;
  const dy = point2.y - point1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate velocity between two points
 */
export function calculateVelocity(point1: TouchPoint, point2: TouchPoint): number {
  const distance = calculateDistance(point1, point2);
  const time = point2.timestamp - point1.timestamp;
  return time > 0 ? distance / time : 0;
}

/**
 * Determine swipe direction based on delta values
 */
export function getSwipeDirection(deltaX: number, deltaY: number): GestureDirection {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  
  if (absX > absY) {
    return deltaX > 0 ? 'right' : 'left';
  } else {
    return deltaY > 0 ? 'down' : 'up';
  }
}

/**
 * Check if touch started near screen edge
 */
export function isTouchNearEdge(x: number, screenWidth: number): 'left' | 'right' | null {
  if (x <= GESTURE_CONFIG.EDGE_SWIPE_ZONE) {
    return 'left';
  } else if (x >= screenWidth - GESTURE_CONFIG.EDGE_SWIPE_ZONE) {
    return 'right';
  }
  return null;
}

/**
 * Analyze gesture from start and end points
 */
export function analyzeGesture(
  startPoint: TouchPoint, 
  endPoint: TouchPoint, 
  screenWidth?: number
): GestureEvent | null {
  const deltaX = endPoint.x - startPoint.x;
  const deltaY = endPoint.y - startPoint.y;
  const distance = calculateDistance(startPoint, endPoint);
  const duration = endPoint.timestamp - startPoint.timestamp;
  const velocity = calculateVelocity(startPoint, endPoint);
  
  // Basic validation
  if (distance < GESTURE_CONFIG.SWIPE_MIN_DISTANCE || 
      duration > GESTURE_CONFIG.SWIPE_MAX_TIME ||
      velocity < GESTURE_CONFIG.SWIPE_MIN_VELOCITY) {
    return null;
  }
  
  const direction = getSwipeDirection(deltaX, deltaY);
  let gestureType: GestureType;
  
  // Check for edge swipes first
  if (screenWidth) {
    const edgeStart = isTouchNearEdge(startPoint.x, screenWidth);
    if (edgeStart && distance > GESTURE_CONFIG.EDGE_SWIPE_MIN_DISTANCE) {
      if (edgeStart === 'left' && direction === 'right') {
        gestureType = 'edge-swipe-left';
      } else if (edgeStart === 'right' && direction === 'left') {
        gestureType = 'edge-swipe-right';
      } else {
        return null; // Invalid edge swipe
      }
    } else if (direction === 'down' && Math.abs(deltaY) > GESTURE_CONFIG.PULL_MIN_DISTANCE) {
      gestureType = 'pull-down';
    } else if (distance > GESTURE_CONFIG.LONG_SWIPE_DISTANCE && 
               velocity > GESTURE_CONFIG.LONG_SWIPE_MIN_VELOCITY) {
      // Long swipe
      gestureType = direction === 'left' ? 'long-swipe-left' : 
                    direction === 'right' ? 'long-swipe-right' :
                    direction === 'up' ? 'swipe-up' : 'swipe-down';
    } else {
      // Regular swipe
      gestureType = direction === 'left' ? 'swipe-left' : 
                    direction === 'right' ? 'swipe-right' :
                    direction === 'up' ? 'swipe-up' : 'swipe-down';
    }
  } else {
    // Simple directional swipe without edge detection
    gestureType = direction === 'left' ? 'swipe-left' : 
                  direction === 'right' ? 'swipe-right' :
                  direction === 'up' ? 'swipe-up' : 'swipe-down';
  }
  
  return {
    type: gestureType,
    direction,
    distance,
    velocity,
    deltaX,
    deltaY,
    startX: startPoint.x,
    startY: startPoint.y,
    endX: endPoint.x,
    endY: endPoint.y,
    duration,
    target: document.elementFromPoint(startPoint.x, startPoint.y) as HTMLElement,
  };
}

/**
 * Trigger haptic feedback if supported
 */
export function triggerHapticFeedback(type: 'light' | 'medium' | 'heavy' = 'light'): void {
  if (!GESTURE_CONFIG.HAPTIC_FEEDBACK_ENABLED) return;
  
  // Check if haptic feedback is supported
  if ('vibrate' in navigator) {
    const patterns = {
      light: [10],
      medium: [15],
      heavy: [25],
    };
    navigator.vibrate(patterns[type]);
  }
  
  // For iOS Safari, try to trigger haptic feedback via impact
  if ('ontouchstart' in window && (window as any).DeviceMotionEvent) {
    try {
      // This is a workaround for iOS haptic feedback
      const audio = new Audio();
      audio.volume = 0;
      audio.play();
    } catch (e) {
      // Silently fail if audio context isn't available
    }
  }
}

/**
 * Get appropriate action color for gesture type
 */
export function getActionColor(gestureType: GestureType): string {
  switch (gestureType) {
    case 'swipe-left':
    case 'long-swipe-left':
      return 'hsl(var(--chart-1))'; // Blue for archive
    case 'swipe-right':
      return 'hsl(var(--chart-2))'; // Green for read/unread
    case 'long-swipe-right':
      return 'hsl(var(--chart-4))'; // Yellow for star
    case 'pull-down':
      return 'hsl(var(--chart-3))'; // Orange for refresh
    default:
      return 'hsl(var(--muted))';
  }
}

/**
 * Get action icon name for gesture type
 */
export function getActionIcon(gestureType: GestureType): string {
  switch (gestureType) {
    case 'swipe-left':
      return 'Archive';
    case 'long-swipe-left':
      return 'Trash';
    case 'swipe-right':
      return 'Eye';
    case 'long-swipe-right':
      return 'Star';
    case 'pull-down':
      return 'RefreshCw';
    case 'edge-swipe-left':
      return 'Menu';
    case 'edge-swipe-right':
      return 'Edit';
    default:
      return 'Circle';
  }
}

/**
 * Calculate spring animation progress based on distance
 */
export function calculateSpringProgress(
  currentDistance: number, 
  maxDistance: number, 
  damping: number = 0.8
): number {
  const ratio = Math.min(currentDistance / maxDistance, 1);
  // Apply easing for more natural feel
  return 1 - Math.pow(1 - ratio, damping);
}

/**
 * Create smooth easing function for gesture animations
 */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Clamp value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Debounce function for gesture events
 */
export function debounce<T extends (...args: any[]) => void>(
  func: T, 
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Check if device supports touch
 */
export function isTouchDevice(): boolean {
  return (
    'ontouchstart' in window || 
    navigator.maxTouchPoints > 0 ||
    (navigator as any).msMaxTouchPoints > 0
  );
}

/**
 * Get safe area insets for mobile devices
 */
export function getSafeAreaInsets(): { top: number; bottom: number; left: number; right: number } {
  const style = getComputedStyle(document.documentElement);
  return {
    top: parseInt(style.getPropertyValue('--safe-area-inset-top') || '0'),
    bottom: parseInt(style.getPropertyValue('--safe-area-inset-bottom') || '0'),
    left: parseInt(style.getPropertyValue('--safe-area-inset-left') || '0'),
    right: parseInt(style.getPropertyValue('--safe-area-inset-right') || '0'),
  };
}