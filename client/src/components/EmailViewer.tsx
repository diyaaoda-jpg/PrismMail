import { useState, useMemo } from "react";
import { Reply, ReplyAll, Forward, Archive, Trash, Star, MoreHorizontal, Paperclip, Download, FileText, Image, FileArchive, File } from "lucide-react";
import DOMPurify from "dompurify";
import { getContextualLabels, shouldShowReplyAll } from "@/lib/emailUtils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import type { EmailMessage } from './EmailListItem';

// Attachment interface based on API response
interface EmailAttachment {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  isInline: boolean;
  downloadUrl: string;
}

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
  // Fetch attachments for the current email
  // SECURITY: Use proper queryKey format for cache invalidation
  const { data: attachmentsData, isLoading: isLoadingAttachments } = useQuery({
    queryKey: [`/api/mail/${email?.id}/attachments`],
    enabled: !!email?.id && email.hasAttachments,
  });

  const attachments: EmailAttachment[] = attachmentsData?.data?.attachments || [];

  // Utility functions
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return Image;
    if (mimeType.includes('pdf')) return FileText;
    if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('gzip')) return FileArchive;
    if (mimeType.includes('document') || mimeType.includes('word') || mimeType.includes('text')) return FileText;
    return File;
  };

  const handleDownloadAttachment = (attachment: EmailAttachment) => {
    // Create a temporary anchor element to trigger download
    const link = document.createElement('a');
    link.href = attachment.downloadUrl;
    link.download = attachment.fileName;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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
              {(() => {
                const date = email.date instanceof Date ? email.date : new Date(email.date);
                return isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleString();
              })()}
            </span>
          </div>

          {/* Attachment indicator */}
          {email.hasAttachments && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Paperclip className="h-3 w-3" />
              <span className="text-xs">
                {isLoadingAttachments 
                  ? "Loading attachments..." 
                  : attachments.length > 0 
                    ? `${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`
                    : "Has attachments"
                }
              </span>
            </div>
          )}
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
                <div style={{ whiteSpace: 'pre-wrap' }}>{email.bodyText}</div>
              ) : (
                <div>
                  <p>{email.snippet}</p>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
        
        {/* Attachments Section */}
        {email.hasAttachments && attachments.length > 0 && (
          <>
            <Separator />
            <div className="p-4 bg-muted/20 border-t">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    Attachments ({attachments.length})
                  </span>
                </div>
                
                <div className="grid gap-2">
                  {attachments.map((attachment) => {
                    const FileIcon = getFileIcon(attachment.mimeType);
                    return (
                      <div
                        key={attachment.id}
                        className="flex items-center justify-between p-3 bg-background rounded-md border hover-elevate transition-colors"
                        data-testid={`attachment-${attachment.id}`}
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <FileIcon className="h-5 w-5 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate" title={attachment.fileName}>
                              {attachment.fileName}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatFileSize(attachment.fileSize)} • {attachment.mimeType}
                            </div>
                          </div>
                        </div>
                        
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownloadAttachment(attachment)}
                          className="shrink-0 hover-elevate active-elevate-2"
                          data-testid={`button-download-${attachment.id}`}
                        >
                          <Download className="h-4 w-4 mr-1" />
                          <span className="text-xs">Download</span>
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
        
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