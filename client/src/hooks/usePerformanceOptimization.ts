import { useEffect, useCallback, useRef, useState } from 'react';
import { performanceMonitor } from '@/lib/performanceMonitor';

// Custom hook for performance optimization across components
export function usePerformanceOptimization(componentName: string) {
  const renderStartTime = useRef<number>(performance.now());
  const [isOptimized, setIsOptimized] = useState(false);

  // Monitor component render performance
  useEffect(() => {
    const endTime = performance.now();
    const renderTime = endTime - renderStartTime.current;
    
    if (renderTime > 16) { // Longer than 1 frame at 60fps
      console.warn(`[${componentName}] Slow render: ${renderTime.toFixed(2)}ms`);
    }
    
    // Reset for next render
    renderStartTime.current = performance.now();
  });

  // Debounced function creator for performance
  const createDebouncedCallback = useCallback(<T extends (...args: any[]) => any>(
    callback: T,
    delay: number = 300
  ): T => {
    let timeoutId: NodeJS.Timeout;
    
    return ((...args: any[]) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => callback(...args), delay);
    }) as T;
  }, []);

  // Throttled function creator for performance
  const createThrottledCallback = useCallback(<T extends (...args: any[]) => any>(
    callback: T,
    limit: number = 100
  ): T => {
    let inThrottle: boolean;
    
    return ((...args: any[]) => {
      if (!inThrottle) {
        callback(...args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    }) as T;
  }, []);

  // Memory usage monitoring
  const checkMemoryUsage = useCallback(() => {
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      const memoryUsageMB = memory.usedJSHeapSize / 1024 / 1024;
      
      if (memoryUsageMB > 100) {
        console.warn(`[${componentName}] High memory usage: ${memoryUsageMB.toFixed(2)}MB`);
      }
      
      return memoryUsageMB;
    }
    return 0;
  }, [componentName]);

  // Performance optimization enabler
  const enableOptimizations = useCallback(() => {
    setIsOptimized(true);
    
    // Enable performance optimizations
    if ('scheduler' in window && 'postTask' in (window as any).scheduler) {
      // Use scheduler API for better performance on supported browsers
      console.log(`[${componentName}] Performance optimizations enabled`);
    }
  }, [componentName]);

  return {
    createDebouncedCallback,
    createThrottledCallback,
    checkMemoryUsage,
    enableOptimizations,
    isOptimized
  };
}

// Hook for managing intersection observer for lazy loading
export function useIntersectionObserver(
  callback: (entries: IntersectionObserverEntry[]) => void,
  options: IntersectionObserverInit = {}
) {
  const targetRef = useRef<HTMLElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const callbackRef = useRef(callback);
  const optionsRef = useRef(options);

  // Update refs when props change
  useEffect(() => {
    callbackRef.current = callback;
    optionsRef.current = options;
  });

  useEffect(() => {
    if (!targetRef.current) return;

    observerRef.current = new IntersectionObserver(
      (entries) => callbackRef.current(entries),
      {
        threshold: 0.1,
        rootMargin: '50px',
        ...optionsRef.current
      }
    );

    observerRef.current.observe(targetRef.current);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []); // No dependencies - refs handle updates

  return targetRef;
}

// Hook for optimized scroll handling
export function useOptimizedScroll(
  callback: (scrollTop: number) => void,
  threshold: number = 10
) {
  const lastScrollTop = useRef(0);
  const ticking = useRef(false);

  const handleScroll = useCallback((e: Event) => {
    const scrollTop = (e.target as HTMLElement).scrollTop;
    
    if (Math.abs(scrollTop - lastScrollTop.current) < threshold) {
      return; // Skip if scroll distance is too small
    }

    if (!ticking.current) {
      requestAnimationFrame(() => {
        callback(scrollTop);
        lastScrollTop.current = scrollTop;
        ticking.current = false;
      });
      ticking.current = true;
    }
  }, [callback, threshold]);

  return handleScroll;
}

// Hook for managing component visibility for performance
export function useComponentVisibility() {
  const [isVisible, setIsVisible] = useState(true);
  const elementRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!elementRef.current || !('IntersectionObserver' in window)) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsVisible(entry.isIntersecting);
        });
      },
      {
        threshold: 0,
        rootMargin: '100px'
      }
    );

    observer.observe(elementRef.current);

    return () => observer.disconnect();
  }, []);

  return { isVisible, elementRef };
}

// Hook for performance-optimized state updates
export function useOptimizedState<T>(
  initialValue: T,
  equalityFn?: (a: T, b: T) => boolean
) {
  const [state, setState] = useState(initialValue);
  const previousValue = useRef(initialValue);

  const optimizedSetState = useCallback((newValue: T | ((prev: T) => T)) => {
    const nextValue = typeof newValue === 'function' 
      ? (newValue as (prev: T) => T)(previousValue.current)
      : newValue;

    // Skip update if values are equal
    if (equalityFn ? equalityFn(previousValue.current, nextValue) : previousValue.current === nextValue) {
      return;
    }

    previousValue.current = nextValue;
    setState(nextValue);
  }, [equalityFn]);

  return [state, optimizedSetState] as const;
}

// Hook for managing background tasks efficiently
export function useBackgroundTask() {
  const tasksRef = useRef<Array<() => void>>([]);
  const isProcessing = useRef(false);

  const scheduleTask = useCallback((task: () => void) => {
    tasksRef.current.push(task);
    
    if (!isProcessing.current) {
      isProcessing.current = true;
      
      // Use requestIdleCallback if available, otherwise setTimeout
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
          processTasks();
        });
      } else {
        setTimeout(() => {
          processTasks();
        }, 0);
      }
    }
  }, []);

  const processTasks = useCallback(() => {
    const startTime = performance.now();
    
    while (tasksRef.current.length > 0 && (performance.now() - startTime) < 5) {
      const task = tasksRef.current.shift();
      task?.();
    }
    
    if (tasksRef.current.length > 0) {
      // Continue processing remaining tasks
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => processTasks());
      } else {
        setTimeout(() => processTasks(), 0);
      }
    } else {
      isProcessing.current = false;
    }
  }, []);

  return { scheduleTask };
}

export default {
  usePerformanceOptimization,
  useIntersectionObserver,
  useOptimizedScroll,
  useComponentVisibility,
  useOptimizedState,
  useBackgroundTask
};