import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { EmailMessage } from '@shared/schema';

interface ExpandableEmailHeadersProps {
  email: EmailMessage;
  className?: string;
}

interface EmailHeaderInfo {
  label: string;
  value: string;
  copyable?: boolean;
  technical?: boolean;
}

export function ExpandableEmailHeaders({ email, className }: ExpandableEmailHeadersProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const { toast } = useToast();

  const handleCopy = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      toast({
        description: `${fieldName} copied to clipboard`,
        duration: 2000,
      });
      
      // Reset copied state after 2 seconds
      setTimeout(() => setCopiedField(null), 2000);
    } catch (error) {
      toast({
        description: "Failed to copy to clipboard",
        variant: "destructive",
        duration: 2000,
      });
    }
  };

  // Basic email headers (always visible)
  const basicHeaders: EmailHeaderInfo[] = [
    { label: "From", value: email.from, copyable: true },
    { label: "To", value: email.to || "Not specified", copyable: true },
    ...(email.cc ? [{ label: "Cc", value: email.cc, copyable: true }] : []),
    ...(email.bcc ? [{ label: "Bcc", value: email.bcc, copyable: true }] : []),
    ...(email.replyTo ? [{ label: "Reply-To", value: email.replyTo, copyable: true }] : []),
    { 
      label: "Date", 
      value: email.date instanceof Date ? email.date.toLocaleString() : new Date(email.date).toLocaleString() 
    },
    { label: "Subject", value: email.subject, copyable: true },
  ];

  // Technical headers (visible when expanded)
  const technicalHeaders: EmailHeaderInfo[] = [
    { label: "Message-ID", value: email.id, copyable: true, technical: true },
    ...(email.threadId ? [{ label: "Thread-ID", value: email.threadId, copyable: true, technical: true }] : []),
    { label: "Folder", value: email.folder, technical: true },
    { label: "Size", value: `~${Math.round((email.snippet?.length || 0) * 1.5)} bytes`, technical: true },
    { label: "Priority", value: email.priority > 0 ? `${email.priority} (High)` : "Normal", technical: true },
    { label: "Read Status", value: email.isRead ? "Read" : "Unread", technical: true },
    { label: "Flagged", value: email.isFlagged ? "Yes" : "No", technical: true },
    { label: "Has Attachments", value: email.hasAttachments ? "Yes" : "No", technical: true },
  ];

  const allHeaders = isExpanded ? [...basicHeaders, ...technicalHeaders] : basicHeaders;

  return (
    <Card className={cn("", className)}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Message Details</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs hover-elevate active-elevate-2"
            data-testid="button-toggle-headers"
          >
            {isExpanded ? (
              <>
                <ChevronDown className="h-3 w-3 mr-1" />
                Hide Technical Info
              </>
            ) : (
              <>
                <ChevronRight className="h-3 w-3 mr-1" />
                Show Technical Info
              </>
            )}
          </Button>
        </div>

        <div className="space-y-3">
          {allHeaders.map((header, index) => {
            const isBasic = index < basicHeaders.length;
            const isCopied = copiedField === header.label;
            
            return (
              <div key={header.label} className={cn(
                "flex items-start gap-3 group",
                header.technical && "opacity-75"
              )}>
                <div className="w-20 shrink-0 text-xs font-medium text-muted-foreground pt-0.5">
                  {header.label}:
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className={cn(
                    "text-sm break-words",
                    header.technical && "font-mono text-xs"
                  )}>
                    {header.value}
                  </div>
                </div>

                {header.copyable && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity hover-elevate active-elevate-2"
                    onClick={() => handleCopy(header.value, header.label)}
                    data-testid={`button-copy-${header.label.toLowerCase()}`}
                  >
                    {isCopied ? (
                      <Check className="h-3 w-3 text-green-600" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {isExpanded && (
          <>
            <Separator className="my-4" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p><strong>Note:</strong> Technical information includes internal identifiers and metadata.</p>
              <p>Message content and headers are sanitized for security.</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}