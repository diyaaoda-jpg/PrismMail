import * as React from 'react';

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

  const [keyboardState, setKeyboardState] = React.useState<VirtualKeyboardState>({
    isVisible: false,
    height: 0,
    isSupported: false
  });

  // Check if Visual Viewport API is supported
  const isVisualViewportSupported = typeof window !== 'undefined' && 'visualViewport' in window;

  // Handle focus events to detect keyboard show
  const handleFocusIn = React.useCallback((event: FocusEvent) => {
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
  const handleFocusOut = React.useCallback(() => {
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
  const scrollElementIntoView = React.useCallback((element: HTMLElement) => {
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
  React.useEffect(() => {
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
  React.useEffect(() => {
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

  // Refs to avoid stale closures in focus/blur handlers
  const keyboardStateRef = React.useRef(keyboardState);
  const onHideRef = React.useRef(onHide);
  const scrollActiveElementIntoViewRef = React.useRef(scrollActiveElementIntoView);

  // Update refs when values change
  React.useEffect(() => {
    keyboardStateRef.current = keyboardState;
  }, [keyboardState]);

  React.useEffect(() => {
    onHideRef.current = onHide;
  }, [onHide]);

  React.useEffect(() => {
    scrollActiveElementIntoViewRef.current = scrollActiveElementIntoView;
  }, [scrollActiveElementIntoView]);

  // Set up focus/blur listeners with refs to avoid stale closures
  React.useEffect(() => {
    const handleFocusInEvent = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      const isInputElement = target.tagName === 'INPUT' || 
                            target.tagName === 'TEXTAREA' || 
                            target.contentEditable === 'true';

      if (isInputElement && scrollActiveElementIntoViewRef.current) {
        // On iOS, keyboard show is detected via viewport resize
        // Add a delay to allow keyboard to appear
        setTimeout(() => {
          const scrollToElement = (element: HTMLElement) => {
            if (!element) return;

            // Use refs to get current values and avoid stale closures
            const rect = element.getBoundingClientRect();
            const viewportHeight = window.visualViewport?.height || window.innerHeight;
            const keyboardOffset = keyboardStateRef.current.height || 300; // Current keyboard height
            
            if (rect.bottom > viewportHeight - keyboardOffset) {
              element.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'nearest'
              });
            }
          };
          scrollToElement(target);
        }, 150);
      }
    };

    const handleFocusOutEvent = () => {
      // Delay to avoid false negatives when switching between inputs
      setTimeout(() => {
        const activeElement = document.activeElement as HTMLElement;
        const isInputFocused = activeElement?.tagName === 'INPUT' || 
                             activeElement?.tagName === 'TEXTAREA' ||
                             activeElement?.contentEditable === 'true';
        
        // Use refs to get current values and avoid stale closures
        const currentKeyboardState = keyboardStateRef.current;
        const currentOnHide = onHideRef.current;
        
        if (!isInputFocused && currentKeyboardState.isVisible) {
          setKeyboardState(prev => ({ ...prev, isVisible: false, height: 0 }));
          currentOnHide?.();
        }
      }, 100);
    };

    document.addEventListener('focusin', handleFocusInEvent);
    document.addEventListener('focusout', handleFocusOutEvent);
    
    return () => {
      document.removeEventListener('focusin', handleFocusInEvent);
      document.removeEventListener('focusout', handleFocusOutEvent);
    };
  }, []); // No dependencies needed since handlers use refs

  // Utility methods
  const scrollToElement = React.useCallback((element: HTMLElement) => {
    scrollElementIntoView(element);
  }, [scrollElementIntoView]);

  const adjustForKeyboard = React.useCallback((offset = 20) => {
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