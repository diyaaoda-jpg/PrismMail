import { useState, useRef, useCallback, memo, useMemo } from "react";
import { Star, Paperclip, Circle, Archive, Trash, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useSwipeGestures, createEmailSwipeActions } from "@/hooks/useSwipeGestures";
import { useIsMobile } from "@/hooks/use-mobile";
import { LazyImage } from "./LazyImage";
import { performanceMonitor } from "@/lib/performanceMonitor";

export interface EmailMessage {
  id: string;
  from: string;
  to?: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  subject: string;
  date: Date;
  isRead: boolean;
  isFlagged: boolean;
  isStarred: boolean;
  isArchived: boolean;
  isDeleted: boolean;
  priority: number;
  hasAttachments: boolean;
  snippet: string;
  bodyHtml?: string;
  bodyText?: string;
  folder: string;
}

interface EmailListItemProps {
  email: EmailMessage;
  isSelected?: boolean;
  onClick?: () => void;
  onToggleRead?: (id: string) => void;
  onToggleFlagged?: (id: string) => void;
  onArchive?: (id: string) => void;
  onDelete?: (id: string) => void;
  onToggleStar?: (id: string) => void;
  onFlag?: (id: string) => void;
  enableSwipeGestures?: boolean;
  showSwipeHints?: boolean;
}

const priorityColors = {
  0: "",
  1: "bg-chart-4/20 border-chart-4", // yellow
  2: "bg-chart-3/20 border-chart-3", // orange  
  3: "bg-destructive/20 border-destructive", // red
};

export const EmailListItem = memo(function EmailListItem({
  email,
  isSelected = false,
  onClick,
  onToggleRead,
  onToggleFlagged,
  onArchive,
  onDelete,
  onToggleStar,
  onFlag,
  enableSwipeGestures = true,
  showSwipeHints = false,
}: EmailListItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  // Create swipe configuration for this email
  const swipeConfig = createEmailSwipeActions(
    {
      id: email.id,
      isRead: email.isRead,
      isStarred: email.isStarred,
      isArchived: email.isArchived,
    },
    {
      onArchive: (id) => onArchive?.(id),
      onDelete: (id) => onDelete?.(id),
      onToggleRead: (id) => onToggleRead?.(id),
      onToggleStar: (id) => onToggleStar?.(id) || onToggleFlagged?.(id),
      onFlag: (id) => onFlag?.(id) || onToggleFlagged?.(id),
    }
  );

  // Initialize swipe gestures
  const { swipeState, handlers, getActionFeedback } = useSwipeGestures(
    enableSwipeGestures && isMobile ? swipeConfig : { leftActions: [], rightActions: [] }
  );

  const handleToggleRead = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleRead?.(email.id);
  }, [onToggleRead, email.id]);

  const handleToggleFlagged = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFlagged?.(email.id);
  }, [onToggleFlagged, email.id]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Don't trigger click if user is swiping
    if (swipeState.isActive) {
      e.preventDefault();
      return;
    }
    onClick?.();
  }, [onClick, swipeState.isActive]);

  // Get current action feedback for visual display
  const actionFeedback = getActionFeedback();

  // Memoize expensive computations for mobile performance
  const memoizedPriorityStyle = useMemo(() => {
    if (email.priority === 0) return {};
    return {
      className: priorityColors[email.priority as keyof typeof priorityColors] || "",
      borderLeft: email.priority > 1 ? '3px solid hsl(var(--destructive))' : undefined
    };
  }, [email.priority]);

  const memoizedTimeDisplay = useMemo(() => {
    const now = new Date();
    const emailDate = new Date(email.date);
    const diffHours = (now.getTime() - emailDate.getTime()) / (1000 * 60 * 60);
    
    if (diffHours < 24) {
      return emailDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffHours < 168) { // 7 days
      return emailDate.toLocaleDateString([], { weekday: 'short' });
    } else {
      return emailDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  }, [email.date]);

  return (
    <div className="relative overflow-hidden group">
      {/* Swipe action backgrounds - Left (Archive/Delete) */}
      <div
        className={cn(
          "absolute left-0 top-0 h-full flex items-center justify-start transition-all duration-200",
          "z-0 opacity-0 pointer-events-none",
          swipeState.direction === 'left' && swipeState.distance > 10 && "opacity-100"
        )}
        style={{
          width: swipeState.direction === 'left' ? Math.min(swipeState.distance, 200) : 0,
          backgroundColor: swipeState.direction === 'left' && actionFeedback?.color ? actionFeedback.color : 'hsl(var(--muted))'
        }}
      >
        {swipeState.direction === 'left' && actionFeedback && (
          <div className="flex items-center justify-center px-4">
            {actionFeedback.icon === 'Archive' && <Archive className="h-5 w-5 text-white" />}
            {actionFeedback.icon === 'Trash' && <Trash className="h-5 w-5 text-white" />}
            <span className="ml-2 text-sm font-medium text-white">
              {swipeState.activeAction?.label}
            </span>
          </div>
        )}
      </div>

      {/* Swipe action backgrounds - Right (Read/Star) */}
      <div
        className={cn(
          "absolute right-0 top-0 h-full flex items-center justify-end transition-all duration-200",
          "z-0 opacity-0 pointer-events-none",
          swipeState.direction === 'right' && swipeState.distance > 10 && "opacity-100"
        )}
        style={{
          width: swipeState.direction === 'right' ? Math.min(swipeState.distance, 200) : 0,
          backgroundColor: swipeState.direction === 'right' && actionFeedback?.color ? actionFeedback.color : 'hsl(var(--muted))'
        }}
      >
        {swipeState.direction === 'right' && actionFeedback && (
          <div className="flex items-center justify-center px-4">
            {actionFeedback.icon === 'Eye' && <Eye className="h-5 w-5 text-white" />}
            {actionFeedback.icon === 'EyeOff' && <EyeOff className="h-5 w-5 text-white" />}
            {actionFeedback.icon === 'Star' && <Star className="h-5 w-5 text-white" />}
            <span className="mr-2 text-sm font-medium text-white">
              {swipeState.activeAction?.label}
            </span>
          </div>
        )}
      </div>

      {/* Main email item content */}
      <div
        ref={itemRef}
        className={cn(
          "relative z-10 flex items-center gap-3 p-4 min-h-[60px] border-b cursor-pointer transition-all duration-200",
          "sm:p-3 sm:min-h-[48px]", // Smaller padding and height on desktop
          "hover-elevate active-elevate-2",
          isSelected && "bg-accent/50",
          !email.isRead && "bg-background",
          email.priority > 0 && priorityColors[email.priority as keyof typeof priorityColors],
          swipeState.isActive && "bg-background shadow-lg",
          // Apply transform based on swipe state
          enableSwipeGestures && isMobile && swipeState.isActive && swipeState.direction === 'left' && 
            `transform-gpu translate-x-[-${Math.min(swipeState.distance, 200)}px]`,
          enableSwipeGestures && isMobile && swipeState.isActive && swipeState.direction === 'right' && 
            `transform-gpu translate-x-[${Math.min(swipeState.distance, 200)}px]`
        )}
        style={{
          transform: enableSwipeGestures && isMobile && swipeState.isActive
            ? swipeState.direction === 'left' 
              ? `translateX(-${Math.min(swipeState.distance, 200)}px)`
              : swipeState.direction === 'right'
              ? `translateX(${Math.min(swipeState.distance, 200)}px)`
              : 'none'
            : 'none'
        }}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onTouchStart={enableSwipeGestures ? handlers.onTouchStart : undefined}
        onTouchMove={enableSwipeGestures ? handlers.onTouchMove : undefined}
        onTouchEnd={enableSwipeGestures ? handlers.onTouchEnd : undefined}
        onPointerDown={enableSwipeGestures ? handlers.onPointerDown : undefined}
        onPointerMove={enableSwipeGestures ? handlers.onPointerMove : undefined}
        onPointerUp={enableSwipeGestures ? handlers.onPointerUp : undefined}
        data-testid={`email-item-${email.id}`}
      >
      {/* Priority indicator */}
      {email.priority > 0 && (
        <div 
          className={cn(
            "w-1 h-8 rounded-full",
            email.priority === 3 && "bg-destructive",
            email.priority === 2 && "bg-chart-3", 
            email.priority === 1 && "bg-chart-4"
          )}
        />
      )}

      {/* Read/Unread indicator - Larger touch target on mobile */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "shrink-0 hover-elevate active-elevate-2",
          "h-8 w-8 sm:h-6 sm:w-6" // Larger on mobile, smaller on desktop
        )}
        onClick={handleToggleRead}
        data-testid={`button-toggle-read-${email.id}`}
        aria-label={email.isRead ? "Mark as unread" : "Mark as read"}
        title={email.isRead ? "Mark as unread" : "Mark as read"}
      >
        <Circle 
          className={cn(
            "h-4 w-4 sm:h-3 sm:w-3", // Larger icon on mobile
            !email.isRead ? "fill-accent text-accent" : "text-muted-foreground"
          )} 
        />
      </Button>

      {/* Star indicator - Larger touch target on mobile */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "shrink-0 hover-elevate active-elevate-2",
          "h-8 w-8 sm:h-6 sm:w-6" // Larger on mobile, smaller on desktop
        )}
        onClick={handleToggleFlagged}
        data-testid={`button-toggle-star-${email.id}`}
        aria-label={email.isStarred ? "Remove from starred" : "Add to starred"}
        title={email.isStarred ? "Remove from starred" : "Add to starred"}
      >
        <Star 
          className={cn(
            "h-4 w-4 sm:h-3 sm:w-3", // Larger icon on mobile
            email.isStarred ? "fill-amber-500 text-amber-500 dark:fill-amber-400 dark:text-amber-400" : "text-muted-foreground"
          )} 
        />
      </Button>

      {/* Email content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span 
            className={cn(
              "font-medium truncate text-sm sm:text-base", // Larger text on mobile
              !email.isRead && "font-semibold"
            )}
            data-testid={`text-sender-${email.id}`}
          >
            {email.from}
          </span>
          <span 
            className="text-xs sm:text-xs text-muted-foreground shrink-0"
            data-testid={`text-date-${email.id}`}
          >
            {email.date instanceof Date ? email.date.toLocaleDateString() : new Date(email.date).toLocaleDateString()}
          </span>
        </div>
        
        <div className="flex items-center gap-2 mb-1">
          <span 
            className={cn(
              "text-sm sm:text-sm truncate", // Consistent text size
              !email.isRead && "font-medium"
            )}
            data-testid={`text-subject-${email.id}`}
          >
            {email.subject}
          </span>
          {email.hasAttachments && (
            <Paperclip className="h-4 w-4 sm:h-3 sm:w-3 text-muted-foreground shrink-0" />
          )}
        </div>
        
        <p 
          className="text-sm sm:text-xs text-muted-foreground truncate leading-relaxed"
          data-testid={`text-snippet-${email.id}`}
        >
          {email.snippet}
        </p>
      </div>

      {/* Priority badge - Larger on mobile */}
      {email.priority > 0 && (
        <Badge 
          variant="secondary" 
          className="shrink-0 text-xs sm:text-xs px-2 py-1 sm:px-1.5 sm:py-0.5"
        >
          {email.priority === 3 && "High"}
          {email.priority === 2 && "Med"}
          {email.priority === 1 && "Low"}
        </Badge>
      )}
      </div>
    </div>
  );
});