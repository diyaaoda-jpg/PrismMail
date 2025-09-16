import { useState, useEffect } from "react";
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
import { X, Send, Paperclip, Bold, Italic, Underline } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { SendEmailRequest, SendEmailResponse } from "@shared/schema";
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

  // TanStack Query mutation for sending emails
  const sendEmailMutation = useMutation({
    mutationFn: async (emailData: SendEmailRequest) => {
      if (!accountId) {
        throw new Error('No account selected for sending email');
      }
      
      const response = await apiRequest(`/api/accounts/${accountId}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailData),
      });

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
      setFormData({ to: "", cc: "", bcc: "", subject: "", body: "" });
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
      setFormData({ to: "", cc: "", bcc: "", subject: "", body: "" });
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