import { useState, useEffect } from "react";
import { Eye, EyeOff, Settings, Filter, Crown, Star, Clock, Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface FocusModeProps {
  className?: string;
  onFocusModeChange?: (enabled: boolean) => void;
}

interface FocusPreferences {
  focusModeEnabled: boolean;
  focusMinPriority: number;
  focusShowVipOnly: boolean;
  focusShowUnreadOnly: boolean;
  autoPriorityEnabled: boolean;
  priorityNotifications: boolean;
  vipNotificationsEnabled: boolean;
}

export function FocusMode({ className, onFocusModeChange }: FocusModeProps) {
  const { toast } = useToast();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [localPrefs, setLocalPrefs] = useState<FocusPreferences>({
    focusModeEnabled: false,
    focusMinPriority: 2,
    focusShowVipOnly: false,
    focusShowUnreadOnly: false,
    autoPriorityEnabled: true,
    priorityNotifications: true,
    vipNotificationsEnabled: true
  });

  // Fetch focus preferences
  const { data: preferences, isLoading } = useQuery({
    queryKey: ['/api/preferences/focus']
  }) as { data: FocusPreferences; isLoading: boolean };

  useEffect(() => {
    if (preferences) {
      setLocalPrefs(preferences);
    }
  }, [preferences]);

  // Update focus preferences mutation
  const updatePreferencesMutation = useMutation({
    mutationFn: async (prefs: Partial<FocusPreferences>) => {
      const response = await apiRequest('POST', '/api/preferences/focus', prefs);
      return response.json();
    },
    onError: (error: any) => {
      toast({ title: "Failed to update preferences", description: error.message, variant: "destructive" });
    }
  });

  useEffect(() => {
    if (updatePreferencesMutation.isSuccess) {
      queryClient.invalidateQueries({ queryKey: ['/api/preferences/focus'] });
      toast({ title: "Focus mode preferences updated" });
    }
  }, [updatePreferencesMutation.isSuccess]);

  // Get focus mode email count
  const { data: focusStats } = useQuery({
    queryKey: ['/api/mail/focus', 'count'],
    enabled: localPrefs.focusModeEnabled,
    select: (data: any[]) => ({
      totalCount: data?.length || 0,
      vipCount: data?.filter((email: any) => email.isVip)?.length || 0,
      highPriorityCount: data?.filter((email: any) => email.priority >= 2)?.length || 0
    })
  }) as { data: { totalCount: number; vipCount: number; highPriorityCount: number } | undefined };

  useEffect(() => {
    if (preferences) {
      setLocalPrefs(preferences);
    }
  }, [preferences]);

  useEffect(() => {
    onFocusModeChange?.(localPrefs.focusModeEnabled);
  }, [localPrefs.focusModeEnabled, onFocusModeChange]);

  const toggleFocusMode = () => {
    const newEnabled = !localPrefs.focusModeEnabled;
    const updatedPrefs = { ...localPrefs, focusModeEnabled: newEnabled };
    setLocalPrefs(updatedPrefs);
    updatePreferencesMutation.mutate(updatedPrefs);
  };

  const updatePreference = (key: keyof FocusPreferences, value: any) => {
    const updatedPrefs = { ...localPrefs, [key]: value };
    setLocalPrefs(updatedPrefs);
    updatePreferencesMutation.mutate(updatedPrefs);
  };

  const getPriorityText = (priority: number) => {
    switch (priority) {
      case 0: return 'Low Priority';
      case 1: return 'Normal Priority';
      case 2: return 'High Priority';
      case 3: return 'Critical Priority';
      default: return 'Normal Priority';
    }
  };

  const getFocusDescription = () => {
    const conditions = [];
    
    if (localPrefs.focusShowVipOnly) {
      conditions.push('VIP contacts only');
    } else {
      conditions.push(`${getPriorityText(localPrefs.focusMinPriority)}+ emails`);
      if (localPrefs.focusShowUnreadOnly) {
        conditions.push('unread only');
      }
    }
    
    return conditions.join(', ');
  };

  if (isLoading) {
    return <div>Loading focus mode...</div>;
  }

  return (
    <div className={`space-y-4 ${className}`} data-testid="focus-mode">
      {/* Focus Mode Toggle */}
      <Card className="relative overflow-hidden">
        <div className={`absolute inset-0 transition-all duration-300 ${
          localPrefs.focusModeEnabled 
            ? 'bg-gradient-to-r from-blue-500/10 to-purple-500/10' 
            : 'bg-transparent'
        }`} />
        <CardHeader className="relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-full transition-colors ${
                localPrefs.focusModeEnabled 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-muted text-muted-foreground'
              }`}>
                {localPrefs.focusModeEnabled ? (
                  <Eye className="h-5 w-5" />
                ) : (
                  <EyeOff className="h-5 w-5" />
                )}
              </div>
              <div>
                <CardTitle className="flex items-center gap-2">
                  Focus Mode
                  {localPrefs.focusModeEnabled && (
                    <Badge variant="default" className="bg-blue-500">
                      Active
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  {localPrefs.focusModeEnabled 
                    ? `Showing ${getFocusDescription()}`
                    : 'Show only high-priority and VIP emails'
                  }
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" data-testid="button-focus-settings">
                    <Settings className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Focus Mode Settings</DialogTitle>
                    <DialogDescription>
                      Customize how focus mode filters your emails for maximum productivity
                    </DialogDescription>
                  </DialogHeader>
                  
                  <div className="space-y-6">
                    <div className="space-y-4">
                      <h3 className="text-lg font-medium">Filtering Options</h3>
                      
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <Label>VIP Only Mode</Label>
                            <p className="text-sm text-muted-foreground">
                              Show only emails from VIP contacts
                            </p>
                          </div>
                          <Switch
                            checked={localPrefs.focusShowVipOnly}
                            onCheckedChange={(checked) => updatePreference('focusShowVipOnly', checked)}
                            data-testid="switch-vip-only"
                          />
                        </div>

                        {!localPrefs.focusShowVipOnly && (
                          <div>
                            <Label>Minimum Priority Level</Label>
                            <p className="text-sm text-muted-foreground mb-2">
                              Only show emails with this priority level or higher
                            </p>
                            <Select
                              value={localPrefs.focusMinPriority.toString()}
                              onValueChange={(value) => updatePreference('focusMinPriority', parseInt(value))}
                            >
                              <SelectTrigger data-testid="select-min-priority">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="0">Low Priority (0)</SelectItem>
                                <SelectItem value="1">Normal Priority (1)</SelectItem>
                                <SelectItem value="2">High Priority (2)</SelectItem>
                                <SelectItem value="3">Critical Priority (3)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        <div className="flex items-center justify-between">
                          <div>
                            <Label>Unread Only</Label>
                            <p className="text-sm text-muted-foreground">
                              Show only unread emails in focus mode
                            </p>
                          </div>
                          <Switch
                            checked={localPrefs.focusShowUnreadOnly}
                            onCheckedChange={(checked) => updatePreference('focusShowUnreadOnly', checked)}
                            data-testid="switch-unread-only"
                          />
                        </div>
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-4">
                      <h3 className="text-lg font-medium">Priority System</h3>
                      
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <Label>Automatic Priority Assignment</Label>
                            <p className="text-sm text-muted-foreground">
                              Automatically assign priority levels to incoming emails
                            </p>
                          </div>
                          <Switch
                            checked={localPrefs.autoPriorityEnabled}
                            onCheckedChange={(checked) => updatePreference('autoPriorityEnabled', checked)}
                            data-testid="switch-auto-priority"
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <div>
                            <Label>Priority Notifications</Label>
                            <p className="text-sm text-muted-foreground">
                              Get notifications for high-priority emails
                            </p>
                          </div>
                          <Switch
                            checked={localPrefs.priorityNotifications}
                            onCheckedChange={(checked) => updatePreference('priorityNotifications', checked)}
                            data-testid="switch-priority-notifications"
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <div>
                            <Label>VIP Notifications</Label>
                            <p className="text-sm text-muted-foreground">
                              Get special notifications for VIP contact emails
                            </p>
                          </div>
                          <Switch
                            checked={localPrefs.vipNotificationsEnabled}
                            onCheckedChange={(checked) => updatePreference('vipNotificationsEnabled', checked)}
                            data-testid="switch-vip-notifications"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
              <Switch
                checked={localPrefs.focusModeEnabled}
                onCheckedChange={toggleFocusMode}
                data-testid="switch-focus-mode"
              />
            </div>
          </div>
        </CardHeader>
        
        {localPrefs.focusModeEnabled && (
          <CardContent className="relative">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-blue-500" />
                <div>
                  <p className="font-medium">{focusStats?.totalCount || 0}</p>
                  <p className="text-sm text-muted-foreground">Focused Emails</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-amber-500" />
                <div>
                  <p className="font-medium">{focusStats?.vipCount || 0}</p>
                  <p className="text-sm text-muted-foreground">From VIPs</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Star className="h-4 w-4 text-orange-500" />
                <div>
                  <p className="font-medium">{focusStats?.highPriorityCount || 0}</p>
                  <p className="text-sm text-muted-foreground">High Priority</p>
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Focus Mode Quick Actions */}
      {localPrefs.focusModeEnabled && (
        <div className="flex items-center gap-2">
          <Alert>
            <Eye className="h-4 w-4" />
            <AlertDescription>
              Focus mode is active. You're seeing {getFocusDescription()}.
              <Button 
                variant="ghost" 
                className="p-0 h-auto ml-2 text-primary underline"
                onClick={() => setIsSettingsOpen(true)}
                data-testid="link-adjust-filters"
              >
                Adjust filters
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Quick Settings Bar */}
      <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Quick Settings:</span>
        </div>
        
        <Button
          variant={localPrefs.focusShowVipOnly ? "default" : "outline"}
          size="sm"
          onClick={() => updatePreference('focusShowVipOnly', !localPrefs.focusShowVipOnly)}
          data-testid="button-quick-vip-only"
        >
          <Crown className="h-4 w-4 mr-1" />
          VIP Only
        </Button>

        <Button
          variant={localPrefs.focusShowUnreadOnly ? "default" : "outline"}
          size="sm"
          onClick={() => updatePreference('focusShowUnreadOnly', !localPrefs.focusShowUnreadOnly)}
          data-testid="button-quick-unread-only"
        >
          <Eye className="h-4 w-4 mr-1" />
          Unread Only
        </Button>

        <Button
          variant={localPrefs.priorityNotifications ? "default" : "outline"}
          size="sm"
          onClick={() => updatePreference('priorityNotifications', !localPrefs.priorityNotifications)}
          data-testid="button-quick-notifications"
        >
          {localPrefs.priorityNotifications ? (
            <Bell className="h-4 w-4 mr-1" />
          ) : (
            <BellOff className="h-4 w-4 mr-1" />
          )}
          Notifications
        </Button>
      </div>
    </div>
  );
}