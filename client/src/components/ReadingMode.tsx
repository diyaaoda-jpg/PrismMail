import { useState, useEffect } from "react";
import { X, ChevronLeft, ChevronRight, ArrowLeft, Reply, Forward, Archive, Star, Trash2, Clock, AlertTriangle, Flag, Eye, EyeOff } from "lucide-react";
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

  // Enhanced priority configuration for reading mode
  const getPriorityConfig = (priority: number) => {
    switch (priority) {
      case 3: return { icon: AlertTriangle, variant: 'destructive' as const, label: 'High Priority', color: '' };
      case 2: return { icon: Flag, variant: 'secondary' as const, label: 'Normal Priority', color: 'text-[hsl(var(--priority-normal))]' };
      case 1: return { icon: Clock, variant: 'outline' as const, label: 'Low Priority', color: 'text-[hsl(var(--priority-low))]' };
      default: return null;
    }
  };

  const priorityInfo = getPriorityConfig(email.priority);

  return (
    <div className="fixed inset-0 z-50">
      {/* Enhanced Background with Professional Gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-background/95 backdrop-blur-xl" />
      
      {/* Subtle Pattern Overlay */}
      <div className="absolute inset-0 opacity-[0.02]" 
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, hsl(var(--foreground)) 1px, transparent 0)`,
          backgroundSize: '20px 20px'
        }}
      />
      
      {/* Optional Background Image with Enhanced Treatment */}
      {backgroundImage && (
        <div 
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `url(${backgroundImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(3px) brightness(0.4) contrast(1.2)',
          }}
        />
      )}
      
      {/* Professional HUD Navigation */}
      <div className="absolute top-6 left-6 right-6 z-10">
        <div className="flex items-center justify-between">
          {/* Enhanced Left Controls */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon" 
              onClick={handleClose}
              data-testid="button-close-reading-mode"
              className={cn(
                "h-11 w-11 rounded-xl border-2 backdrop-blur-md",
                "bg-background/80 hover:bg-background/90 border-border/60 hover:border-border",
                "shadow-lg hover:shadow-xl transition-all duration-200"
              )}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            
            <Badge 
              variant="secondary" 
              className={cn(
                "px-4 py-2 text-sm font-medium backdrop-blur-md",
                "bg-background/80 border border-border/60 shadow-lg"
              )}
            >
              {currentIndex + 1} of {emails.length}
            </Badge>
          </div>

          {/* Enhanced Center Status Indicators */}
          <div className="flex items-center gap-3">
            {!email.isRead && (
              <Badge 
                variant="default"
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-sm font-medium",
                  "bg-[hsl(var(--status-unread))]/90 text-white",
                  "backdrop-blur-md shadow-lg border border-[hsl(var(--status-unread))]/30"
                )}
              >
                <Eye className="h-3.5 w-3.5" />
                Unread
              </Badge>
            )}
            
            {priorityInfo && (
              <Badge 
                variant={priorityInfo.variant}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-sm font-medium backdrop-blur-md",
                  "shadow-lg border-2", priorityInfo.color
                )}
              >
                <priorityInfo.icon className="h-3.5 w-3.5" />
                {priorityInfo.label}
              </Badge>
            )}
          </div>

          {/* Enhanced Right Controls */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={handlePrevious}
              disabled={currentIndex === 0}
              data-testid="button-previous-email"
              className={cn(
                "h-11 w-11 rounded-xl border-2 backdrop-blur-md transition-all duration-200",
                "bg-background/80 hover:bg-background/90 border-border/60 hover:border-border",
                "shadow-lg hover:shadow-xl disabled:opacity-40 disabled:cursor-not-allowed"
              )}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            
            <Button
              variant="outline"
              size="icon"
              onClick={handleNext}
              disabled={currentIndex === emails.length - 1}
              data-testid="button-next-email"
              className={cn(
                "h-11 w-11 rounded-xl border-2 backdrop-blur-md transition-all duration-200",
                "bg-background/80 hover:bg-background/90 border-border/60 hover:border-border", 
                "shadow-lg hover:shadow-xl disabled:opacity-40 disabled:cursor-not-allowed"
              )}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Enhanced Main Content Area with Professional Glass Effect */}
      <div className="pt-20 px-8 pb-20 h-full">
        <div className="mx-auto max-w-5xl h-full">
          <div className={cn(
            "h-full rounded-2xl backdrop-blur-2xl shadow-2xl overflow-hidden transition-all duration-300",
            "bg-gradient-to-b from-background/95 to-background/90 border border-border/40",
            "ring-1 ring-white/10 dark:ring-white/5"
          )}>
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

      {/* Enhanced Side Navigation Arrows */}
      <Button
        variant="outline"
        size="icon"
        className={cn(
          "absolute left-8 top-1/2 -translate-y-1/2 h-14 w-14 rounded-2xl backdrop-blur-lg",
          "bg-background/80 border-2 border-border/40 shadow-xl transition-all duration-200",
          "hover:bg-background/90 hover:border-border/60 hover:shadow-2xl hover:scale-105",
          currentIndex === 0 && "opacity-30 cursor-not-allowed hover:scale-100"
        )}
        onClick={handlePrevious}
        disabled={currentIndex === 0}
        data-testid="button-nav-previous"
      >
        <ChevronLeft className="h-6 w-6" />
      </Button>
      
      <Button
        variant="outline"
        size="icon"
        className={cn(
          "absolute right-8 top-1/2 -translate-y-1/2 h-14 w-14 rounded-2xl backdrop-blur-lg",
          "bg-background/80 border-2 border-border/40 shadow-xl transition-all duration-200",
          "hover:bg-background/90 hover:border-border/60 hover:shadow-2xl hover:scale-105",
          currentIndex === emails.length - 1 && "opacity-30 cursor-not-allowed hover:scale-100"
        )}
        onClick={handleNext}
        disabled={currentIndex === emails.length - 1}
        data-testid="button-nav-next"
      >
        <ChevronRight className="h-6 w-6" />
      </Button>

      {/* Enhanced Floating Action Bar */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20">
        <div className={cn(
          "flex items-center gap-2 p-3 rounded-2xl backdrop-blur-xl",
          "bg-gradient-to-r from-background/95 to-background/90",
          "border border-border/40 shadow-2xl ring-1 ring-white/10 dark:ring-white/5"
        )}>
          <Button
            variant="default"
            size="sm"
            onClick={handleReply}
            disabled={!onReply}
            data-testid="button-quick-reply"
            className={cn(
              "font-medium px-4 py-2.5 h-auto bg-primary hover:bg-primary/90",
              "shadow-lg hover:shadow-xl transition-all duration-200"
            )}
          >
            <Reply className="h-4 w-4 mr-2" />
            Reply
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={handleForward}
            disabled={!onForward}
            data-testid="button-quick-forward"
            className={cn(
              "font-medium px-4 py-2.5 h-auto border-2",
              "hover:bg-background/60 transition-all duration-200"
            )}
          >
            <Forward className="h-4 w-4 mr-2" />
            Forward
          </Button>
          
          <div className="w-px h-6 bg-border/40" />
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleFlagged}
            data-testid="button-quick-star"
            className={cn(
              "font-medium px-3 py-2.5 h-auto transition-all duration-200",
              email?.isFlagged 
                ? "text-[hsl(var(--status-flagged))] hover:bg-[hsl(var(--status-flagged))]/20" 
                : "hover:text-[hsl(var(--status-flagged))] hover:bg-[hsl(var(--status-flagged))]/10"
            )}
          >
            <Star className={cn(
              "h-4 w-4", 
              email?.isFlagged && "fill-[hsl(var(--status-flagged))] text-[hsl(var(--status-flagged))]"
            )} />
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleArchive}
            data-testid="button-quick-archive"
            className={cn(
              "font-medium px-3 py-2.5 h-auto transition-all duration-200",
              "hover:bg-[hsl(var(--status-archived))]/20 hover:text-[hsl(var(--status-archived))]"
            )}
          >
            <Archive className="h-4 w-4" />
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            data-testid="button-quick-delete"
            className={cn(
              "font-medium px-3 py-2.5 h-auto transition-all duration-200",
              "text-destructive/80 hover:text-destructive hover:bg-destructive/20"
            )}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}