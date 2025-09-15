import * as React from 'react';
import { VirtualScrollList, useVirtualScrollList } from './VirtualScrollList';
import { EmailListItem, type EmailMessage } from './EmailListItem';
import { performanceMonitor } from '@/lib/performanceMonitor';
import { cn } from '@/lib/utils';

interface OptimizedEmailListProps {
  emails: EmailMessage[];
  selectedEmail?: EmailMessage | null;
  onEmailSelect?: (email: EmailMessage) => void;
  onToggleRead?: (id: string) => void;
  onToggleFlagged?: (id: string) => void;
  onArchive?: (id: string) => void;
  onDelete?: (id: string) => void;
  onToggleStar?: (id: string) => void;
  searchQuery?: string;
  className?: string;
  enableSwipeGestures?: boolean;
  isLoading?: boolean;
}

// Memoized email item component for virtual scrolling performance
const MemoizedEmailItem = memo(function MemoizedEmailItem({
  email,
  isSelected,
  onSelect,
  onToggleRead,
  onToggleFlagged,
  onArchive,
  onDelete,
  onToggleStar,
  enableSwipeGestures
}: {
  email: EmailMessage;
  isSelected: boolean;
  onSelect: () => void;
  onToggleRead: (id: string) => void;
  onToggleFlagged: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleStar: (id: string) => void;
  enableSwipeGestures: boolean;
}) {
  return (
    <div className="email-list-item">
      <EmailListItem
        email={email}
        isSelected={isSelected}
        onClick={onSelect}
        onToggleRead={onToggleRead}
        onToggleFlagged={onToggleFlagged}
        onArchive={onArchive}
        onDelete={onDelete}
        onToggleStar={onToggleStar}
        enableSwipeGestures={enableSwipeGestures}
      />
    </div>
  );
});

// Skeleton loading component for better perceived performance - LAYOUT SHIFT FIX: Fixed dimensions
const EmailListSkeleton = memo(function EmailListSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="space-y-1 p-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="animate-pulse" style={{ height: '80px' }}> {/* Fixed height to match email items */}
          <div className="flex items-center space-x-3 p-4 border rounded-lg h-full"> {/* h-full to match container */}
            <div className="h-8 w-8 bg-muted rounded-full flex-shrink-0"></div> {/* flex-shrink-0 to prevent size changes */}
            <div className="flex-1 space-y-2 min-w-0"> {/* min-w-0 to prevent overflow */}
              <div className="h-4 bg-muted rounded" style={{ width: '75%' }}></div> {/* Fixed percentage widths */}
              <div className="h-3 bg-muted rounded" style={{ width: '50%' }}></div>
            </div>
            <div className="h-3 bg-muted rounded flex-shrink-0" style={{ width: '48px' }}></div> {/* Fixed width */}
          </div>
        </div>
      ))}
    </div>
  );
});

export const OptimizedEmailList = memo(function OptimizedEmailList({
  emails,
  selectedEmail,
  onEmailSelect,
  onToggleRead,
  onToggleFlagged,
  onArchive,
  onDelete,
  onToggleStar,
  searchQuery,
  className,
  enableSwipeGestures = true,
  isLoading = false
}: OptimizedEmailListProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [itemHeight] = React.useState(80); // Fixed height for consistent performance
  
  // Use virtual scrolling hook for container size management
  const { containerHeight } = useVirtualScrollList(emails, containerRef, itemHeight);

  // Memoized email filtering for performance - CRITICAL FIX: Remove performance monitor to prevent render loop
  const filteredEmails = React.useMemo(() => {
    if (!searchQuery) return emails;
    
    const query = searchQuery.toLowerCase();
    return emails.filter(email => 
      email.from.toLowerCase().includes(query) ||
      email.subject.toLowerCase().includes(query) ||
      email.snippet.toLowerCase().includes(query)
    );
  }, [emails, searchQuery]);

  // Memoized handlers for performance
  const handleEmailSelect = React.useCallback((email: EmailMessage) => {
    onEmailSelect?.(email);
  }, [onEmailSelect]);

  const handleToggleRead = React.useCallback((id: string) => {
    onToggleRead?.(id);
  }, [onToggleRead]);

  const handleToggleFlagged = React.useCallback((id: string) => {
    onToggleFlagged?.(id);
  }, [onToggleFlagged]);

  const handleArchive = React.useCallback((id: string) => {
    onArchive?.(id);
  }, [onArchive]);

  const handleDelete = React.useCallback((id: string) => {
    onDelete?.(id);
  }, [onDelete]);

  const handleToggleStar = React.useCallback((id: string) => {
    onToggleStar?.(id);
  }, [onToggleStar]);

  // Performance monitoring effect - Stable to prevent excessive re-runs
  React.useEffect(() => {
    let timeoutId: number;
    
    // Use setTimeout to measure after React's reconciliation is complete
    const startTime = performance.now();
    const emailCount = filteredEmails.length; // Capture count to avoid closure issues
    
    timeoutId = setTimeout(() => {
      const endTime = performance.now();
      const renderTime = endTime - startTime;
      
      if (renderTime > 16) { // Longer than 1 frame at 60fps
        console.warn(`[EmailList] Slow render detected: ${renderTime.toFixed(2)}ms for ${emailCount} emails`);
      } else {
        console.log(`[EmailList] Render completed: ${renderTime.toFixed(2)}ms for ${emailCount} emails`);
      }
    }, 0);
    
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [emails.length, searchQuery]); // More stable dependencies

  // Show loading skeleton
  if (isLoading) {
    return (
      <div className={cn("h-full", className)}>
        <EmailListSkeleton />
      </div>
    );
  }

  // Show empty state
  if (filteredEmails.length === 0) {
    return (
      <div className={cn("h-full flex items-center justify-center", className)}>
        <div className="text-center space-y-2">
          <div className="text-lg font-medium text-muted-foreground">
            {searchQuery ? 'No matching emails' : 'No emails found'}
          </div>
          <div className="text-sm text-muted-foreground">
            {searchQuery 
              ? 'Try adjusting your search terms' 
              : 'Your mailbox is empty'
            }
          </div>
        </div>
      </div>
    );
  }

  // Use virtual scrolling for large email lists (>50 emails for mobile performance)
  const useVirtualScrolling = filteredEmails.length > 50;

  if (useVirtualScrolling) {
    return (
      <div ref={containerRef} className={cn("h-full", className)}>
        <VirtualScrollList
          items={filteredEmails}
          itemHeight={itemHeight}
          containerHeight={containerHeight}
          renderItem={(email, index) => (
            <MemoizedEmailItem
              key={email.id}
              email={email}
              isSelected={selectedEmail?.id === email.id}
              onSelect={() => handleEmailSelect(email)}
              onToggleRead={handleToggleRead}
              onToggleFlagged={handleToggleFlagged}
              onArchive={handleArchive}
              onDelete={handleDelete}
              onToggleStar={handleToggleStar}
              enableSwipeGestures={enableSwipeGestures}
            />
          )}
          itemKey={(email) => email.id}
          className="virtual-scroll-container scroll-smooth-gpu"
          overscan={5} // Render 5 extra items for smooth scrolling
        />
      </div>
    );
  }

  // Regular rendering for smaller lists
  return (
    <div className={cn("h-full overflow-auto scroll-smooth-gpu", className)}>
      <div className="space-y-1 p-4">
        {filteredEmails.map((email) => (
          <MemoizedEmailItem
            key={email.id}
            email={email}
            isSelected={selectedEmail?.id === email.id}
            onSelect={() => handleEmailSelect(email)}
            onToggleRead={handleToggleRead}
            onToggleFlagged={handleToggleFlagged}
            onArchive={handleArchive}
            onDelete={handleDelete}
            onToggleStar={handleToggleStar}
            enableSwipeGestures={enableSwipeGestures}
          />
        ))}
      </div>
    </div>
  );
});

export default OptimizedEmailList;