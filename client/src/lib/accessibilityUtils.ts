/**
 * Accessibility utilities for touch gesture support
 * Ensures all gesture functionality has keyboard and screen reader alternatives
 */

// Accessibility configuration
export const ACCESSIBILITY_CONFIG = {
  REDUCED_MOTION_QUERY: '(prefers-reduced-motion: reduce)',
  SCREEN_READER_ANNOUNCEMENTS: true,
  KEYBOARD_SHORTCUTS_ENABLED: true,
  GESTURE_TIMEOUT: 5000, // Time to show gesture hints
  FOCUS_TIMEOUT: 150, // Focus management delay
};

// Screen reader announcements
export const SCREEN_READER_MESSAGES = {
  SWIPE_LEFT: 'Swipe left to archive email, or press A',
  SWIPE_RIGHT: 'Swipe right to mark as read, or press R', 
  LONG_SWIPE_LEFT: 'Long swipe left to delete, or press Delete key',
  LONG_SWIPE_RIGHT: 'Long swipe right to star, or press S',
  PULL_TO_REFRESH: 'Pull down to refresh emails, or press F5',
  EDGE_SWIPE_LEFT: 'Swipe from left edge to open menu, or press M',
  EDGE_SWIPE_RIGHT: 'Swipe from right edge to compose, or press C',
  EMAIL_NAVIGATION: 'Swipe left/right to navigate emails, or use arrow keys',
  ZOOM_GESTURE: 'Pinch to zoom or double-tap, press Ctrl+Plus to zoom in',
  GESTURE_COMPLETED: (action: string) => `${action} completed`,
  GESTURE_AVAILABLE: (action: string) => `${action} available`,
};

// Keyboard shortcuts mapping
export const KEYBOARD_SHORTCUTS = {
  ARCHIVE: ['a', 'A'],
  READ_TOGGLE: ['r', 'R'],
  STAR_TOGGLE: ['s', 'S'],  
  DELETE: ['Delete', 'd', 'D'],
  COMPOSE: ['c', 'C'],
  REFRESH: ['F5', 'r'],
  PREVIOUS_EMAIL: ['ArrowLeft', 'j', 'J'],
  NEXT_EMAIL: ['ArrowRight', 'k', 'K'],
  CLOSE_EMAIL: ['Escape'],
  ZOOM_IN: ['Equal', 'Plus'],
  ZOOM_OUT: ['Minus'],
  ZOOM_RESET: ['0'],
  SEARCH: ['/', 'f', 'F'],
  MENU: ['m', 'M'],
};

/**
 * Check if user has reduced motion preference
 */
export function hasReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(ACCESSIBILITY_CONFIG.REDUCED_MOTION_QUERY).matches;
}

/**
 * Announce message to screen readers
 */
export function announceToScreenReader(
  message: string, 
  priority: 'polite' | 'assertive' = 'polite'
): void {
  if (!ACCESSIBILITY_CONFIG.SCREEN_READER_ANNOUNCEMENTS) return;

  // Create or get existing aria-live region
  let liveRegion = document.getElementById('gesture-announcements');
  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.id = 'gesture-announcements';
    liveRegion.setAttribute('aria-live', priority);
    liveRegion.setAttribute('aria-atomic', 'true');
    liveRegion.style.position = 'absolute';
    liveRegion.style.left = '-10000px';
    liveRegion.style.width = '1px';
    liveRegion.style.height = '1px';
    liveRegion.style.overflow = 'hidden';
    document.body.appendChild(liveRegion);
  }

  // Clear and set new message
  liveRegion.textContent = '';
  setTimeout(() => {
    liveRegion!.textContent = message;
  }, 100);
}

/**
 * Handle keyboard shortcuts for gesture actions
 */
export function handleKeyboardShortcut(
  event: KeyboardEvent,
  callbacks: {
    onArchive?: () => void;
    onReadToggle?: () => void;
    onStarToggle?: () => void;
    onDelete?: () => void;
    onCompose?: () => void;
    onRefresh?: () => void;
    onPreviousEmail?: () => void;
    onNextEmail?: () => void;
    onCloseEmail?: () => void;
    onZoomIn?: () => void;
    onZoomOut?: () => void;
    onZoomReset?: () => void;
    onSearch?: () => void;
    onMenu?: () => void;
  }
): boolean {
  if (!ACCESSIBILITY_CONFIG.KEYBOARD_SHORTCUTS_ENABLED) return false;

  const key = event.key;
  const hasModifier = event.ctrlKey || event.metaKey || event.altKey;

  // Handle Ctrl/Cmd shortcuts
  if (hasModifier) {
    if ((event.ctrlKey || event.metaKey) && key === '=') {
      event.preventDefault();
      callbacks.onZoomIn?.();
      announceToScreenReader('Zoomed in');
      return true;
    }
    if ((event.ctrlKey || event.metaKey) && key === '-') {
      event.preventDefault();
      callbacks.onZoomOut?.();
      announceToScreenReader('Zoomed out');
      return true;
    }
    if ((event.ctrlKey || event.metaKey) && key === '0') {
      event.preventDefault();
      callbacks.onZoomReset?.();
      announceToScreenReader('Zoom reset to normal');
      return true;
    }
    return false;
  }

  // Handle regular shortcuts
  if (KEYBOARD_SHORTCUTS.ARCHIVE.includes(key)) {
    event.preventDefault();
    callbacks.onArchive?.();
    announceToScreenReader('Email archived');
    return true;
  }

  if (KEYBOARD_SHORTCUTS.READ_TOGGLE.includes(key)) {
    event.preventDefault();
    callbacks.onReadToggle?.();
    announceToScreenReader('Email read status toggled');
    return true;
  }

  if (KEYBOARD_SHORTCUTS.STAR_TOGGLE.includes(key)) {
    event.preventDefault();
    callbacks.onStarToggle?.();
    announceToScreenReader('Email starred status toggled');
    return true;
  }

  if (KEYBOARD_SHORTCUTS.DELETE.includes(key)) {
    event.preventDefault();
    callbacks.onDelete?.();
    announceToScreenReader('Email deleted');
    return true;
  }

  if (KEYBOARD_SHORTCUTS.COMPOSE.includes(key)) {
    event.preventDefault();
    callbacks.onCompose?.();
    announceToScreenReader('Compose dialog opened');
    return true;
  }

  if (KEYBOARD_SHORTCUTS.REFRESH.includes(key) && key === 'F5') {
    event.preventDefault();
    callbacks.onRefresh?.();
    announceToScreenReader('Refreshing emails');
    return true;
  }

  if (KEYBOARD_SHORTCUTS.PREVIOUS_EMAIL.includes(key)) {
    event.preventDefault();
    callbacks.onPreviousEmail?.();
    announceToScreenReader('Previous email');
    return true;
  }

  if (KEYBOARD_SHORTCUTS.NEXT_EMAIL.includes(key)) {
    event.preventDefault();
    callbacks.onNextEmail?.();
    announceToScreenReader('Next email');
    return true;
  }

  if (KEYBOARD_SHORTCUTS.CLOSE_EMAIL.includes(key)) {
    event.preventDefault();
    callbacks.onCloseEmail?.();
    announceToScreenReader('Email viewer closed');
    return true;
  }

  if (KEYBOARD_SHORTCUTS.SEARCH.includes(key)) {
    event.preventDefault();
    callbacks.onSearch?.();
    announceToScreenReader('Search opened');
    return true;
  }

  if (KEYBOARD_SHORTCUTS.MENU.includes(key)) {
    event.preventDefault();
    callbacks.onMenu?.();
    announceToScreenReader('Menu opened');
    return true;
  }

  return false;
}

/**
 * Add gesture hints for accessibility
 */
export function addGestureHints(element: HTMLElement, hints: string[]): void {
  const hintText = hints.join('. ');
  element.setAttribute('aria-description', hintText);
  element.setAttribute('title', hintText);
}

/**
 * Focus management for gesture actions
 */
export function manageFocus(
  targetElement: HTMLElement | null,
  options: {
    delay?: number;
    scroll?: boolean;
    announceContext?: string;
  } = {}
): void {
  const { delay = ACCESSIBILITY_CONFIG.FOCUS_TIMEOUT, scroll = false, announceContext } = options;

  setTimeout(() => {
    if (targetElement && typeof targetElement.focus === 'function') {
      targetElement.focus();
      
      if (scroll && typeof targetElement.scrollIntoView === 'function') {
        targetElement.scrollIntoView({ 
          behavior: hasReducedMotion() ? 'auto' : 'smooth',
          block: 'nearest'
        });
      }

      if (announceContext) {
        announceToScreenReader(announceContext, 'polite');
      }
    }
  }, delay);
}

/**
 * Create accessibility-friendly gesture feedback
 */
export function createAccessibleFeedback(
  action: string,
  success: boolean,
  context?: string
): void {
  const message = success 
    ? `${action} completed successfully${context ? `. ${context}` : ''}`
    : `${action} failed${context ? `. ${context}` : ''}`;
  
  announceToScreenReader(message, success ? 'polite' : 'assertive');
}

/**
 * Enhanced haptic feedback with accessibility considerations
 */
export function enhancedHapticFeedback(
  type: 'success' | 'warning' | 'error' | 'selection' = 'selection',
  options: {
    respectReducedMotion?: boolean;
    announceToScreenReader?: boolean;
    message?: string;
  } = {}
): void {
  const { 
    respectReducedMotion = true, 
    announceToScreenReader: announce = false,
    message 
  } = options;

  // Skip haptic feedback if reduced motion is preferred
  if (respectReducedMotion && hasReducedMotion()) {
    if (announce && message) {
      announceToScreenReader(message);
    }
    return;
  }

  // Trigger haptic feedback if supported
  if ('vibrate' in navigator) {
    const patterns = {
      success: [100, 50, 100],
      warning: [200],
      error: [300, 100, 300],
      selection: [50],
    };
    navigator.vibrate(patterns[type]);
  }

  // Announce to screen reader if requested
  if (announce && message) {
    announceToScreenReader(message);
  }
}

/**
 * Initialize accessibility features for gesture support
 */
export function initializeGestureAccessibility(): void {
  // Add global keyboard event listener
  document.addEventListener('keydown', (event) => {
    // This will be handled by individual components
    // with their specific callback implementations
  });

  // Add reduced motion listener
  if (typeof window !== 'undefined') {
    const mediaQuery = window.matchMedia(ACCESSIBILITY_CONFIG.REDUCED_MOTION_QUERY);
    mediaQuery.addEventListener('change', (e) => {
      document.documentElement.setAttribute(
        'data-reduced-motion', 
        e.matches ? 'reduce' : 'no-preference'
      );
    });
    
    // Set initial state
    document.documentElement.setAttribute(
      'data-reduced-motion', 
      mediaQuery.matches ? 'reduce' : 'no-preference'
    );
  }

  // Create or ensure aria-live region exists
  if (typeof document !== 'undefined') {
    let liveRegion = document.getElementById('gesture-announcements');
    if (!liveRegion) {
      liveRegion = document.createElement('div');
      liveRegion.id = 'gesture-announcements';
      liveRegion.setAttribute('aria-live', 'polite');
      liveRegion.setAttribute('aria-atomic', 'true');
      liveRegion.style.position = 'absolute';
      liveRegion.style.left = '-10000px';
      liveRegion.style.width = '1px';
      liveRegion.style.height = '1px';
      liveRegion.style.overflow = 'hidden';
      document.body.appendChild(liveRegion);
    }
  }
}

/**
 * Get appropriate ARIA labels for gesture actions
 */
export function getGestureAriaLabel(gestureType: string, context?: string): string {
  const labels: Record<string, string> = {
    'swipe-left': 'Swipe left to archive or press A',
    'swipe-right': 'Swipe right to mark as read or press R',
    'long-swipe-left': 'Long swipe left to delete or press Delete',
    'long-swipe-right': 'Long swipe right to star or press S',
    'pull-to-refresh': 'Pull to refresh or press F5',
    'edge-swipe-left': 'Swipe from left edge to open menu or press M',
    'edge-swipe-right': 'Swipe from right edge to compose or press C',
    'double-tap-zoom': 'Double-tap to zoom or use Ctrl+Plus/Minus',
    'pinch-zoom': 'Pinch to zoom or use Ctrl+Plus/Minus',
    'swipe-navigate': 'Swipe to navigate or use arrow keys',
  };

  const baseLabel = labels[gestureType] || 'Touch gesture available';
  return context ? `${baseLabel}. ${context}` : baseLabel;
}