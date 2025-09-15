import { useState } from "react";
import { Star, Paperclip, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
}

const priorityColors = {
  0: "",
  1: "bg-chart-4/20 border-chart-4", // yellow
  2: "bg-chart-3/20 border-chart-3", // orange  
  3: "bg-destructive/20 border-destructive", // red
};

export function EmailListItem({
  email,
  isSelected = false,
  onClick,
  onToggleRead,
  onToggleFlagged,
}: EmailListItemProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleToggleRead = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleRead?.(email.id);
    console.log('Toggle read for:', email.id);
  };

  const handleToggleFlagged = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFlagged?.(email.id);
    console.log('Toggle flagged for:', email.id);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-4 min-h-[60px] border-b cursor-pointer transition-colors hover-elevate active-elevate-2",
        "sm:p-3 sm:min-h-[48px]", // Smaller padding and height on desktop
        isSelected && "bg-accent/50",
        !email.isRead && "bg-background",
        email.priority > 0 && priorityColors[email.priority as keyof typeof priorityColors]
      )}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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
  );
}