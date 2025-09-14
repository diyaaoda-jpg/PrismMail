import { useState } from "react";
import { Star, Paperclip, Circle, Crown, AlertTriangle, Flag, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface EmailMessage {
  id: string;
  from: string;
  subject: string;
  date: Date;
  isRead: boolean;
  isFlagged: boolean;
  priority: number;
  hasAttachments: boolean;
  snippet: string;
  bodyHtml?: string;
  bodyText?: string;
  folder: string;
  // Enhanced priority system fields
  autoPriority?: number;
  priorityScore?: number;
  prioritySource?: string;
  isVip?: boolean;
  isInFocus?: boolean;
  ruleId?: string;
}

interface EmailListItemProps {
  email: EmailMessage;
  isSelected?: boolean;
  onClick?: () => void;
  onToggleRead?: (id: string) => void;
  onToggleFlagged?: (id: string) => void;
}

// Helper function to generate avatar initials
const getInitials = (name: string): string => {
  if (!name) return "?";
  const parts = name.split(/[@\s]+/);
  if (parts[0]) {
    const namePart = parts[0];
    return namePart.length >= 2 
      ? namePart.substring(0, 2).toUpperCase()
      : namePart[0].toUpperCase();
  }
  return name[0]?.toUpperCase() || "?";
};

const priorityConfig = {
  0: { color: "", badge: null, icon: null, label: "", iconColor: "" },
  1: { 
    color: "border-l-[3px] border-l-[hsl(var(--priority-low))] bg-[hsl(var(--priority-low))]/8", 
    badge: "outline", 
    icon: Clock, 
    label: "Low",
    iconColor: "text-[hsl(var(--priority-low))]"
  },
  2: { 
    color: "border-l-[3px] border-l-[hsl(var(--priority-normal))] bg-[hsl(var(--priority-normal))]/8", 
    badge: "secondary", 
    icon: Flag, 
    label: "Normal",
    iconColor: "text-[hsl(var(--priority-normal))]"
  },
  3: { 
    color: "border-l-[3px] border-l-[hsl(var(--priority-high))] bg-[hsl(var(--priority-high))]/12", 
    badge: "destructive", 
    icon: AlertTriangle, 
    label: "High",
    iconColor: "text-[hsl(var(--priority-high))]"
  },
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

  const priorityInfo = priorityConfig[email.priority as keyof typeof priorityConfig];
  const initials = getInitials(email.from);
  
  // Format date to be more readable
  const formatDate = (date: Date) => {
    const now = new Date();
    const emailDate = date instanceof Date ? date : new Date(date);
    const diffMs = now.getTime() - emailDate.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return emailDate.toLocaleDateString();
  };

  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 p-4 cursor-pointer transition-all duration-200 hover-elevate active-elevate-2",
        "border-b border-border/60",
        isSelected && "bg-accent/20 border-accent/30",
        !email.isRead && "bg-gradient-to-r from-[hsl(var(--status-unread))]/5 to-transparent",
        priorityInfo.color
      )}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-testid={`email-item-${email.id}`}
    >
      {/* Unread accent border */}
      {!email.isRead && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-[hsl(var(--status-unread))] rounded-r" />
      )}

      {/* Sender Avatar */}
      <Avatar className="h-10 w-10 shrink-0 border-2 border-border/20">
        <AvatarFallback 
          className={cn(
            "font-semibold text-xs transition-colors",
            !email.isRead ? "bg-[hsl(var(--status-unread))]/15 text-[hsl(var(--status-unread))]" : "bg-muted text-muted-foreground"
          )}
        >
          {initials}
        </AvatarFallback>
      </Avatar>

      {/* Read/Unread indicator */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-6 w-6 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity",
          !email.isRead && "opacity-100"
        )}
        onClick={handleToggleRead}
        data-testid={`button-toggle-read-${email.id}`}
      >
        <Circle 
          className={cn(
            "h-3 w-3 transition-all",
            !email.isRead 
              ? "fill-[hsl(var(--status-unread))] text-[hsl(var(--status-unread))]" 
              : "text-muted-foreground hover:text-foreground"
          )} 
        />
      </Button>

      {/* Email content */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span 
              className={cn(
                "truncate transition-colors",
                !email.isRead 
                  ? "font-semibold text-foreground" 
                  : "font-medium text-muted-foreground"
              )}
              data-testid={`text-sender-${email.id}`}
            >
              {email.from.replace(/@.*$/, '')}
            </span>
            {email.isVip && (
              <Crown className="h-3.5 w-3.5 shrink-0 text-amber-500" data-testid={`icon-vip-${email.id}`} />
            )}
            {priorityInfo.icon && (
              <priorityInfo.icon className={cn("h-3.5 w-3.5 shrink-0", priorityInfo.iconColor)} />
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span 
              className="text-xs text-muted-foreground font-medium"
              data-testid={`text-date-${email.id}`}
            >
              {formatDate(email.date)}
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <span 
            className={cn(
              "text-sm truncate transition-colors",
              !email.isRead 
                ? "font-medium text-foreground" 
                : "text-muted-foreground"
            )}
            data-testid={`text-subject-${email.id}`}
          >
            {email.subject}
          </span>
          {email.hasAttachments && (
            <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
        </div>
        
        <p 
          className="text-xs text-muted-foreground/80 truncate leading-relaxed"
          data-testid={`text-snippet-${email.id}`}
        >
          {email.snippet}
        </p>
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Star indicator */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-7 w-7 opacity-60 group-hover:opacity-100 transition-all hover:bg-[hsl(var(--status-flagged))]/20",
            email.isFlagged && "opacity-100"
          )}
          onClick={handleToggleFlagged}
          data-testid={`button-toggle-star-${email.id}`}
        >
          <Star 
            className={cn(
              "h-3.5 w-3.5 transition-all",
              email.isFlagged 
                ? "fill-[hsl(var(--status-flagged))] text-[hsl(var(--status-flagged))]" 
                : "text-muted-foreground hover:text-[hsl(var(--status-flagged))]"
            )} 
          />
        </Button>

        {/* Priority badge */}
        {email.priority > 0 && (
          <Badge 
            variant={priorityInfo.badge as "outline" | "secondary" | "destructive"} 
            className="shrink-0 text-xs font-medium px-2 py-0.5"
          >
            {priorityInfo.label}
          </Badge>
        )}
      </div>
    </div>
  );
}