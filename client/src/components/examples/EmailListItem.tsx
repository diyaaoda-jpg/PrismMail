import { EmailListItem, type EmailMessage } from '../EmailListItem';

// Mock data for demonstration
const mockEmail: EmailMessage = {
  id: '1',
  from: 'john.smith@acmecorp.com',
  subject: 'Q4 Budget Review Meeting - Action Required',
  date: new Date('2025-01-10T14:30:00'),
  isRead: false,
  isFlagged: true,
  priority: 3,
  hasAttachments: true,
  snippet: 'Hi team, we need to finalize the Q4 budget allocations before the board meeting next week. Please review the attached...',
  folder: 'INBOX'
};

export default function EmailListItemExample() {
  return (
    <div className="w-full max-w-2xl bg-background border rounded-lg">
      <EmailListItem
        email={mockEmail}
        isSelected={false}
        onClick={() => console.log('Email clicked')}
        onToggleRead={(id) => console.log('Toggle read:', id)}
        onToggleFlagged={(id) => console.log('Toggle flagged:', id)}
      />
      <EmailListItem
        email={{
          ...mockEmail,
          id: '2',
          from: 'sarah.jones@client.com',
          subject: 'Project Proposal Approved - Next Steps',
          isRead: true,
          isFlagged: false,
          priority: 2,
          hasAttachments: false,
          snippet: 'Great news! The project proposal has been approved by the executive committee...'
        }}
        isSelected={true}
        onClick={() => console.log('Email 2 clicked')}
      />
      <EmailListItem
        email={{
          ...mockEmail,
          id: '3',
          from: 'notifications@github.com',
          subject: 'New pull request: Feature/authentication',
          isRead: true,
          isFlagged: false,
          priority: 0,
          hasAttachments: false,
          snippet: 'A new pull request has been opened for the authentication feature...'
        }}
        onClick={() => console.log('Email 3 clicked')}
      />
    </div>
  );
}