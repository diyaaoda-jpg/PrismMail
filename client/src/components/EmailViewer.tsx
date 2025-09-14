import { useState, useMemo } from "react";
import { Reply, ReplyAll, Forward, Archive, Trash, Star, MoreHorizontal, Clock, Crown, AlertTriangle, Flag } from "lucide-react";
import DOMPurify from "dompurify";
import { getContextualLabels, shouldShowReplyAll } from "@/lib/emailUtils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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

  // Helper function to generate avatar initials
  const getInitials = (email: string): string => {
    if (!email) return "?";
    const parts = email.split(/[@\s]+/);
    if (parts[0]) {
      const namePart = parts[0];
      return namePart.length >= 2 
        ? namePart.substring(0, 2).toUpperCase()
        : namePart[0].toUpperCase();
    }
    return email[0]?.toUpperCase() || "?";
  };

  // Professional priority configuration
  const priorityConfig = {
    0: { label: '', icon: null, variant: null, color: '' },
    1: { 
      label: 'Low Priority', 
      icon: Clock, 
      variant: 'outline' as const, 
      color: 'text-[hsl(var(--priority-low))]' 
    },
    2: { 
      label: 'Normal Priority', 
      icon: Flag, 
      variant: 'secondary' as const, 
      color: 'text-[hsl(var(--priority-normal))]' 
    },
    3: { 
      label: 'High Priority', 
      icon: AlertTriangle, 
      variant: 'destructive' as const, 
      color: '' 
    },
  };

  // Format date for email viewer
  const formatEmailDate = (date: Date) => {
    const emailDate = date instanceof Date ? date : new Date(date);
    if (isNaN(emailDate.getTime())) return 'Invalid Date';
    
    return emailDate.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const contextualLabels = useMemo(() => {
    return email ? getContextualLabels(email) : { reply: 'Reply', replyAll: 'Reply All', forward: 'Forward' };
  }, [email]);

  const showReplyAll = useMemo(() => {
    return email ? shouldShowReplyAll(email, currentUserEmail) : true;
  }, [email, currentUserEmail]);

  const priorityInfo = priorityConfig[email.priority as keyof typeof priorityConfig];
  const senderInitials = getInitials(email.from);

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Enhanced Header */}
      <div className="border-b bg-card">
        {/* Priority indicator bar */}
        {email.priority > 0 && (
          <div className={cn(
            "h-1 w-full",
            email.priority === 3 && "bg-[hsl(var(--priority-high))]",
            email.priority === 2 && "bg-[hsl(var(--priority-normal))]", 
            email.priority === 1 && "bg-[hsl(var(--priority-low))]"
          )} />
        )}
        
        <div className="p-6 space-y-6">
          {/* Subject and Priority */}
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h1 
                  className={cn(
                    "text-2xl font-bold leading-tight text-foreground",
                    !email.isRead && "font-extrabold"
                  )}
                  data-testid="text-email-subject"
                >
                  {email.subject}
                </h1>
              </div>
              
              <div className="flex items-center gap-2 shrink-0">
                {/* Priority Badge */}
                {email.priority > 0 && (
                  <Badge 
                    variant={priorityInfo.variant}
                    className={cn(
                      "flex items-center gap-1.5 font-medium px-3 py-1.5",
                      priorityInfo.color
                    )}
                  >
                    {priorityInfo.icon && <priorityInfo.icon className="h-3.5 w-3.5" />}
                    {priorityInfo.label}
                  </Badge>
                )}
                
                {/* Star indicator */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleToggleFlagged}
                  data-testid="button-toggle-star-viewer"
                  className={cn(
                    "h-9 w-9 transition-all hover:bg-[hsl(var(--status-flagged))]/20",
                    email.isFlagged && "text-[hsl(var(--status-flagged))]"
                  )}
                >
                  <Star className={cn(
                    "h-4 w-4 transition-all",
                    email.isFlagged 
                      ? "fill-[hsl(var(--status-flagged))] text-[hsl(var(--status-flagged))]" 
                      : "text-muted-foreground hover:text-[hsl(var(--status-flagged))]"
                  )} />
                </Button>
                
                {/* More options */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-9 w-9" data-testid="button-email-more">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={handleArchive} data-testid="button-archive">
                      <Archive className="h-4 w-4 mr-3" />
                      Archive Message
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={handleDelete} 
                      className="text-destructive focus:text-destructive" 
                      data-testid="button-delete"
                    >
                      <Trash className="h-4 w-4 mr-3" />
                      Delete Message
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>

          {/* Sender Information */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* Sender Avatar */}
              <Avatar className="h-12 w-12 border-2 border-border/30">
                <AvatarFallback 
                  className={cn(
                    "font-semibold text-sm bg-gradient-to-br from-accent/20 to-accent/10 text-accent-foreground",
                    !email.isRead && "from-[hsl(var(--status-unread))]/20 to-[hsl(var(--status-unread))]/10 text-[hsl(var(--status-unread))]"
                  )}
                >
                  {senderInitials}
                </AvatarFallback>
              </Avatar>
              
              {/* Sender Details */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span 
                    className={cn(
                      "font-semibold text-base leading-none",
                      !email.isRead ? "text-foreground" : "text-muted-foreground"
                    )}
                    data-testid="text-email-from"
                  >
                    {email.from.replace(/@.*$/, '')}
                  </span>
                  {!email.isRead && (
                    <div className="h-2 w-2 rounded-full bg-[hsl(var(--status-unread))] animate-pulse" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground leading-none">
                  {email.from}
                </p>
              </div>
            </div>
            
            {/* Date and Time */}
            <div className="text-right">
              <p 
                className="text-sm font-medium text-foreground leading-none"
                data-testid="text-email-date"
              >
                {formatEmailDate(email.date)}
              </p>
              <p className="text-xs text-muted-foreground mt-1 leading-none">
                {email.hasAttachments && (
                  <span className="flex items-center gap-1 justify-end">
                    <Archive className="h-3 w-3" />
                    Has attachments
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Enhanced Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <ScrollArea className="flex-1 px-6">
          <div className="py-8 max-w-none">
            {/* Email Body */}
            <div 
              className={cn(
                "prose prose-base max-w-none dark:prose-invert",
                "prose-headings:text-foreground prose-p:text-foreground prose-p:leading-relaxed",
                "prose-blockquote:border-l-accent prose-blockquote:text-muted-foreground",
                "prose-a:text-accent prose-a:no-underline hover:prose-a:underline",
                "prose-code:bg-muted prose-code:px-2 prose-code:py-1 prose-code:rounded prose-code:text-sm",
                "prose-pre:bg-muted prose-pre:border prose-pre:border-border",
                "prose-table:border-collapse prose-th:border prose-td:border prose-th:bg-muted/50",
                "prose-ul:my-4 prose-ol:my-4 prose-li:my-1",
                "text-base leading-7"
              )}
              data-testid="text-email-content"
            >
              {email.bodyHtml ? (
                <div 
                  className="email-html-content"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(email.bodyHtml, {
                    ADD_TAGS: ['style'],
                    ADD_ATTR: ['style', 'class'],
                    WHOLE_DOCUMENT: false,
                    RETURN_DOM_FRAGMENT: false,
                    RETURN_DOM: false
                  }) }} 
                />
              ) : email.bodyText ? (
                <div className="whitespace-pre-wrap font-mono text-sm bg-muted/30 p-4 rounded-lg border">
                  {email.bodyText}
                </div>
              ) : (
                <div className="bg-gradient-to-r from-muted/40 to-transparent p-6 rounded-lg border-l-4 border-l-accent">
                  <p className="text-muted-foreground italic">
                    This email only contains a preview snippet:
                  </p>
                  <p className="mt-2 text-base font-medium leading-relaxed">
                    {email.snippet}
                  </p>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
        
        {/* Enhanced Action Bar */}
        <Separator className="opacity-60" />
        
        <div className="bg-gradient-to-r from-card to-card/95 px-6 py-4 border-t border-border/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Primary Actions */}
              <Button 
                onClick={handleReply} 
                data-testid="button-reply"
                className="font-medium px-4 py-2 h-10 bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                <Reply className="h-4 w-4 mr-2" />
                {contextualLabels.reply}
              </Button>
              
              {showReplyAll && (
                <Button 
                  variant="outline" 
                  onClick={handleReplyAll} 
                  data-testid="button-reply-all"
                  className="font-medium px-4 py-2 h-10 border-2"
                >
                  <ReplyAll className="h-4 w-4 mr-2" />
                  {contextualLabels.replyAll}
                </Button>
              )}
              
              <Button 
                variant="outline" 
                onClick={handleForward} 
                data-testid="button-forward"
                className="font-medium px-4 py-2 h-10 border-2"
              >
                <Forward className="h-4 w-4 mr-2" />
                {contextualLabels.forward}
              </Button>
            </div>
            
            {/* Secondary Actions */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-medium">
                {email.folder} 
              </span>
              <span className="opacity-60">•</span>
              <span>
                {formatEmailDate(email.date).split(',')[0]}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}