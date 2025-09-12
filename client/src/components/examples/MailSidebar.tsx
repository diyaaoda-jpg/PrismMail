import { MailSidebar } from '../MailSidebar';

// Mock unread counts for demonstration
const mockUnreadCounts = {
  inbox: 23,
  focus: 5,
  unread: 12,
  priority: 3,
  starred: 8
};

export default function MailSidebarExample() {
  return (
    <div className="h-96 w-64 border rounded-lg overflow-hidden">
      <MailSidebar
        selectedFolder="inbox"
        unreadCounts={mockUnreadCounts}
        onFolderSelect={(folder) => console.log('Selected folder:', folder)}
        onCompose={() => console.log('Compose new email')}
        onSearch={(query) => console.log('Search:', query)}
      />
    </div>
  );
}