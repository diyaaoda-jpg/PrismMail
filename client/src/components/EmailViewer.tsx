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
      <div className="px-6 py-4 border-b bg-white dark:bg-gray-900">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <h2
              className={cn(
                "text-2xl font-normal text-gray-900 dark:text-gray-100 line-clamp-2 flex-1",
                !email.isRead && "font-semibold"
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

        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-medium">
                  {email.from.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 dark:text-gray-100 truncate" data-testid="text-email-from">
                    {email.from.split('<')[0].trim() || email.from}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                    {email.from.includes('<') ? email.from.match(/<([^>]+)>/)?.[1] : email.from}
                  </div>
                </div>
              </div>
            </div>
            <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap" data-testid="text-email-date">
              {(() => {
                const date = email.date instanceof Date ? email.date : new Date(email.date);
                return isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleString();
              })()}
            </span>
          </div>
          {(email.to || email.cc) && (
            <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1 ml-13">
              {email.to && (
                <div>
                  <span className="text-gray-500 dark:text-gray-500">To: </span>
                  <span>{email.to}</span>
                </div>
              )}
              {email.cc && (
                <div>
                  <span className="text-gray-500 dark:text-gray-500">Cc: </span>
                  <span>{email.cc}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col">
        <ScrollArea className="flex-1 bg-white dark:bg-gray-900">
          <div className="px-6 py-8 max-w-4xl mx-auto w-full">
            <div data-testid="text-email-content" className="email-content">
              {email.bodyHtml ? (
                <div
                  className="prose prose-base max-w-none dark:prose-invert
                    prose-headings:text-gray-900 dark:prose-headings:text-gray-100
                    prose-p:text-gray-700 dark:prose-p:text-gray-300
                    prose-a:text-blue-600 dark:prose-a:text-blue-400
                    prose-strong:text-gray-900 dark:prose-strong:text-gray-100
                    prose-blockquote:border-gray-300 dark:prose-blockquote:border-gray-600
                    prose-blockquote:text-gray-600 dark:prose-blockquote:text-gray-400
                    prose-code:text-gray-800 dark:prose-code:text-gray-200
                    prose-pre:bg-gray-100 dark:prose-pre:bg-gray-800"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(email.bodyHtml) }}
                />
              ) : email.bodyText ? (
                <div className="whitespace-pre-wrap text-gray-700 dark:text-gray-300 text-base leading-relaxed font-sans">
                  {email.bodyText}
                </div>
              ) : (
                <div className="text-gray-700 dark:text-gray-300 text-base leading-relaxed">
                  <p>{email.snippet}</p>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
        
        <Separator />
        
        {/* Action buttons */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t">
          <div className="flex items-center gap-3">
            <Button
              onClick={handleReply}
              data-testid="button-reply"
              className="hover-elevate active-elevate-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
              variant="outline"
            >
              <Reply className="h-4 w-4 mr-2" />
              {contextualLabels.reply}
            </Button>
            {showReplyAll && (
              <Button
                onClick={handleReplyAll}
                data-testid="button-reply-all"
                className="hover-elevate active-elevate-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
                variant="outline"
              >
                <ReplyAll className="h-4 w-4 mr-2" />
                {contextualLabels.replyAll}
              </Button>
            )}
            <Button
              onClick={handleForward}
              data-testid="button-forward"
              className="hover-elevate active-elevate-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
              variant="outline"
            >
              <Forward className="h-4 w-4 mr-2" />
              {contextualLabels.forward}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}