import { useState, useMemo } from "react";
import { Reply, ReplyAll, Forward, Archive, Trash, Star, MoreHorizontal } from "lucide-react";
import { getContextualLabels, shouldShowReplyAll } from "@/lib/emailUtils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { EmailMessage } from './EmailListItem';

interface EmailViewerProps {
  email: EmailMessage | null;
  currentUserEmail?: string;
  onReply?: (email: EmailMessage) => void;
  onReplyAll?: (email: EmailMessage) => void;
  onForward?: (email: EmailMessage) => void;
  onArchive?: (email: EmailMessage) => void;
  onDelete?: (email: EmailMessage) => void;
  onToggleFlagged?: (email: EmailMessage) => void;
}

export function EmailViewer({
  email,
  currentUserEmail,
  onReply,
  onReplyAll, 
  onForward,
  onArchive,
  onDelete,
  onToggleFlagged,
}: EmailViewerProps) {
  if (!email) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/30">
        <div className="text-center text-muted-foreground">
          <div className="text-lg font-medium mb-2">No message selected</div>
          <div className="text-sm">Select an email from the list to read it here</div>
        </div>
      </div>
    );
  }

  const handleReply = () => {
    onReply?.(email);
    console.log('Reply to:', email.id);
  };

  const handleReplyAll = () => {
    onReplyAll?.(email);
    console.log('Reply all to:', email.id);
  };

  const handleForward = () => {
    onForward?.(email);
    console.log('Forward:', email.id);
  };

  const handleArchive = () => {
    onArchive?.(email);
    console.log('Archive:', email.id);
  };

  const handleDelete = () => {
    onDelete?.(email);
    console.log('Delete:', email.id);
  };

  const handleToggleFlagged = () => {
    onToggleFlagged?.(email);
    console.log('Toggle flagged:', email.id);
  };

  const priorityLabel = {
    0: '',
    1: 'Low Priority',
    2: 'Medium Priority', 
    3: 'High Priority'
  };

  const contextualLabels = useMemo(() => {
    return email ? getContextualLabels(email) : { reply: 'Reply', replyAll: 'Reply All', forward: 'Forward' };
  }, [email]);

  const showReplyAll = useMemo(() => {
    return email ? shouldShowReplyAll(email, currentUserEmail) : true;
  }, [email, currentUserEmail]);

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Header */}
      <div className="p-4 border-b bg-card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h2 
              className={cn(
                "text-xl font-semibold line-clamp-2",
                !email.isRead && "font-bold"
              )}
              data-testid="text-email-subject"
            >
              {email.subject}
            </h2>
            {email.priority > 0 && (
              <Badge 
                variant={email.priority === 3 ? "destructive" : "secondary"}
                className="shrink-0"
              >
                {priorityLabel[email.priority as keyof typeof priorityLabel]}
              </Badge>
            )}
          </div>
          
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleToggleFlagged}
              data-testid="button-toggle-star-viewer"
              className="hover-elevate active-elevate-2"
            >
              <Star className={cn(
                "h-4 w-4",
                email.isFlagged ? "fill-chart-4 text-chart-4" : "text-muted-foreground"
              )} />
            </Button>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" data-testid="button-email-more">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleArchive} data-testid="button-archive">
                  <Archive className="h-4 w-4 mr-2" />
                  Archive
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDelete} className="text-destructive" data-testid="button-delete">
                  <Trash className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-medium">From: </span>
              <span data-testid="text-email-from">{email.from}</span>
            </div>
            <span className="text-muted-foreground" data-testid="text-email-date">
              {email.date.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col">
        <ScrollArea className="flex-1">
          <div className="p-6 prose prose-sm max-w-none dark:prose-invert">
            <div data-testid="text-email-content">
              {/* Mock email content - in real app this would be HTML rendered safely */}
              <p>Dear Team,</p>
              <p>{email.snippet}</p>
              <p>
                I wanted to provide you with an update on our current progress and outline the next steps we need to take.
                The project has been moving forward successfully, and we're on track to meet our upcoming deadlines.
              </p>
              <p>
                Key highlights from this week:
              </p>
              <ul>
                <li>Completed initial design mockups</li>
                <li>Set up development environment</li>
                <li>Conducted stakeholder interviews</li>
                <li>Finalized project timeline</li>
              </ul>
              <p>
                Please let me know if you have any questions or concerns. I'm available for a quick call to discuss any of these items in more detail.
              </p>
              <p>Best regards,<br />Team Lead</p>
            </div>
          </div>
        </ScrollArea>
        
        <Separator />
        
        {/* Action buttons */}
        <div className="p-4 bg-card">
          <div className="flex items-center gap-2">
            <Button onClick={handleReply} data-testid="button-reply" className="hover-elevate active-elevate-2">
              <Reply className="h-4 w-4 mr-2" />
              {contextualLabels.reply}
            </Button>
            {showReplyAll && (
              <Button variant="outline" onClick={handleReplyAll} data-testid="button-reply-all" className="hover-elevate active-elevate-2">
                <ReplyAll className="h-4 w-4 mr-2" />
                {contextualLabels.replyAll}
              </Button>
            )}
            <Button variant="outline" onClick={handleForward} data-testid="button-forward" className="hover-elevate active-elevate-2">
              <Forward className="h-4 w-4 mr-2" />
              {contextualLabels.forward}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}