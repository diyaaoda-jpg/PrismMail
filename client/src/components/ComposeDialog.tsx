import { useState } from "react";
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

interface ComposeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  replyTo?: {
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    body?: string;
  };
}

export function ComposeDialog({ isOpen, onClose, replyTo }: ComposeDialogProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    to: replyTo?.to || "",
    cc: replyTo?.cc || "",
    bcc: replyTo?.bcc || "",
    subject: replyTo?.subject || "",
    body: replyTo?.body || ""
  });
  const [isSending, setIsSending] = useState(false);

  const handleSend = async () => {
    if (!formData.to || !formData.subject) {
      toast({
        title: "Missing Information",
        description: "Please enter recipient and subject",
        variant: "destructive"
      });
      return;
    }

    setIsSending(true);
    
    // Simulate sending email
    setTimeout(() => {
      console.log('Sending email:', formData);
      toast({
        title: "Email Sent",
        description: `Your email to ${formData.to} has been sent successfully.`,
      });
      setIsSending(false);
      onClose();
      // Reset form
      setFormData({ to: "", cc: "", bcc: "", subject: "", body: "" });
    }, 1500);
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
            <Button variant="ghost" size="sm" data-testid="button-bold">
              <Bold className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" data-testid="button-italic">
              <Italic className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" data-testid="button-underline">
              <Underline className="h-4 w-4" />
            </Button>
            <Separator orientation="vertical" className="h-6 mx-2" />
            <Button variant="ghost" size="sm" data-testid="button-attach">
              <Paperclip className="h-4 w-4" />
              <span className="ml-1 text-sm">Attach</span>
            </Button>
          </div>

          {/* Email Body */}
          <div className="flex-1">
            <Textarea
              value={formData.body}
              onChange={(e) => setFormData({ ...formData, body: e.target.value })}
              placeholder="Write your email..."
              className="min-h-[300px] resize-none"
              data-testid="textarea-body"
            />
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
              disabled={isSending}
              data-testid="button-send-compose"
            >
              {isSending ? (
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