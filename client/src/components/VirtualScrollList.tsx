import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';

interface VirtualScrollListProps<T> {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  overscan?: number;
  className?: string;
  onScroll?: (scrollTop: number) => void;
  itemKey?: (item: T, index: number) => string | number;
}

export function VirtualScrollList<T>({
  items,
  itemHeight,
  containerHeight,
  renderItem,
  overscan = 5,
  className,
  onScroll,
  itemKey = (_, index) => index,
}: VirtualScrollListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const scrollElementRef = useRef<HTMLDivElement>(null);

  // Calculate visible range with overscan for smooth scrolling - Optimized to prevent excessive re-calculations
  const visibleRange = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const end = Math.min(items.length, start + visibleCount + overscan * 2);
    
    return { start, end };
  }, [Math.floor(scrollTop / itemHeight), containerHeight, items.length, overscan]); // Reduce sensitivity to scrollTop changes

  // Get visible items efficiently - Memoize more aggressively to prevent unnecessary re-renders
  const visibleItems = useMemo(() => {
    if (visibleRange.start >= items.length) return [];
    
    const slicedItems = items.slice(visibleRange.start, visibleRange.end);
    return slicedItems.map((item, index) => ({
      item,
      index: visibleRange.start + index,
      key: itemKey(item, visibleRange.start + index),
    }));
  }, [items, visibleRange.start, visibleRange.end, itemKey]);

  // Total height of the virtual list
  const totalHeight = items.length * itemHeight;

  // Handle scroll events with throttling for performance - Add RAF throttling to prevent excessive renders
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const newScrollTop = e.currentTarget.scrollTop;
    
    // Throttle scroll updates using requestAnimationFrame
    if (!window.requestIdleCallback) {
      requestAnimationFrame(() => {
        setScrollTop(newScrollTop);
        onScroll?.(newScrollTop);
      });
    } else {
      window.requestIdleCallback(() => {
        setScrollTop(newScrollTop);
        onScroll?.(newScrollTop);
      });
    }
  }, [onScroll]);

  // Scroll to specific item (for navigation)
  const scrollToItem = useCallback((index: number, behavior: ScrollBehavior = 'smooth') => {
    if (scrollElementRef.current) {
      const targetScrollTop = Math.max(0, index * itemHeight);
      scrollElementRef.current.scrollTo({
        top: targetScrollTop,
        behavior
      });
    }
  }, [itemHeight]);

  // Expose scroll methods
  useEffect(() => {
    if (scrollElementRef.current) {
      (scrollElementRef.current as any).scrollToItem = scrollToItem;
    }
  }, [scrollToItem]);

  return (
    <div
      ref={scrollElementRef}
      className={cn("overflow-auto", className)}
      style={{ height: containerHeight }}
      onScroll={handleScroll}
      data-testid="virtual-scroll-container"
    >
      {/* Virtual spacer for scroll position */}
      <div style={{ height: totalHeight, position: 'relative' }}>
        {/* Visible items container */}
        <div
          style={{
            transform: `translateY(${visibleRange.start * itemHeight}px)`,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
          }}
        >
          {visibleItems.map(({ item, index, key }) => (
            <div
              key={key}
              style={{ height: itemHeight }}
              data-testid={`virtual-item-${index}`}
            >
              {renderItem(item, index)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Hook for managing virtual scroll list state
export function useVirtualScrollList<T>(
  items: T[],
  containerRef: React.RefObject<HTMLElement>,
  itemHeight: number = 60
) {
  const [containerHeight, setContainerHeight] = useState(400);
  
  // Observe container size changes for responsive design
  useEffect(() => {
    if (!containerRef.current) return;
    
    const resizeObserver = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    
    resizeObserver.observe(containerRef.current);
    
    // Set initial height
    setContainerHeight(containerRef.current.clientHeight);
    
    return () => resizeObserver.disconnect();
  }, [containerRef]);
  
  return {
    containerHeight,
    visibleCount: Math.ceil(containerHeight / itemHeight)
  };
}