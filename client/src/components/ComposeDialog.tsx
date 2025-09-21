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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  X,
  Send,
  Paperclip,
  Bold,
  Italic,
  Underline,
  Link2,
  List,
  ListOrdered,
  Quote,
  Undo,
  Redo,
  Type,
  Strikethrough
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { SendEmailRequest, SendEmailResponse, AccountConnection, ImapSettings, EwsSettings } from "@shared/schema";
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { cn } from '@/lib/utils';

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
  const [formData, setFormData] = useState(() => ({
    to: replyTo?.to || "",
    cc: replyTo?.cc || "",
    bcc: replyTo?.bcc || "",
    subject: replyTo?.subject || "",
    body: replyTo?.body || ""
  }));

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
  
  // If still no account but dialog is open, wait for accounts to load
  const hasAccountsData = !!accountsData && !isLoadingAccounts;

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

  // Initialize TipTap editor with enhanced features
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-600 dark:text-blue-400 underline',
        },
      }),
      Placeholder.configure({
        placeholder: 'Type your message here...',
      }),
    ],
    content: formData.body,
    editorProps: {
      attributes: {
        class: 'prose prose-base max-w-none focus:outline-none min-h-[300px] p-6 '
          + 'prose-headings:text-gray-900 dark:prose-headings:text-gray-100 '
          + 'prose-p:text-gray-700 dark:prose-p:text-gray-300 '
          + 'prose-a:text-blue-600 dark:prose-a:text-blue-400 '
          + 'prose-strong:text-gray-900 dark:prose-strong:text-gray-100 '
          + 'prose-ul:text-gray-700 dark:prose-ul:text-gray-300 '
          + 'prose-ol:text-gray-700 dark:prose-ol:text-gray-300 '
          + 'prose-blockquote:border-gray-300 dark:prose-blockquote:border-gray-600 '
          + 'prose-blockquote:text-gray-600 dark:prose-blockquote:text-gray-400',
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
      console.log('ComposeDialog: Updating form data with replyTo:', replyTo);
      setFormData({
        to: replyTo.to || "",
        cc: replyTo.cc || "",
        bcc: replyTo.bcc || "",
        subject: replyTo.subject || "",
        body: replyTo.body || ""
      });
    }
  }, [replyTo]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setFormData({
        to: "",
        cc: "",
        bcc: "",
        subject: "",
        body: ""
      });
    }
  }, [isOpen]);

  // TanStack Query mutation for sending emails
  const sendEmailMutation = useMutation({
    mutationFn: async (emailData: SendEmailRequest & { sendingAccountId: string }) => {
      if (!emailData.sendingAccountId) {
        throw new Error('No account selected for sending email');
      }
      
      const response = await apiRequest('POST', `/api/accounts/${emailData.sendingAccountId}/send`, emailData);

      if (!response.ok) {
        let errorMessage = 'Failed to send email';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (parseError) {
          // If we can't parse error response as JSON, use status text
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      // Handle successful response
      try {
        const result = await response.json();
        return result as SendEmailResponse;
      } catch (parseError) {
        // If response isn't JSON but was successful, return a simple success response
        console.log('Email sent successfully but response was not JSON:', parseError);
        return {
          success: true,
          sentAt: new Date(),
          messageId: 'sent-' + Date.now()
        } as SendEmailResponse;
      }
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

    // Wait for accounts to load if they're still loading
    if (isLoadingAccounts || !hasAccountsData) {
      toast({
        title: "Please Wait",
        description: "Loading account information...",
        variant: "default"
      });
      return;
    }

    // Use the auto-selected account if no specific accountId was provided
    const sendingAccountId = accountId || currentAccount?.id;
    
    // Debug logging
    console.log('Debug - Account selection:', {
      accountId,
      currentAccount: currentAccount?.id,
      sendingAccountId,
      accountsData: !!accountsData,
      accountsList: accountsList?.length || 0,
      hasAccountsData,
      isLoadingAccounts
    });
    
    if (!accountsList || accountsList.length === 0) {
      toast({
        title: "No Email Accounts",
        description: "Please configure at least one email account before sending emails.",
        variant: "destructive"
      });
      return;
    }
    
    if (!sendingAccountId || !currentAccount) {
      toast({
        title: "No Account Selected",
        description: `Could not select an account for sending. Available accounts: ${accountsList.length}. Please check your account configuration.`,
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
    const emailData: SendEmailRequest & { sendingAccountId: string } = {
      accountId: sendingAccountId,
      sendingAccountId: sendingAccountId,
      to: formData.to,
      cc: formData.cc || undefined,
      bcc: formData.bcc || undefined,
      subject: formData.subject,
      body: formData.body,
      bodyHtml: formData.body, // TipTap already provides proper HTML
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
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col bg-white dark:bg-gray-900">
        <DialogHeader className="flex flex-row items-center justify-between space-y-0 pb-4 border-b">
          <DialogTitle className="text-xl font-normal text-gray-900 dark:text-gray-100">New Message</DialogTitle>
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
        
        <div className="flex-1 space-y-3 overflow-y-auto">
          {/* Recipient Fields */}
          <div className="space-y-2 pt-3">
            {/* From Field - Read-only */}
            <div className="flex items-center px-4">
              <Label htmlFor="from" className="w-14 text-sm text-gray-500 dark:text-gray-400">
                From
              </Label>
              <Input
                id="from"
                value={fromDisplay}
                readOnly
                placeholder={isLoadingAccounts ? "Loading account..." : "No account selected"}
                className="flex-1 bg-gray-50 dark:bg-gray-800 border-0 cursor-default text-gray-700 dark:text-gray-300"
                data-testid="input-from"
              />
            </div>
            
            <div className="flex items-center px-4">
              <Label htmlFor="to" className="w-14 text-sm text-gray-500 dark:text-gray-400">
                To
              </Label>
              <Input
                id="to"
                value={formData.to}
                onChange={(e) => setFormData({ ...formData, to: e.target.value })}
                placeholder="Recipients"
                className="flex-1 border-0 border-b focus:border-b-2 focus:border-blue-500 rounded-none px-2"
                data-testid="input-to"
              />
            </div>
            
            <div className="flex items-center px-4">
              <Label htmlFor="cc" className="w-14 text-sm text-gray-500 dark:text-gray-400">
                Cc
              </Label>
              <Input
                id="cc"
                value={formData.cc}
                onChange={(e) => setFormData({ ...formData, cc: e.target.value })}
                placeholder=""
                className="flex-1 border-0 border-b focus:border-b-2 focus:border-blue-500 rounded-none px-2"
                data-testid="input-cc"
              />
            </div>
            
            <div className="flex items-center px-4">
              <Label htmlFor="bcc" className="w-14 text-sm text-gray-500 dark:text-gray-400">
                Bcc
              </Label>
              <Input
                id="bcc"
                value={formData.bcc}
                onChange={(e) => setFormData({ ...formData, bcc: e.target.value })}
                placeholder=""
                className="flex-1 border-0 border-b focus:border-b-2 focus:border-blue-500 rounded-none px-2"
                data-testid="input-bcc"
              />
            </div>
          </div>

          {/* Subject */}
          <div className="flex items-center px-4 border-b pb-2">
            <Input
              id="subject"
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              placeholder="Subject"
              className="flex-1 border-0 text-base font-medium placeholder:font-normal"
              data-testid="input-subject"
            />
          </div>

          {/* Enhanced Formatting Toolbar */}
          <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50 dark:bg-gray-800/50">
            <div className="flex items-center gap-1">
              {/* Text Formatting */}
              <div className="flex items-center gap-0.5 mr-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => editor?.chain().focus().toggleBold().run()}
                  className={cn(
                    "h-8 w-8 p-0",
                    editor?.isActive('bold') && 'bg-gray-200 dark:bg-gray-700'
                  )}
                  disabled={!editor}
                  data-testid="button-bold"
                  title="Bold (Ctrl+B)"
                >
                  <Bold className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => editor?.chain().focus().toggleItalic().run()}
                  className={cn(
                    "h-8 w-8 p-0",
                    editor?.isActive('italic') && 'bg-gray-200 dark:bg-gray-700'
                  )}
                  disabled={!editor}
                  data-testid="button-italic"
                  title="Italic (Ctrl+I)"
                >
                  <Italic className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => editor?.chain().focus().toggleStrike().run()}
                  className={cn(
                    "h-8 w-8 p-0",
                    editor?.isActive('strike') && 'bg-gray-200 dark:bg-gray-700'
                  )}
                  disabled={!editor}
                  data-testid="button-strikethrough"
                  title="Strikethrough"
                >
                  <Strikethrough className="h-4 w-4" />
                </Button>
              </div>

              <Separator orientation="vertical" className="h-6" />

              {/* Font Size */}
              <Select
                value="normal"
                onValueChange={(value) => {
                  if (value === 'normal') {
                    editor?.chain().focus().setParagraph().run();
                  } else if (value.startsWith('h')) {
                    const level = parseInt(value.slice(1)) as 1 | 2 | 3;
                    editor?.chain().focus().toggleHeading({ level }).run();
                  }
                }}
                disabled={!editor}
              >
                <SelectTrigger className="h-8 w-24 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="h1">Heading 1</SelectItem>
                  <SelectItem value="h2">Heading 2</SelectItem>
                  <SelectItem value="h3">Heading 3</SelectItem>
                </SelectContent>
              </Select>

              <Separator orientation="vertical" className="h-6" />

              {/* Lists and Quotes */}
              <div className="flex items-center gap-0.5 mx-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => editor?.chain().focus().toggleBulletList().run()}
                  className={cn(
                    "h-8 w-8 p-0",
                    editor?.isActive('bulletList') && 'bg-gray-200 dark:bg-gray-700'
                  )}
                  disabled={!editor}
                  data-testid="button-bullet-list"
                  title="Bullet list"
                >
                  <List className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                  className={cn(
                    "h-8 w-8 p-0",
                    editor?.isActive('orderedList') && 'bg-gray-200 dark:bg-gray-700'
                  )}
                  disabled={!editor}
                  data-testid="button-ordered-list"
                  title="Numbered list"
                >
                  <ListOrdered className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => editor?.chain().focus().toggleBlockquote().run()}
                  className={cn(
                    "h-8 w-8 p-0",
                    editor?.isActive('blockquote') && 'bg-gray-200 dark:bg-gray-700'
                  )}
                  disabled={!editor}
                  data-testid="button-quote"
                  title="Quote"
                >
                  <Quote className="h-4 w-4" />
                </Button>
              </div>

              <Separator orientation="vertical" className="h-6" />

              {/* Undo/Redo */}
              <div className="flex items-center gap-0.5 mx-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => editor?.chain().focus().undo().run()}
                  className="h-8 w-8 p-0"
                  disabled={!editor || !editor.can().undo()}
                  data-testid="button-undo"
                  title="Undo (Ctrl+Z)"
                >
                  <Undo className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => editor?.chain().focus().redo().run()}
                  className="h-8 w-8 p-0"
                  disabled={!editor || !editor.can().redo()}
                  data-testid="button-redo"
                  title="Redo (Ctrl+Y)"
                >
                  <Redo className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Attachment button */}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-3"
              data-testid="button-attach"
              title="Attach files"
            >
              <Paperclip className="h-4 w-4 mr-2" />
              <span className="text-sm">Attach</span>
            </Button>
          </div>

          {/* Email Body - Rich Text Editor */}
          <div className="flex-1">
            <div className="min-h-[350px] bg-white dark:bg-gray-900">
              {editor ? (
                <EditorContent
                  editor={editor}
                  className="email-composer"
                  data-testid="editor-body"
                />
              ) : (
                <div className="flex items-center justify-center min-h-[350px] text-gray-500 dark:text-gray-400">
                  Loading editor...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50 dark:bg-gray-800/50">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {formData.body.length > 0 && `${formData.body.length} characters`}
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={handleClose}
              className="text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              data-testid="button-cancel-compose"
            >
              Discard
            </Button>
            <Button
              onClick={handleSend}
              disabled={sendEmailMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6"
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