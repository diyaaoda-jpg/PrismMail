import { useState, useEffect, useCallback } from 'react';

interface VirtualKeyboardState {
  isVisible: boolean;
  height: number;
  isSupported: boolean;
}

interface UseVirtualKeyboardOptions {
  onShow?: (height: number) => void;
  onHide?: () => void;
  adjustViewport?: boolean;
  scrollActiveElementIntoView?: boolean;
}

/**
 * Hook for detecting and handling virtual keyboard on mobile devices
 * Provides keyboard state and automatic viewport adjustments
 */
export function useVirtualKeyboard(options: UseVirtualKeyboardOptions = {}) {
  const {
    onShow,
    onHide,
    adjustViewport = true,
    scrollActiveElementIntoView = true
  } = options;

  const [keyboardState, setKeyboardState] = useState<VirtualKeyboardState>({
    isVisible: false,
    height: 0,
    isSupported: false
  });

  // Check if Visual Viewport API is supported
  const isVisualViewportSupported = typeof window !== 'undefined' && 'visualViewport' in window;

  // Handle focus events to detect keyboard show
  const handleFocusIn = useCallback((event: FocusEvent) => {
    const target = event.target as HTMLElement;
    const isInputElement = target.tagName === 'INPUT' || 
                          target.tagName === 'TEXTAREA' || 
                          target.contentEditable === 'true';

    if (isInputElement) {
      // On iOS, keyboard show is detected via viewport resize
      // Add a delay to allow keyboard to appear
      setTimeout(() => {
        if (scrollActiveElementIntoView) {
          scrollElementIntoView(target);
        }
      }, 150);
    }
  }, [scrollActiveElementIntoView]);

  // Handle blur events to detect keyboard hide
  const handleFocusOut = useCallback(() => {
    // Delay to avoid false negatives when switching between inputs
    setTimeout(() => {
      const activeElement = document.activeElement as HTMLElement;
      const isInputFocused = activeElement?.tagName === 'INPUT' || 
                           activeElement?.tagName === 'TEXTAREA' ||
                           activeElement?.contentEditable === 'true';
      
      if (!isInputFocused && keyboardState.isVisible) {
        setKeyboardState(prev => ({ ...prev, isVisible: false, height: 0 }));
        onHide?.();
      }
    }, 100);
  }, [keyboardState.isVisible, onHide]);

  // Scroll element into view with keyboard accommodation
  const scrollElementIntoView = useCallback((element: HTMLElement) => {
    if (!element) return;

    // Use smooth scrolling with offset for keyboard
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const keyboardOffset = keyboardState.height || 300; // Estimated keyboard height
    
    if (rect.bottom > viewportHeight - keyboardOffset) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      });
    }
  }, [keyboardState.height]);

  // Visual Viewport API handling (modern browsers)
  useEffect(() => {
    if (!isVisualViewportSupported) return;

    const visualViewport = window.visualViewport!;
    
    const handleViewportChange = () => {
      const windowHeight = window.innerHeight;
      const viewportHeight = visualViewport.height;
      const keyboardHeight = windowHeight - viewportHeight;
      
      const isKeyboardVisible = keyboardHeight > 150; // Threshold for keyboard detection
      
      setKeyboardState(prev => {
        const newState = {
          isVisible: isKeyboardVisible,
          height: isKeyboardVisible ? keyboardHeight : 0,
          isSupported: true
        };
        
        // Trigger callbacks if state changed
        if (newState.isVisible && !prev.isVisible) {
          onShow?.(newState.height);
        } else if (!newState.isVisible && prev.isVisible) {
          onHide?.();
        }
        
        return newState;
      });

      // Apply viewport adjustments
      if (adjustViewport) {
        document.documentElement.style.setProperty(
          '--keyboard-height', 
          `${isKeyboardVisible ? keyboardHeight : 0}px`
        );
        
        // Add/remove class for CSS-based adjustments
        document.documentElement.classList.toggle('keyboard-visible', isKeyboardVisible);
      }
    };

    visualViewport.addEventListener('resize', handleViewportChange);
    
    return () => {
      visualViewport.removeEventListener('resize', handleViewportChange);
      if (adjustViewport) {
        document.documentElement.style.removeProperty('--keyboard-height');
        document.documentElement.classList.remove('keyboard-visible');
      }
    };
  }, [isVisualViewportSupported, onShow, onHide, adjustViewport]);

  // Fallback for older browsers using window resize
  useEffect(() => {
    if (isVisualViewportSupported) return; // Use Visual Viewport API if available

    let initialHeight = window.innerHeight;
    
    const handleWindowResize = () => {
      const currentHeight = window.innerHeight;
      const heightDifference = initialHeight - currentHeight;
      
      // Only consider significant height changes as keyboard events
      const isKeyboardVisible = heightDifference > 150;
      const keyboardHeight = isKeyboardVisible ? heightDifference : 0;
      
      setKeyboardState(prev => {
        const newState = {
          isVisible: isKeyboardVisible,
          height: keyboardHeight,
          isSupported: false // Fallback method
        };
        
        // Trigger callbacks if state changed
        if (newState.isVisible && !prev.isVisible) {
          onShow?.(newState.height);
        } else if (!newState.isVisible && prev.isVisible) {
          onHide?.();
        }
        
        return newState;
      });

      // Apply viewport adjustments
      if (adjustViewport) {
        document.documentElement.style.setProperty(
          '--keyboard-height', 
          `${keyboardHeight}px`
        );
        document.documentElement.classList.toggle('keyboard-visible', isKeyboardVisible);
      }
    };

    // Debounce resize events
    const debouncedResize = debounce(handleWindowResize, 100);
    
    window.addEventListener('resize', debouncedResize);
    
    return () => {
      window.removeEventListener('resize', debouncedResize);
      if (adjustViewport) {
        document.documentElement.style.removeProperty('--keyboard-height');
        document.documentElement.classList.remove('keyboard-visible');
      }
    };
  }, [isVisualViewportSupported, onShow, onHide, adjustViewport]);

  // Set up focus/blur listeners
  useEffect(() => {
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, [handleFocusIn, handleFocusOut]);

  // Utility methods
  const scrollToElement = useCallback((element: HTMLElement) => {
    scrollElementIntoView(element);
  }, [scrollElementIntoView]);

  const adjustForKeyboard = useCallback((offset = 20) => {
    if (keyboardState.isVisible) {
      window.scrollBy({
        top: offset,
        behavior: 'smooth'
      });
    }
  }, [keyboardState.isVisible]);

  return {
    ...keyboardState,
    scrollToElement,
    adjustForKeyboard
  };
}

// Simple debounce utility
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}