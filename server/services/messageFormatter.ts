import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

// Initialize DOMPurify with JSDOM for server-side usage
const window = (new JSDOM('')).window as unknown as Window;
const DOMPurify = createDOMPurify(window);

export interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: any }>;
  attrs?: any;
}

export interface TipTapDocument {
  type: 'doc';
  content: TipTapNode[];
}

export interface FormattedMessage {
  html: string;
  text: string;
  wordCount: number;
  hasRichContent: boolean;
}

export interface ReplyForwardOptions {
  mode: 'reply' | 'reply_all' | 'forward';
  originalFrom: string;
  originalDate: Date;
  originalSubject: string;
  originalBodyHtml?: string;
  originalBodyText?: string;
  originalTo?: string;
  originalCc?: string;
}

/**
 * Message formatting service for converting TipTap content and handling email composition
 */
export class MessageFormatterService {
  private static instance: MessageFormatterService;
  
  public static getInstance(): MessageFormatterService {
    if (!MessageFormatterService.instance) {
      MessageFormatterService.instance = new MessageFormatterService();
    }
    return MessageFormatterService.instance;
  }

  /**
   * Convert TipTap JSON to HTML and plain text
   */
  public formatMessage(content: string | TipTapDocument): FormattedMessage {
    try {
      let document: TipTapDocument;
      
      // Parse content if it's a string
      if (typeof content === 'string') {
        // Try to parse as JSON first
        try {
          document = JSON.parse(content);
        } catch {
          // If not JSON, treat as plain text
          return this.formatPlainText(content);
        }
      } else {
        document = content;
      }
      
      if (!document || document.type !== 'doc' || !document.content) {
        return this.formatPlainText('');
      }
      
      const html = this.convertToHTML(document);
      const text = this.convertToText(document);
      const wordCount = this.countWords(text);
      const hasRichContent = this.hasRichFormatting(document);
      
      return {
        html: this.sanitizeHTML(html),
        text: text.trim(),
        wordCount,
        hasRichContent
      };
      
    } catch (error) {
      console.error('Error formatting message:', error);
      // Fallback to treating as plain text
      const fallbackText = typeof content === 'string' ? content : '';
      return this.formatPlainText(fallbackText);
    }
  }
  
  /**
   * Generate reply or forward content with proper attribution
   */
  public generateReplyForward(
    userContent: string | TipTapDocument,
    options: ReplyForwardOptions
  ): FormattedMessage {
    const userMessage = this.formatMessage(userContent);
    const attribution = this.createAttribution(options);
    
    let combinedHtml: string;
    let combinedText: string;
    
    if (options.mode === 'forward') {
      combinedHtml = `${userMessage.html}${attribution.html}`;
      combinedText = `${userMessage.text}${attribution.text}`;
    } else {
      // Reply mode - user content first, then quoted original
      combinedHtml = `${userMessage.html}${attribution.html}`;
      combinedText = `${userMessage.text}${attribution.text}`;
    }
    
    return {
      html: this.sanitizeHTML(combinedHtml),
      text: combinedText.trim(),
      wordCount: this.countWords(combinedText),
      hasRichContent: userMessage.hasRichContent || attribution.hasRichContent
    };
  }
  
  /**
   * Convert TipTap document to HTML
   */
  private convertToHTML(document: TipTapDocument): string {
    if (!document.content) return '';
    
    return document.content.map(node => this.nodeToHTML(node)).join('');
  }
  
  /**
   * Convert a single TipTap node to HTML
   */
  private nodeToHTML(node: TipTapNode): string {
    switch (node.type) {
      case 'paragraph':
        const pContent = node.content ? node.content.map(child => this.nodeToHTML(child)).join('') : '';
        return `<p>${pContent}</p>`;
        
      case 'text':
        let text = node.text || '';
        
        // Apply marks (formatting)
        if (node.marks) {
          for (const mark of node.marks) {
            switch (mark.type) {
              case 'bold':
                text = `<strong>${text}</strong>`;
                break;
              case 'italic':
                text = `<em>${text}</em>`;
                break;
              case 'underline':
                text = `<u>${text}</u>`;
                break;
              case 'code':
                text = `<code>${text}</code>`;
                break;
              case 'link':
                const href = mark.attrs?.href || '#';
                text = `<a href="${href}">${text}</a>`;
                break;
            }
          }
        }
        
        return text;
        
      case 'hardBreak':
        return '<br>';
        
      case 'heading':
        const level = Math.min(Math.max(node.attrs?.level || 1, 1), 6);
        const headingContent = node.content ? node.content.map(child => this.nodeToHTML(child)).join('') : '';
        return `<h${level}>${headingContent}</h${level}>`;
        
      case 'bulletList':
        const bulletItems = node.content ? node.content.map(child => this.nodeToHTML(child)).join('') : '';
        return `<ul>${bulletItems}</ul>`;
        
      case 'orderedList':
        const orderedItems = node.content ? node.content.map(child => this.nodeToHTML(child)).join('') : '';
        const start = node.attrs?.start || 1;
        return `<ol start="${start}">${orderedItems}</ol>`;
        
      case 'listItem':
        const itemContent = node.content ? node.content.map(child => this.nodeToHTML(child)).join('') : '';
        return `<li>${itemContent}</li>`;
        
      case 'blockquote':
        const quoteContent = node.content ? node.content.map(child => this.nodeToHTML(child)).join('') : '';
        return `<blockquote>${quoteContent}</blockquote>`;
        
      case 'codeBlock':
        const codeContent = node.content ? node.content.map(child => this.nodeToHTML(child)).join('') : '';
        const language = node.attrs?.language || '';
        return `<pre><code${language ? ` class="language-${language}"` : ''}>${codeContent}</code></pre>`;
        
      case 'horizontalRule':
        return '<hr>';
        
      default:
        // For unknown types, try to process content
        if (node.content) {
          return node.content.map(child => this.nodeToHTML(child)).join('');
        }
        return node.text || '';
    }
  }
  
  /**
   * Convert TipTap document to plain text
   */
  private convertToText(document: TipTapDocument): string {
    if (!document.content) return '';
    
    return document.content.map(node => this.nodeToText(node)).join('\n');
  }
  
  /**
   * Convert a single TipTap node to plain text
   */
  private nodeToText(node: TipTapNode): string {
    switch (node.type) {
      case 'paragraph':
        return node.content ? node.content.map(child => this.nodeToText(child)).join('') : '';
        
      case 'text':
        return node.text || '';
        
      case 'hardBreak':
        return '\n';
        
      case 'heading':
        const headingText = node.content ? node.content.map(child => this.nodeToText(child)).join('') : '';
        return headingText + '\n';
        
      case 'bulletList':
      case 'orderedList':
        return node.content ? node.content.map((child, index) => {
          const marker = node.type === 'bulletList' ? '• ' : `${index + 1}. `;
          return marker + this.nodeToText(child);
        }).join('\n') : '';
        
      case 'listItem':
        return node.content ? node.content.map(child => this.nodeToText(child)).join('') : '';
        
      case 'blockquote':
        const quoteText = node.content ? node.content.map(child => this.nodeToText(child)).join('') : '';
        return '> ' + quoteText.split('\n').join('\n> ');
        
      case 'codeBlock':
        return node.content ? node.content.map(child => this.nodeToText(child)).join('') : '';
        
      case 'horizontalRule':
        return '---';
        
      default:
        if (node.content) {
          return node.content.map(child => this.nodeToText(child)).join('');
        }
        return node.text || '';
    }
  }
  
  /**
   * Create attribution block for replies and forwards
   */
  private createAttribution(options: ReplyForwardOptions): FormattedMessage {
    const dateStr = options.originalDate.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    let html: string;
    let text: string;
    
    if (options.mode === 'forward') {
      html = `
<br><br>
<div style="border-left: 3px solid #ccc; margin: 10px 0; padding-left: 15px; color: #666;">
  <p><strong>---------- Forwarded message ----------</strong></p>
  <p><strong>From:</strong> ${this.escapeHtml(options.originalFrom)}</p>
  ${options.originalTo ? `<p><strong>To:</strong> ${this.escapeHtml(options.originalTo)}</p>` : ''}
  ${options.originalCc ? `<p><strong>Cc:</strong> ${this.escapeHtml(options.originalCc)}</p>` : ''}
  <p><strong>Date:</strong> ${dateStr}</p>
  <p><strong>Subject:</strong> ${this.escapeHtml(options.originalSubject)}</p>
  <br>
  ${options.originalBodyHtml || this.textToHtml(options.originalBodyText || '')}
</div>`;
      
      text = `

---------- Forwarded message ----------
From: ${options.originalFrom}
${options.originalTo ? `To: ${options.originalTo}` : ''}
${options.originalCc ? `Cc: ${options.originalCc}` : ''}
Date: ${dateStr}
Subject: ${options.originalSubject}

${options.originalBodyText || ''}`;
      
    } else {
      // Reply mode
      html = `
<br><br>
<div style="border-left: 3px solid #ccc; margin: 10px 0; padding-left: 15px; color: #666;">
  <p>On ${dateStr}, <strong>${this.escapeHtml(options.originalFrom)}</strong> wrote:</p>
  ${options.originalBodyHtml || this.textToHtml(options.originalBodyText || '')}
</div>`;
      
      text = `

On ${dateStr}, ${options.originalFrom} wrote:
> ${(options.originalBodyText || '').split('\n').join('\n> ')}`;
    }
    
    return {
      html,
      text,
      wordCount: this.countWords(text),
      hasRichContent: true
    };
  }
  
  /**
   * Format plain text content
   */
  private formatPlainText(text: string): FormattedMessage {
    return {
      html: this.textToHtml(text),
      text: text.trim(),
      wordCount: this.countWords(text),
      hasRichContent: false
    };
  }
  
  /**
   * Convert plain text to HTML with proper line breaks
   */
  private textToHtml(text: string): string {
    return text
      .split('\n')
      .map(line => `<p>${this.escapeHtml(line) || '<br>'}</p>`)
      .join('');
  }
  
  /**
   * Escape HTML entities
   */
  private escapeHtml(text: string): string {
    const div = window.document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  /**
   * Sanitize HTML content for security
   */
  private sanitizeHTML(html: string): string {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'u', 'code', 'pre', 'a', 'ul', 'ol', 'li',
        'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'div', 'span'
      ],
      ALLOWED_ATTR: ['href', 'style', 'class'],
      ALLOW_DATA_ATTR: false
    });
  }
  
  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }
  
  /**
   * Check if document has rich formatting
   */
  private hasRichFormatting(document: TipTapDocument): boolean {
    return this.checkNodeForRichContent(document);
  }
  
  /**
   * Recursively check nodes for rich content
   */
  private checkNodeForRichContent(node: any): boolean {
    // Check if this node itself has rich content
    if (node.type && !['doc', 'paragraph', 'text'].includes(node.type)) {
      return true;
    }
    
    // Check if text has marks (formatting)
    if (node.marks && node.marks.length > 0) {
      return true;
    }
    
    // Recursively check content
    if (node.content) {
      return node.content.some((child: any) => this.checkNodeForRichContent(child));
    }
    
    return false;
  }
  
  /**
   * Generate subject line for reply/forward
   */
  public generateSubject(originalSubject: string, mode: 'reply' | 'reply_all' | 'forward'): string {
    const cleanSubject = originalSubject.replace(/^(RE:|FW:|FWD:)\s*/i, '').trim();
    
    if (mode === 'forward') {
      return `FW: ${cleanSubject}`;
    } else {
      return `RE: ${cleanSubject}`;
    }
  }
  
  /**
   * Extract plain text from HTML content
   */
  public htmlToText(html: string): string {
    const window = new JSDOM(html).window;
    const textContent = window.document.body?.textContent || '';
    return textContent.trim();
  }
  
  /**
   * Validate email content for sending
   */
  public validateContent(content: FormattedMessage): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!content.text.trim()) {
      errors.push('Email body cannot be empty');
    }
    
    if (content.text.length > 1000000) { // 1MB limit
      errors.push('Email content is too large (limit: 1MB)');
    }
    
    if (content.wordCount > 50000) {
      errors.push('Email is too long (limit: 50,000 words)');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}

// Export singleton instance
export const messageFormatter = MessageFormatterService.getInstance();