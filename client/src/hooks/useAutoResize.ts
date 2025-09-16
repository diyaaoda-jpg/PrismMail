import { useEffect, useCallback, RefObject } from 'react';

interface UseAutoResizeOptions {
  minHeight?: number;
  maxHeight?: number;
  enabled?: boolean;
  debounceMs?: number;
}

/**
 * Hook for auto-resizing textarea elements based on content
 * Provides smooth, performant auto-resize functionality for mobile and desktop
 */
export function useAutoResize(
  textareaRef: RefObject<HTMLTextAreaElement>,
  options: UseAutoResizeOptions = {}
) {
  const {
    minHeight = 120,
    maxHeight = 400,
    enabled = true,
    debounceMs = 50
  } = options;

  const adjustHeight = useCallback((textarea: HTMLTextAreaElement) => {
    if (!enabled) return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';
    
    // Get the content height
    const scrollHeight = textarea.scrollHeight;
    
    // Calculate new height within bounds
    const newHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
    
    // Apply the new height
    textarea.style.height = `${newHeight}px`;
    
    // Handle overflow for max height case
    if (scrollHeight > maxHeight) {
      textarea.style.overflowY = 'auto';
    } else {
      textarea.style.overflowY = 'hidden';
    }
  }, [enabled, minHeight, maxHeight]);

  // Debounced resize function
  const debouncedResize = useCallback(
    debounce((textarea: HTMLTextAreaElement) => adjustHeight(textarea), debounceMs),
    [adjustHeight, debounceMs]
  );

  // Set up resize observer for content changes with stable dependencies
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !enabled) return;

    // Initial setup
    textarea.style.resize = 'none';
    textarea.style.boxSizing = 'border-box';
    
    // Use current adjustHeight function avoiding stale closure
    const initialAdjust = () => {
      if (!enabled) return;
      textarea.style.height = 'auto';
      const scrollHeight = textarea.scrollHeight;
      const newHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
      textarea.style.height = `${newHeight}px`;
      textarea.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
    };
    initialAdjust();

    // Handle input events with debouncing
    let debounceTimer: NodeJS.Timeout;
    const handleInput = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        initialAdjust(); // Use local function to avoid stale closure
      }, debounceMs);
    };
    
    // Handle paste events (may change content significantly)
    const handlePaste = () => {
      // Use setTimeout to let paste complete first
      setTimeout(initialAdjust, 0);
    };

    // Handle window resize (orientation change on mobile)
    const handleResize = () => {
      // Recalculate on window resize
      setTimeout(initialAdjust, 100);
    };

    textarea.addEventListener('input', handleInput);
    textarea.addEventListener('paste', handlePaste);
    window.addEventListener('resize', handleResize);

    return () => {
      clearTimeout(debounceTimer);
      textarea.removeEventListener('input', handleInput);
      textarea.removeEventListener('paste', handlePaste);
      window.removeEventListener('resize', handleResize);
    };
  }, [textareaRef, enabled, minHeight, maxHeight, debounceMs]); // Only stable dependencies

  // Return resize function for manual triggering
  const triggerResize = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      adjustHeight(textarea);
    }
  }, [textareaRef, adjustHeight]);

  return { triggerResize };
}

// Utility debounce function
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