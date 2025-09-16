import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { X, Send, Paperclip, Bold, Italic, Underline, FileText, Image, Download, Trash2, Save, Clock, CheckCircle2, AlertCircle, Edit2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { SendEmailRequest, SendEmailResponse, AccountConnection, ImapSettings, EwsSettings, LoadDraftResponse, DraftContent, Signature, ListSignaturesResponse } from "@shared/schema";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useDraftAutoSave } from '@/hooks/useDraftAutoSave';
import { useMobileCompose } from '@/hooks/useMobileCompose';
import { useAutoResize } from '@/hooks/useAutoResize';

interface ComposeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  accountId?: string; // Account ID for sending emails
  draftId?: string; // Draft ID to load when opening
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

export function ComposeDialog({ isOpen, onClose, accountId, draftId, replyTo }: ComposeDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    to: replyTo?.to || "",
    cc: replyTo?.cc || "",
    bcc: replyTo?.bcc || "",
    subject: replyTo?.subject || "",
    body: replyTo?.body || ""
  });

  // Draft management states
  const [isDraftLoaded, setIsDraftLoaded] = useState(false);
  const [showUnsavedChangesDialog, setShowUnsavedChangesDialog] = useState(false);
  const [pendingCloseAction, setPendingCloseAction] = useState<(() => void) | null>(null);

  // Signature management states
  const [selectedSignatureId, setSelectedSignatureId] = useState<string | null>(null);
  const [signatureInserted, setSignatureInserted] = useState(false);

  // Attachment state
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mobile compose optimization
  const mobileCompose = useMobileCompose({
    isOpen, // Pass isOpen to fix body scroll lock
    onSend: () => handleSend(),
    onClose: () => handleClose(), // This is safe - handleClose will handle confirmation
    onSaveDraft: () => saveDraftManually(),
    enableSwipeGestures: true,
    enableHapticFeedback: true,
    keyboardAdjustment: true,
  });

  // Auto-resize hook for subject textarea only (body uses TipTap editor which handles its own sizing)
  const { triggerResize: triggerSubjectResize } = useAutoResize(mobileCompose.subjectRef, {
    minHeight: mobileCompose.isMobile ? 44 : 36,
    maxHeight: mobileCompose.isMobile ? 120 : 100,
    enabled: true,
  });

  // Note: Body content uses TipTap EditorContent which doesn't need useAutoResize
  // TipTap handles content sizing through CSS and its own content management

  // Fetch account information for the From field
  const { data: accountsData, isLoading: isLoadingAccounts } = useQuery({
    queryKey: ['/api/accounts'],
    enabled: isOpen, // Fetch accounts whenever dialog is open
  });

  // Find the current account from the accounts list with proper typing - MUST be before signatures query
  interface AccountsResponse {
    data: AccountConnection[];
  }
  
  const accountsList = accountsData && typeof accountsData === 'object' && accountsData !== null && 'data' in accountsData 
    ? (accountsData as AccountsResponse).data 
    : undefined;
  
  // Auto-select account: use provided accountId, or fall back to first active account
  let currentAccount = accountsList?.find((account: AccountConnection) => account.id === accountId);
  
  // If no account found with provided ID, auto-select the primary account
  if (!currentAccount && accountsList && accountsList.length > 0) {
    // Prefer IMAP accounts over EWS for sending emails
    currentAccount = accountsList.find(account => account.isActive && account.protocol === 'IMAP') ||
                     accountsList.find(account => account.isActive) ||
                     accountsList[0];
  }

  // Fetch signatures for current account - MUST be after currentAccount is computed
  const { data: signaturesResponse } = useQuery<ListSignaturesResponse>({
    queryKey: ['/api/signatures', currentAccount?.id],
    enabled: isOpen && !!currentAccount,
  });

  const signatures = signaturesResponse?.signatures || [];
  const defaultSignature = signatures.find(sig => 
    sig.isDefault && sig.isActive && 
    (sig.accountId === currentAccount?.id || !sig.accountId)
  );

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

  // Initialize draft auto-save hook
  const {
    saveDraft,
    saveDraftManually,
    deleteDraft,
    status: draftStatus,
    currentDraftId,
    clearDraft
  } = useDraftAutoSave({
    accountId: accountId || currentAccount?.id,
    draftId,
    autoSaveInterval: 30000, // 30 seconds
    debounceDelay: 2000, // 2 seconds
    enableLocalStorage: true
  });

  // Load draft when dialog opens with draftId
  const { data: draftData, isLoading: isDraftLoading } = useQuery({
    queryKey: ['/api/accounts', accountId || currentAccount?.id, 'drafts', draftId],
    queryFn: async () => {
      if (!draftId || !accountId || !currentAccount?.id) return null;
      
      const response = await apiRequest('GET', `/api/accounts/${accountId || currentAccount?.id}/drafts/${draftId}`);
      if (!response.ok) {
        throw new Error('Failed to load draft');
      }
      
      const result = await response.json();
      return result.data as LoadDraftResponse;
    },
    enabled: isOpen && !!draftId && !!(accountId || currentAccount?.id),
  });

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
      setFormData(prev => {
        const newData = { ...prev, body: html };
        // Trigger auto-save when body changes
        triggerAutoSave(newData);
        return newData;
      });
    },
  });

  // Enhanced signature insertion with race condition prevention
  const insertSignature = useCallback((signature: Signature, preventAutoSave = false) => {
    if (!editor) return;

    const signatureHtml = signature.contentHtml || `<p>${signature.contentText || ''}</p>`;
    
    // Get current content
    const currentContent = editor.getHTML();
    
    // Check if signature already exists to prevent duplication
    const hasExistingSignature = currentContent.includes('data-signature-id=');
    
    // Remove any existing signature (look for signature wrapper)
    const contentWithoutSignature = currentContent.replace(
      /<div data-signature-id="[^"]*">[\s\S]*?<\/div>/g, 
      ''
    ).trim();
    
    // Add signature wrapper with ID for easy removal/replacement
    const signatureMarker = `<!-- SIGNATURE_START:${signature.id} -->`;
    const signatureEndMarker = `<!-- SIGNATURE_END:${signature.id} -->`;
    const signatureWithWrapper = `<br/>${signatureMarker}<div data-signature-id="${signature.id}">${signatureHtml}</div>${signatureEndMarker}`;
    
    // Insert at the end of content
    const newContent = contentWithoutSignature + signatureWithWrapper;
    
    // Temporarily disable auto-save to prevent race condition
    if (preventAutoSave) {
      const originalOnUpdate = editor.options.onUpdate;
      editor.setOptions({ onUpdate: () => {} });
      
      editor.commands.setContent(newContent);
      
      // Re-enable auto-save after a brief delay
      setTimeout(() => {
        editor.setOptions({ onUpdate: originalOnUpdate });
      }, 100);
    } else {
      editor.commands.setContent(newContent);
    }
    
    setSelectedSignatureId(signature.id);
    setSignatureInserted(true);
  }, [editor]);

  // Auto-insert default signature with improved race condition handling
  useEffect(() => {
    if (editor && defaultSignature && !signatureInserted && !replyTo && !draftId && isOpen && isDraftLoaded !== null) {
      // Use a timeout to ensure editor is fully initialized and draft loading is complete
      const signatureTimeout = setTimeout(() => {
        const currentContent = editor.getHTML();
        // Only insert signature if content doesn't already contain one
        if (!currentContent.includes('data-signature-id=')) {
          insertSignature(defaultSignature, true); // Prevent auto-save during insertion
        } else {
          setSignatureInserted(true);
        }
      }, 150);
      
      return () => clearTimeout(signatureTimeout);
    }
  }, [editor, defaultSignature, signatureInserted, replyTo, draftId, isOpen, isDraftLoaded, insertSignature]);

  // Reset signature state when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      setSignatureInserted(false);
      setSelectedSignatureId(null);
    }
  }, [isOpen]);

  // Auto-save trigger function with signature state tracking
  const triggerAutoSave = useCallback((data: typeof formData) => {
    if (!currentAccount?.id || (!draftId && !data.to && !data.subject && !data.body)) {
      return; // Don't save empty drafts
    }
    
    // Skip auto-save if we're still in the process of loading draft or inserting signature
    if (!isDraftLoaded && draftId) {
      return; // Don't auto-save while draft is loading
    }

    const draftContent: Partial<DraftContent> = {
      accountId: currentAccount.id,
      to: data.to,
      cc: data.cc,
      bcc: data.bcc,
      subject: data.subject,
      body: data.body,
      bodyHtml: data.body,
      attachmentIds: attachments.filter(att => att.id).map(att => att.id!),
    };

    saveDraft(draftContent);
  }, [currentAccount?.id, draftId, attachments, saveDraft, isDraftLoaded]);

  // Load draft when dialog opens with signature detection
  useEffect(() => {
    if (draftData?.draft && !isDraftLoaded) {
      const draft = draftData.draft;
      const draftBody = draft.bodyHtml || draft.body || '';
      
      setFormData({
        to: draft.to || "",
        cc: draft.cc || "",
        bcc: draft.bcc || "",
        subject: draft.subject || "",
        body: draftBody
      });

      // Update editor content and check for existing signature
      if (editor) {
        editor.commands.setContent(draftBody);
        
        // Check if draft already contains a signature
        const hasSignature = draftBody.includes('data-signature-id=');
        if (hasSignature) {
          setSignatureInserted(true);
          // Extract signature ID if present
          const signatureIdMatch = draftBody.match(/data-signature-id="([^"]*)"/)
          if (signatureIdMatch) {
            setSelectedSignatureId(signatureIdMatch[1]);
          }
        }
      }

      setIsDraftLoaded(true);
      
      toast({
        title: "Draft Loaded",
        description: "Your draft has been restored.",
      });
    }
  }, [draftData, isDraftLoaded, editor, toast]);

  // Update editor content when replyTo changes
  useEffect(() => {
    if (editor && replyTo?.body && !isDraftLoaded) {
      editor.commands.setContent(replyTo.body);
    }
  }, [editor, replyTo, isDraftLoaded]);

  // Update form data when replyTo changes
  useEffect(() => {
    if (replyTo && !isDraftLoaded) {
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
      
      const response = await apiRequest('POST', '/api/attachments/upload', formData);

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
    // Check for unsaved changes and show confirmation if needed
    const hasUnsavedContent = formData.to || formData.subject || formData.body || attachments.length > 0;
    
    if (hasUnsavedContent && draftStatus !== 'saving' && draftStatus !== 'saved') {
      // Set up pending close action for unsaved changes dialog
      setPendingCloseAction(() => () => {
        // Apply haptic feedback on mobile
        if (mobileCompose.isMobile) {
          mobileCompose.triggerHaptic('light');
        }
        
        // Clear editor and form
        if (editor) {
          editor.commands.clearContent();
        }
        
        // Clear draft and reset form
        clearDraft();
        setFormData({ to: "", cc: "", bcc: "", subject: "", body: "" });
        setAttachments([]);
        setIsDraftLoaded(false);
        setSignatureInserted(false);
        setSelectedSignatureId(null);
        
        // Call the original onClose
        onClose();
      });
      setShowUnsavedChangesDialog(true);
      return;
    }
    
    // No unsaved changes, close immediately
    // Apply haptic feedback on mobile
    if (mobileCompose.isMobile) {
      mobileCompose.triggerHaptic('light');
    }
    
    // Clear editor and form
    if (editor) {
      editor.commands.clearContent();
    }
    
    // Clear draft and reset form
    clearDraft();
    setFormData({ to: "", cc: "", bcc: "", subject: "", body: "" });
    setAttachments([]);
    setIsDraftLoaded(false);
    setSignatureInserted(false);
    setSelectedSignatureId(null);
    
    // Call the original onClose
    onClose();
  };

  // Render compose content
  const renderComposeContent = () => (
    <div 
      ref={mobileCompose.composeRef}
      className={`flex flex-col h-full ${mobileCompose.isMobile ? 'pb-safe' : ''} ${isDragOver ? 'border-primary border-2 border-dashed' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={mobileCompose.isMobile ? mobileCompose.getMobileStyles().compose : undefined}
    >
      {/* Header */}
      <div className={`flex items-center justify-between p-4 border-b ${mobileCompose.isMobile ? 'bg-background/95 backdrop-blur-sm' : ''}`}>
        <h2 className="text-lg font-semibold">
          {replyTo ? "Reply" : "Compose Email"}
        </h2>
        <div className="flex items-center space-x-2">
          {/* Draft status indicator */}
          {draftStatus === 'saving' && (
            <div className="flex items-center space-x-1 text-muted-foreground text-sm">
              <Clock className="h-3 w-3 animate-spin" />
              <span>Saving...</span>
            </div>
          )}
          {draftStatus === 'saved' && (
            <div className="flex items-center space-x-1 text-muted-foreground text-sm">
              <CheckCircle2 className="h-3 w-3" />
              <span>Saved</span>
            </div>
          )}
          {draftStatus === 'error' && (
            <div className="flex items-center space-x-1 text-destructive text-sm">
              <AlertCircle className="h-3 w-3" />
              <span>Error</span>
            </div>
          )}

          <Button
            variant="ghost"
            size={mobileCompose.isMobile ? "default" : "icon"}
            onClick={handleClose}
            data-testid="button-close-compose"
            className={mobileCompose.isMobile ? "px-4" : ""}
          >
            <X className="h-4 w-4" />
            {mobileCompose.isMobile && <span className="ml-1">Close</span>}
          </Button>
        </div>
      </div>

      {/* Form Content */}
      <div className={`flex-1 overflow-y-auto ${mobileCompose.isMobile ? 'px-4' : 'p-6'} space-y-4`}>
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
              <Label htmlFor="to" className={`${mobileCompose.isMobile ? 'w-16' : 'w-12'} text-sm text-muted-foreground`}>
                To:
              </Label>
              <Input
                id="to"
                value={formData.to}
                onChange={(e) => {
                  const newData = { ...formData, to: e.target.value };
                  setFormData(newData);
                  triggerAutoSave(newData);
                }}
                placeholder="recipient@example.com"
                className="flex-1"
                data-testid="input-to"
                {...mobileCompose.getMobileInputProps('email')}
                onFocus={() => mobileCompose.keyboard.scrollToElement?.(document.getElementById('to')!)}
              />
            </div>
            
            <div className="flex items-center space-x-2">
              <Label htmlFor="cc" className={`${mobileCompose.isMobile ? 'w-16' : 'w-12'} text-sm text-muted-foreground`}>
                CC:
              </Label>
              <Input
                id="cc"
                value={formData.cc}
                onChange={(e) => {
                  const newData = { ...formData, cc: e.target.value };
                  setFormData(newData);
                  triggerAutoSave(newData);
                }}
                placeholder="cc@example.com"
                className="flex-1"
                data-testid="input-cc"
                {...mobileCompose.getMobileInputProps('email')}
                onFocus={() => mobileCompose.keyboard.scrollToElement?.(document.getElementById('cc')!)}
              />
            </div>
            
            <div className="flex items-center space-x-2">
              <Label htmlFor="bcc" className={`${mobileCompose.isMobile ? 'w-16' : 'w-12'} text-sm text-muted-foreground`}>
                BCC:
              </Label>
              <Input
                id="bcc"
                value={formData.bcc}
                onChange={(e) => {
                  const newData = { ...formData, bcc: e.target.value };
                  setFormData(newData);
                  triggerAutoSave(newData);
                }}
                placeholder="bcc@example.com"
                className="flex-1"
                data-testid="input-bcc"
                {...mobileCompose.getMobileInputProps('email')}
                onFocus={() => mobileCompose.keyboard.scrollToElement?.(document.getElementById('bcc')!)}
              />
            </div>
          </div>

          <Separator />

          {/* Subject */}
          <div className="flex items-center space-x-2">
            <Label htmlFor="subject" className={`${mobileCompose.isMobile ? 'w-16' : 'w-12'} text-sm text-muted-foreground`}>
              Subject:
            </Label>
            <Textarea
              ref={mobileCompose.subjectRef}
              id="subject"
              value={formData.subject}
              onChange={(e) => {
                const newData = { ...formData, subject: e.target.value };
                setFormData(newData);
                triggerAutoSave(newData);
                triggerSubjectResize();
              }}
              placeholder="Email subject"
              className="flex-1 resize-none"
              data-testid="input-subject"
              style={mobileCompose.isMobile ? mobileCompose.getMobileStyles().subject : undefined}
              rows={1}
              onFocus={() => mobileCompose.keyboard.scrollToElement?.(document.getElementById('subject')!)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  mobileCompose.focusNextField('subject');
                }
              }}
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
            
            {/* Signature Selection */}
            {signatures.length > 0 && (
              <>
                <Select
                  value={selectedSignatureId || ""}
                  onValueChange={(value) => {
                    if (value === "none") {
                      // Remove signature
                      if (editor) {
                        const currentContent = editor.getHTML();
                        const contentWithoutSignature = currentContent.replace(
                          /<div data-signature-id="[^"]*">[\s\S]*?<\/div>/g, 
                          ''
                        );
                        editor.commands.setContent(contentWithoutSignature);
                        setSelectedSignatureId(null);
                      }
                    } else {
                      const signature = signatures.find(sig => sig.id === value);
                      if (signature) {
                        insertSignature(signature);
                      }
                    }
                  }}
                >
                  <SelectTrigger className="w-32 h-8" data-testid="select-signature">
                    <Edit2 className="h-3 w-3 mr-1" />
                    <SelectValue placeholder="Signature" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Signature</SelectItem>
                    {signatures
                      .filter(sig => sig.isActive)
                      .sort((a, b) => {
                        // Put default signature first
                        if (a.isDefault && !b.isDefault) return -1;
                        if (!a.isDefault && b.isDefault) return 1;
                        return a.name.localeCompare(b.name);
                      })
                      .map((signature) => (
                        <SelectItem key={signature.id} value={signature.id}>
                          {signature.name}
                          {signature.isDefault && (
                            <Badge variant="secondary" className="ml-2 text-xs">
                              Default
                            </Badge>
                          )}
                        </SelectItem>
                      ))
                    }
                  </SelectContent>
                </Select>
                <Separator orientation="vertical" className="h-6 mx-2" />
              </>
            )}
            
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

          {/* Email Body - Auto-resizing Textarea with TipTap */}
          <div className="flex-1 space-y-2">
            <Label className="text-sm text-muted-foreground">Message:</Label>
            <div className={`border rounded-md overflow-hidden ${mobileCompose.isMobile ? 'min-h-[200px]' : 'min-h-[300px]'}`}>
              {editor ? (
                <EditorContent 
                  editor={editor} 
                  className={`prose-email ${mobileCompose.isMobile ? 'mobile-editor' : ''}`}
                  data-testid="editor-body"
                  style={mobileCompose.isMobile ? {
                    ...mobileCompose.getMobileStyles().body,
                    minHeight: '200px'
                  } : undefined}
                />
              ) : (
                <div className={`flex items-center justify-center ${mobileCompose.isMobile ? 'min-h-[200px]' : 'min-h-[300px]'} text-muted-foreground`}>
                  Loading editor...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile-Optimized Footer */}
        <div className={`border-t bg-background ${mobileCompose.isMobile ? 'p-4 pb-safe' : 'p-6'}`}>
          <div className={`flex ${mobileCompose.isMobile ? 'flex-col space-y-3' : 'items-center justify-between'}`}>
            {/* Character count and draft status */}
            <div className={`flex items-center space-x-4 ${mobileCompose.isMobile ? 'justify-between' : ''}`}>
              <div className="text-sm text-muted-foreground">
                {formData.body?.length || 0} characters
              </div>
              
              {/* Draft status */}
              {draftStatus === 'saving' && (
                <div className="flex items-center space-x-1 text-muted-foreground text-sm">
                  <Clock className="h-3 w-3 animate-spin" />
                  <span>Saving...</span>
                </div>
              )}
              {draftStatus === 'saved' && (
                <div className="flex items-center space-x-1 text-green-600 text-sm">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>Saved</span>
                </div>
              )}
              {draftStatus === 'error' && (
                <div className="flex items-center space-x-1 text-destructive text-sm">
                  <AlertCircle className="h-3 w-3" />
                  <span>Error saving</span>
                </div>
              )}
            </div>
            
            {/* Action buttons */}
            <div className={`flex ${mobileCompose.isMobile ? 'w-full space-x-3' : 'items-center space-x-2'}`}>
              {mobileCompose.isMobile && (
                <Button 
                  variant="outline"
                  onClick={() => saveDraftManually()}
                  className="flex-1"
                  disabled={!formData.to && !formData.subject && !formData.body}
                  data-testid="button-save-draft"
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save Draft
                </Button>
              )}
              
              <Button 
                variant={mobileCompose.isMobile ? "secondary" : "outline"}
                onClick={handleClose}
                className={mobileCompose.isMobile ? "flex-1" : ""}
                data-testid="button-cancel-compose"
              >
                Cancel
              </Button>
              
              <Button 
                onClick={mobileCompose.handleMobileSend}
                disabled={sendEmailMutation.isPending}
                className={`${mobileCompose.isMobile ? 'flex-1 font-semibold' : ''}`}
                style={mobileCompose.isMobile ? mobileCompose.getMobileStyles().sendButton : undefined}
                data-testid="button-send-compose"
              >
                {sendEmailMutation.isPending ? (
                  <div className="flex items-center space-x-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground" />
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
        </div>
      </div>
  );

  // Responsive Dialog/Sheet system
  if (mobileCompose.isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={handleClose}>
        <SheetContent 
          side="bottom"
          className="h-full w-full p-0 rounded-none border-none"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{replyTo ? "Reply" : "Compose Email"}</SheetTitle>
            <SheetDescription>
              Create and send a new email message.
            </SheetDescription>
          </SheetHeader>
          {renderComposeContent()}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent 
        className="max-w-4xl max-h-[90vh] p-0"
        onInteractOutside={(e) => {
          // Prevent closing when clicking outside on desktop if there's unsaved content
          if (formData.to || formData.subject || formData.body) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{replyTo ? "Reply" : "Compose Email"}</DialogTitle>
          <DialogDescription>
            Create and send a new email message.
          </DialogDescription>
        </DialogHeader>
        {renderComposeContent()}
      </DialogContent>
    </Dialog>
  );
}