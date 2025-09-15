import { useState, useEffect } from "react";
import { X, ChevronLeft, ChevronRight, ArrowLeft, Reply, Forward, Archive, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { EmailMessage } from './EmailListItem';
import { EmailViewer } from './EmailViewer';

interface ReadingModeProps {
  email: EmailMessage | null;
  emails: EmailMessage[];
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (direction: 'prev' | 'next') => void;
  onReply?: (email: EmailMessage) => void;
  onForward?: (email: EmailMessage) => void;
  onArchive?: (email: EmailMessage) => void;
  onDelete?: (email: EmailMessage) => void;
  onToggleFlagged?: (email: EmailMessage) => void;
  backgroundImage?: string;
}

export function ReadingMode({
  email,
  emails,
  isOpen,
  onClose,
  onNavigate,
  onReply,
  onForward,
  onArchive,
  onDelete,
  onToggleFlagged,
  backgroundImage,
}: ReadingModeProps) {
  // Calculate current index from the passed email prop to avoid sync issues
  const currentIndex = email && emails.length > 0 ? emails.findIndex(e => e.id === email.id) : 0;
  
  if (!isOpen || !email) return null;
  
  // Guard against invalid index
  if (currentIndex === -1) {
    console.warn('Email not found in emails list, closing reading mode');
    onClose();
    return null;
  }

  const handlePrevious = () => {
    if (currentIndex > 0) {
      onNavigate?.('prev');
      console.log('Navigate to previous email');
    }
  };

  const handleNext = () => {
    if (currentIndex < emails.length - 1) {
      onNavigate?.('next');
      console.log('Navigate to next email');
    }
  };

  const handleClose = () => {
    onClose();
    console.log('Close reading mode');
  };

  const handleReply = () => {
    if (email && onReply) {
      onReply(email);
      console.log('Reply to email from reading mode:', email.subject);
    }
  };

  const handleForward = () => {
    if (email && onForward) {
      onForward(email);
      console.log('Forward email from reading mode:', email.subject);
    }
  };

  const handleToggleFlagged = () => {
    if (email && onToggleFlagged) {
      onToggleFlagged(email);
      console.log('Toggle flagged from reading mode:', email.subject);
    }
  };

  const handleArchive = () => {
    if (email && onArchive) {
      onArchive(email);
      // Close reading mode after archiving
      onClose();
      console.log('Archive email from reading mode:', email.subject);
    }
  };

  const handleDelete = () => {
    if (email && onDelete) {
      onDelete(email);
      // Close reading mode after deleting
      onClose();
      console.log('Delete email from reading mode:', email.subject);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm">
      {/* Background image overlay */}
      {backgroundImage && (
        <div 
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `url(${backgroundImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(2px) brightness(0.7)',
          }}
        />
      )}
      
      {/* Navigation HUD */}
      <div className="absolute top-4 left-4 right-4 z-10">
        <div className="flex items-center justify-between">
          {/* Left controls */}
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="icon"
              onClick={handleClose}
              data-testid="button-close-reading-mode"
              className="hover-elevate active-elevate-2 backdrop-blur-sm bg-background/80"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            
            <Badge variant="secondary" className="backdrop-blur-sm bg-background/80">
              {currentIndex + 1} of {emails.length}
            </Badge>
          </div>

          {/* Center - Email status indicator */}
          <div className="flex items-center gap-2">
            {!email.isRead && (
              <Badge variant="default" className="backdrop-blur-sm bg-accent/90 text-accent-foreground">
                Unread
              </Badge>
            )}
            {email.priority > 0 && (
              <Badge 
                variant={email.priority === 3 ? "destructive" : "secondary"}
                className="backdrop-blur-sm"
              >
                Priority {email.priority}
              </Badge>
            )}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="icon"
              onClick={handlePrevious}
              disabled={currentIndex === 0}
              data-testid="button-previous-email"
              className="hover-elevate active-elevate-2 backdrop-blur-sm bg-background/80"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            
            <Button
              variant="secondary"
              size="icon"
              onClick={handleNext}
              disabled={currentIndex === emails.length - 1}
              data-testid="button-next-email"
              className="hover-elevate active-elevate-2 backdrop-blur-sm bg-background/80"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main content area with glass effect */}
      <div className="pt-16 px-8 pb-8 h-full">
        <div className="mx-auto max-w-4xl h-full">
          <div className="h-full rounded-lg backdrop-blur-lg bg-background/90 border shadow-2xl overflow-hidden">
            <EmailViewer
              email={email}
              onReply={onReply || handleReply}
              onReplyAll={onReply || handleReply}
              onForward={onForward || handleForward}
              onArchive={onArchive || handleArchive}
              onDelete={onDelete || handleDelete}
              onToggleFlagged={onToggleFlagged || handleToggleFlagged}
            />
          </div>
        </div>
      </div>

      {/* Side navigation arrows (floating) */}
      <Button
        variant="secondary"
        size="icon"
        className={cn(
          "absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full backdrop-blur-sm bg-background/80 hover-elevate active-elevate-2",
          currentIndex === 0 && "opacity-50 cursor-not-allowed"
        )}
        onClick={handlePrevious}
        disabled={currentIndex === 0}
        data-testid="button-nav-previous"
      >
        <ChevronLeft className="h-6 w-6" />
      </Button>
      
      <Button
        variant="secondary"
        size="icon"
        className={cn(
          "absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full backdrop-blur-sm bg-background/80 hover-elevate active-elevate-2",
          currentIndex === emails.length - 1 && "opacity-50 cursor-not-allowed"
        )}
        onClick={handleNext}
        disabled={currentIndex === emails.length - 1}
        data-testid="button-nav-next"
      >
        <ChevronRight className="h-6 w-6" />
      </Button>

      {/* Floating action bar */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10">
        <div className="flex items-center gap-2 p-2 rounded-lg backdrop-blur-lg bg-background/90 border shadow-lg">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReply}
            disabled={!onReply}
            data-testid="button-quick-reply"
            className="hover-elevate active-elevate-2"
          >
            <Reply className="h-4 w-4 mr-2" />
            Reply
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleForward}
            disabled={!onForward}
            data-testid="button-quick-forward"
            className="hover-elevate active-elevate-2"
          >
            <Forward className="h-4 w-4 mr-2" />
            Forward
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleArchive}
            data-testid="button-quick-archive"
            className="hover-elevate active-elevate-2"
          >
            <Archive className="h-4 w-4 mr-2" />
            Archive
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleFlagged}
            data-testid="button-quick-star"
            className="hover-elevate active-elevate-2"
          >
            <Star className={`h-4 w-4 mr-2 ${email?.isFlagged ? 'fill-amber-500 text-amber-500 dark:fill-amber-400 dark:text-amber-400' : ''}`} />
            {email?.isFlagged ? 'Unstar' : 'Star'}
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            data-testid="button-quick-delete"
            className="hover-elevate active-elevate-2 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}