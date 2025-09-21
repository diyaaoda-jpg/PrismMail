import { useState, useMemo } from "react";
import { Reply, ReplyAll, Forward, Archive, Trash, Star, MoreHorizontal } from "lucide-react";
import DOMPurify from "dompurify";
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
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <h2
              className={cn(
                "text-xl font-semibold truncate",
                !email.isRead && "font-bold"
              )}
              data-testid="text-email-subject"
            >
              {email.subject}
            </h2>
            {email.priority > 0 && (
              <Badge
                variant={email.priority === 3 ? "destructive" : "secondary"}
                className="shrink-0 ml-2"
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
              {(() => {
                const date = email.date instanceof Date ? email.date : new Date(email.date);
                return isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleString();
              })()}
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col">
        <ScrollArea className="flex-1">
          <div className="p-6 prose prose-sm max-w-none dark:prose-invert">
            <div data-testid="text-email-content">
              {email.bodyHtml ? (
                <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(email.bodyHtml) }} />
              ) : email.bodyText ? (
                <div className="whitespace-pre-wrap">{email.bodyText}</div>
              ) : (
                <div>
                  <p>{email.snippet}</p>
                </div>
              )}
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