import { useState, useCallback, useEffect } from "react";
import { BookOpen, Settings, RefreshCw, X } from "lucide-react";
import { makeReply, makeReplyAll, makeForward } from "@/lib/emailUtils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ThemeMenu } from "./ThemeMenu";
import { MailSidebar } from "./MailSidebar";
import { EmailListItem, type EmailMessage } from "./EmailListItem";
import { EmailViewer } from "./EmailViewer";
import { ReadingMode } from "./ReadingMode";
import { ComposeDialog } from "./ComposeDialog";
import { SearchDialog } from "./SearchDialog";
import { SettingsDialog } from "./SettingsDialog";
import { cn } from "@/lib/utils";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { UserPrefs } from "@shared/schema";

interface PrismMailProps {
  user?: {
    id: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    profileImageUrl?: string;
  };
  onLogout?: () => void;
}

// Mock data for demonstration - todo: remove mock functionality
const mockEmails: EmailMessage[] = [
  {
    id: '1',
    from: 'john.smith@acmecorp.com',
    subject: 'Q4 Budget Review Meeting - Action Required',
    date: new Date('2025-01-10T14:30:00'),
    isRead: false,
    isFlagged: true,
    priority: 3,
    hasAttachments: true,
    snippet: 'Hi team, we need to finalize the Q4 budget allocations before the board meeting next week. Please review the attached documents and come prepared with your department\'s requirements.',
    folder: 'INBOX'
  },
  {
    id: '2',
    from: 'sarah.jones@client.com',
    subject: 'Project Proposal Approved - Next Steps',
    date: new Date('2025-01-10T10:15:00'),
    isRead: false,
    isFlagged: false,
    priority: 2,
    hasAttachments: false,
    snippet: 'Great news! The project proposal has been approved by the executive committee. We can now proceed with the implementation phase.',
    folder: 'INBOX'
  },
  {
    id: '3',
    from: 'notifications@github.com',
    subject: 'New pull request: Feature/authentication',
    date: new Date('2025-01-10T09:45:00'),
    isRead: true,
    isFlagged: false,
    priority: 0,
    hasAttachments: false,
    snippet: 'A new pull request has been opened for the authentication feature by @developer123. Please review when you have a chance.',
    folder: 'INBOX'
  },
  {
    id: '4',
    from: 'marketing@company.com',
    subject: 'Weekly Newsletter - Product Updates',
    date: new Date('2025-01-09T16:20:00'),
    isRead: true,
    isFlagged: true,
    priority: 1,
    hasAttachments: true,
    snippet: 'Check out the latest product updates, feature releases, and upcoming events in this week\'s newsletter.',
    folder: 'INBOX'
  },
  {
    id: '5',
    from: 'security@company.com',
    subject: 'Security Alert: Suspicious Login Detected',
    date: new Date('2025-01-09T11:10:00'),
    isRead: false,
    isFlagged: false,
    priority: 3,
    hasAttachments: false,
    snippet: 'We detected a login attempt from an unrecognized device. Please verify this was you or secure your account immediately.',
    folder: 'INBOX'
  }
].sort((a, b) => b.date.getTime() - a.date.getTime()); // Sort newest first

const mockUnreadCounts = {
  inbox: 3,
  focus: 2,
  unread: 3,
  priority: 2,
  starred: 2
};

interface AccountConnection {
  id: string;
  name: string;
  protocol: 'IMAP' | 'EWS';
  isActive: boolean;
}

export function PrismMail({ user, onLogout }: PrismMailProps) {
  const [selectedFolder, setSelectedFolder] = useState('inbox');
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [selectedEmail, setSelectedEmail] = useState<EmailMessage | null>(null);
  const [isReadingMode, setIsReadingMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { toast } = useToast();
  
  // Dialog states
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [composeReplyTo, setComposeReplyTo] = useState<{to: string; cc?: string; bcc?: string; subject: string; body?: string} | undefined>();
  
  // Inline compose state for replies
  const [inlineComposeDraft, setInlineComposeDraft] = useState<{to: string; cc?: string; bcc?: string; subject: string; body?: string} | null>(null);

  // Fetch user's accounts
  const { data: accounts = [], isLoading: accountsLoading } = useQuery<AccountConnection[]>({
    queryKey: ['/api/accounts']
  });

  // Fetch user preferences for auto-sync settings
  const { data: userPrefs } = useQuery<UserPrefs>({
    queryKey: ['/api/preferences']
  });

  // Auto-select account on load with IMAP preference
  useEffect(() => {
    if (accounts.length > 0 && !selectedAccount) {
      // Prefer IMAP accounts over EWS for auto-sync
      const preferredAccount = accounts.find(account => account.isActive && account.protocol === 'IMAP') ||
                               accounts.find(account => account.isActive) ||
                               accounts[0];
      
      if (preferredAccount) {
        setSelectedAccount(preferredAccount.id);
        console.log('Auto-selected account (IMAP preferred):', preferredAccount.name, preferredAccount.protocol);
      }
    }
  }, [accounts, selectedAccount]);

  // Get the selected account or fall back to first active account
  const primaryAccount = accounts.find(account => account.id === selectedAccount) ||
                         accounts.find(account => account.isActive && account.protocol === 'IMAP') ||
                         accounts.find(account => account.isActive);

  // Fetch emails for the primary account
  const { data: emails = [], isLoading: emailsLoading, refetch: refetchEmails } = useQuery<EmailMessage[]>({
    queryKey: ['/api/mail', primaryAccount?.id, selectedFolder],
    enabled: !!primaryAccount,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Auto-sync emails when account becomes available
  const syncMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const response = await fetch(`/api/accounts/${accountId}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ folder: 'INBOX', limit: 50 })
      });
      
      if (!response.ok) {
        throw new Error(`Sync failed: ${response.statusText}`);
      }
      
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Email sync completed",
        description: "Your emails have been synchronized successfully."
      });
      // Refresh the email list
      refetchEmails();
    },
    onError: (error: any) => {
      console.error('Email sync failed:', error);
      toast({
        title: "Email sync failed", 
        description: error.message || "Failed to synchronize emails",
        variant: "destructive"
      });
    }
  });

  // Auto-sync when a new account becomes active (only once when account changes)
  useEffect(() => {
    if (primaryAccount && emails.length === 0) {
      console.log('Auto-syncing emails for account:', primaryAccount.name, `(${primaryAccount.protocol})`);
      syncMutation.mutate(primaryAccount.id);
    }
  }, [primaryAccount?.id]); // Only depend on account ID, not the mutation or emails.length

  // Auto-sync scheduling based on user preferences - prefer IMAP accounts
  useEffect(() => {
    if (!userPrefs?.autoSync) {
      return; // No auto-sync if disabled
    }

    // Get all active accounts, prioritizing IMAP
    const activeAccounts = accounts.filter(account => account.isActive);
    const imapAccounts = activeAccounts.filter(account => account.protocol === 'IMAP');
    const ewsAccounts = activeAccounts.filter(account => account.protocol === 'EWS');
    
    // Prioritize IMAP accounts for auto-sync
    const accountsToSync = imapAccounts.length > 0 ? imapAccounts : ewsAccounts;
    
    if (accountsToSync.length === 0) {
      return; // No active accounts to sync
    }

    const syncInterval = (userPrefs.syncInterval || 600) * 1000; // Convert seconds to milliseconds
    console.log(`Setting up auto-sync every ${userPrefs.syncInterval || 600} seconds for ${accountsToSync.length} accounts (IMAP preferred)`);

    const intervalId = setInterval(() => {
      // Sync accounts in priority order (IMAP first)
      accountsToSync.forEach((account, index) => {
        setTimeout(() => {
          console.log('Auto-sync triggered for account:', account.name, `(${account.protocol})`);
          syncMutation.mutate(account.id);
        }, index * 2000); // Stagger syncs by 2 seconds to avoid overwhelming the server
      });
    }, syncInterval);

    // Cleanup interval on unmount or when dependencies change
    return () => {
      console.log('Cleaning up auto-sync interval');
      clearInterval(intervalId);
    };
  }, [userPrefs?.autoSync, userPrefs?.syncInterval, accounts]);

  // Show real emails only - no mock data fallback
  const displayEmails = emails;

  // Filter emails based on selected folder and search
  const filteredEmails = displayEmails.filter(email => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!email.from.toLowerCase().includes(query) && 
          !email.subject.toLowerCase().includes(query) &&
          !email.snippet.toLowerCase().includes(query)) {
        return false;
      }
    }

    // Folder filter
    switch (selectedFolder) {
      case 'inbox':
        return email.folder === 'INBOX';
      case 'starred':
        return email.isFlagged;
      case 'unread':
        return !email.isRead;
      case 'focus':
        return !email.isRead || email.priority > 1;
      case 'priority':
        return email.priority > 1;
      default:
        return email.folder === selectedFolder.toUpperCase();
    }
  });

  const handleEmailSelect = useCallback((email: EmailMessage) => {
    setSelectedEmail(email);
    
    // Mark as read when selected (only for real emails)
    if (!email.isRead && primaryAccount && emails.length > 0) {
      handleToggleRead(email.id);
    }
    console.log('Selected email:', email.subject);
  }, [primaryAccount, emails.length]);

  const handleToggleRead = useCallback(async (emailId: string) => {
    if (!primaryAccount) return;
    
    // Update optimistically in UI
    queryClient.setQueryData(['/api/mail', primaryAccount.id, selectedFolder], (oldData: EmailMessage[] | undefined) => {
      if (!oldData) return [];
      return oldData.map(email => 
        email.id === emailId ? { ...email, isRead: !email.isRead } : email
      );
    });
    
    try {
      // Update on server (only for real emails)
      const currentEmail = emails.find(e => e.id === emailId);
      if (currentEmail && emails.length > 0) {
        const response = await fetch(`/api/mail/${emailId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ isRead: !currentEmail.isRead })
        });
        
        if (!response.ok) {
          throw new Error('Failed to update read status');
        }
      }
    } catch (error) {
      console.error('Failed to update read status:', error);
      // Revert optimistic update on error
      refetchEmails();
    }
    console.log('Toggled read status for email:', emailId);
  }, [primaryAccount, selectedFolder, emails, refetchEmails]);

  const handleToggleFlagged = useCallback(async (emailId: string) => {
    if (!primaryAccount) return;
    
    // Update optimistically in UI  
    queryClient.setQueryData(['/api/mail', primaryAccount.id, selectedFolder], (oldData: EmailMessage[] | undefined) => {
      if (!oldData) return [];
      return oldData.map(email => 
        email.id === emailId ? { ...email, isFlagged: !email.isFlagged } : email
      );
    });
    
    try {
      // Update on server (only for real emails)
      const currentEmail = emails.find(e => e.id === emailId);
      if (currentEmail && emails.length > 0) {
        const response = await fetch(`/api/mail/${emailId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ isFlagged: !currentEmail.isFlagged })
        });
        
        if (!response.ok) {
          throw new Error('Failed to update flagged status');
        }
      }
    } catch (error) {
      console.error('Failed to update flagged status:', error);
      // Revert optimistic update on error
      refetchEmails();
    }
    console.log('Toggled flagged status for email:', emailId);
  }, [primaryAccount, selectedFolder, emails, refetchEmails]);

  const handleOpenReadingMode = () => {
    if (selectedEmail) {
      setIsReadingMode(true);
      console.log('Opening reading mode for:', selectedEmail.subject);
    }
  };

  const handleCloseReadingMode = () => {
    setIsReadingMode(false);
    console.log('Closing reading mode');
  };

  const handleReadingModeNavigation = (direction: 'prev' | 'next') => {
    if (!selectedEmail) return;
    
    const currentIndex = filteredEmails.findIndex(e => e.id === selectedEmail.id);
    let newIndex = currentIndex;
    
    if (direction === 'prev' && currentIndex > 0) {
      newIndex = currentIndex - 1;
    } else if (direction === 'next' && currentIndex < filteredEmails.length - 1) {
      newIndex = currentIndex + 1;
    }
    
    if (newIndex !== currentIndex) {
      const newEmail = filteredEmails[newIndex];
      setSelectedEmail(newEmail);
      handleToggleRead(newEmail.id); // Mark as read
      console.log('Navigated to:', newEmail.subject);
    }
  };

  const handleLogout = () => {
    onLogout?.();
    window.location.href = '/api/logout';
    console.log('Logging out');
  };

  // Dialog handlers
  const handleCompose = useCallback(() => {
    setComposeReplyTo(undefined);
    setIsComposeOpen(true);
    console.log('Compose clicked');
  }, []);

  const handleSearch = useCallback(() => {
    setIsSearchOpen(true);
    console.log('Search clicked');
  }, []);

  const handleSettings = useCallback(() => {
    setIsSettingsOpen(true);
    console.log('Settings clicked');
  }, []);

  const handleReply = useCallback((email: EmailMessage) => {
    const replyData = makeReply(email, user?.email);
    setInlineComposeDraft({
      to: replyData.to,
      cc: replyData.cc,
      bcc: replyData.bcc,
      subject: replyData.subject,
      body: replyData.body
    });
    console.log('Reply to:', email.subject);
  }, [user?.email]);

  const handleReplyAll = useCallback((email: EmailMessage) => {
    const replyAllData = makeReplyAll(email, user?.email);
    setInlineComposeDraft({
      to: replyAllData.to,
      cc: replyAllData.cc,
      bcc: replyAllData.bcc,
      subject: replyAllData.subject,
      body: replyAllData.body
    });
    console.log('Reply all to:', email.subject);
  }, [user?.email]);

  const handleForward = useCallback((email: EmailMessage) => {
    const forwardData = makeForward(email);
    setInlineComposeDraft({
      to: forwardData.to,
      cc: forwardData.cc,
      bcc: forwardData.bcc,
      subject: forwardData.subject,
      body: forwardData.body
    });
    console.log('Forward:', email.subject);
  }, []);

  const handleSelectEmailFromSearch = useCallback((emailId: string) => {
    const email = emails.find(e => e.id === emailId);
    if (email) {
      setSelectedEmail(email);
      handleEmailSelect(email);
    }
  }, [emails, handleEmailSelect]);

  const handleArchive = useCallback(async (email: EmailMessage) => {
    if (!primaryAccount) return;
    
    // Clear selection if we archived the currently selected email
    if (selectedEmail?.id === email.id) {
      setSelectedEmail(null);
    }
    
    try {
      // Move to archive folder (only for real emails)
      if (emails.length > 0) {
        const response = await fetch(`/api/mail/${email.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ folder: 'ARCHIVE' })
        });
        
        if (!response.ok) {
          throw new Error('Failed to archive email');
        }
      }
      
      // Refresh the email list to remove archived email from current view
      refetchEmails();
    } catch (error) {
      console.error('Failed to archive email:', error);
      toast({
        title: "Archive failed",
        description: "Failed to archive the email",
        variant: "destructive"
      });
    }
    console.log('Archived:', email.subject);
  }, [primaryAccount, selectedEmail, emails.length, refetchEmails, toast]);

  const handleDelete = useCallback(async (email: EmailMessage) => {
    if (!primaryAccount) return;
    
    // If we deleted the selected email, clear selection
    if (selectedEmail?.id === email.id) {
      setSelectedEmail(null);
    }
    
    try {
      // Move to trash folder (only for real emails)
      if (emails.length > 0) {
        const response = await fetch(`/api/mail/${email.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ folder: 'TRASH' })
        });
        
        if (!response.ok) {
          throw new Error('Failed to delete email');
        }
      }
      
      // Refresh the email list to remove deleted email from current view
      refetchEmails();
    } catch (error) {
      console.error('Failed to delete email:', error);
      toast({
        title: "Delete failed",
        description: "Failed to delete the email",
        variant: "destructive"
      });
    }
    console.log('Deleted:', email.subject);
  }, [primaryAccount, selectedEmail, emails.length, refetchEmails, toast]);

  const getUserDisplayName = () => {
    if (user?.firstName || user?.lastName) {
      return `${user.firstName || ''} ${user.lastName || ''}`.trim();
    }
    return user?.email || 'User';
  };

  const getUserInitials = () => {
    const name = getUserDisplayName();
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  return (
    <div className="h-screen flex bg-background">
      {/* Sidebar */}
      <MailSidebar
        selectedFolder={selectedFolder}
        selectedAccount={selectedAccount}
        onFolderSelect={(folderId, accountId) => {
          setSelectedFolder(folderId);
          if (accountId) {
            setSelectedAccount(accountId);
          }
        }}
        onAccountSelect={setSelectedAccount}
        onCompose={handleCompose}
        onSearch={handleSearch}
        onSettings={handleSettings}
        unreadCounts={mockUnreadCounts}
        accountFolderCounts={{}}
        accounts={accounts}
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="h-14 border-b flex items-center justify-between px-4 bg-card">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold">PrismMail</h1>
            
            <Button
              variant="outline"
              onClick={handleOpenReadingMode}
              disabled={!selectedEmail}
              data-testid="button-reading-mode"
              className="hover-elevate active-elevate-2"
            >
              <BookOpen className="h-4 w-4 mr-2" />
              Reading Mode
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {primaryAccount && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => syncMutation.mutate(primaryAccount.id)}
                disabled={syncMutation.isPending}
                data-testid="button-sync"
                className="hover-elevate active-elevate-2"
              >
                <RefreshCw className={cn("h-4 w-4", syncMutation.isPending && "animate-spin")} />
                <span className="sr-only">Sync emails</span>
              </Button>
            )}
            
            <ThemeMenu variant="dropdown" />
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full hover-elevate active-elevate-2" data-testid="button-user-menu">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user?.profileImageUrl} alt={getUserDisplayName()} />
                    <AvatarFallback>{getUserInitials()}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end">
                <div className="flex items-center justify-start gap-2 p-2">
                  <div className="flex flex-col space-y-1 leading-none">
                    <p className="font-medium">{getUserDisplayName()}</p>
                    {user?.email && (
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    )}
                  </div>
                </div>
                <Separator />
                <DropdownMenuItem onClick={handleSettings} data-testid="button-settings">
                  <Settings className="h-4 w-4 mr-2" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout} data-testid="button-logout">
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Email list and viewer */}
        <div className="flex-1 flex overflow-hidden">
          {/* Email list */}
          <div className="w-96 border-r flex flex-col">
            <div className="p-3 border-b bg-card">
              <div className="flex items-center justify-between">
                <h2 className="font-medium capitalize">{selectedFolder}</h2>
                <span className="text-sm text-muted-foreground">
                  {filteredEmails.length} emails
                </span>
              </div>
            </div>
            
            <ScrollArea className="flex-1">
              <div className="divide-y">
                {filteredEmails.map((email) => (
                  <EmailListItem
                    key={email.id}
                    email={email}
                    isSelected={selectedEmail?.id === email.id}
                    onClick={() => handleEmailSelect(email)}
                    onToggleRead={handleToggleRead}
                    onToggleFlagged={handleToggleFlagged}
                  />
                ))}
                {filteredEmails.length === 0 && (
                  <div className="p-8 text-center text-muted-foreground">
                    <div className="text-lg font-medium mb-2">No emails found</div>
                    <div className="text-sm">Try changing your filter or search terms</div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Email viewer and inline composer */}
          <div className="flex-1 flex flex-col">
            <EmailViewer
              email={selectedEmail}
              currentUserEmail={user?.email}
              onReply={handleReply}
              onReplyAll={handleReplyAll}
              onForward={handleForward}
              onArchive={handleArchive}
              onDelete={handleDelete}
              onToggleFlagged={(email) => handleToggleFlagged(email.id)}
            />
            
            {/* Inline Composer for Replies */}
            {inlineComposeDraft && (
              <div className="border-t bg-card">
                <div className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-lg">Reply</h3>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setComposeReplyTo(inlineComposeDraft);
                          setIsComposeOpen(true);
                          setInlineComposeDraft(null);
                        }}
                        data-testid="button-pop-out-compose"
                      >
                        Pop out
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setInlineComposeDraft(null)}
                        data-testid="button-close-inline-compose"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  
                  <ComposeDialog
                    isOpen={true}
                    onClose={() => setInlineComposeDraft(null)}
                    accountId={primaryAccount?.id}
                    replyTo={inlineComposeDraft}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reading Mode Overlay */}
      <ReadingMode
        email={selectedEmail}
        emails={filteredEmails}
        isOpen={isReadingMode}
        onClose={handleCloseReadingMode}
        onNavigate={handleReadingModeNavigation}
        onReply={handleReply}
        onForward={handleForward}
        onArchive={handleArchive}
        onDelete={handleDelete}
        onToggleFlagged={(email) => handleToggleFlagged(email.id)}
        backgroundImage="https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&h=1080&fit=crop"
      />

      {/* Dialogs */}
      <ComposeDialog
        isOpen={isComposeOpen}
        onClose={() => setIsComposeOpen(false)}
        accountId={primaryAccount?.id}
        replyTo={composeReplyTo}
      />
      
      <SearchDialog
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectEmail={handleSelectEmailFromSearch}
      />
      
      {user && (
        <SettingsDialog
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          user={user}
        />
      )}
    </div>
  );
}