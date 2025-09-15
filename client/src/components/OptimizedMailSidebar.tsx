import * as React from "react";
import { Inbox, Send, Archive, Star, Trash, Settings, Plus, Filter, Search, Zap, Mail, ChevronRight, ChevronDown, FileText, ShieldAlert, FolderOpen, Calendar, Rss, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { VirtualScrollList, useVirtualScrollList } from "./VirtualScrollList";
import { cn } from "@/lib/utils";
import { performanceMonitor } from "@/lib/performanceMonitor";

interface MailFolder {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
  color?: string;
}

interface MailSidebarProps {
  selectedFolder?: string;
  selectedAccount?: string;
  onFolderSelect?: (folderId: string, accountId?: string) => void;
  onAccountSelect?: (accountId: string) => void;
  onCompose?: () => void;
  onSearch?: (query: string) => void;
  onSettings?: () => void;
  unreadCounts?: Record<string, number>;
  accountFolderCounts?: Record<string, Record<string, number>>;
  accounts?: Array<{
    id: string;
    name: string;
    protocol: 'IMAP' | 'EWS';
    isActive: boolean;
    folders?: MailFolder[];
  }>;
}

const unifiedFolders: MailFolder[] = [
  { id: 'inbox', name: 'Inbox', icon: Inbox },
  { id: 'drafts', name: 'Drafts', icon: FileText },
  { id: 'sent', name: 'Sent', icon: Send },
  { id: 'deleted', name: 'Deleted Items', icon: Trash },
];

const defaultAccountFolders: MailFolder[] = [
  { id: 'inbox', name: 'Inbox', icon: Inbox },
  { id: 'drafts', name: 'Drafts', icon: FileText },
  { id: 'sent', name: 'Sent', icon: Send },
  { id: 'archive', name: 'Archive', icon: Archive },
  { id: 'deleted', name: 'Deleted Items', icon: Trash },
  { id: 'junk', name: 'Junk Email', icon: ShieldAlert },
];

const smartFolders: MailFolder[] = [
  { id: 'focus', name: 'Focus', icon: Zap, color: 'text-chart-3' },
  { id: 'unread', name: 'Unread', icon: Filter, color: 'text-accent' },
  { id: 'priority', name: 'High Priority', icon: Star, color: 'text-destructive' },
];

const organizationFolders: MailFolder[] = [
  { id: 'starred', name: 'Starred', icon: Star, color: 'text-amber-500 dark:text-amber-400' },
  { id: 'archived', name: 'Archive', icon: Archive, color: 'text-chart-1' },
  { id: 'deleted', name: 'Trash', icon: Trash, color: 'text-destructive' },
];

// Memoized folder item component for virtual scrolling performance
const FolderItem = React.memo(function FolderItem({ 
  folder, 
  accountId, 
  indent, 
  isSelected, 
  count, 
  onClick 
}: { 
  folder: MailFolder; 
  accountId?: string; 
  indent: boolean;
  isSelected: boolean;
  count: number;
  onClick: () => void;
}) {
  // Handle icon mapping - convert string icon names to React components
  let IconComponent = folder.icon;
  if (typeof folder.icon === 'string') {
    switch (folder.icon) {
      case 'Inbox':
        IconComponent = Inbox;
        break;
      case 'Send':
        IconComponent = Send;
        break;
      case 'FileText':
        IconComponent = FileText;
        break;
      case 'Trash':
        IconComponent = Trash;
        break;
      case 'Archive':
        IconComponent = Archive;
        break;
      case 'ShieldAlert':
        IconComponent = ShieldAlert;
        break;
      default:
        IconComponent = FolderOpen;
        break;
    }
  }

  return (
    <Button
      variant={isSelected ? "secondary" : "ghost"}
      className={cn(
        "w-full justify-start gap-3 mb-1 h-11 text-base hover-elevate active-elevate-2",
        isSelected && "bg-accent text-accent-foreground",
        indent && "ml-4"
      )}
      onClick={onClick}
      data-testid={`button-folder-${accountId ? `${accountId}-` : ''}${folder.id}`}
    >
      <IconComponent className={cn("h-5 w-5", folder.color)} />
      <span className="flex-1 text-left">{folder.name}</span>
      {count > 0 && (
        <span className="ml-auto text-sm text-blue-600 dark:text-blue-400 font-medium">
          {count.toLocaleString()}
        </span>
      )}
    </Button>
  );
});

// Memoized virtual folder list for performance
const VirtualFolderList = React.memo(function VirtualFolderList({ 
  folders, 
  accountId, 
  selectedFolder, 
  selectedAccount, 
  accountFolderCounts, 
  unreadCounts, 
  onFolderSelect 
}: {
  folders: MailFolder[];
  accountId?: string;
  selectedFolder: string;
  selectedAccount?: string;
  accountFolderCounts: Record<string, Record<string, number>>;
  unreadCounts: Record<string, number>;
  onFolderSelect?: (folderId: string, accountId?: string) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { containerHeight } = useVirtualScrollList(folders, containerRef, 48); // 48px per folder item

  const handleFolderClick = React.useCallback((folderId: string) => {
    onFolderSelect?.(folderId, accountId);
  }, [onFolderSelect, accountId]);

  // Use virtual scrolling for accounts with many folders (>15 for better performance)
  if (folders.length > 15) {
    return (
      <div ref={containerRef} className="max-h-96">
        <VirtualScrollList
          items={folders}
          itemHeight={48}
          containerHeight={Math.min(containerHeight, 384)} // Max 384px
          renderItem={(folder, index) => {
            const isSelected = selectedFolder === folder.id && (!accountId || selectedAccount === accountId);
            const count = accountId ? 
              accountFolderCounts[accountId]?.[folder.id] || 0 : 
              unreadCounts[folder.id] || 0;

            return (
              <FolderItem
                key={`${accountId || 'unified'}-${folder.id}`}
                folder={folder}
                accountId={accountId}
                indent={!!accountId}
                isSelected={isSelected}
                count={count}
                onClick={() => handleFolderClick(folder.id)}
              />
            );
          }}
          itemKey={(folder) => `${accountId || 'unified'}-${folder.id}`}
          className="space-y-1"
        />
      </div>
    );
  }

  // Regular rendering for smaller folder lists
  return (
    <div className="space-y-1">
      {folders.map(folder => {
        const isSelected = selectedFolder === folder.id && (!accountId || selectedAccount === accountId);
        const count = accountId ? 
          accountFolderCounts[accountId]?.[folder.id] || 0 : 
          unreadCounts[folder.id] || 0;

        return (
          <FolderItem
            key={`${accountId || 'unified'}-${folder.id}`}
            folder={folder}
            accountId={accountId}
            indent={!!accountId}
            isSelected={isSelected}
            count={count}
            onClick={() => handleFolderClick(folder.id)}
          />
        );
      })}
    </div>
  );
});

// Memoized account item for performance
const AccountItem = React.memo(function AccountItem({ 
  account, 
  isExpanded, 
  onToggle, 
  selectedFolder, 
  selectedAccount, 
  accountFolderCounts, 
  onFolderSelect 
}: {
  account: { id: string; name: string; protocol: 'IMAP' | 'EWS'; isActive: boolean; folders?: MailFolder[] };
  isExpanded: boolean;
  onToggle: () => void;
  selectedFolder: string;
  selectedAccount?: string;
  accountFolderCounts: Record<string, Record<string, number>>;
  onFolderSelect?: (folderId: string, accountId?: string) => void;
}) {
  const accountFolders = account.folders || defaultAccountFolders;

  return (
    <div className="mb-4">
      <Collapsible open={isExpanded} onOpenChange={onToggle}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className={cn(
              "w-full justify-start gap-3 mb-2 h-11 text-base font-medium hover-elevate active-elevate-2",
              !account.isActive && "opacity-60"
            )}
            data-testid={`button-account-toggle-${account.id}`}
          >
            {isExpanded ? (
              <ChevronDown className="h-5 w-5" />
            ) : (
              <ChevronRight className="h-5 w-5" />
            )}
            <Mail className="h-5 w-5" />
            <span className="flex-1 text-left truncate">{account.name}</span>
            {!account.isActive && (
              <Badge variant="destructive" className="ml-1 text-xs">
                Offline
              </Badge>
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <VirtualFolderList
            folders={accountFolders}
            accountId={account.id}
            selectedFolder={selectedFolder}
            selectedAccount={selectedAccount}
            accountFolderCounts={accountFolderCounts}
            unreadCounts={{}}
            onFolderSelect={onFolderSelect}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
});

export const OptimizedMailSidebar = React.memo(function OptimizedMailSidebar({
  selectedFolder = 'inbox',
  selectedAccount,
  onFolderSelect,
  onAccountSelect,
  onCompose,
  onSearch,
  onSettings,
  unreadCounts = {},
  accountFolderCounts = {},
  accounts = [],
}: MailSidebarProps) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [allAccountsExpanded, setAllAccountsExpanded] = React.useState(true);
  const [smartFoldersExpanded, setSmartFoldersExpanded] = React.useState(false);
  const [organizationFoldersExpanded, setOrganizationFoldersExpanded] = React.useState(true);
  const [individualAccountsExpanded, setIndividualAccountsExpanded] = React.useState<Record<string, boolean>>(
    accounts.reduce((acc, account) => ({ ...acc, [account.id]: true }), {})
  );

  // Memoized handlers for performance
  const handleFolderClick = React.useCallback((folderId: string, accountId?: string) => {
    onFolderSelect?.(folderId, accountId);
    console.log('Selected folder:', folderId, accountId ? `from account ${accountId}` : 'unified');
  }, [onFolderSelect]);

  const handleIndividualAccountToggle = React.useCallback((accountId: string) => {
    setIndividualAccountsExpanded(prev => ({
      ...prev,
      [accountId]: !prev[accountId]
    }));
  }, []);

  const handleSearch = React.useCallback((e: React.FormEvent) => {
    e.preventDefault();
    performanceMonitor.measureSearchTime(async () => {
      onSearch?.(searchQuery);
      console.log('Search query:', searchQuery);
    });
  }, [onSearch, searchQuery]);

  const handleCompose = React.useCallback(() => {
    onCompose?.();
    console.log('Compose clicked');
  }, [onCompose]);

  const handleSettings = React.useCallback(() => {
    onSettings?.();
    console.log('Settings clicked');
  }, [onSettings]);

  // Memoized account list for performance
  const memoizedAccountsList = React.useMemo(() => {
    return accounts.map(account => (
      <AccountItem
        key={account.id}
        account={account}
        isExpanded={individualAccountsExpanded[account.id]}
        onToggle={() => handleIndividualAccountToggle(account.id)}
        selectedFolder={selectedFolder}
        selectedAccount={selectedAccount}
        accountFolderCounts={accountFolderCounts}
        onFolderSelect={handleFolderClick}
      />
    ));
  }, [accounts, individualAccountsExpanded, selectedFolder, selectedAccount, accountFolderCounts, handleFolderClick, handleIndividualAccountToggle]);

  return (
    <div className="w-full bg-sidebar border-r flex flex-col h-full">
      {/* Header with compose button */}
      <div className="p-4 border-b">
        <Button 
          onClick={handleCompose}
          className="w-full mb-4 h-12 text-base font-medium hover-elevate active-elevate-2"
          data-testid="button-compose"
        >
          <Plus className="h-5 w-5 mr-3" />
          Compose
        </Button>
        
        {/* Search */}
        <form onSubmit={handleSearch} className="relative">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search mail..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-12 h-12 text-base"
            data-testid="input-search"
          />
        </form>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* All Accounts Section */}
          <div className="mb-6">
            <Collapsible open={allAccountsExpanded} onOpenChange={setAllAccountsExpanded}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-3 mb-3 h-11 text-base font-medium hover-elevate active-elevate-2"
                  data-testid="button-all-accounts-toggle"
                >
                  {allAccountsExpanded ? (
                    <ChevronDown className="h-5 w-5" />
                  ) : (
                    <ChevronRight className="h-5 w-5" />
                  )}
                  All Accounts
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <VirtualFolderList
                  folders={unifiedFolders}
                  selectedFolder={selectedFolder}
                  selectedAccount={selectedAccount}
                  accountFolderCounts={accountFolderCounts}
                  unreadCounts={unreadCounts}
                  onFolderSelect={handleFolderClick}
                />
              </CollapsibleContent>
            </Collapsible>
          </div>

          <Separator className="my-4" />

          {/* Individual Account Sections */}
          {accounts.length > 0 && (
            <>
              <div className="mb-6">
                {memoizedAccountsList}
              </div>
              <Separator className="my-4" />
            </>
          )}

          {/* Smart Folders Section */}
          <div className="mb-6">
            <Collapsible open={smartFoldersExpanded} onOpenChange={setSmartFoldersExpanded}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-2 mb-3 text-sm font-medium hover-elevate active-elevate-2"
                  data-testid="button-smart-folders-toggle"
                >
                  {smartFoldersExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  Smart Folders
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <VirtualFolderList
                  folders={smartFolders}
                  selectedFolder={selectedFolder}
                  selectedAccount={selectedAccount}
                  accountFolderCounts={accountFolderCounts}
                  unreadCounts={unreadCounts}
                  onFolderSelect={handleFolderClick}
                />
              </CollapsibleContent>
            </Collapsible>
          </div>

          {/* Organization Folders */}
          <div className="mb-6">
            <Collapsible open={organizationFoldersExpanded} onOpenChange={setOrganizationFoldersExpanded}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-2 mb-3 text-sm font-medium hover-elevate active-elevate-2"
                  data-testid="button-organization-folders-toggle"
                >
                  {organizationFoldersExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  Organization
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <VirtualFolderList
                  folders={organizationFolders}
                  selectedFolder={selectedFolder}
                  selectedAccount={selectedAccount}
                  accountFolderCounts={accountFolderCounts}
                  unreadCounts={unreadCounts}
                  onFolderSelect={handleFolderClick}
                />
              </CollapsibleContent>
            </Collapsible>
          </div>

          <Separator className="my-4" />

          {/* Account Settings */}
          <div>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 hover-elevate active-elevate-2"
              onClick={handleSettings}
              data-testid="button-settings"
            >
              <Settings className="h-4 w-4" />
              <span>Settings</span>
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
});

export default OptimizedMailSidebar;