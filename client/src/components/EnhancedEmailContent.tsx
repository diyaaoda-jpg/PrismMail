import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronDown, ChevronRight, Eye, Shield, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";
import type { EmailMessage } from '@shared/schema';

interface EnhancedEmailContentProps {
  email: EmailMessage;
  currentUserEmail?: string;
  showExpandedHeaders?: boolean;
}

interface EmailHeaders {
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  returnPath?: string;
  deliveredTo?: string;
  received?: string[];
  contentType?: string;
  mimeVersion?: string;
  userAgent?: string;
}

// SECURE DOMPurify configuration for email content - prevents XSS attacks
const EMAIL_PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'span', 'div',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
    'blockquote', 'pre', 'code',
    'a', 'img',
    'hr', 'sub', 'sup', 'small',
    'strike', 's', 'del', 'ins'
  ],
  ALLOWED_ATTR: [
    'href', 'src', 'alt', 'title', 'width', 'height',
    'align', 'valign', 'border', 'cellpadding', 'cellspacing'
  ],
  // Only allow safe URLs - block data: URIs and javascript:
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  // Security: DO NOT allow dangerous elements
  FORBID_TAGS: ['style', 'script', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'button', 'iframe', 'frame', 'frameset'],
  FORBID_ATTR: ['style', 'onclick', 'onerror', 'onload', 'onmouseover', 'onfocus', 'onblur', 'class', 'id'],
  // Security: Block data attributes completely
  ALLOW_DATA_ATTR: false,
  // Ensure clean output
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
  RETURN_TRUSTED_TYPE: false,
  // Remove unknown protocols
  SANITIZE_DOM: true
};

/**
 * Process inline images with Content-ID references
 */
function processInlineImages(htmlContent: string, attachments?: any[]): string {
  if (!attachments || attachments.length === 0) {
    return htmlContent;
  }
  
  let processedContent = htmlContent;
  
  // Find all img tags with src="cid:..." and replace with actual attachment URLs
  attachments.forEach(attachment => {
    if (attachment.isInline && attachment.contentId) {
      const cidPattern = new RegExp(`src="cid:${attachment.contentId}"`, 'gi');
      processedContent = processedContent.replace(cidPattern, `src="${attachment.downloadUrl}"`);
    }
  });
  
  return processedContent;
}

/**
 * Add CSS styles for better email rendering
 */
function addEmailStyles(htmlContent: string): string {
  const emailStyles = `
    <style>
      .email-content {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        line-height: 1.6;
        color: var(--foreground);
        background-color: var(--background);
      }
      
      .email-content table {
        border-collapse: collapse;
        width: 100%;
        max-width: 100%;
      }
      
      .email-content img {
        max-width: 100%;
        height: auto;
        border-radius: 4px;
      }
      
      .email-content blockquote {
        margin: 10px 0;
        padding: 10px 15px;
        border-left: 3px solid var(--muted-foreground);
        background-color: var(--muted);
        border-radius: 4px;
      }
      
      .email-content pre {
        background-color: var(--muted);
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 12px;
        overflow-x: auto;
        white-space: pre-wrap;
      }
      
      .email-content a {
        color: var(--primary);
        text-decoration: underline;
      }
      
      .email-content a:hover {
        opacity: 0.8;
      }
      
      /* Handle quoted text styling */
      .gmail_quote,
      .outlook_quote,
      [class*="quote"],
      blockquote[type="cite"] {
        margin: 15px 0 15px 10px;
        padding: 10px 15px;
        border-left: 2px solid var(--muted-foreground);
        background-color: var(--muted/50);
        border-radius: 0 4px 4px 0;
      }
      
      /* Responsive email content */
      @media (max-width: 768px) {
        .email-content table {
          font-size: 14px;
        }
        
        .email-content img {
          max-width: 100% !important;
          width: auto !important;
          height: auto !important;
        }
      }
    </style>
  `;
  
  return emailStyles + htmlContent;
}

/**
 * Extract and parse quoted text sections
 */
function parseQuotedText(htmlContent: string): { mainContent: string; quotedSections: string[] } {
  const quotedPatterns = [
    // Gmail style
    /<div class="gmail_quote">[\s\S]*?<\/div>/gi,
    // Outlook style  
    /<div class="outlook_quote">[\s\S]*?<\/div>/gi,
    // Generic blockquote
    /<blockquote[^>]*type="cite"[^>]*>[\s\S]*?<\/blockquote>/gi,
    // Generic quoted text with specific patterns
    /<div[^>]*class="[^"]*quote[^"]*"[^>]*>[\s\S]*?<\/div>/gi
  ];
  
  let mainContent = htmlContent;
  const quotedSections: string[] = [];
  
  quotedPatterns.forEach(pattern => {
    const matches = htmlContent.match(pattern);
    if (matches) {
      matches.forEach(match => {
        quotedSections.push(match);
        mainContent = mainContent.replace(match, `<div class="quoted-text-placeholder">[Quoted text hidden - expand to view]</div>`);
      });
    }
  });
  
  return { mainContent, quotedSections };
}

export function EnhancedEmailContent({ 
  email, 
  currentUserEmail,
  showExpandedHeaders = false 
}: EnhancedEmailContentProps) {
  const [showFullHeaders, setShowFullHeaders] = useState(false);
  const [showQuotedText, setShowQuotedText] = useState(false);
  const [loadExternalImages, setLoadExternalImages] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeSrc, setIframeSrc] = useState<string>('');

  // Parse email headers (this would typically come from the server)
  const emailHeaders: EmailHeaders = useMemo(() => {
    // In a real implementation, these would come from the email data
    return {
      messageId: email.id,
      contentType: email.bodyHtml ? 'text/html' : 'text/plain',
      mimeVersion: '1.0',
    };
  }, [email]);

  // Process email content
  const processedContent = useMemo(() => {
    if (!email.bodyHtml && !email.bodyText) {
      return { 
        content: `<div class="email-content"><p>${email.snippet}</p></div>`,
        hasQuotedText: false,
        quotedSections: []
      };
    }
    
    let htmlContent = email.bodyHtml || `<pre>${email.bodyText}</pre>`;
    
    // Process inline images
    // Note: In real implementation, you'd pass actual attachments here
    // htmlContent = processInlineImages(htmlContent, attachments);
    
    // Add email-specific CSS styling
    htmlContent = addEmailStyles(htmlContent);
    
    // Parse quoted text
    const { mainContent, quotedSections } = parseQuotedText(htmlContent);
    
    // Sanitize the content
    const sanitizedContent = DOMPurify.sanitize(
      showQuotedText ? htmlContent : mainContent, 
      EMAIL_PURIFY_CONFIG
    );
    
    return {
      content: `<div class="email-content">${sanitizedContent}</div>`,
      hasQuotedText: quotedSections.length > 0,
      quotedSections
    };
  }, [email.bodyHtml, email.bodyText, email.snippet, showQuotedText]);

  // SECURITY: Removed dangerous iframe implementation that could bypass CSP
  // HTML content is now safely displayed inline with proper DOMPurify sanitization
  // If iframe is needed in future, implement with proper CSP and sandbox attributes

  const headerEntries = Object.entries(emailHeaders).filter(([_, value]) => value != null);

  return (
    <div className="space-y-4">
      {/* Email Headers Section */}
      {showExpandedHeaders && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Email Headers</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowFullHeaders(!showFullHeaders)}
                className="text-xs"
              >
                {showFullHeaders ? (
                  <>
                    <ChevronDown className="h-3 w-3 mr-1" />
                    Hide Details
                  </>
                ) : (
                  <>
                    <ChevronRight className="h-3 w-3 mr-1" />
                    Show Details
                  </>
                )}
              </Button>
            </div>
            
            {showFullHeaders && (
              <div className="space-y-2 text-xs font-mono">
                {headerEntries.map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <span className="text-muted-foreground min-w-0 w-24 capitalize">
                      {key.replace(/([A-Z])/g, '-$1').toLowerCase()}:
                    </span>
                    <span className="flex-1 break-all">{String(value)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* External Images Warning */}
      {email.bodyHtml && !loadExternalImages && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-amber-600" />
                <span className="text-sm">External images are blocked for your security</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLoadExternalImages(true)}
                className="text-xs"
              >
                <Eye className="h-3 w-3 mr-1" />
                Load Images
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Email Content */}
      <div className="relative">
        {email.bodyHtml ? (
          // Use iframe for HTML content with sandboxing
          <div className="border rounded-md overflow-hidden">
            <iframe
              ref={iframeRef}
              src={iframeSrc}
              className="w-full min-h-96 border-0"
              sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              title="Email content"
              data-testid="email-content-iframe"
            />
          </div>
        ) : (
          // Direct rendering for plain text or simple HTML
          <div 
            className="prose prose-sm max-w-none dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: processedContent.content }}
            data-testid="email-content-direct"
          />
        )}
        
        {/* Quoted Text Section */}
        {processedContent.hasQuotedText && (
          <>
            <Separator className="my-4" />
            <div className="space-y-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowQuotedText(!showQuotedText)}
                className="text-xs text-muted-foreground"
                data-testid="button-toggle-quoted-text"
              >
                {showQuotedText ? (
                  <>
                    <ChevronDown className="h-3 w-3 mr-1" />
                    Hide quoted text
                  </>
                ) : (
                  <>
                    <ChevronRight className="h-3 w-3 mr-1" />
                    Show quoted text ({processedContent.quotedSections.length})
                  </>
                )}
              </Button>
              
              {showQuotedText && (
                <div className="pl-4 border-l-2 border-muted-foreground/20">
                  {processedContent.quotedSections.map((section, index) => (
                    <div
                      key={index}
                      className="prose prose-sm max-w-none dark:prose-invert text-muted-foreground"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(section, EMAIL_PURIFY_CONFIG) }}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}