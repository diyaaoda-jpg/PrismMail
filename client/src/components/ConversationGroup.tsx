import { useState } from "react";
import { ChevronDown, ChevronRight, Star, Paperclip, Circle, Users, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmailListItem } from "./EmailListItem";
import { cn } from "@/lib/utils";
import { 
  getConversationSummary, 
  getConversationParticipants, 
  hasUnreadEmails,
  type ConversationThread 
} from "@/lib/conversationUtils";
import type { EmailMessage } from '@shared/schema';

interface ConversationGroupProps {
  conversation: ConversationThread;
  isSelected?: boolean;
  currentUserEmail?: string;
  onConversationClick?: (conversation: ConversationThread) => void;
  onEmailClick?: (email: EmailMessage) => void;
  onToggleExpanded?: (conversationId: string) => void;
  onToggleRead?: (emailId: string) => void;
  onToggleFlagged?: (emailId: string) => void;
}

const priorityColors = {
  0: "",
  1: "bg-chart-4/20 border-chart-4", // yellow
  2: "bg-chart-3/20 border-chart-3", // orange  
  3: "bg-destructive/20 border-destructive", // red
};

export function ConversationGroup({
  conversation,
  isSelected = false,
  currentUserEmail,
  onConversationClick,
  onEmailClick,
  onToggleExpanded,
  onToggleRead,
  onToggleFlagged,
}: ConversationGroupProps) {
  const [isHovered, setIsHovered] = useState(false);
  
  const { 
    id, 
    originalSubject, 
    emails, 
    latestEmail, 
    unreadCount, 
    totalCount, 
    isExpanded,
    hasAttachments,
    priority,
    isFlagged
  } = conversation;
  
  const isMultiEmail = totalCount > 1;
  const hasUnread = hasUnreadEmails(conversation);
  const participants = getConversationParticipants(conversation, currentUserEmail);
  const summary = getConversationSummary(conversation);

  const handleConversationClick = () => {
    if (isMultiEmail && !isExpanded) {
      // If not expanded, expand the conversation
      onToggleExpanded?.(id);
    } else if (isMultiEmail && isExpanded) {
      // If expanded, select latest email
      onEmailClick?.(latestEmail);
    } else {
      // Single email conversation - just select it
      onEmailClick?.(latestEmail);
    }
    onConversationClick?.(conversation);
  };

  const handleToggleExpanded = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpanded?.(id);
  };

  const handleEmailSelect = (email: EmailMessage) => {
    onEmailClick?.(email);
  };

  return (
    <div className="border-b">
      {/* Conversation Header */}
      <div
        className={cn(
          "flex items-center gap-3 p-3 cursor-pointer transition-colors hover-elevate",
          isSelected && "bg-accent/50",
          !hasUnread && "bg-background",
          hasUnread && "bg-background",
          priority > 0 && priorityColors[priority as keyof typeof priorityColors]
        )}
        onClick={handleConversationClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        data-testid={`conversation-${id}`}
      >
        {/* Priority indicator */}
        {priority > 0 && (
          <div 
            className={cn(
              "w-1 h-8 rounded-full",
              priority === 3 && "bg-destructive",
              priority === 2 && "bg-chart-3", 
              priority === 1 && "bg-chart-4"
            )}
          />
        )}

        {/* Expand/Collapse button for multi-email conversations */}
        {isMultiEmail && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={handleToggleExpanded}
            data-testid={`button-toggle-expand-${id}`}
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </Button>
        )}

        {/* Read/Unread indicator */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            // For conversations, toggle the latest unread email
            const latestUnread = emails.find(email => !email.isRead);
            if (latestUnread) {
              onToggleRead?.(latestUnread.id);
            } else {
              onToggleRead?.(latestEmail.id);
            }
          }}
          data-testid={`button-toggle-read-conversation-${id}`}
        >
          <Circle 
            className={cn(
              "h-3 w-3",
              hasUnread ? "fill-accent text-accent" : "text-muted-foreground"
            )} 
          />
        </Button>

        {/* Star indicator */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            // For conversations, toggle the latest email's flagged status
            onToggleFlagged?.(latestEmail.id);
          }}
          data-testid={`button-toggle-star-conversation-${id}`}
        >
          <Star 
            className={cn(
              "h-3 w-3",
              isFlagged ? "fill-chart-4 text-chart-4" : "text-muted-foreground"
            )} 
          />
        </Button>

        {/* Conversation content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span 
                className={cn(
                  "font-medium truncate",
                  hasUnread && "font-semibold"
                )}
                data-testid={`text-conversation-participants-${id}`}
              >
                {participants}
              </span>
              
              {/* Conversation indicators */}
              {isMultiEmail && (
                <div className="flex items-center gap-1 shrink-0">
                  <MessageCircle className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {totalCount}
                  </span>
                </div>
              )}
              
              {unreadCount > 0 && (
                <Badge variant="secondary" className="h-4 px-1 py-0 text-xs">
                  {unreadCount} unread
                </Badge>
              )}
            </div>
            
            <span 
              className="text-xs text-muted-foreground shrink-0"
              data-testid={`text-conversation-date-${id}`}
            >
              {latestEmail.date instanceof Date ? latestEmail.date.toLocaleDateString() : new Date(latestEmail.date).toLocaleDateString()}
            </span>
          </div>
          
          <div className="flex items-center gap-2 mb-1">
            <span 
              className={cn(
                "text-sm truncate",
                hasUnread && "font-medium"
              )}
              data-testid={`text-conversation-subject-${id}`}
            >
              {originalSubject}
            </span>
            
            {hasAttachments && (
              <div className="flex items-center gap-1 shrink-0">
                <Paperclip className="h-3 w-3 text-muted-foreground" />
                <Badge variant="secondary" className="text-xs h-4 px-1 py-0">
                  <Paperclip className="h-2 w-2 mr-1" />
                  Files
                </Badge>
              </div>
            )}
          </div>
          
          <p 
            className="text-xs text-muted-foreground truncate"
            data-testid={`text-conversation-summary-${id}`}
          >
            {summary}
          </p>
        </div>

        {/* Priority badge */}
        {priority > 0 && (
          <Badge variant="secondary" className="shrink-0">
            {priority === 3 && "High"}
            {priority === 2 && "Med"}
            {priority === 1 && "Low"}
          </Badge>
        )}
      </div>

      {/* Expanded emails list */}
      {isMultiEmail && isExpanded && (
        <div className="ml-6 border-l-2 border-muted">
          {emails.map((email, index) => (
            <div key={email.id} className="relative">
              {/* Connection line */}
              <div className="absolute left-0 top-6 w-4 h-px bg-muted" />
              
              <div className="ml-4">
                <EmailListItem
                  email={email}
                  isSelected={false}
                  onClick={() => handleEmailSelect(email)}
                  onToggleRead={onToggleRead}
                  onToggleFlagged={onToggleFlagged}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}