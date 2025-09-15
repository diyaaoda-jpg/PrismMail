import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { X, Send, Paperclip, Bold, Italic, Underline, FileText, Image, Download, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { SendEmailRequest, SendEmailResponse, AccountConnection, ImapSettings, EwsSettings } from "@shared/schema";
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

interface ComposeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  accountId?: string; // Account ID for sending emails
  replyTo?: {
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    body?: string;
  };
}

// Attachment interface
interface AttachmentFile {
  id?: string;
  file?: File;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt?: string;
  uploading?: boolean;
}

export function ComposeDialog({ isOpen, onClose, accountId, replyTo }: ComposeDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    to: replyTo?.to || "",
    cc: replyTo?.cc || "",
    bcc: replyTo?.bcc || "",
    subject: replyTo?.subject || "",
    body: replyTo?.body || ""
  });

  // Attachment state
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch account information for the From field
  const { data: accountsData, isLoading: isLoadingAccounts } = useQuery({
    queryKey: ['/api/accounts'],
    enabled: isOpen, // Fetch accounts whenever dialog is open
  });

  // Find the current account from the accounts list
  const accountsList = accountsData && typeof accountsData === 'object' && accountsData !== null && 'data' in accountsData ? (accountsData as any).data as AccountConnection[] : undefined;
  
  // Auto-select account: use provided accountId, or fall back to first active account
  let currentAccount = accountsList?.find((account: AccountConnection) => account.id === accountId);
  
  // If no account found with provided ID, auto-select the primary account
  if (!currentAccount && accountsList && accountsList.length > 0) {
    // Prefer IMAP accounts over EWS for sending emails
    currentAccount = accountsList.find(account => account.isActive && account.protocol === 'IMAP') ||
                     accountsList.find(account => account.isActive) ||
                     accountsList[0];
  }

  // Extract email from account settings
  const getAccountEmail = (account: AccountConnection | undefined): string => {
    if (!account) return '';
    
    try {
      const settings = JSON.parse(account.settingsJson);
      if (account.protocol === 'IMAP') {
        const imapSettings = settings as ImapSettings;
        return imapSettings.username; // For IMAP, username is typically the email
      } else if (account.protocol === 'EWS') {
        const ewsSettings = settings as EwsSettings;
        // For EWS, username might be email or DOMAIN\username format
        const username = ewsSettings.username;
        // If it contains @, it's likely an email
        if (username.includes('@')) {
          return username;
        }
        // If it's DOMAIN\username format, we can't determine email easily
        return username;
      }
    } catch (error) {
      console.error('Error parsing account settings:', error);
    }
    return '';
  };

  const accountEmail = getAccountEmail(currentAccount);
  const fromDisplay = currentAccount ? `${currentAccount.name} <${accountEmail}>` : '';

  // Initialize TipTap editor
  const editor = useEditor({
    extensions: [StarterKit],
    content: formData.body,
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none min-h-[300px] p-4',
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      setFormData(prev => ({ ...prev, body: html }));
    },
  });

  // Update editor content when replyTo changes
  useEffect(() => {
    if (editor && replyTo?.body) {
      editor.commands.setContent(replyTo.body);
    }
  }, [editor, replyTo]);

  // Update form data when replyTo changes
  useEffect(() => {
    if (replyTo) {
      setFormData({
        to: replyTo.to || "",
        cc: replyTo.cc || "",
        bcc: replyTo.bcc || "",
        subject: replyTo.subject || "",
        body: replyTo.body || ""
      });
    }
  }, [replyTo]);

  // File upload mutation
  const uploadAttachmentMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('attachments', file);
      
      const response = await apiRequest('POST', '/api/attachments/upload', formData, {
        headers: {
          // Don't set Content-Type, let the browser set it with boundary for FormData
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to upload attachment');
      }

      const result = await response.json();
      return result.data[0]; // Return first uploaded attachment
    },
    onSuccess: (uploadedAttachment, file) => {
      setAttachments(prev => prev.map(att => 
        att.file === file ? {
          ...att,
          id: uploadedAttachment.id,
          uploading: false,
          uploadedAt: uploadedAttachment.uploadedAt
        } : att
      ));
      
      toast({
        title: "Attachment Uploaded",
        description: `${file.name} has been uploaded successfully.`,
      });
    },
    onError: (error: Error, file) => {
      setAttachments(prev => prev.filter(att => att.file !== file));
      
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload attachment. Please try again.",
        variant: "destructive"
      });
    }
  });

  // File handling functions
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

  const validateFile = (file: File): string | null => {
    // File size limit (25MB)
    if (file.size > 25 * 1024 * 1024) {
      return 'File size exceeds 25MB limit';
    }

    // File type validation
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
      'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain', 'text/csv', 'application/zip', 'application/x-zip-compressed'
    ];

    if (!allowedTypes.includes(file.type)) {
      return 'File type not supported. Please upload images, PDFs, Office documents, text files, or ZIP archives.';
    }

    return null;
  };

  const handleFileSelect = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    
    for (const file of fileArray) {
      const error = validateFile(file);
      if (error) {
        toast({
          title: "Invalid File",
          description: `${file.name}: ${error}`,
          variant: "destructive"
        });
        continue;
      }

      // Check if file already attached
      if (attachments.some(att => att.fileName === file.name && att.fileSize === file.size)) {
        toast({
          title: "Duplicate File",
          description: `${file.name} is already attached.`,
          variant: "destructive"
        });
        continue;
      }

      // Add to attachments list
      const newAttachment: AttachmentFile = {
        file,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        uploading: true
      };

      setAttachments(prev => [...prev, newAttachment]);
      
      // Start upload
      uploadAttachmentMutation.mutate(file);
    }
  }, [attachments, toast, uploadAttachmentMutation]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelect(e.target.files);
      // Reset input
      e.target.value = '';
    }
  };

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files);
    }
  }, [handleFileSelect]);

  // TanStack Query mutation for sending emails
  const sendEmailMutation = useMutation({
    mutationFn: async (emailData: SendEmailRequest) => {
      if (!accountId) {
        throw new Error('No account selected for sending email');
      }
      
      const response = await apiRequest('POST', `/api/accounts/${accountId}/send`, emailData);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to send email');
      }

      return response.json() as Promise<SendEmailResponse>;
    },
    onSuccess: (response) => {
      toast({
        title: "Email Sent",
        description: `Your email to ${formData.to} has been sent successfully.`,
      });
      
      // Invalidate email queries to refresh the UI with the sent email
      if (accountId) {
        queryClient.invalidateQueries({ queryKey: ['/api/mail', accountId, 'sent'] });
        queryClient.invalidateQueries({ queryKey: ['/api/mail', accountId] });
      }
      
      onClose();
      // Reset form and attachments
      setFormData({ to: "", cc: "", bcc: "", subject: "", body: "" });
      setAttachments([]);
    },
    onError: (error: Error) => {
      console.error('Email sending failed:', error);
      toast({
        title: "Failed to Send Email",
        description: error.message || "An error occurred while sending the email. Please try again.",
        variant: "destructive"
      });
    }
  });

  const handleSend = async () => {
    if (!formData.to || !formData.subject) {
      toast({
        title: "Missing Information",
        description: "Please enter recipient and subject",
        variant: "destructive"
      });
      return;
    }

    if (!formData.body) {
      toast({
        title: "Missing Information", 
        description: "Please enter email content",
        variant: "destructive"
      });
      return;
    }

    // Use the auto-selected account if no specific accountId was provided
    const sendingAccountId = accountId || currentAccount?.id;
    
    if (!sendingAccountId || !currentAccount) {
      toast({
        title: "No Account Selected",
        description: "Please select an account to send emails",
        variant: "destructive"
      });
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.to)) {
      toast({
        title: "Invalid Email Address",
        description: "Please enter a valid email address in the To field",
        variant: "destructive"
      });
      return;
    }

    // Check if any attachments are still uploading
    const uploadingAttachments = attachments.filter(att => att.uploading);
    if (uploadingAttachments.length > 0) {
      toast({
        title: "Attachments Uploading",
        description: "Please wait for all attachments to finish uploading before sending.",
        variant: "destructive"
      });
      return;
    }

    // Prepare attachments for email
    const emailAttachments = attachments.map(att => ({
      filename: att.fileName,
      content: '', // For email sending, we'll reference by ID
      contentType: att.mimeType,
      size: att.fileSize,
      attachmentId: att.id // Custom field to reference uploaded attachment
    }));

    // Prepare email data for API
    const emailData: SendEmailRequest = {
      accountId: sendingAccountId,
      to: formData.to,
      cc: formData.cc || undefined,
      bcc: formData.bcc || undefined,
      subject: formData.subject,
      body: formData.body,
      bodyHtml: formData.body.replace(/\n/g, '<br>'), // Convert newlines to HTML
      attachments: emailAttachments
    };

    // Send the email using the mutation
    sendEmailMutation.mutate(emailData);
  };

  const handleClose = () => {
    onClose();
    // Reset form and attachments after close
    setTimeout(() => {
      setFormData({ to: "", cc: "", bcc: "", subject: "", body: "" });
      setAttachments([]);
    }, 300);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent 
        className={`max-w-4xl max-h-[90vh] flex flex-col ${isDragOver ? 'border-primary border-2 border-dashed' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <DialogHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <DialogTitle className="text-lg font-semibold">Compose Email</DialogTitle>
          <DialogDescription className="hidden">
            Create and send a new email message.
          </DialogDescription>
          <div className="text-lg font-semibold sr-only">
            {replyTo ? "Reply" : "Compose"}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            data-testid="button-close-compose"
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>
        
        <div className="flex-1 space-y-4 overflow-y-auto">
          {/* Recipient Fields */}
          <div className="space-y-3">
            {/* From Field - Read-only */}
            <div className="flex items-center space-x-2">
              <Label htmlFor="from" className="w-12 text-sm text-muted-foreground">
                From:
              </Label>
              <Input
                id="from"
                value={fromDisplay}
                readOnly
                placeholder={isLoadingAccounts ? "Loading account..." : "No account selected"}
                className="flex-1 bg-muted/50 cursor-default"
                data-testid="input-from"
              />
            </div>
            
            <div className="flex items-center space-x-2">
              <Label htmlFor="to" className="w-12 text-sm text-muted-foreground">
                To:
              </Label>
              <Input
                id="to"
                value={formData.to}
                onChange={(e) => setFormData({ ...formData, to: e.target.value })}
                placeholder="recipient@example.com"
                className="flex-1"
                data-testid="input-to"
              />
            </div>
            
            <div className="flex items-center space-x-2">
              <Label htmlFor="cc" className="w-12 text-sm text-muted-foreground">
                CC:
              </Label>
              <Input
                id="cc"
                value={formData.cc}
                onChange={(e) => setFormData({ ...formData, cc: e.target.value })}
                placeholder="cc@example.com"
                className="flex-1"
                data-testid="input-cc"
              />
            </div>
            
            <div className="flex items-center space-x-2">
              <Label htmlFor="bcc" className="w-12 text-sm text-muted-foreground">
                BCC:
              </Label>
              <Input
                id="bcc"
                value={formData.bcc}
                onChange={(e) => setFormData({ ...formData, bcc: e.target.value })}
                placeholder="bcc@example.com"
                className="flex-1"
                data-testid="input-bcc"
              />
            </div>
          </div>

          <Separator />

          {/* Subject */}
          <div className="flex items-center space-x-2">
            <Label htmlFor="subject" className="w-12 text-sm text-muted-foreground">
              Subject:
            </Label>
            <Input
              id="subject"
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              placeholder="Email subject"
              className="flex-1"
              data-testid="input-subject"
            />
          </div>

          <Separator />

          {/* Attachments Display */}
          {attachments.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">
                Attachments ({attachments.length})
              </Label>
              <div className="flex flex-wrap gap-2">
                {attachments.map((attachment, index) => {
                  const FileIcon = getFileIcon(attachment.mimeType);
                  return (
                    <div
                      key={index}
                      className="flex items-center gap-2 p-2 border rounded-md bg-muted/50 max-w-xs"
                      data-testid={`attachment-${index}`}
                    >
                      <FileIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate" title={attachment.fileName}>
                          {attachment.fileName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatFileSize(attachment.fileSize)}
                          {attachment.uploading && (
                            <span className="ml-1 text-primary">• Uploading...</span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveAttachment(index)}
                        className="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive"
                        disabled={attachment.uploading}
                        data-testid={`button-remove-attachment-${index}`}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>
              <Separator />
            </div>
          )}

          {/* Drag and Drop Overlay */}
          {isDragOver && (
            <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-md flex items-center justify-center z-50">
              <div className="text-center">
                <Paperclip className="h-8 w-8 mx-auto mb-2 text-primary" />
                <p className="text-lg font-medium text-primary">Drop files to attach</p>
                <p className="text-sm text-muted-foreground">
                  Supports images, PDFs, documents, and archives up to 25MB
                </p>
              </div>
            </div>
          )}

          {/* Formatting Toolbar */}
          <div className="flex items-center space-x-1 p-2 border rounded-md bg-muted/20">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => editor?.chain().focus().toggleBold().run()}
              className={editor?.isActive('bold') ? 'bg-muted' : ''}
              disabled={!editor}
              data-testid="button-bold"
            >
              <Bold className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              className={editor?.isActive('italic') ? 'bg-muted' : ''}
              disabled={!editor}
              data-testid="button-italic"
            >
              <Italic className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => editor?.chain().focus().toggleStrike().run()}
              className={editor?.isActive('strike') ? 'bg-muted' : ''}
              disabled={!editor}
              data-testid="button-underline"
            >
              <Underline className="h-4 w-4" />
            </Button>
            <Separator orientation="vertical" className="h-6 mx-2" />
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleAttachClick}
              data-testid="button-attach"
            >
              <Paperclip className="h-4 w-4" />
              <span className="ml-1 text-sm">Attach</span>
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileInputChange}
              style={{ display: 'none' }}
              accept=".jpg,.jpeg,.png,.gif,.webp,.svg,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
              data-testid="input-file-upload"
            />
          </div>

          {/* Email Body - Rich Text Editor */}
          <div className="flex-1">
            <div className="min-h-[300px] border rounded-md">
              {editor ? (
                <EditorContent 
                  editor={editor} 
                  className="prose-email"
                  data-testid="editor-body"
                />
              ) : (
                <div className="flex items-center justify-center min-h-[300px] text-muted-foreground">
                  Loading editor...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            {formData.body.length} characters
          </div>
          
          <div className="flex items-center space-x-2">
            <Button 
              variant="outline" 
              onClick={handleClose}
              data-testid="button-cancel-compose"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSend} 
              disabled={sendEmailMutation.isPending}
              data-testid="button-send-compose"
            >
              {sendEmailMutation.isPending ? (
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
                  <span>Sending...</span>
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <Send className="h-4 w-4" />
                  <span>Send</span>
                </div>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}