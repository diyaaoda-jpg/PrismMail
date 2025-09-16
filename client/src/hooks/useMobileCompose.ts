import { useState, useCallback, useRef, useEffect } from 'react';
import { useIsMobile } from './use-mobile';
import { useVirtualKeyboard } from './useVirtualKeyboard';
import { useAutoResize } from './useAutoResize';

interface MobileComposeOptions {
  isOpen?: boolean; // Whether compose dialog is open
  onSend?: () => void;
  onClose?: () => void;
  onSaveDraft?: () => void;
  enableSwipeGestures?: boolean;
  enableHapticFeedback?: boolean;
  keyboardAdjustment?: boolean;
}

interface SwipeGesture {
  startY: number;
  startX: number;
  currentY: number;
  currentX: number;
  isDragging: boolean;
  threshold: number;
}

/**
 * Hook for mobile-specific compose functionality
 * Handles mobile UX patterns, gestures, and optimizations
 */
export function useMobileCompose(options: MobileComposeOptions = {}) {
  const {
    isOpen = false,
    onSend,
    onClose,
    onSaveDraft,
    enableSwipeGestures = true,
    enableHapticFeedback = true,
    keyboardAdjustment = true
  } = options;

  const isMobile = useIsMobile();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [maxBodyHeight, setMaxBodyHeight] = useState(() => window.innerHeight * 0.4);
  const composeRef = useRef<HTMLDivElement>(null);
  const subjectRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Swipe gesture state
  const [swipeGesture, setSwipeGesture] = useState<SwipeGesture>({
    startY: 0,
    startX: 0,
    currentY: 0,
    currentX: 0,
    isDragging: false,
    threshold: 50
  });

  // Virtual keyboard handling
  const keyboard = useVirtualKeyboard({
    onShow: (height) => {
      if (keyboardAdjustment) {
        setKeyboardOffset(height);
      }
    },
    onHide: () => {
      setKeyboardOffset(0);
    },
    adjustViewport: keyboardAdjustment,
    scrollActiveElementIntoView: true
  });

  // Auto-resize for subject and body
  const { triggerResize: triggerSubjectResize } = useAutoResize(subjectRef, {
    minHeight: 44, // Mobile touch target minimum
    maxHeight: 120,
    enabled: true
  });

  // Note: bodyRef not used for auto-resize since TipTap EditorContent handles its own sizing
  // TipTap editors manage content height through CSS and internal content management

  // Handle mobile fullscreen mode and body scroll lock
  useEffect(() => {
    if (isMobile && isOpen) {
      setIsFullscreen(true);
      // Prevent body scroll on mobile when compose is open
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      
      return () => {
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.width = '';
      };
    } else if (isMobile && !isOpen) {
      // Ensure body scroll is restored when compose is closed
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      setIsFullscreen(false);
    }
  }, [isMobile, isOpen]);

  // Haptic feedback helper
  const triggerHaptic = useCallback((type: 'light' | 'medium' | 'heavy' | 'success' | 'error' = 'light') => {
    if (!enableHapticFeedback || typeof navigator === 'undefined') return;
    
    // Use Vibration API as fallback
    if ('vibrate' in navigator) {
      const patterns = {
        light: [10],
        medium: [20],
        heavy: [30],
        success: [10, 50, 10],
        error: [20, 100, 20]
      };
      navigator.vibrate(patterns[type]);
    }
  }, [enableHapticFeedback]);

  // Set up swipe gesture listeners with stable handlers
  useEffect(() => {
    if (!enableSwipeGestures || !isMobile) return;
    
    const element = composeRef.current;
    if (!element) return;

    // Define handlers inside effect to avoid recreating on every render
    const handleTouchStart = (e: TouchEvent) => {
      if (!enableSwipeGestures || !isMobile) return;
      
      const touch = e.touches[0];
      setSwipeGesture(prev => ({
        ...prev,
        startY: touch.clientY,
        startX: touch.clientX,
        currentY: touch.clientY,
        currentX: touch.clientX,
        isDragging: true
      }));
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!enableSwipeGestures) return;
      
      const touch = e.touches[0];
      setSwipeGesture(prev => {
        if (!prev.isDragging) return prev;
        
        // Prevent default scrolling if swiping down from top
        const deltaY = touch.clientY - prev.startY;
        if (deltaY > 0 && window.scrollY <= 0) {
          e.preventDefault();
        }

        return {
          ...prev,
          currentY: touch.clientY,
          currentX: touch.clientX
        };
      });
    };

    const handleTouchEnd = () => {
      if (!enableSwipeGestures) return;
      
      setSwipeGesture(prev => {
        if (!prev.isDragging) return prev;
        
        const deltaY = prev.currentY - prev.startY;
        const deltaX = Math.abs(prev.currentX - prev.startX);
        
        // Swipe down to close (if primarily vertical swipe)
        if (deltaY > prev.threshold && deltaX < prev.threshold * 2) {
          // Trigger haptic feedback
          if (enableHapticFeedback && 'vibrate' in navigator) {
            navigator.vibrate([20]);
          }
          onClose?.(); // Safe - ComposeDialog handles confirmation
        }
        
        return { ...prev, isDragging: false };
      });
    };

    element.addEventListener('touchstart', handleTouchStart, { passive: false });
    element.addEventListener('touchmove', handleTouchMove, { passive: false });
    element.addEventListener('touchend', handleTouchEnd);
    
    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [enableSwipeGestures, isMobile, enableHapticFeedback, onClose]); // Stable dependencies only

  // Mobile-optimized send handler
  const handleMobileSend = useCallback(() => {
    triggerHaptic('success');
    onSend?.();
  }, [triggerHaptic, onSend]);

  // Handle orientation changes to update maxHeight
  useEffect(() => {
    const handleResize = () => {
      setMaxBodyHeight(window.innerHeight * 0.4);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  // Mobile-optimized close handler - does NOT call onClose to prevent recursion
  const handleMobileClose = useCallback(() => {
    triggerHaptic('light');
    // Do NOT call onClose here to prevent infinite recursion
    // The calling component should handle close logic directly
  }, [triggerHaptic]);

  // Mobile-optimized save draft
  const handleMobileSaveDraft = useCallback(() => {
    triggerHaptic('medium');
    onSaveDraft?.();
  }, [triggerHaptic, onSaveDraft]);

  // Focus management for mobile
  const focusNextField = useCallback((currentField: 'to' | 'subject' | 'body') => {
    const fieldOrder = ['to', 'subject', 'body'];
    const currentIndex = fieldOrder.indexOf(currentField);
    const nextField = fieldOrder[currentIndex + 1];
    
    if (nextField === 'subject' && subjectRef.current) {
      subjectRef.current.focus();
    } else if (nextField === 'body' && bodyRef.current) {
      bodyRef.current.focus();
    }
  }, []);

  // Get mobile-optimized styles
  const getMobileStyles = useCallback(() => {
    if (!isMobile) return {};
    
    return {
      // Main compose container
      compose: {
        height: '100vh',
        width: '100vw',
        paddingBottom: keyboardOffset ? `${keyboardOffset}px` : '0px',
        transition: 'padding-bottom 0.2s ease-in-out'
      },
      // Input fields
      input: {
        fontSize: '16px', // Prevent zoom on iOS
        minHeight: '44px', // Touch target minimum
        padding: '12px 16px',
      },
      // Subject field
      subject: {
        fontSize: '16px',
        minHeight: '44px',
        padding: '12px 16px',
        resize: 'none' as const,
      },
      // Body field
      body: {
        fontSize: '16px',
        minHeight: '200px',
        padding: '16px',
        resize: 'none' as const,
      },
      // Send button
      sendButton: {
        minHeight: '48px',
        fontSize: '16px',
        fontWeight: '600',
        padding: '12px 24px',
      }
    };
  }, [isMobile, keyboardOffset]);

  // Mobile-specific input props
  const getMobileInputProps = useCallback((type: 'email' | 'text' = 'text') => {
    if (!isMobile) return {};
    
    const baseProps = {
      style: getMobileStyles().input,
      autoCapitalize: 'none' as const,
      autoComplete: 'off',
      autoCorrect: 'off',
      spellCheck: false,
    };
    
    if (type === 'email') {
      return {
        ...baseProps,
        type: 'email',
        inputMode: 'email' as const,
        autoCapitalize: 'none' as const,
      };
    }
    
    return baseProps;
  }, [isMobile, getMobileStyles]);

  return {
    // State
    isMobile,
    isFullscreen,
    keyboard,
    keyboardOffset,
    
    // Refs
    composeRef,
    subjectRef,
    bodyRef,
    
    // Resize functions
    triggerSubjectResize,
    // Note: triggerBodyResize removed - TipTap editor handles its own content sizing
    
    // Handlers
    handleMobileSend,
    handleMobileClose,
    handleMobileSaveDraft,
    focusNextField,
    triggerHaptic,
    
    // Styles and props
    getMobileStyles,
    getMobileInputProps,
    
    // Swipe state
    swipeGesture
  };
}