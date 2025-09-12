import { EmailViewer } from '../EmailViewer';
import type { EmailMessage } from '../EmailListItem';

// Mock email for demonstration
const mockEmail: EmailMessage = {
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
};

export default function EmailViewerExample() {
  return (
    <div className="h-96 w-full border rounded-lg overflow-hidden">
      <EmailViewer
        email={mockEmail}
        onReply={(email) => console.log('Reply to:', email.subject)}
        onReplyAll={(email) => console.log('Reply all to:', email.subject)}
        onForward={(email) => console.log('Forward:', email.subject)}
        onArchive={(email) => console.log('Archive:', email.subject)}
        onDelete={(email) => console.log('Delete:', email.subject)}
        onToggleFlagged={(email) => console.log('Toggle flagged:', email.subject)}
      />
    </div>
  );
}