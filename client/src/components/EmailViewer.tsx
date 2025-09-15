import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react";
import { Reply, ReplyAll, Forward, Archive, Trash, Star, MoreHorizontal, Paperclip, Download, FileText, Image, ZoomIn, ZoomOut, Printer, Eye, EyeOff, ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import DOMPurify from "dompurify";
import { getContextualLabels, shouldShowReplyAll } from "@/lib/emailUtils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/ThemeProvider";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSwipeGestures } from "@/hooks/useSwipeGestures";
import { triggerHapticFeedback, clamp } from "@/lib/gestureUtils";
import { LazyImage } from "./LazyImage";
import { useOptimizedEmailQuery } from "@/hooks/useOptimizedQuery";
import { performanceMonitor } from "@/lib/performanceMonitor";
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
  onToggleStar?: (email: EmailMessage) => void;
  onBack?: () => void;
  onNavigatePrevious?: () => void;
  onNavigateNext?: () => void;
  hasNext?: boolean;
  hasPrevious?: boolean;
  enableGestures?: boolean;
}

// Memoized attachment component for performance
const AttachmentItem = memo(function AttachmentItem({ attachment, onDownload }: {
  attachment: { id: string; fileName: string; fileSize: number; mimeType: string };
  onDownload: (id: string) => void;
}) {
  const handleDownload = useCallback(() => {
    onDownload(attachment.id);
  }, [attachment.id, onDownload]);

  const formatFileSize = useCallback((bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }, []);

  const isImage = attachment.mimeType.startsWith('image/');
  
  return (
    <div className="flex items-center gap-3 p-3 border rounded-lg hover-elevate active-elevate-2">
      <div className="flex-shrink-0">
        {isImage ? (
          <Image className="h-8 w-8 text-blue-500" />
        ) : (
          <FileText className="h-8 w-8 text-gray-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{attachment.fileName}</p>
        <p className="text-xs text-muted-foreground">{formatFileSize(attachment.fileSize)}</p>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={handleDownload}
        className="hover-elevate active-elevate-2"
        data-testid={`button-download-${attachment.id}`}
      >
        <Download className="h-4 w-4" />
      </Button>
    </div>
  );
});

export const EmailViewer = memo(function EmailViewer({
  email,
  currentUserEmail,
  onReply,
  onReplyAll, 
  onForward,
  onArchive,
  onDelete,
  onToggleFlagged,
  onBack,
  onNavigatePrevious,
  onNavigateNext,
  hasNext = false,
  hasPrevious = false,
  enableGestures = true,
}: EmailViewerProps) {
  // All hooks must be declared at the top in consistent order
  const { toast } = useToast();
  const { effectiveMode } = useTheme();
  const isMobile = useIsMobile();
  const contentRef = useRef<HTMLDivElement>(null);
  
  // State hooks first
  const [fontSize, setFontSize] = useState(100);
  const [showImages, setShowImages] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [contentLoaded, setContentLoaded] = useState(false);
  
  // Zoom and gesture state
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isZooming, setIsZooming] = useState(false);
  const [lastDoubleTapTime, setLastDoubleTapTime] = useState(0);
  const [showNavigationHints, setShowNavigationHints] = useState(false);
  
  // Gesture refs
  const viewerRef = useRef<HTMLDivElement>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);

  // Query hooks
  const { data: attachmentsData, isLoading: isLoadingAttachments } = useQuery({
    queryKey: ['/api/emails', email?.id, 'attachments'],
    enabled: !!email?.id,
  });

  interface AttachmentResponse {
    data: Array<{
      id: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
    }>;
  }
  
  const attachments = attachmentsData && typeof attachmentsData === 'object' && attachmentsData !== null && 'data' in attachmentsData 
    ? (attachmentsData as AttachmentResponse).data 
    : [];

  // Dark mode style transformation - MUST be declared before sanitizeHtml
  const applyDarkModeStyles = useCallback((html: string) => {
    // Transform common problematic styles for dark mode
    return html
      .replace(/color:\s*black/gi, 'color: var(--foreground)')
      .replace(/color:\s*#000000/gi, 'color: var(--foreground)')
      .replace(/color:\s*#000/gi, 'color: var(--foreground)')
      .replace(/background-color:\s*white/gi, 'background-color: var(--background)')
      .replace(/background-color:\s*#ffffff/gi, 'background-color: var(--background)')
      .replace(/background-color:\s*#fff/gi, 'background-color: var(--background)')
      .replace(/border-color:\s*#cccccc/gi, 'border-color: var(--border)')
      .replace(/border-color:\s*#ccc/gi, 'border-color: var(--border)');
  }, []);

  // Secure HTML sanitization with minimal allowed tags/attributes
  const sanitizeHtml = useMemo(() => {
    return (html: string) => {
      const config = {
        // Minimal allowed tags for email content
        ALLOWED_TAGS: [
          'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's',
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre',
          'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
          'a', 'hr', 'sub', 'sup', 'small'
        ],
        // Minimal allowed attributes - removed style, class, id for security
        ALLOWED_ATTR: [
          'href', 'title', 'alt', 'target', 'rel', 'colspan', 'rowspan', 'align',
          'width', 'height'
        ],
        // Restrict data URIs to safe image formats only
        ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid):|data:image\/(png|jpeg|jpg|gif|webp);base64,|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
        ALLOW_DATA_ATTR: false,
        ALLOW_UNKNOWN_PROTOCOLS: false,
        SANITIZE_DOM: true,
        KEEP_CONTENT: true,
        transformCaseFunc: (tagName: string) => tagName.toLowerCase(),
      };
      
      let sanitized = DOMPurify.sanitize(html, config);
      
      // Remove images if not explicitly allowed - use clean placeholder
      if (!showImages) {
        sanitized = sanitized.replace(
          /<img[^>]*>/gi,
          '<div class="image-placeholder">Image content hidden - click "Show Images" to display</div>'
        );
      }
      
      // Apply dark mode compatible styles
      if (effectiveMode === 'dark') {
        sanitized = applyDarkModeStyles(sanitized);
      }
      
      return sanitized;
    };
  }, [showImages, effectiveMode, applyDarkModeStyles]);
  
  // Print functionality
  const handlePrint = useCallback(() => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    
    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Email: ${email?.subject || 'Untitled'}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 2rem; line-height: 1.6; color: #000; }
            .email-header { border-bottom: 1px solid #ccc; padding-bottom: 1rem; margin-bottom: 1rem; }
            .email-content { max-width: none; }
            .email-content img { max-width: 100%; height: auto; }
            .email-content table { border-collapse: collapse; width: 100%; }
            .email-content td, .email-content th { border: 1px solid #ddd; padding: 0.5rem; }
            @media print { body { margin: 0; } }
          </style>
        </head>
        <body>
          <div class="email-header">
            <h2>${email?.subject || 'Untitled'}</h2>
            <p><strong>From:</strong> ${email?.from || 'Unknown'}</p>
            <p><strong>Date:</strong> ${email?.date ? new Date(email.date).toLocaleString() : 'Unknown'}</p>
            ${email?.to ? `<p><strong>To:</strong> ${email.to}</p>` : ''}
            ${email?.cc ? `<p><strong>CC:</strong> ${email.cc}</p>` : ''}
          </div>
          <div class="email-content">
            ${email?.bodyHtml ? sanitizeHtml(email.bodyHtml) : (email?.bodyText || email?.snippet || '').replace(/\n/g, '<br>')}
          </div>
        </body>
      </html>
    `;
    
    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  }, [email]);
  
  // Font size controls
  const increaseFontSize = useCallback(() => {
    setFontSize(prev => Math.min(prev + 10, 150));
  }, []);
  
  const decreaseFontSize = useCallback(() => {
    setFontSize(prev => Math.max(prev - 10, 70));
  }, []);
  
  const resetFontSize = useCallback(() => {
    setFontSize(100);
  }, []);
  
  // Navigation gesture configuration
  const navigationGestureConfig = {
    leftActions: hasPrevious ? [{
      type: 'previous' as const,
      icon: 'ChevronLeft',
      color: 'hsl(var(--primary))',
      label: 'Previous Email',
      threshold: 80,
      callback: () => {
        onNavigatePrevious?.();
        if (isMobile) triggerHapticFeedback('light');
      },
    }] : [],
    rightActions: hasNext ? [{
      type: 'next' as const,
      icon: 'ChevronRight', 
      color: 'hsl(var(--primary))',
      label: 'Next Email',
      threshold: 80,
      callback: () => {
        onNavigateNext?.();
        if (isMobile) triggerHapticFeedback('light');
      },
    }] : [],
    enableHapticFeedback: isMobile && enableGestures,
    preventScrolling: false,
  };

  // Close gesture configuration (swipe down)
  const closeGestureConfig = {
    leftActions: [],
    rightActions: [],
    enableHapticFeedback: isMobile && enableGestures,
    preventScrolling: false,
  };

  const navigationGestures = useSwipeGestures(
    enableGestures && isMobile ? navigationGestureConfig : { leftActions: [], rightActions: [] }
  );

  // Zoom functionality
  const handlePinchZoom = useCallback((scaleFactor: number) => {
    if (!enableGestures) return;
    
    setZoomLevel(prev => {
      const newZoom = clamp(prev * scaleFactor, 0.5, 3.0);
      return newZoom;
    });
    setIsZooming(true);
    
    // Clear zooming state after animation
    setTimeout(() => setIsZooming(false), 300);
  }, [enableGestures]);

  // Double tap to zoom
  const handleDoubleTap = useCallback((event: React.TouchEvent | React.PointerEvent) => {
    if (!enableGestures || !isMobile) return;
    
    const currentTime = Date.now();
    const timeDiff = currentTime - lastDoubleTapTime;
    
    if (timeDiff < 300) { // Double tap detected
      event.preventDefault();
      
      if (zoomLevel > 1) {
        // Reset zoom
        setZoomLevel(1);
        triggerHapticFeedback('light');
      } else {
        // Smart zoom to 1.5x
        setZoomLevel(1.5);
        triggerHapticFeedback('medium');
      }
      
      setIsZooming(true);
      setTimeout(() => setIsZooming(false), 300);
    }
    
    setLastDoubleTapTime(currentTime);
  }, [enableGestures, isMobile, lastDoubleTapTime, zoomLevel]);

  // Handle swipe down to close
  const handleSwipeDown = useCallback((event: TouchEvent) => {
    if (!enableGestures || !isMobile || !onBack) return;
    
    const touch = event.touches[0];
    const startY = touch?.clientY || 0;
    
    const handleTouchMove = (moveEvent: TouchEvent) => {
      const currentTouch = moveEvent.touches[0];
      if (!currentTouch) return;
      
      const deltaY = currentTouch.clientY - startY;
      
      // If swipe down more than 100px, trigger close
      if (deltaY > 100) {
        moveEvent.preventDefault();
        onBack();
        triggerHapticFeedback('medium');
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
      }
    };
    
    const handleTouchEnd = () => {
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
    
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
  }, [enableGestures, isMobile, onBack]);

  // Enhanced image loading with lazy loading simulation
  useEffect(() => {
    if (email?.bodyHtml) {
      setIsLoadingContent(true);
      // Simulate processing time for complex emails
      const timer = setTimeout(() => {
        setIsLoadingContent(false);
        setContentLoaded(true);
      }, 100);
      return () => clearTimeout(timer);
    } else {
      setContentLoaded(true);
    }
  }, [email]);

  // Show navigation hints on mobile
  useEffect(() => {
    if (isMobile && enableGestures && (hasNext || hasPrevious)) {
      setShowNavigationHints(true);
      const timer = setTimeout(() => setShowNavigationHints(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [email, isMobile, enableGestures, hasNext, hasPrevious]);
  
  // CRITICAL: All useMemo hooks must be called before any early returns to maintain hooks order
  const contextualLabels = useMemo(() => {
    return email ? getContextualLabels(email) : { reply: 'Reply', replyAll: 'Reply All', forward: 'Forward' };
  }, [email]);

  const showReplyAll = useMemo(() => {
    return email ? shouldShowReplyAll(email, currentUserEmail) : true;
  }, [email, currentUserEmail]);
  
  // Utility functions for attachments
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return Image;
    return FileText;
  };

  const handleDownloadAttachment = async (attachmentId: string, fileName: string) => {
    try {
      const response = await fetch(`/api/attachments/${attachmentId}/download`, {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to download attachment');
      }

      // Create blob and download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: "Download Started",
        description: `${fileName} is being downloaded.`,
      });
    } catch (error) {
      console.error('Download failed:', error);
      toast({
        title: "Download Failed",
        description: "Failed to download attachment. Please try again.",
        variant: "destructive"
      });
    }
  };

  // Early return AFTER all hooks have been called
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

  const handleToggleStar = () => {
    onToggleFlagged?.(email);
    console.log('Toggle star:', email.id);
  };

  const priorityLabel = {
    0: '',
    1: 'Low Priority',
    2: 'Medium Priority', 
    3: 'High Priority'
  };

  return (
    <div 
      ref={viewerRef}
      className="relative flex-1 flex flex-col bg-background email-viewer-enhanced"
      onTouchStart={enableGestures && isMobile ? navigationGestures.handlers.onTouchStart : undefined}
      onTouchMove={enableGestures && isMobile ? navigationGestures.handlers.onTouchMove : undefined}
      onTouchEnd={enableGestures && isMobile ? navigationGestures.handlers.onTouchEnd : undefined}
      onPointerDown={enableGestures && isMobile ? navigationGestures.handlers.onPointerDown : undefined}
      onPointerMove={enableGestures && isMobile ? navigationGestures.handlers.onPointerMove : undefined}
      onPointerUp={enableGestures && isMobile ? navigationGestures.handlers.onPointerUp : undefined}
    >
      {/* Navigation gesture visual feedback */}
      {enableGestures && isMobile && navigationGestures.swipeState.isActive && (
        <div className="absolute inset-0 pointer-events-none z-40">
          {navigationGestures.swipeState.direction === 'left' && hasPrevious && (
            <div 
              className="absolute left-0 top-0 h-full bg-primary/20 transition-all duration-200 flex items-center justify-start"
              style={{ width: Math.min(navigationGestures.swipeState.distance, 120) }}
            >
              <div className="flex items-center justify-center h-full px-6">
                <ChevronLeft className="h-8 w-8 text-primary" />
                <span className="ml-2 text-primary font-medium">Previous</span>
              </div>
            </div>
          )}
          {navigationGestures.swipeState.direction === 'right' && hasNext && (
            <div 
              className="absolute right-0 top-0 h-full bg-primary/20 transition-all duration-200 flex items-center justify-end"
              style={{ width: Math.min(navigationGestures.swipeState.distance, 120) }}
            >
              <div className="flex items-center justify-center h-full px-6">
                <span className="mr-2 text-primary font-medium">Next</span>
                <ChevronRight className="h-8 w-8 text-primary" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Navigation hints */}
      {showNavigationHints && enableGestures && isMobile && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-50 pointer-events-none">
          <div className="bg-black/70 text-white px-4 py-2 rounded-full text-sm font-medium animate-fade-in-out">
            Swipe left/right to navigate emails
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col">
      {/* Mobile Header - Only shown on mobile */}
      {isMobile && onBack && (
        <div className="h-14 border-b flex items-center justify-between px-4 bg-card">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="hover-elevate active-elevate-2"
              data-testid="button-mobile-back"
              aria-label="Go back to email list"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-lg font-semibold truncate">
              {email?.subject || 'Email'}
            </h1>
          </div>
          
          <div className="flex items-center gap-2">
            {email?.bodyHtml && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowImages(!showImages)}
                title={showImages ? "Hide images" : "Show images"}
                data-testid="button-mobile-toggle-images"
                className="hover-elevate active-elevate-2"
                aria-label={showImages ? "Hide images" : "Show images"}
              >
                {showImages ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            )}
            
            <Button
              variant="ghost"
              size="icon"
              onClick={handleToggleStar}
              data-testid="button-mobile-toggle-star"
              className="hover-elevate active-elevate-2"
              aria-label={email?.isStarred ? "Remove star" : "Add star"}
            >
              <Star className={cn(
                "h-4 w-4",
                email?.isStarred ? "fill-amber-500 text-amber-500 dark:fill-amber-400 dark:text-amber-400" : "text-muted-foreground"
              )} />
            </Button>
          </div>
        </div>
      )}
      
      {/* Desktop Header */}
      <div className={cn(
        "p-4 border-b bg-card",
        isMobile && onBack ? "hidden" : ""
      )}>
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
            {/* Accessibility Controls */}
            <div className="flex items-center gap-1 border-r pr-2 mr-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={decreaseFontSize}
                title="Decrease font size"
                data-testid="button-font-decrease"
                className="hover-elevate active-elevate-2"
                disabled={fontSize <= 70}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground min-w-[3ch] text-center">{fontSize}%</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={increaseFontSize}
                title="Increase font size"
                data-testid="button-font-increase"
                className="hover-elevate active-elevate-2"
                disabled={fontSize >= 150}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              {email?.bodyHtml && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowImages(!showImages)}
                  title={showImages ? "Hide images" : "Show images"}
                  data-testid="button-toggle-images"
                  className="hover-elevate active-elevate-2"
                >
                  {showImages ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={handlePrint}
                title="Print email"
                data-testid="button-print"
                className="hover-elevate active-elevate-2"
              >
                <Printer className="h-4 w-4" />
              </Button>
            </div>
            
            <Button
              variant="ghost"
              size="icon"
              onClick={handleToggleStar}
              data-testid="button-toggle-star-viewer"
              className="hover-elevate active-elevate-2"
            >
              <Star className={cn(
                "h-4 w-4",
                email.isStarred ? "fill-amber-500 text-amber-500 dark:fill-amber-400 dark:text-amber-400" : "text-muted-foreground"
              )} />
            </Button>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" data-testid="button-email-more" aria-label="More email actions" title="More email actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={resetFontSize} data-testid="button-reset-font">
                  <ZoomIn className="h-4 w-4 mr-2" />
                  Reset Font Size
                </DropdownMenuItem>
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
        <ScrollArea 
          className="flex-1" 
          ref={contentScrollRef}
          onTouchStart={enableGestures && isMobile ? handleSwipeDown : undefined}
        >
          <div 
            ref={contentRef}
            className={cn(
              "p-6 prose prose-sm max-w-none dark:prose-invert email-content-container",
              "transition-transform duration-300 transform-gpu",
              isZooming && "transition-transform duration-300"
            )}
            style={{ 
              fontSize: `${fontSize}%`,
              transform: `scale(${zoomLevel})`,
              transformOrigin: 'top center'
            }}
            onTouchStart={enableGestures && isMobile ? handleDoubleTap : undefined}
            onPointerDown={enableGestures && isMobile ? handleDoubleTap : undefined}
          >
            {isLoadingContent && email?.bodyHtml ? (
              <div className="flex items-center justify-center py-8" data-testid="email-loading">
                <div className="text-muted-foreground">Loading email content...</div>
              </div>
            ) : (
              <div data-testid="text-email-content" className="email-content">
                {email.bodyHtml ? (
                  <>
                    {!showImages && email.bodyHtml.includes('<img') && (
                      <div className="mb-4 p-3 bg-muted/50 border border-border rounded-md flex items-center gap-2" data-testid="images-blocked-notice">
                        <Eye className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Images are hidden for security</span>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => setShowImages(true)}
                          data-testid="button-show-images-inline"
                        >
                          Show Images
                        </Button>
                      </div>
                    )}
                    <div 
                      className="email-html-content"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(email.bodyHtml) }} 
                    />
                  </>
                ) : email.bodyText ? (
                  <div 
                    className="email-text-content"
                    style={{ 
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'inherit',
                      lineHeight: '1.6',
                      wordBreak: 'break-word'
                    }}
                  >
                    {email.bodyText}
                  </div>
                ) : (
                  <div className="email-snippet-content">
                    <p style={{ fontStyle: 'italic', color: 'var(--muted-foreground)' }}>
                      {email.snippet || 'No content available'}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Attachments Section */}
        {attachments && attachments.length > 0 && (
          <div className="border-t bg-card">
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">
                  {attachments.length} attachment{attachments.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {attachments.map((attachment: {
                  id: string;
                  fileName: string;
                  fileSize: number;
                  mimeType: string;
                }, index: number) => {
                  const FileIcon = getFileIcon(attachment.mimeType);
                  return (
                    <div
                      key={attachment.id}
                      className="flex items-center gap-3 p-3 border rounded-md hover-elevate active-elevate-2 cursor-pointer"
                      onClick={() => handleDownloadAttachment(attachment.id, attachment.fileName)}
                      data-testid={`attachment-${index}`}
                    >
                      <FileIcon className="h-8 w-8 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate" title={attachment.fileName}>
                          {attachment.fileName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatFileSize(attachment.fileSize)}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="opacity-60 hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadAttachment(attachment.id, attachment.fileName);
                        }}
                        data-testid={`button-download-attachment-${index}`}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
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
            
            <Separator orientation="vertical" className="h-6" />
            
            <Button 
              variant={email.isStarred ? "default" : "ghost"} 
              size="sm"
              onClick={handleToggleStar}
              data-testid="button-star"
              className={cn(
                "hover-elevate active-elevate-2",
                email.isStarred && "text-amber-600 bg-amber-50 hover:bg-amber-100 dark:text-amber-400 dark:bg-amber-950/50"
              )}
            >
              <Star className={cn("h-4 w-4 mr-2", email.isStarred && "fill-current")} />
              {email.isStarred ? "Starred" : "Star"}
            </Button>
            
            <Button 
              variant="ghost" 
              size="sm"
              onClick={handleArchive}
              data-testid="button-archive"
              className="hover-elevate active-elevate-2"
            >
              <Archive className="h-4 w-4 mr-2" />
              Archive
            </Button>
            
            <Button 
              variant="ghost" 
              size="sm"
              onClick={handleDelete}
              data-testid="button-delete"
              className="hover-elevate active-elevate-2 text-destructive hover:text-destructive"
            >
              <Trash className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
  );
});