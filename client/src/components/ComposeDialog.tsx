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
import { X, Send, Paperclip, Bold, Italic, Underline, Save, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { SendEmailRequest, SendEmailResponse, MailDraft, InsertMailDraft } from "@shared/schema";
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

interface ComposeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  accountId?: string; // Account ID for sending emails
  draftId?: string; // Load existing draft
  replyTo?: {
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    body?: string;
    messageId?: string; // For reply/forward context
  };
  mode?: 'new' | 'reply' | 'forward' | 'reply_all'; // Composition mode
}

export function ComposeDialog({ isOpen, onClose, accountId, draftId, replyTo, mode = 'new' }: ComposeDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout>();
  const [currentDraftId, setCurrentDraftId] = useState<string | undefined>(draftId);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [contactSuggestions, setContactSuggestions] = useState<Array<{email: string, name?: string, source: string}>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeField, setActiveField] = useState<'to' | 'cc' | 'bcc' | null>(null);
  
  const [formData, setFormData] = useState({
    to: replyTo?.to || "",
    cc: replyTo?.cc || "",
    bcc: replyTo?.bcc || "",
    subject: replyTo?.subject || "",
    body: replyTo?.body || "",
    priority: 2, // Default priority
    compositionMode: mode
  });

  // Load existing draft query
  const { data: loadedDraft } = useQuery({
    queryKey: ['/api/drafts', currentDraftId],
    queryFn: async (): Promise<MailDraft> => {
      const response = await apiRequest('GET', `/api/drafts/${currentDraftId}`);
      if (!response.ok) throw new Error('Failed to load draft');
      const result = await response.json();
      return result.data;
    },
    enabled: !!currentDraftId && isOpen
  });

  // Contact suggestions query
  const getContactSuggestions = useCallback(async (query: string, field: 'to' | 'cc' | 'bcc') => {
    if (query.length < 2) {
      setContactSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    
    try {
      const response = await apiRequest('GET', `/api/contacts/suggestions?query=${encodeURIComponent(query)}&limit=5`);
      if (response.ok) {
        const result = await response.json();
        setContactSuggestions(result.data || []);
        setActiveField(field);
        setShowSuggestions(true);
      }
    } catch (error) {
      console.error('Failed to get contact suggestions:', error);
    }
  }, []);

  // Auto-save draft mutation
  const autoSaveMutation = useMutation({
    mutationFn: async (draftData: Partial<InsertMailDraft>) => {
      if (!accountId) return null;
      
      const response = await apiRequest('POST', '/api/drafts/auto-save', { accountId, ...draftData });
      
      if (!response.ok) throw new Error('Failed to auto-save draft');
      const result = await response.json();
      return result.data;
    },
    onSuccess: (savedDraft) => {
      if (savedDraft) {
        setCurrentDraftId(savedDraft.id);
        setLastSavedAt(new Date());
        queryClient.invalidateQueries({ queryKey: ['/api/drafts'] });
      }
    },
    onError: (error) => {
      console.error('Auto-save failed:', error);
    }
  });

  // Manual save draft mutation
  const saveDraftMutation = useMutation({
    mutationFn: async (draftData: Partial<InsertMailDraft>) => {
      if (!accountId) throw new Error('No account selected');
      
      const method = currentDraftId ? 'PUT' : 'POST';
      const url = currentDraftId ? `/api/drafts/${currentDraftId}` : '/api/drafts';
      
      const response = await apiRequest(method, url, {
        accountId, 
        ...draftData,
        isAutoSaved: false 
      });
      
      if (!response.ok) throw new Error('Failed to save draft');
      const result = await response.json();
      return result.data;
    },
    onSuccess: (savedDraft) => {
      setCurrentDraftId(savedDraft.id);
      setLastSavedAt(new Date());
      queryClient.invalidateQueries({ queryKey: ['/api/drafts'] });
      toast({
        title: "Draft Saved",
        description: "Your email draft has been saved successfully."
      });
    },
    onError: (error) => {
      toast({
        title: "Save Failed",
        description: "Failed to save draft. Please try again.",
        variant: "destructive"
      });
    }
  });

  // Initialize TipTap editor
  const editor = useEditor({
    extensions: [StarterKit],
    content: formData.body,
    editorProps: {
      attributes: {
        class: 'prose-email',
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      setFormData(prev => ({ ...prev, body: html }));
      // Schedule auto-save
      scheduleAutoSave();
    },
  });

  // Auto-save functionality
  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    
    autoSaveTimeoutRef.current = setTimeout(() => {
      if (accountId && (formData.to || formData.subject || formData.body)) {
        const draftData = {
          toRecipients: formData.to,
          ccRecipients: formData.cc || null,
          bccRecipients: formData.bcc || null,
          subject: formData.subject,
          bodyHtml: formData.body,
          priority: formData.priority,
          compositionMode: formData.compositionMode,
          replyToMessageId: replyTo?.messageId || null
        };
        autoSaveMutation.mutate(draftData);
      }
    }, 30000); // Auto-save every 30 seconds
  }, [accountId, formData, autoSaveMutation, replyTo?.messageId]);

  // Load draft data when component opens or draft changes
  useEffect(() => {
    if (loadedDraft) {
      const draftFormData = {
        to: loadedDraft.toRecipients || "",
        cc: loadedDraft.ccRecipients || "",
        bcc: loadedDraft.bccRecipients || "",
        subject: loadedDraft.subject || "",
        body: loadedDraft.bodyHtml || "",
        priority: loadedDraft.priority || 2,
        compositionMode: loadedDraft.compositionMode || 'new'
      };
      setFormData(draftFormData);
      
      if (editor && loadedDraft.bodyHtml) {
        editor.commands.setContent(loadedDraft.bodyHtml);
      }
    }
  }, [loadedDraft, editor]);

  // Update editor content when replyTo changes
  useEffect(() => {
    if (editor && replyTo?.body && !loadedDraft) {
      editor.commands.setContent(replyTo.body);
    }
  }, [editor, replyTo, loadedDraft]);

  // Update form data when replyTo changes
  useEffect(() => {
    if (replyTo && !loadedDraft) {
      setFormData(prev => ({
        ...prev,
        to: replyTo.to || "",
        cc: replyTo.cc || "",
        bcc: replyTo.bcc || "",
        subject: replyTo.subject || "",
        body: replyTo.body || "",
        compositionMode: mode
      }));
    }
  }, [replyTo, mode, loadedDraft]);

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
      // Reset form
      setFormData({ to: "", cc: "", bcc: "", subject: "", body: "", priority: 2, compositionMode: 'new' });
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

    if (!accountId) {
      toast({
        title: "No Account Selected",
        description: "Please select an IMAP account to send emails",
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

    // Prepare email data for API
    const emailData: SendEmailRequest = {
      accountId: accountId!,
      to: formData.to,
      cc: formData.cc || undefined,
      bcc: formData.bcc || undefined,
      subject: formData.subject,
      body: formData.body,
      bodyHtml: formData.body.replace(/\n/g, '<br>'), // Convert newlines to HTML
      attachments: [] // TODO: Add attachment support in next task
    };

    // Send the email using the mutation
    sendEmailMutation.mutate(emailData);
  };

  const handleClose = () => {
    onClose();
    // Reset form after close
    setTimeout(() => {
      setFormData({ to: "", cc: "", bcc: "", subject: "", body: "", priority: 2, compositionMode: 'new' });
    }, 300);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
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
            <Button variant="ghost" size="sm" data-testid="button-attach">
              <Paperclip className="h-4 w-4" />
              <span className="ml-1 text-sm">Attach</span>
            </Button>
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