import { useState } from "react";
import { Inbox, Send, Archive, Star, Trash, Settings, Plus, Filter, Search, Zap, Mail, ChevronRight, ChevronDown } from "lucide-react";
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
  onFolderSelect?: (folderId: string) => void;
  onAccountSelect?: (accountId: string) => void;
  onCompose?: () => void;
  onSearch?: (query: string) => void;
  onSettings?: () => void;
  unreadCounts?: Record<string, number>;
  accounts?: Array<{
    id: string;
    name: string;
    protocol: 'IMAP' | 'EWS';
    isActive: boolean;
  }>;
}

const defaultFolders: MailFolder[] = [
  { id: 'inbox', name: 'Inbox', icon: Inbox },
  { id: 'starred', name: 'Starred', icon: Star },
  { id: 'sent', name: 'Sent', icon: Send },
  { id: 'archive', name: 'Archive', icon: Archive },
  { id: 'trash', name: 'Trash', icon: Trash },
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
  accounts = [],
}: MailSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [accountsExpanded, setAccountsExpanded] = useState(accounts.length > 1);

  const handleFolderClick = (folderId: string) => {
    onFolderSelect?.(folderId);
    console.log('Selected folder:', folderId);
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

  const renderAccount = (account: { id: string; name: string; protocol: 'IMAP' | 'EWS'; isActive: boolean }) => {
    const isSelected = selectedAccount === account.id;

    return (
      <Button
        key={account.id}
        variant={isSelected ? "secondary" : "ghost"}
        className={cn(
          "w-full justify-start gap-3 mb-1 hover-elevate active-elevate-2",
          isSelected && "bg-accent text-accent-foreground",
          !account.isActive && "opacity-60"
        )}
        onClick={() => handleAccountSelect(account.id)}
        data-testid={`button-account-${account.id}`}
      >
        <Mail className="h-4 w-4" />
        <span className="flex-1 text-left truncate">{account.name}</span>
        <Badge variant="outline" className="ml-auto text-xs">
          {account.protocol}
        </Badge>
        {!account.isActive && (
          <Badge variant="destructive" className="ml-1 text-xs">
            Offline
          </Badge>
        )}
      </Button>
    );
  };

  const renderFolder = (folder: MailFolder) => {
    const isSelected = selectedFolder === folder.id;
    const count = unreadCounts[folder.id] || 0;
    const IconComponent = folder.icon;

    return (
      <Button
        key={folder.id}
        variant={isSelected ? "secondary" : "ghost"}
        className={cn(
          "w-full justify-start gap-3 mb-1 hover-elevate active-elevate-2",
          isSelected && "bg-accent text-accent-foreground"
        )}
        onClick={() => handleFolderClick(folder.id)}
        data-testid={`button-folder-${folder.id}`}
      >
        <IconComponent className={cn("h-4 w-4", folder.color)} />
        <span className="flex-1 text-left">{folder.name}</span>
        {count > 0 && (
          <Badge variant="secondary" className="ml-auto text-xs">
            {count}
          </Badge>
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
          {/* Smart Folders */}
          <div className="mb-6">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-3 tracking-wide">
              Smart Filters
            </h3>
            <div className="space-y-1">
              {smartFolders.map(renderFolder)}
            </div>
          </div>

          <Separator className="my-4" />

          {/* Default Folders */}
          <div className="mb-6">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-3 tracking-wide">
              Folders
            </h3>
            <div className="space-y-1">
              {defaultFolders.map(renderFolder)}
            </div>
          </div>

          <Separator className="my-4" />

          {/* Accounts Section - only show if multiple accounts */}
          {accounts.length > 1 && (
            <>
              <div className="mb-6">
                <Collapsible open={accountsExpanded} onOpenChange={setAccountsExpanded}>
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className="w-full justify-start gap-1 mb-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover-elevate active-elevate-2"
                      data-testid="button-accounts-toggle"
                    >
                      {accountsExpanded ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                      Accounts ({accounts.length})
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-1">
                    {accounts.map(renderAccount)}
                  </CollapsibleContent>
                </Collapsible>
              </div>

              <Separator className="my-4" />
            </>
          )}

          {/* Account Settings */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-3 tracking-wide">
              Account
            </h3>
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