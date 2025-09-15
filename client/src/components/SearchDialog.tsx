import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Search, Filter, Clock, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface SearchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEmail?: (emailId: string) => void;
}

interface SearchResult {
  id: string;
  subject: string | null;
  from: string | null;
  snippet: string | null;
  date: Date | null;
  isRead: boolean;
  isFlagged: boolean;
  hasAttachments: boolean;
  priority: number;
  relevanceScore?: number;
  highlightedSnippet?: string;
  matchedFields?: string[];
}

interface SearchResponse {
  results: SearchResult[];
  totalCount: number;
  hasMore: boolean;
}

export function SearchDialog({ isOpen, onClose, onSelectEmail }: SearchDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchType, setSearchType] = useState("all");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [recentSearches] = useState([
    "Project proposal",
    "Meeting notes", 
    "Budget review",
    "Security alert"
  ]);
  const { toast } = useToast();

  // Debounce search query to avoid too many API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Real-time search using React Query
  const { data: searchResponse, isLoading: isSearching, error } = useQuery({
    queryKey: ['/api/mail/search', debouncedQuery, searchType],
    enabled: !!debouncedQuery.trim() && debouncedQuery.length >= 2,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: 1,
    queryFn: async () => {
      const params = new URLSearchParams({
        q: debouncedQuery.trim(),
        limit: '20',
        offset: '0'
      });
      
      // Add search fields based on search type
      if (searchType !== 'all') {
        params.append('searchFields', searchType);
      }
      
      const response = await fetch(`/api/mail/search?${params}`);
      if (!response.ok) {
        throw new Error('Search failed');
      }
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error?.message || 'Search failed');
      }
      return data.data;
    }
  });

  // Handle search errors
  useEffect(() => {
    if (error) {
      console.error('Search error:', error);
      toast({
        title: "Search Error",
        description: error.message || "Failed to search emails",
        variant: "destructive"
      });
    }
  }, [error, toast]);

  const searchResults = searchResponse?.results || [];
  
  const handleManualSearch = () => {
    if (searchQuery.trim()) {
      setDebouncedQuery(searchQuery);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleManualSearch();
    }
  };

  const handleSelectResult = (email: SearchResult) => {
    console.log('Selected search result:', email.subject);
    onSelectEmail?.(email.id);
    onClose();
  };

  const handleClose = () => {
    onClose();
    // Reset search after close
    setTimeout(() => {
      setSearchQuery("");
      setDebouncedQuery("");
    }, 300);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <DialogTitle className="text-lg font-semibold">
            Search Mail
          </DialogTitle>
          <DialogDescription className="hidden">
            Search through your emails by keywords, sender, or subject.
          </DialogDescription>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            data-testid="button-close-search"
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>
        
        <div className="flex-1 space-y-4 overflow-hidden">
          {/* Search Input */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Search emails... (type at least 2 characters)"
                  className="pl-10"
                  data-testid="input-search"
                />
                {isSearching && (
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
                  </div>
                )}
              </div>
              <Button 
                onClick={handleManualSearch} 
                disabled={isSearching || !searchQuery.trim() || searchQuery.length < 2}
                data-testid="button-perform-search"
              >
                <Search className="h-4 w-4" />
              </Button>
            </div>

            {/* Search Filters */}
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="searchType" className="text-sm">Search in:</Label>
                <Select value={searchType} onValueChange={setSearchType}>
                  <SelectTrigger className="w-32" data-testid="select-search-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Fields</SelectItem>
                    <SelectItem value="subject">Subject</SelectItem>
                    <SelectItem value="from">From</SelectItem>
                    <SelectItem value="to">To</SelectItem>
                    <SelectItem value="body">Body</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Recent Searches */}
          {!searchQuery && searchResults.length === 0 && (
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Recent Searches</Label>
              </div>
              <div className="flex flex-wrap gap-2">
                {recentSearches.map((search, index) => (
                  <Badge 
                    key={index}
                    variant="secondary" 
                    className="cursor-pointer hover-elevate"
                    onClick={() => setSearchQuery(search)}
                    data-testid={`badge-recent-${index}`}
                  >
                    {search}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Search Results */}
          {(searchResults.length > 0 || isSearching) && (
            <div className="flex-1 space-y-3 overflow-hidden">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  {isSearching ? 'Searching...' : `Search Results (${searchResults.length}${searchResponse?.hasMore ? '+' : ''})`}
                </Label>
                {searchResponse?.totalCount && (
                  <span className="text-xs text-muted-foreground">
                    {searchResponse.totalCount} total
                  </span>
                )}
              </div>
              
              <ScrollArea className="flex-1 h-[400px]">
                <div className="space-y-2">
                  {searchResults.map((email: SearchResult) => (
                    <div
                      key={email.id}
                      className="p-3 border rounded-lg cursor-pointer hover-elevate active-elevate-2 transition-colors"
                      onClick={() => handleSelectResult(email)}
                      data-testid={`search-result-${email.id}`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 mb-1">
                            {!email.isRead && (
                              <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0" />
                            )}
                            <h4 className={`text-sm font-medium truncate ${
                              email.isRead ? 'text-muted-foreground' : 'text-foreground'
                            }`}>
                              {email.subject}
                            </h4>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            From: {email.from}
                          </p>
                        </div>
                        <div className="text-xs text-muted-foreground flex-shrink-0 ml-2">
                          {email.date ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
                            Math.floor((email.date.getTime() - Date.now()) / (1000 * 60 * 60)), 
                            'hour'
                          ) : 'Unknown'}
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {email.snippet}
                      </p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* No Results */}
          {searchQuery && searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && (
            <div className="flex-1 flex items-center justify-center py-12">
              <div className="text-center space-y-2">
                <Search className="h-12 w-12 text-muted-foreground mx-auto" />
                <h3 className="text-lg font-medium">No emails found</h3>
                <p className="text-sm text-muted-foreground">
                  Try adjusting your search terms or filters
                </p>
              </div>
            </div>
          )}
          
          {/* Search hint */}
          {searchQuery && searchQuery.length > 0 && searchQuery.length < 2 && (
            <div className="flex-1 flex items-center justify-center py-12">
              <div className="text-center space-y-2">
                <Search className="h-8 w-8 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">
                  Type at least 2 characters to search
                </p>
              </div>
            </div>
          )}
          
          {/* Error state */}
          {error && (
            <div className="flex-1 flex items-center justify-center py-12">
              <div className="text-center space-y-2">
                <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
                <h3 className="text-lg font-medium text-destructive">Search Error</h3>
                <p className="text-sm text-muted-foreground">
                  {error.message || 'Failed to search emails'}
                </p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => handleManualSearch()}
                  data-testid="button-retry-search"
                >
                  Try Again
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="text-xs text-muted-foreground">
            Use keyboard shortcuts: Enter to search, Esc to close
          </div>
          <Button 
            variant="outline" 
            onClick={handleClose}
            data-testid="button-close-search-footer"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}