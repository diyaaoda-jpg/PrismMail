import { useState } from "react";
import { Inbox, Send, Archive, Star, Trash, Settings, Plus, Filter, Search, Zap, Mail, ChevronRight, ChevronDown, FileText, ShieldAlert, FolderOpen, Calendar, Rss, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

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

export function MailSidebar({
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
  const [searchQuery, setSearchQuery] = useState('');
  const [allAccountsExpanded, setAllAccountsExpanded] = useState(true);
  const [smartFoldersExpanded, setSmartFoldersExpanded] = useState(false);
  const [individualAccountsExpanded, setIndividualAccountsExpanded] = useState<Record<string, boolean>>(
    accounts.reduce((acc, account) => ({ ...acc, [account.id]: true }), {})
  );

  const handleFolderClick = (folderId: string, accountId?: string) => {
    onFolderSelect?.(folderId, accountId);
    console.log('Selected folder:', folderId, accountId ? `from account ${accountId}` : 'unified');
  };

  const handleIndividualAccountToggle = (accountId: string) => {
    setIndividualAccountsExpanded(prev => ({
      ...prev,
      [accountId]: !prev[accountId]
    }));
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch?.(searchQuery);
    console.log('Search query:', searchQuery);
  };

  const handleCompose = () => {
    onCompose?.();
    console.log('Compose clicked');
  };

  const handleAccountSelect = (accountId: string) => {
    onAccountSelect?.(accountId);
    console.log('Selected account:', accountId);
  };

  const handleSettings = () => {
    onSettings?.();
    console.log('Settings clicked');
  };

  const renderIndividualAccount = (account: { id: string; name: string; protocol: 'IMAP' | 'EWS'; isActive: boolean; folders?: MailFolder[] }) => {
    const isExpanded = individualAccountsExpanded[account.id];
    const accountFolders = account.folders || defaultAccountFolders;

    return (
      <div key={account.id} className="mb-4">
        <Collapsible 
          open={isExpanded} 
          onOpenChange={() => handleIndividualAccountToggle(account.id)}
        >
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className={cn(
                "w-full justify-start gap-2 mb-2 text-sm font-medium hover-elevate active-elevate-2",
                !account.isActive && "opacity-60"
              )}
              data-testid={`button-account-toggle-${account.id}`}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <Mail className="h-4 w-4" />
              <span className="flex-1 text-left truncate">{account.name}</span>
              {!account.isActive && (
                <Badge variant="destructive" className="ml-1 text-xs">
                  Offline
                </Badge>
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1">
            {accountFolders.map(folder => renderFolder(folder, account.id, true))}
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  };

  const renderFolder = (folder: MailFolder, accountId?: string, indent: boolean = false) => {
    const isSelected = selectedFolder === folder.id && (!accountId || selectedAccount === accountId);
    const count = accountId ? 
      accountFolderCounts[accountId]?.[folder.id] || 0 : 
      unreadCounts[folder.id] || 0;
    const IconComponent = folder.icon;

    return (
      <Button
        key={`${accountId || 'unified'}-${folder.id}`}
        variant={isSelected ? "secondary" : "ghost"}
        className={cn(
          "w-full justify-start gap-3 mb-1 hover-elevate active-elevate-2",
          isSelected && "bg-accent text-accent-foreground",
          indent && "ml-4"
        )}
        onClick={() => handleFolderClick(folder.id, accountId)}
        data-testid={`button-folder-${accountId ? `${accountId}-` : ''}${folder.id}`}
      >
        <IconComponent className={cn("h-4 w-4", folder.color)} />
        <span className="flex-1 text-left">{folder.name}</span>
        {count > 0 && (
          <span className="ml-auto text-xs text-blue-600 dark:text-blue-400 font-medium">
            {count.toLocaleString()}
          </span>
        )}
      </Button>
    );
  };

  return (
    <div className="w-64 bg-sidebar border-r flex flex-col h-full">
      {/* Header with compose button */}
      <div className="p-4 border-b">
        <Button 
          onClick={handleCompose}
          className="w-full mb-4 hover-elevate active-elevate-2"
          data-testid="button-compose"
        >
          <Plus className="h-4 w-4 mr-2" />
          Compose
        </Button>
        
        {/* Search */}
        <form onSubmit={handleSearch} className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search mail..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
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
                  className="w-full justify-start gap-2 mb-3 text-sm font-medium hover-elevate active-elevate-2"
                  data-testid="button-all-accounts-toggle"
                >
                  {allAccountsExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  All Accounts
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1">
                {unifiedFolders.map(folder => renderFolder(folder))}
              </CollapsibleContent>
            </Collapsible>
          </div>

          <Separator className="my-4" />

          {/* Individual Account Sections */}
          {accounts.length > 0 && (
            <>
              <div className="mb-6">
                {accounts.map(renderIndividualAccount)}
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
              <CollapsibleContent className="space-y-1">
                {smartFolders.map(folder => renderFolder(folder))}
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
}