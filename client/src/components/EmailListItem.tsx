import { useState } from "react";
import { Star, Paperclip, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { EmailMessage } from "@shared/schema";

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
        "flex items-center gap-3 p-3 border-b cursor-pointer transition-colors hover-elevate",
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

      {/* Read/Unread indicator */}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={handleToggleRead}
        data-testid={`button-toggle-read-${email.id}`}
      >
        <Circle 
          className={cn(
            "h-3 w-3",
            !email.isRead ? "fill-accent text-accent" : "text-muted-foreground"
          )} 
        />
      </Button>

      {/* Star indicator */}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={handleToggleFlagged}
        data-testid={`button-toggle-star-${email.id}`}
      >
        <Star 
          className={cn(
            "h-3 w-3",
            email.isFlagged ? "fill-chart-4 text-chart-4" : "text-muted-foreground"
          )} 
        />
      </Button>

      {/* Email content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span 
            className={cn(
              "font-medium truncate",
              !email.isRead && "font-semibold"
            )}
            data-testid={`text-sender-${email.id}`}
          >
            {email.from}
          </span>
          <span 
            className="text-xs text-muted-foreground shrink-0"
            data-testid={`text-date-${email.id}`}
          >
            {email.date instanceof Date ? email.date.toLocaleDateString() : new Date(email.date).toLocaleDateString()}
          </span>
        </div>
        
        <div className="flex items-center gap-2 mb-1">
          <span 
            className={cn(
              "text-sm truncate",
              !email.isRead && "font-medium"
            )}
            data-testid={`text-subject-${email.id}`}
          >
            {email.subject}
          </span>
          {email.hasAttachments && (
            <div className="flex items-center gap-1 shrink-0">
              <Paperclip className="h-3 w-3 text-muted-foreground" />
              <Badge variant="secondary" className="text-xs h-4 px-1 py-0">
                <Paperclip className="h-2 w-2 mr-1" />
                Attachments
              </Badge>
            </div>
          )}
        </div>
        
        <p 
          className="text-xs text-muted-foreground truncate"
          data-testid={`text-snippet-${email.id}`}
        >
          {email.snippet}
        </p>
      </div>

      {/* Priority badge */}
      {email.priority > 0 && (
        <Badge variant="secondary" className="shrink-0">
          {email.priority === 3 && "High"}
          {email.priority === 2 && "Med"}
          {email.priority === 1 && "Low"}
        </Badge>
      )}
    </div>
  );
}