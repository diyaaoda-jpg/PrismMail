import { useState } from 'react';
import { ReadingMode } from '../ReadingMode';
import type { EmailMessage } from '../EmailListItem';
import { Button } from '@/components/ui/button';

// Mock emails for demonstration
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
    snippet: 'Hi team, we need to finalize the Q4 budget allocations before the board meeting next week.',
    folder: 'INBOX'
  },
  {
    id: '2',
    from: 'sarah.jones@client.com',
    subject: 'Project Proposal Approved - Next Steps',
    date: new Date('2025-01-10T10:15:00'),
    isRead: true,
    isFlagged: false,
    priority: 2,
    hasAttachments: false,
    snippet: 'Great news! The project proposal has been approved by the executive committee.',
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
    snippet: 'A new pull request has been opened for the authentication feature.',
    folder: 'INBOX'
  }
];

export default function ReadingModeExample() {
  const [isReadingMode, setIsReadingMode] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<EmailMessage | null>(null);

  const openReadingMode = () => {
    setSelectedEmail(mockEmails[0]);
    setIsReadingMode(true);
  };

  const closeReadingMode = () => {
    setIsReadingMode(false);
    setSelectedEmail(null);
  };

  return (
    <div className="p-4">
      <Button 
        onClick={openReadingMode}
        data-testid="button-open-reading-mode"
        className="hover-elevate active-elevate-2"
      >
        Open Reading Mode Demo
      </Button>
      
      <ReadingMode
        email={selectedEmail}
        emails={mockEmails}
        isOpen={isReadingMode}
        onClose={closeReadingMode}
        onNavigate={(direction) => {
          const currentIndex = mockEmails.findIndex(e => e.id === selectedEmail?.id);
          if (direction === 'prev' && currentIndex > 0) {
            setSelectedEmail(mockEmails[currentIndex - 1]);
          } else if (direction === 'next' && currentIndex < mockEmails.length - 1) {
            setSelectedEmail(mockEmails[currentIndex + 1]);
          }
        }}
        backgroundImage="https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&h=1080&fit=crop"
      />
    </div>
  );
}