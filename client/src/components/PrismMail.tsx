import * as React from "react";
import { BookOpen, Settings, RefreshCw, X, Menu, ArrowLeft, Search, Edit, ChevronDown } from "lucide-react";
import { makeReply, makeReplyAll, makeForward } from "@/lib/emailUtils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ThemeMenu } from "./ThemeMenu";
import { MailSidebar } from "./MailSidebar";
import { type EmailMessage } from "./EmailListItem";
import { OptimizedEmailList } from "./OptimizedEmailList";
import { EmailViewer } from "./EmailViewer";
import { ReadingMode } from "./ReadingMode";
import { ComposeDialog } from "./ComposeDialog";
import { SearchDialog } from "./SearchDialog";
import { SettingsDialog } from "./SettingsDialog";
import { OfflineIndicator } from "./OfflineIndicator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { cn, debounce } from "@/lib/utils";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useBreakpoint, useIsTabletOrMobile, useHasTouchInterface } from "@/hooks/use-breakpoint";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useOfflineActions } from "@/hooks/useOfflineActions";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useSwipeGestures } from "@/hooks/useSwipeGestures";
import { triggerHapticFeedback } from "@/lib/gestureUtils";
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
    isStarred: true,
    isArchived: false,
    isDeleted: false,
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
    isStarred: false,
    isArchived: false,
    isDeleted: false,
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
    isStarred: false,
    isArchived: false,
    isDeleted: false,
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
    isStarred: true,
    isArchived: false,
    isDeleted: false,
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
    isStarred: false,
    isArchived: false,
    isDeleted: false,
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
  const [selectedFolder, setSelectedFolder] = React.useState('inbox');
  const [selectedAccount, setSelectedAccount] = React.useState<string>('');
  const [selectedEmail, setSelectedEmail] = React.useState<EmailMessage | null>(null);
  const [isReadingMode, setIsReadingMode] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const { toast } = useToast();
  
  // Responsive state management - SINGLE SOURCE OF TRUTH to eliminate redundant listeners
  const breakpoint = useBreakpoint();
  const { isMobile, isTablet, isDesktop, isXl, currentBreakpoint, 
         isTabletOrMobile, isDesktopOrXl, hasTouchInterface } = breakpoint;
  
  // Sidebar state - unified for mobile and tablet
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
  
  // Mobile-specific state for full-screen email view
  const [isMobileEmailViewOpen, setIsMobileEmailViewOpen] = React.useState(false);
  
  // Tablet-specific state
  const [tabletSidebarMode, setTabletSidebarMode] = React.useState<'overlay' | 'push'>('push');
  
  // Dialog states
  const [isComposeOpen, setIsComposeOpen] = React.useState(false);
  const [isSearchOpen, setIsSearchOpen] = React.useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [composeReplyTo, setComposeReplyTo] = React.useState<{to: string; cc?: string; bcc?: string; subject: string; body?: string} | undefined>();
  
  // Inline compose state for replies
  const [inlineComposeDraft, setInlineComposeDraft] = React.useState<{to: string; cc?: string; bcc?: string; subject: string; body?: string} | null>(null);
  
  // Responsive panel state and persistence - different defaults per breakpoint
  const [panelSizes, setPanelSizes] = React.useState<number[]>(() => {
    const saved = localStorage.getItem('prismmail-panel-sizes');
    if (saved) return JSON.parse(saved);
    
    // Responsive defaults based on screen size
    if (typeof window !== 'undefined') {
      const width = window.innerWidth;
      if (width >= 1440) return [30, 70]; // XL: More space for email content
      if (width >= 1024) return [35, 65]; // Desktop: Balanced split
      if (width >= 768) return [40, 60];  // Tablet: Favor email list for touch
    }
    return [35, 65]; // Fallback
  });
  
  // Debounced localStorage save to prevent jank during dragging
  const debouncedSavePanelSizes = React.useCallback(
    debounce((sizes: number[]) => {
      localStorage.setItem('prismmail-panel-sizes', JSON.stringify(sizes));
    }, 200),
    []
  );

  // Handle panel size changes and persist to localStorage
  const handlePanelLayout = React.useCallback((sizes: number[]) => {
    setPanelSizes(sizes);
    debouncedSavePanelSizes(sizes);
  }, [debouncedSavePanelSizes]);

  // Fetch user's accounts - ensure it's always an array
  const { data: accountsResponse, isLoading: accountsLoading } = useQuery<{
    success: boolean;
    data: AccountConnection[];
  }>({
    queryKey: ['/api/accounts']
  });
  
  // Extract accounts from API response wrapper and ensure it's always an array
  const accounts: AccountConnection[] = Array.isArray(accountsResponse?.data) ? accountsResponse.data : [];

  // Fetch user preferences for auto-sync settings
  const { data: userPrefs } = useQuery<UserPrefs>({
    queryKey: ['/api/preferences']
  });

  // WebSocket connection for real-time email updates
  const { isConnected: wsConnected, lastMessage: wsMessage } = useWebSocket();
  
  // Get the selected account or fall back to first active account - with array safety
  const primaryAccount: AccountConnection | undefined = accounts.length > 0 ? (
    accounts.find((account: AccountConnection) => account.id === selectedAccount) ||
    accounts.find((account: AccountConnection) => account.isActive && account.protocol === 'IMAP') ||
    accounts.find((account: AccountConnection) => account.isActive)
  ) : undefined;

  // Fetch emails based on selected folder and account
  const { data: emailResponse, isLoading: emailsLoading, refetch: refetchEmails } = useQuery({
    queryKey: selectedAccount === '' 
      ? ['/api/mail/unified', selectedFolder]
      : ['/api/mail', selectedFolder, selectedAccount],
    queryFn: ({ queryKey }) => {
      const [endpoint, folder] = queryKey;
      if (endpoint === '/api/mail/unified') {
        return fetch(`${endpoint}/${folder}`).then(res => res.json());
      } else {
        // For individual account view, pass the accountId parameter
        const accountId = selectedAccount;
        const url = `${endpoint}?folder=${folder}&accountId=${accountId}`;
        console.log(`API Debug - Fetching emails: ${url}`);
        return fetch(url).then(res => res.json());
      }
    },
    enabled: selectedAccount === '' || !!primaryAccount,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Sync mutation for manual email refresh
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

  // Pull-to-refresh functionality
  const handleRefresh = React.useCallback(async () => {
    console.log('Pull-to-refresh triggered');
    if (primaryAccount) {
      // Trigger sync for the current account
      await syncMutation.mutateAsync(primaryAccount.id);
    } else {
      // Refetch emails if no specific account
      await refetchEmails();
    }
  }, [primaryAccount, syncMutation, refetchEmails]);

  const pullToRefresh = usePullToRefresh(handleRefresh, {
    threshold: 80,
    maxPullDistance: 120,
    enableHapticFeedback: isMobile,
    refreshingText: 'Refreshing emails...',
    pullText: 'Pull to refresh',
    readyText: 'Release to refresh',
    completedText: 'Emails updated',
  });

  // Edge swipe gestures for navigation - enabled on touch devices (mobile/tablet)
  const edgeSwipeConfig = {
    leftActions: [{
      type: 'menu' as const,
      icon: 'Menu',
      color: 'hsl(var(--primary))',
      label: 'Open Menu',
      threshold: hasTouchInterface ? (isTablet ? 80 : 60) : 60, // Larger threshold for tablet
      callback: () => {
        setIsSidebarOpen(true);
        if (hasTouchInterface) triggerHapticFeedback('light');
      },
    }],
    rightActions: [{
      type: 'compose' as const,
      icon: 'Edit',
      color: 'hsl(var(--chart-2))',
      label: 'Compose',
      threshold: hasTouchInterface ? (isTablet ? 80 : 60) : 60, // Larger threshold for tablet
      callback: () => {
        setIsComposeOpen(true);
        if (hasTouchInterface) triggerHapticFeedback('light');
      },
    }],
    enableHapticFeedback: hasTouchInterface,
    preventScrolling: false,
  };

  const edgeSwipes = useSwipeGestures(hasTouchInterface ? edgeSwipeConfig : { leftActions: [], rightActions: [] });
  
  // Refs for gesture handling
  const mainContainerRef = React.useRef<HTMLDivElement>(null);
  

  // Auto-select account on load with IMAP preference
  React.useEffect(() => {
    if (Array.isArray(accounts) && accounts.length > 0 && !selectedAccount) {
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


  // Fetch unified folder counts for All Accounts view
  const { data: unifiedCounts } = useQuery<{
    unified: Record<string, { unread: number; total: number }>;
    accounts: Array<{
      accountId: string;
      accountName: string;
      folders: Record<string, { unread: number; total: number }>;
    }>;
  }>({
    queryKey: ['/api/mail/unified-counts'],
    enabled: selectedAccount === '',
    staleTime: 1000 * 60 * 2, // 2 minutes
  });

  // Extract emails with tolerant parsing - handle both wrapped {success,data} and raw array formats
  const emails: EmailMessage[] = Array.isArray(emailResponse) 
    ? emailResponse 
    : (emailResponse?.success && Array.isArray(emailResponse.data) ? emailResponse.data : []);


  // Listen for WebSocket messages and refresh emails automatically
  React.useEffect(() => {
    if (wsMessage?.type === 'emailSynced' || wsMessage?.type === 'emailReceived') {
      // Show a prominent notification to user with real-time indicator
      const messageData = wsMessage.data || {};
      const accountName = messageData.accountName || 'your email account';
      const folder = messageData.folder || 'Inbox';
      
      if (wsMessage.type === 'emailReceived') {
        toast({
          title: "📧 New Email Received",
          description: `Email arrived in ${accountName} - ${folder}. Updated automatically.`,
          duration: 5000,
        });
      } else if (wsMessage.type === 'emailSynced') {
        toast({
          title: "🔄 Email Sync Complete",
          description: `${accountName} - ${folder} synchronized successfully.`,
          duration: 4000,
        });
      }
      
      // Automatically refresh the email list
      refetchEmails();
      
      // Also invalidate the unified counts to update badges
      queryClient.invalidateQueries({ queryKey: ['/api/mail/unified-counts'] });
    }
  }, [wsMessage?.type, wsMessage?.data, refetchEmails, toast]); // Include refetchEmails and toast dependencies

  // Auto-sync when a new account becomes active (only once when account changes)
  React.useEffect(() => {
    if (primaryAccount && emails.length === 0 && !syncMutation.isPending) {
      console.log('Auto-syncing emails for account:', primaryAccount.name, `(${primaryAccount.protocol})`);
      syncMutation.mutate(primaryAccount.id);
    }
  }, [primaryAccount?.id, emails.length, syncMutation]); // Include syncMutation dependency

  // Auto-sync scheduling based on user preferences - prefer IMAP accounts
  React.useEffect(() => {
    if (!userPrefs?.autoSync) {
      return; // No auto-sync if disabled
    }

    // Get all active accounts, prioritizing IMAP - with array safety
    const activeAccounts = accounts.length > 0 ? accounts.filter((account: AccountConnection) => account.isActive) : [];
    const imapAccounts = activeAccounts.filter((account: AccountConnection) => account.protocol === 'IMAP');
    const ewsAccounts = activeAccounts.filter((account: AccountConnection) => account.protocol === 'EWS');
    
    // Prioritize IMAP accounts for auto-sync
    const accountsToSync = imapAccounts.length > 0 ? imapAccounts : ewsAccounts;
    
    if (accountsToSync.length === 0) {
      return; // No active accounts to sync
    }

    const syncInterval = (userPrefs.syncInterval || 600) * 1000; // Convert seconds to milliseconds
    console.log(`Setting up auto-sync every ${userPrefs.syncInterval || 600} seconds for ${accountsToSync.length} accounts (IMAP preferred)`);

    const intervalId = setInterval(() => {
      // Sync accounts in priority order (IMAP first)
      accountsToSync.forEach((account: AccountConnection, index: number) => {
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
  }, [userPrefs?.autoSync, userPrefs?.syncInterval, accounts.length]); // Use length for array stability

  // Show real emails only - no mock data fallback
  const displayEmails = Array.isArray(emails) ? emails : [];

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

    // Folder filter - map logical folders to actual stored folder names
    switch (selectedFolder) {
      case 'inbox':
        return email.folder === 'INBOX' || email.folder === 'inbox';
      case 'sent':
        return email.folder === 'SentItems' || email.folder === 'Sent';
      case 'drafts':
        return email.folder === 'Drafts';
      case 'deleted':
        return email.folder === 'DeletedItems' || email.folder === 'Trash';
      case 'spam':
        return email.folder === 'JunkEmail' || email.folder === 'Spam';
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

  const handleEmailSelect = React.useCallback((email: EmailMessage) => {
    setSelectedEmail(email);
    
    // Mark as read when selected (only for real emails)
    if (!email.isRead && primaryAccount && emails.length > 0) {
      // Call handleToggleRead directly to avoid stale closure
      handleToggleRead(email.id);
    }
    
    // Open mobile email viewer
    if (isMobile) {
      setIsMobileEmailViewOpen(true);
    }
    
    console.log('Selected email:', email.subject);
  }, [primaryAccount?.id, emails.length, isMobile]); // Use stable primaryAccount.id

  const handleToggleRead = React.useCallback(async (emailId: string) => {
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

  const handleToggleFlagged = React.useCallback(async (emailId: string) => {
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
  const handleCompose = React.useCallback(() => {
    setComposeReplyTo(undefined);
    setIsComposeOpen(true);
    console.log('Compose clicked');
  }, []);

  const handleSearch = React.useCallback(() => {
    setIsSearchOpen(true);
    console.log('Search clicked');
  }, []);

  const handleSettings = React.useCallback(() => {
    setIsSettingsOpen(true);
    console.log('Settings clicked');
  }, []);

  const handleReply = React.useCallback((email: EmailMessage) => {
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

  const handleReplyAll = React.useCallback((email: EmailMessage) => {
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

  const handleForward = React.useCallback((email: EmailMessage) => {
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

  const handleSelectEmailFromSearch = React.useCallback((emailId: string) => {
    const email = emails.find(e => e.id === emailId);
    if (email) {
      setSelectedEmail(email);
      handleEmailSelect(email);
    }
  }, [emails, handleEmailSelect]);

  // Organization mutations using React Query
  const starMutation = useMutation({
    mutationFn: async ({ emailId, isStarred }: { emailId: string; isStarred: boolean }) => {
      return apiRequest('PATCH', `/api/mail/${emailId}/star`, { isStarred: !isStarred });
    },
    onMutate: async ({ emailId, isStarred }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['/api/mail'] });
      
      // Snapshot the previous value
      const previousEmails = queryClient.getQueryData(['/api/mail', selectedFolder, selectedAccount]);
      
      // Optimistically update to the new value
      queryClient.setQueryData(['/api/mail', selectedFolder, selectedAccount], (old: any) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((email: EmailMessage) =>
            email.id === emailId ? { ...email, isStarred: !isStarred } : email
          )
        };
      });
      
      return { previousEmails };
    },
    onError: (err, variables, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      if (context?.previousEmails) {
        queryClient.setQueryData(['/api/mail', selectedFolder, selectedAccount], context.previousEmails);
      }
      toast({
        title: "Star failed",
        description: "Failed to update star status",
        variant: "destructive"
      });
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: ['/api/mail'] });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async ({ emailId, isArchived }: { emailId: string; isArchived: boolean }) => {
      return apiRequest('PATCH', `/api/mail/${emailId}/archive`, { isArchived: !isArchived });
    },
    onMutate: async ({ emailId }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['/api/mail'] });
      
      // Clear selection if we archived the currently selected email
      if (selectedEmail?.id === emailId) {
        setSelectedEmail(null);
      }
      
      // Snapshot the previous value
      const previousEmails = queryClient.getQueryData(['/api/mail', selectedFolder, selectedAccount]);
      
      return { previousEmails };
    },
    onError: (err, variables, context) => {
      if (context?.previousEmails) {
        queryClient.setQueryData(['/api/mail', selectedFolder, selectedAccount], context.previousEmails);
      }
      toast({
        title: "Archive failed",
        description: "Failed to archive email",
        variant: "destructive"
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mail'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ emailId, isDeleted }: { emailId: string; isDeleted: boolean }) => {
      return apiRequest('PATCH', `/api/mail/${emailId}/delete`, { isDeleted: !isDeleted });
    },
    onMutate: async ({ emailId }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['/api/mail'] });
      
      // Clear selection if we deleted the currently selected email
      if (selectedEmail?.id === emailId) {
        setSelectedEmail(null);
      }
      
      // Snapshot the previous value
      const previousEmails = queryClient.getQueryData(['/api/mail', selectedFolder, selectedAccount]);
      
      return { previousEmails };
    },
    onError: (err, variables, context) => {
      if (context?.previousEmails) {
        queryClient.setQueryData(['/api/mail', selectedFolder, selectedAccount], context.previousEmails);
      }
      toast({
        title: "Delete failed",
        description: "Failed to delete email",
        variant: "destructive"
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mail'] });
    },
  });

  // Organization action handlers
  const handleStar = React.useCallback((email: EmailMessage) => {
    starMutation.mutate({ emailId: email.id, isStarred: email.isStarred });
    console.log('Starred:', email.subject, !email.isStarred);
  }, [starMutation]);

  const handleArchive = React.useCallback((email: EmailMessage) => {
    archiveMutation.mutate({ emailId: email.id, isArchived: email.isArchived });
    console.log('Archived:', email.subject, !email.isArchived);
  }, [archiveMutation]);

  const handleDelete = React.useCallback((email: EmailMessage) => {
    deleteMutation.mutate({ emailId: email.id, isDeleted: email.isDeleted });
    console.log('Deleted:', email.subject, !email.isDeleted);
  }, [deleteMutation]);

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

  // Touch device handlers for mobile and tablet
  const handleSidebarToggle = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  const handleMobileBackToList = () => {
    setIsMobileEmailViewOpen(false);
    setSelectedEmail(null);
  };

  const handleMobileCompose = () => {
    setIsComposeOpen(true);
    setIsSidebarOpen(false);
  };

  const handleMobileSearch = () => {
    setIsSearchOpen(true);
    setIsSidebarOpen(false);
  };

  return (
    <div 
      ref={mainContainerRef}
      className="h-screen bg-background"
      onTouchStart={isMobile ? edgeSwipes.handlers.onTouchStart : undefined}
      onTouchMove={isMobile ? edgeSwipes.handlers.onTouchMove : undefined}
      onTouchEnd={isMobile ? edgeSwipes.handlers.onTouchEnd : undefined}
      onPointerDown={isMobile ? edgeSwipes.handlers.onPointerDown : undefined}
      onPointerMove={isMobile ? edgeSwipes.handlers.onPointerMove : undefined}
      onPointerUp={isMobile ? edgeSwipes.handlers.onPointerUp : undefined}
    >
      {/* Edge swipe visual feedback */}
      {edgeSwipes.swipeState.isActive && (
        <div className="fixed inset-0 pointer-events-none z-50">
          {edgeSwipes.swipeState.direction === 'right' && (
            <div 
              className="absolute left-0 top-0 h-full bg-primary/20 transition-all duration-200"
              style={{ width: Math.min(edgeSwipes.swipeState.distance, 100) }}
            >
              <div className="flex items-center justify-center h-full px-4">
                <Menu className="h-6 w-6 text-primary" />
              </div>
            </div>
          )}
          {edgeSwipes.swipeState.direction === 'left' && (
            <div 
              className="absolute right-0 top-0 h-full bg-chart-2/20 transition-all duration-200"
              style={{ width: Math.min(edgeSwipes.swipeState.distance, 100) }}
            >
              <div className="flex items-center justify-center h-full px-4">
                <Edit className="h-6 w-6 text-chart-2" />
              </div>
            </div>
          )}
        </div>
      )}

      <div className={cn(
        "flex",
        isMobile ? "h-full flex-col" : "h-full"
      )}>
        {/* Mobile Sidebar Sheet Overlay */}
        <Sheet open={isTabletOrMobile && isSidebarOpen} onOpenChange={setIsSidebarOpen}>
          <SheetContent side="left" className="w-80 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation Menu</SheetTitle>
            </SheetHeader>
            <MailSidebar
              selectedFolder={selectedFolder}
              selectedAccount={selectedAccount}
              onFolderSelect={(folderId, accountId) => {
                setSelectedFolder(folderId);
                if (accountId) {
                  setSelectedAccount(accountId);
                } else {
                  setSelectedAccount('');
                }
                setIsSidebarOpen(false);
              }}
              onAccountSelect={(accountId) => {
                setSelectedAccount(accountId);
                setIsSidebarOpen(false);
              }}
              onCompose={handleMobileCompose}
              onSearch={handleMobileSearch}
              onSettings={handleSettings}
              unreadCounts={selectedAccount === '' && unifiedCounts?.unified ? 
                Object.entries(unifiedCounts.unified).reduce((acc, [folderType, counts]) => ({
                  ...acc,
                  [folderType]: counts.unread
                }), {}) : 
                mockUnreadCounts
              }
              accountFolderCounts={selectedAccount !== '' && unifiedCounts?.accounts ? 
                unifiedCounts.accounts.reduce((acc, account) => ({
                  ...acc,
                  [account.accountId]: Object.entries(account.folders).reduce((folderAcc, [folderType, counts]) => ({
                    ...folderAcc,
                    [folderType]: counts.unread
                  }), {})
                }), {}) : 
                {}
              }
              accounts={accounts}
            />
          </SheetContent>
        </Sheet>

        {/* Desktop Sidebar - Fixed sidebar for desktop and xl */}
        {(isDesktop || isXl) && (
          <MailSidebar
            selectedFolder={selectedFolder}
            selectedAccount={selectedAccount}
            onFolderSelect={(folderId, accountId) => {
              setSelectedFolder(folderId);
              if (accountId) {
                setSelectedAccount(accountId);
              } else {
                setSelectedAccount('');
              }
            }}
            onAccountSelect={(accountId) => {
              setSelectedAccount(accountId);
            }}
            onCompose={handleCompose}
            onSearch={handleSearch}
            onSettings={handleSettings}
            unreadCounts={selectedAccount === '' && unifiedCounts?.unified ? 
              Object.entries(unifiedCounts.unified).reduce((acc, [folderType, counts]) => ({
                ...acc,
                [folderType]: counts.unread
              }), {}) : 
              mockUnreadCounts
            }
            accountFolderCounts={selectedAccount !== '' && unifiedCounts?.accounts ? 
              unifiedCounts.accounts.reduce((acc, account) => ({
                ...acc,
                [account.accountId]: Object.entries(account.folders).reduce((folderAcc, [folderType, counts]) => ({
                  ...folderAcc,
                  [folderType]: counts.unread
                }), {})
              }), {}) : 
              {}
            }
            accounts={accounts}
          />
        )}

        {/* Main content area */}
        <div className={cn(
          "flex-1 flex flex-col",
          isMobile ? "h-full" : ""
        )}>
        {/* Desktop Header - Hidden on mobile and tablet */}
        {(isDesktop || isXl) && (
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
              
              <OfflineIndicator variant="badge" />
              
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
        )}

        {/* Mobile Email Viewer - Full screen overlay */}
        {isMobile && isMobileEmailViewOpen && selectedEmail && (
          <div className="fixed inset-0 top-14 bg-background z-30 flex flex-col">
            <div className="h-14 border-b flex items-center justify-between px-4 bg-card">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleMobileBackToList}
                className="hover-elevate active-elevate-2"
                data-testid="button-mobile-back"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenReadingMode}
                  className="hover-elevate active-elevate-2"
                  data-testid="button-mobile-reading-mode"
                >
                  <BookOpen className="h-4 w-4 mr-1" />
                  Reading
                </Button>
              </div>
            </div>
            
            <div className="flex-1 overflow-hidden">
              <EmailViewer
                email={selectedEmail}
                currentUserEmail={user?.email}
                onReply={handleReply}
                onReplyAll={handleReplyAll}
                onForward={handleForward}
                onArchive={handleArchive}
                onDelete={handleDelete}
                onToggleStar={handleStar}
                onBack={handleMobileBackToList}
              />
            </div>
          </div>
        )}

        {/* Mobile Header - Only shown on mobile for main view */}
        {isMobile && (
          <div className="h-14 border-b flex items-center justify-between px-4 bg-card shrink-0">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsSidebarOpen(true)}
                className="hover-elevate active-elevate-2"
                data-testid="button-mobile-menu"
                aria-label="Open sidebar menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
              
              <h1 className="text-lg font-semibold">
                {isMobileEmailViewOpen && selectedEmail ? 
                  "Email" : 
                  (selectedFolder === 'inbox' ? 'Inbox' : selectedFolder.charAt(0).toUpperCase() + selectedFolder.slice(1))
                }
              </h1>
              
              {!isMobileEmailViewOpen && filteredEmails.length > 0 && (
                <span className="text-sm text-muted-foreground">
                  ({filteredEmails.length})
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isMobileEmailViewOpen && selectedEmail ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleMobileBackToList}
                    className="hover-elevate active-elevate-2"
                    data-testid="button-mobile-back"
                    aria-label="Back to email list"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOpenReadingMode}
                    className="hover-elevate active-elevate-2"
                    data-testid="button-mobile-reading-mode"
                    aria-label="Open reading mode"
                  >
                    <BookOpen className="h-4 w-4 mr-1" />
                    Reading
                  </Button>
                </>
              ) : (
                <>
                  {primaryAccount && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => syncMutation.mutate(primaryAccount.id)}
                      disabled={syncMutation.isPending}
                      data-testid="button-mobile-sync"
                      className="hover-elevate active-elevate-2"
                      aria-label="Sync emails"
                    >
                      <RefreshCw className={cn("h-4 w-4", syncMutation.isPending && "animate-spin")} />
                    </Button>
                  )}
                  
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleSearch}
                    className="hover-elevate active-elevate-2"
                    data-testid="button-mobile-search"
                    aria-label="Search emails"
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                  
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCompose}
                    className="hover-elevate active-elevate-2"
                    data-testid="button-mobile-compose"
                    aria-label="Compose new email"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Mobile Email Viewer - Full screen overlay */}
        {isMobile && isMobileEmailViewOpen && selectedEmail && (
          <div className="flex-1 overflow-hidden">
            <EmailViewer
              email={selectedEmail}
              currentUserEmail={user?.email}
              onReply={handleReply}
              onReplyAll={handleReplyAll}
              onForward={handleForward}
              onArchive={handleArchive}
              onDelete={handleDelete}
              onToggleStar={handleStar}
              onBack={handleMobileBackToList}
            />
          </div>
        )}

        {/* Responsive layout based on breakpoint */}
        {/* Mobile: Single pane with overlay email view */}
        {isMobile && !isMobileEmailViewOpen && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Email list */}
            <div className="border-r flex flex-col flex-1">
              <div className="p-3 border-b bg-card">
                <div className="flex items-center justify-between">
                  <h2 className="font-medium capitalize">{selectedFolder}</h2>
                  <span className="text-sm text-muted-foreground">
                    {filteredEmails.length} emails
                  </span>
                </div>
              </div>
              
              <div className="flex-1 flex flex-col relative">
                {/* Pull-to-refresh indicator */}
                {pullToRefresh.pullState.isActive && (
                  <div 
                    className="flex items-center justify-center py-4 transition-all duration-300 absolute top-0 left-0 right-0 z-10"
                    style={{ 
                      height: pullToRefresh.pullDistance,
                      opacity: pullToRefresh.pullProgress,
                    }}
                  >
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <RefreshCw 
                        className={cn(
                          "h-4 w-4 transition-transform duration-300",
                          pullToRefresh.isRefreshing && "animate-spin",
                          pullToRefresh.pullProgress > 0.8 && "rotate-180"
                        )} 
                      />
                      <span className="text-sm font-medium">
                        {pullToRefresh.getStatusText()}
                      </span>
                    </div>
                  </div>
                )}

                {/* Optimized email list with virtual scrolling */}
                <div 
                  className="flex-1"
                  data-scroll-container
                  onTouchStart={hasTouchInterface ? (e: React.TouchEvent) => pullToRefresh.handlers.onTouchStart(e.nativeEvent) : undefined}
                  onTouchMove={hasTouchInterface ? (e: React.TouchEvent) => pullToRefresh.handlers.onTouchMove(e.nativeEvent) : undefined}
                  onTouchEnd={hasTouchInterface ? (e: React.TouchEvent) => pullToRefresh.handlers.onTouchEnd(e.nativeEvent) : undefined}
                  onPointerDown={hasTouchInterface ? (e: React.PointerEvent) => pullToRefresh.handlers.onPointerDown(e.nativeEvent) : undefined}
                  onPointerMove={hasTouchInterface ? (e: React.PointerEvent) => pullToRefresh.handlers.onPointerMove(e.nativeEvent) : undefined}
                  onPointerUp={hasTouchInterface ? (e: React.PointerEvent) => pullToRefresh.handlers.onPointerUp(e.nativeEvent) : undefined}
                >
                  <OptimizedEmailList
                    emails={filteredEmails}
                    selectedEmail={selectedEmail}
                    onEmailSelect={(email) => {
                      setSelectedEmail(email);
                      if (isMobile) {
                        setIsMobileEmailViewOpen(true);
                      }
                      console.log('Selected email:', email.subject);
                    }}
                    onToggleRead={handleToggleRead}
                    onToggleFlagged={handleToggleFlagged}
                    onToggleStar={(id: string) => {
                      const email = filteredEmails.find(e => e.id === id);
                      if (email) handleStar(email);
                    }}
                    onArchive={(id: string) => {
                      const email = filteredEmails.find(e => e.id === id);
                      if (email) handleArchive(email);
                    }}
                    onDelete={(id: string) => {
                      const email = filteredEmails.find(e => e.id === id);
                      if (email) handleDelete(email);
                    }}
                    enableSwipeGestures={hasTouchInterface}
                    isLoading={emailsLoading}
                    searchQuery={searchQuery}
                    className="h-full"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tablet: Fixed two-pane layout with touch-optimized sizing */}
        {isTablet && (
          <div className="flex flex-1 h-full">
            {/* Email List Panel - Fixed width for touch interaction */}
            <div className="w-[400px] min-w-[350px] border-r flex flex-col">
              <div className="p-4 border-b bg-card">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-lg capitalize">{selectedFolder}</h2>
                  <span className="text-sm text-muted-foreground bg-muted px-2 py-1 rounded-md">
                    {filteredEmails.length}
                  </span>
                </div>
              </div>
              
              <div className="flex-1 flex flex-col relative">
                {/* Pull-to-refresh indicator */}
                {pullToRefresh.pullState.isActive && (
                  <div 
                    className="flex items-center justify-center py-4 transition-all duration-300 absolute top-0 left-0 right-0 z-10"
                    style={{ 
                      height: pullToRefresh.pullDistance,
                      opacity: pullToRefresh.pullProgress,
                    }}
                  >
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <RefreshCw 
                        className={cn(
                          "h-5 w-5 transition-transform duration-300",
                          pullToRefresh.isRefreshing && "animate-spin",
                          pullToRefresh.pullProgress > 0.8 && "rotate-180"
                        )} 
                      />
                      <span className="text-base font-medium">
                        {pullToRefresh.getStatusText()}
                      </span>
                    </div>
                  </div>
                )}

                {/* Email list with touch-optimized interactions */}
                <div 
                  className="flex-1"
                  data-scroll-container
                  onTouchStart={hasTouchInterface ? (e: React.TouchEvent) => pullToRefresh.handlers.onTouchStart(e.nativeEvent) : undefined}
                  onTouchMove={hasTouchInterface ? (e: React.TouchEvent) => pullToRefresh.handlers.onTouchMove(e.nativeEvent) : undefined}
                  onTouchEnd={hasTouchInterface ? (e: React.TouchEvent) => pullToRefresh.handlers.onTouchEnd(e.nativeEvent) : undefined}
                  onPointerDown={hasTouchInterface ? (e: React.PointerEvent) => pullToRefresh.handlers.onPointerDown(e.nativeEvent) : undefined}
                  onPointerMove={hasTouchInterface ? (e: React.PointerEvent) => pullToRefresh.handlers.onPointerMove(e.nativeEvent) : undefined}
                  onPointerUp={hasTouchInterface ? (e: React.PointerEvent) => pullToRefresh.handlers.onPointerUp(e.nativeEvent) : undefined}
                >
                  <OptimizedEmailList
                    emails={filteredEmails}
                    selectedEmail={selectedEmail}
                    onEmailSelect={handleEmailSelect}
                    onToggleRead={handleToggleRead}
                    onToggleFlagged={handleToggleFlagged}
                    onToggleStar={(id: string) => {
                      const email = filteredEmails.find(e => e.id === id);
                      if (email) handleStar(email);
                    }}
                    onArchive={(id: string) => {
                      const email = filteredEmails.find(e => e.id === id);
                      if (email) handleArchive(email);
                    }}
                    onDelete={(id: string) => {
                      const email = filteredEmails.find(e => e.id === id);
                      if (email) handleDelete(email);
                    }}
                    enableSwipeGestures={hasTouchInterface}
                    isLoading={emailsLoading}
                    searchQuery={searchQuery}
                    className="h-full"
                  />
                </div>
              </div>
            </div>

            {/* Email Viewer Panel - Takes remaining space */}
            <div className="flex-1 flex flex-col">
              <EmailViewer
                email={selectedEmail}
                currentUserEmail={user?.email}
                onReply={handleReply}
                onReplyAll={handleReplyAll}
                onForward={handleForward}
                onArchive={handleArchive}
                onDelete={handleDelete}
                onToggleStar={handleStar}
              />
              
              {/* Inline Composer for Replies on Tablet */}
              {inlineComposeDraft && (
                <div className="border-t bg-card">
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-semibold text-lg">Reply</h3>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="default"
                          onClick={() => {
                            setComposeReplyTo(inlineComposeDraft);
                            setIsComposeOpen(true);
                            setInlineComposeDraft(null);
                          }}
                          data-testid="button-pop-out-compose"
                          className="hover-elevate active-elevate-2"
                        >
                          Pop out
                        </Button>
                        <Button
                          variant="ghost"
                          size="default"
                          onClick={() => setInlineComposeDraft(null)}
                          data-testid="button-close-inline-compose"
                          className="hover-elevate active-elevate-2"
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
        )}

        {/* Desktop & XL ONLY: Resizable three-pane layout - tablets get fixed layout */}
        {isDesktopOrXl && (
            <PanelGroup 
              direction="horizontal" 
              className="flex-1 overflow-hidden"
              onLayout={handlePanelLayout}
            >
              {/* Email List Panel - Minimum 25% width for readability, maximum 60% to preserve viewer space */}
              <Panel 
                defaultSize={panelSizes[0]} 
                minSize={25} 
                maxSize={60}
                id="email-list"
              >
                <div className="border-r flex flex-col h-full">
                  <div className="p-3 border-b bg-card">
                    <div className="flex items-center justify-between">
                      <h2 className="font-medium capitalize">{selectedFolder}</h2>
                      <span className="text-sm text-muted-foreground">
                        {filteredEmails.length} emails
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex-1 flex flex-col relative">
                    {/* Pull-to-refresh indicator */}
                    {pullToRefresh.pullState.isActive && (
                      <div 
                        className="flex items-center justify-center py-4 transition-all duration-300 absolute top-0 left-0 right-0 z-10"
                        style={{ 
                          height: pullToRefresh.pullDistance,
                          opacity: pullToRefresh.pullProgress,
                        }}
                      >
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <RefreshCw 
                            className={cn(
                              "h-4 w-4 transition-transform duration-300",
                              pullToRefresh.isRefreshing && "animate-spin",
                              pullToRefresh.pullProgress > 0.8 && "rotate-180"
                            )} 
                          />
                          <span className="text-sm font-medium">
                            {pullToRefresh.getStatusText()}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Optimized email list with virtual scrolling */}
                    <div 
                      className="flex-1"
                      data-scroll-container
                      onTouchStart={isMobile ? (e: React.TouchEvent) => pullToRefresh.handlers.onTouchStart(e.nativeEvent) : undefined}
                      onTouchMove={isMobile ? (e: React.TouchEvent) => pullToRefresh.handlers.onTouchMove(e.nativeEvent) : undefined}
                      onTouchEnd={isMobile ? (e: React.TouchEvent) => pullToRefresh.handlers.onTouchEnd(e.nativeEvent) : undefined}
                      onPointerDown={isMobile ? (e: React.PointerEvent) => pullToRefresh.handlers.onPointerDown(e.nativeEvent) : undefined}
                      onPointerMove={isMobile ? (e: React.PointerEvent) => pullToRefresh.handlers.onPointerMove(e.nativeEvent) : undefined}
                      onPointerUp={isMobile ? (e: React.PointerEvent) => pullToRefresh.handlers.onPointerUp(e.nativeEvent) : undefined}
                    >
                      <OptimizedEmailList
                        emails={filteredEmails}
                        selectedEmail={selectedEmail}
                        onEmailSelect={(email) => {
                          setSelectedEmail(email);
                          if (isMobile) {
                            setIsMobileEmailViewOpen(true);
                          }
                          console.log('Selected email:', email.subject);
                        }}
                        onToggleRead={handleToggleRead}
                        onToggleFlagged={handleToggleFlagged}
                        onToggleStar={(id: string) => {
                          const email = filteredEmails.find(e => e.id === id);
                          if (email) handleStar(email);
                        }}
                        onArchive={(id: string) => {
                          const email = filteredEmails.find(e => e.id === id);
                          if (email) handleArchive(email);
                        }}
                        onDelete={(id: string) => {
                          const email = filteredEmails.find(e => e.id === id);
                          if (email) handleDelete(email);
                        }}
                        enableSwipeGestures={isMobile}
                        isLoading={emailsLoading}
                        searchQuery={searchQuery}
                        className="h-full"
                      />
                    </div>
                  </div>
                </div>
              </Panel>

              {/* Resizable Handle */}
              <PanelResizeHandle 
                className="w-1 bg-border hover:bg-accent transition-colors data-[panel-group-direction=horizontal]:w-1 data-[panel-group-direction=horizontal]:h-full flex items-center justify-center group" 
                data-testid="handle-resize-panels"
              />

              {/* Email Viewer Panel - Minimum 40% width for email content readability, maximum 75% to preserve list */}
              <Panel 
                defaultSize={panelSizes[1]} 
                minSize={40} 
                maxSize={75}
                id="email-viewer"
              >
                <div className="flex-1 flex flex-col h-full">
                  <EmailViewer
                    email={selectedEmail}
                    currentUserEmail={user?.email}
                    onReply={handleReply}
                    onReplyAll={handleReplyAll}
                    onForward={handleForward}
                    onArchive={handleArchive}
                    onDelete={handleDelete}
                    onToggleStar={handleStar}
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
              </Panel>
            </PanelGroup>
        )}
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