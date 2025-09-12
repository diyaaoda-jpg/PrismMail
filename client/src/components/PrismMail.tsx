import { useState, useCallback } from "react";
import { BookOpen, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "./ThemeToggle";
import { MailSidebar } from "./MailSidebar";
import { EmailListItem, type EmailMessage } from "./EmailListItem";
import { EmailViewer } from "./EmailViewer";
import { ReadingMode } from "./ReadingMode";
import { cn } from "@/lib/utils";

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
];

const mockUnreadCounts = {
  inbox: 3,
  focus: 2,
  unread: 3,
  priority: 2,
  starred: 2
};

export function PrismMail({ user, onLogout }: PrismMailProps) {
  const [selectedFolder, setSelectedFolder] = useState('inbox');
  const [selectedEmail, setSelectedEmail] = useState<EmailMessage | null>(null);
  const [emails, setEmails] = useState<EmailMessage[]>(mockEmails);
  const [isReadingMode, setIsReadingMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Filter emails based on selected folder and search
  const filteredEmails = emails.filter(email => {
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
    // Mark as read when selected - todo: remove mock functionality
    setEmails(prev => prev.map(e => 
      e.id === email.id ? { ...e, isRead: true } : e
    ));
    console.log('Selected email:', email.subject);
  }, []);

  const handleToggleRead = useCallback((emailId: string) => {
    setEmails(prev => prev.map(email => 
      email.id === emailId ? { ...email, isRead: !email.isRead } : email
    ));
    console.log('Toggled read status for email:', emailId);
  }, []);

  const handleToggleFlagged = useCallback((emailId: string) => {
    setEmails(prev => prev.map(email => 
      email.id === emailId ? { ...email, isFlagged: !email.isFlagged } : email
    ));
    console.log('Toggled flagged status for email:', emailId);
  }, []);

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
        onFolderSelect={setSelectedFolder}
        onCompose={() => console.log('Compose email')}
        onSearch={setSearchQuery}
        unreadCounts={mockUnreadCounts}
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
            <ThemeToggle />
            
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

          {/* Email viewer */}
          <EmailViewer
            email={selectedEmail}
            onReply={(email) => console.log('Reply to:', email.subject)}
            onReplyAll={(email) => console.log('Reply all to:', email.subject)}
            onForward={(email) => console.log('Forward:', email.subject)}
            onArchive={(email) => console.log('Archive:', email.subject)}
            onDelete={(email) => console.log('Delete:', email.subject)}
            onToggleFlagged={(email) => handleToggleFlagged(email.id)}
          />
        </div>
      </div>

      {/* Reading Mode Overlay */}
      <ReadingMode
        email={selectedEmail}
        emails={filteredEmails}
        isOpen={isReadingMode}
        onClose={handleCloseReadingMode}
        onNavigate={handleReadingModeNavigation}
        backgroundImage="https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&h=1080&fit=crop"
      />
    </div>
  );
}