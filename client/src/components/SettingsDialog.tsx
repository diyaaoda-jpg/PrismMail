import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Plus, Trash2, Server, RefreshCw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { X, Save, Mail, User, Shield, Palette } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertAccountConnectionSchema, type AccountConnection } from "@shared/schema";
import { z } from "zod";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  user: {
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    profileImageUrl?: string;
  };
}

// Account form validation schema
const accountFormSchema = z.object({
  name: z.string().min(1, "Account name is required"),
  protocol: z.enum(["IMAP", "EWS"]),
  host: z.string().min(1, "Mail server is required"),
  port: z.string().min(1, "Port is required"),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  useSSL: z.boolean(),
});

type AccountFormData = z.infer<typeof accountFormSchema>;

export function SettingsDialog({ isOpen, onClose, user }: SettingsDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("account");
  const [isSaving, setIsSaving] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [deleteAccountId, setDeleteAccountId] = useState<string | null>(null);
  const [syncingAccounts, setSyncingAccounts] = useState<Set<string>>(new Set());
  
  // Account form setup with validation
  const accountForm = useForm<AccountFormData>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: {
      name: "",
      protocol: "IMAP",
      host: "",
      port: "993", // Default IMAP SSL port
      username: "",
      password: "",
      useSSL: true,
    },
  });
  
  // Watch protocol changes to adjust form defaults
  const watchedProtocol = accountForm.watch("protocol");
  
  // Update form defaults when protocol changes
  useEffect(() => {
    if (watchedProtocol === 'IMAP') {
      accountForm.setValue('port', '993');
      accountForm.setValue('useSSL', true);
    } else if (watchedProtocol === 'EWS') {
      // EWS doesn't use port or SSL settings - uses default secure HTTPS API
      accountForm.setValue('port', '');
      accountForm.setValue('useSSL', true);
    }
  }, [watchedProtocol, accountForm]);
  
  // Account settings
  const [accountData, setAccountData] = useState({
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    email: user.email || "",
    signature: "Best regards,\n" + (user.firstName || "User")
  });

  // Email preferences
  const [emailPrefs, setEmailPrefs] = useState({
    autoMarkRead: true,
    showPreview: true,
    compactView: false,
    emailsPerPage: "25",
    defaultFolder: "inbox",
    autoSync: true,
    syncInterval: "600" // 10 minutes in seconds
  });

  // Notification settings
  const [notifications, setNotifications] = useState({
    desktopNotifications: true,
    soundNotifications: false,
    emailNotifications: true,
    priorityOnly: false
  });

  // Theme settings
  const [themeSettings, setThemeSettings] = useState({
    theme: "light",
    fontSize: "medium",
    readingModeBackground: "default"
  });

  // Account connections API with proper typing
  const { data: accounts = [], isLoading: accountsLoading } = useQuery<AccountConnection[]>({
    queryKey: ['/api/accounts'],
    enabled: isOpen
  });

  const createAccountMutation = useMutation({
    mutationFn: async (accountData: AccountFormData) => {
      // First test the connection before adding to database
      const testResponse = await fetch('/api/accounts/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          protocol: accountData.protocol,
          host: accountData.host,
          port: accountData.protocol === 'IMAP' ? 993 : undefined, // IMAP uses 993, EWS doesn't use port
          username: accountData.username,
          password: accountData.password,
          useSSL: accountData.protocol === 'IMAP' ? true : undefined, // Only IMAP uses SSL flag
        })
      });
      
      if (!testResponse.ok) {
        const error = await testResponse.json();
        throw new Error(error.message || 'Connection test failed');
      }
      
      // If test successful, create account
      const settingsJson = JSON.stringify({
        host: accountData.host,
        port: accountData.protocol === 'IMAP' ? 993 : undefined,
        username: accountData.username,
        password: accountData.password,
        useSSL: accountData.protocol === 'IMAP' ? true : undefined,
      });
      
      const response = await apiRequest('POST', '/api/accounts', {
        name: accountData.name,
        protocol: accountData.protocol,
        settingsJson
      });
      
      return await response.json() as AccountConnection;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      toast({
        title: "Account Added Successfully", 
        description: "Connection test passed. Your email account has been added and is ready to sync."
      });
      setShowAddAccount(false);
      accountForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Connection Failed",
        description: error.message || "Failed to connect to your email account. Please check your settings.",
        variant: "destructive"
      });
    }
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const response = await apiRequest('DELETE', `/api/accounts/${accountId}`);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      toast({
        title: "Account Deleted",
        description: "Your email account has been removed successfully."
      });
      setDeleteAccountId(null);
    },
    onError: (error: any) => {
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete the email account.",
        variant: "destructive"
      });
    }
  });

  const handleDeleteAccount = (accountId: string) => {
    setDeleteAccountId(accountId);
  };

  const handleSyncAccount = async (accountId: string) => {
    setSyncingAccounts(prev => new Set(prev).add(accountId));
    
    try {
      const response = await fetch(`/api/accounts/${accountId}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ folder: 'INBOX', limit: 25 })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to sync account');
      }
      
      const result = await response.json();
      
      toast({
        title: "Sync Completed",
        description: `Successfully synced ${result.messageCount || 0} messages`
      });
      
      // Invalidate accounts query to refresh the UI
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      
    } catch (error: any) {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync account",
        variant: "destructive"
      });
    } finally {
      setSyncingAccounts(prev => {
        const newSet = new Set(prev);
        newSet.delete(accountId);
        return newSet;
      });
    }
  };

  const confirmDeleteAccount = () => {
    if (deleteAccountId) {
      deleteAccountMutation.mutate(deleteAccountId);
    }
  };

  const onSubmitAccount = (data: AccountFormData) => {
    createAccountMutation.mutate(data);
  };

  const handleSave = async () => {
    setIsSaving(true);
    
    // Simulate saving settings
    setTimeout(() => {
      console.log('Saving settings:', {
        account: accountData,
        email: emailPrefs,
        notifications,
        theme: themeSettings
      });
      
      toast({
        title: "Settings Saved",
        description: "Your preferences have been updated successfully.",
      });
      
      setIsSaving(false);
      onClose();
    }, 1000);
  };

  const handleClose = () => {
    onClose();
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader className="flex flex-row items-center justify-between space-y-0 pb-4 flex-shrink-0">
            <DialogTitle className="text-lg font-semibold">
              Settings
            </DialogTitle>
            <DialogDescription className="hidden">
              Manage your account settings, email preferences, and application configuration.
            </DialogDescription>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              data-testid="button-close-settings"
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogHeader>
          
          <div className="flex-1 min-h-0 overflow-hidden">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
              <TabsList className="grid w-full grid-cols-4 flex-shrink-0">
                <TabsTrigger value="account" data-testid="tab-account">
                  <User className="h-4 w-4 mr-2" />
                  Account
                </TabsTrigger>
                <TabsTrigger value="email" data-testid="tab-email">
                  <Mail className="h-4 w-4 mr-2" />
                  Email
                </TabsTrigger>
                <TabsTrigger value="notifications" data-testid="tab-notifications">
                  <Shield className="h-4 w-4 mr-2" />
                  Notifications
                </TabsTrigger>
                <TabsTrigger value="appearance" data-testid="tab-appearance">
                  <Palette className="h-4 w-4 mr-2" />
                  Appearance
                </TabsTrigger>
              </TabsList>

              <div className="flex-1 overflow-y-auto pt-6 pr-1">
                {/* Account Settings */}
                <TabsContent value="account" className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Profile Information</CardTitle>
                      <CardDescription>
                        Update your account details and email signature
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="firstName">First Name</Label>
                          <Input
                            id="firstName"
                            value={accountData.firstName}
                            onChange={(e) => setAccountData({ ...accountData, firstName: e.target.value })}
                            data-testid="input-first-name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="lastName">Last Name</Label>
                          <Input
                            id="lastName"
                            value={accountData.lastName}
                            onChange={(e) => setAccountData({ ...accountData, lastName: e.target.value })}
                            data-testid="input-last-name"
                          />
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="email">Email Address</Label>
                        <Input
                          id="email"
                          value={accountData.email}
                          onChange={(e) => setAccountData({ ...accountData, email: e.target.value })}
                          data-testid="input-email"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="signature">Email Signature</Label>
                        <textarea
                          id="signature"
                          value={accountData.signature}
                          onChange={(e) => setAccountData({ ...accountData, signature: e.target.value })}
                          className="w-full p-2 border rounded-md h-24 resize-none"
                          data-testid="textarea-signature"
                        />
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Email Settings */}
                <TabsContent value="email" className="space-y-6">
                  {/* Email Accounts Section */}
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle>Email Accounts</CardTitle>
                          <CardDescription>
                            Connect your email accounts to sync messages
                          </CardDescription>
                        </div>
                        <Button 
                          onClick={() => setShowAddAccount(true)}
                          className="hover-elevate active-elevate-2"
                          data-testid="button-add-account"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Add Account
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {accountsLoading ? (
                        <div className="text-center py-4 text-muted-foreground">
                          Loading accounts...
                        </div>
                      ) : accounts.length > 0 ? (
                        <div className="space-y-3">
                          {accounts.map((account) => (
                            <div key={account.id} className="flex items-center justify-between p-3 border rounded-lg">
                              <div className="flex items-center gap-3">
                                <div className="p-2 bg-primary/10 rounded-md">
                                  <Server className="h-4 w-4 text-primary" />
                                </div>
                                <div>
                                  <div className="font-medium">{account.name}</div>
                                  <div className="text-sm text-muted-foreground">
                                    {account.protocol} • {account.isActive ? 'Active' : 'Inactive'}
                                    {account.lastError && (
                                      <span className="text-destructive ml-1">• {account.lastError}</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant={account.isActive ? "default" : "secondary"}>
                                  {account.isActive ? "Connected" : "Disconnected"}
                                </Badge>
                                {account.isActive && (
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    onClick={() => handleSyncAccount(account.id)}
                                    disabled={syncingAccounts.has(account.id)}
                                    className="text-xs px-2 py-1 h-7"
                                    data-testid={`button-sync-account-${account.id}`}
                                  >
                                    <RefreshCw className={`h-3 w-3 mr-1 ${syncingAccounts.has(account.id) ? 'animate-spin' : ''}`} />
                                    {syncingAccounts.has(account.id) ? 'Syncing...' : 'Sync'}
                                  </Button>
                                )}
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={() => handleDeleteAccount(account.id)}
                                  data-testid={`button-delete-account-${account.id}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">
                          <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <div className="text-sm">No email accounts connected</div>
                          <div className="text-xs">Add an account to start syncing your emails</div>
                        </div>
                      )}

                      {/* Add Account Form */}
                      {showAddAccount && (
                        <div className="border-t pt-4 mt-4">
                          <h4 className="font-medium mb-4">Add New Email Account</h4>
                          <Form {...accountForm}>
                            <form onSubmit={accountForm.handleSubmit(onSubmitAccount)} className="space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                <FormField
                                  control={accountForm.control}
                                  name="name"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Account Name</FormLabel>
                                      <FormControl>
                                        <Input
                                          placeholder="My Work Email"
                                          data-testid="input-account-name"
                                          {...field}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={accountForm.control}
                                  name="protocol"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Protocol</FormLabel>
                                      <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                          <SelectTrigger data-testid="select-protocol">
                                            <SelectValue placeholder="Select protocol" />
                                          </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                          <SelectItem value="IMAP">IMAP</SelectItem>
                                          <SelectItem value="EWS">Exchange (EWS)</SelectItem>
                                        </SelectContent>
                                      </Select>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>
                              
                              <div className="grid grid-cols-3 gap-4">
                                <div className={watchedProtocol === 'EWS' ? 'col-span-3' : 'col-span-2'}>
                                  <FormField
                                    control={accountForm.control}
                                    name="host"
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel>
                                          {watchedProtocol === 'EWS' ? 'Exchange Server URL' : 'Mail Server'}
                                        </FormLabel>
                                        <FormControl>
                                          <Input
                                            placeholder={
                                              watchedProtocol === 'EWS' 
                                                ? "https://mail.example.com/ews" 
                                                : "imap.gmail.com"
                                            }
                                            data-testid="input-host"
                                            {...field}
                                          />
                                        </FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                </div>
                                {watchedProtocol === 'IMAP' && (
                                  <FormField
                                    control={accountForm.control}
                                    name="port"
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel>Port</FormLabel>
                                        <FormControl>
                                          <Input
                                            placeholder="993"
                                            data-testid="input-port"
                                            disabled
                                            {...field}
                                          />
                                        </FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                )}
                              </div>
                              
                              <div className="grid grid-cols-2 gap-4">
                                <FormField
                                  control={accountForm.control}
                                  name="username"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Username/Email</FormLabel>
                                      <FormControl>
                                        <Input
                                          placeholder="user@example.com"
                                          data-testid="input-username"
                                          {...field}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={accountForm.control}
                                  name="password"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Password</FormLabel>
                                      <FormControl>
                                        <Input
                                          type="password"
                                          placeholder="Your password"
                                          data-testid="input-password"
                                          {...field}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>
                              
                              {watchedProtocol === 'IMAP' && (
                                <FormField
                                  control={accountForm.control}
                                  name="useSSL"
                                  render={({ field }) => (
                                    <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                                      <FormControl>
                                        <input
                                          type="checkbox"
                                          checked={true}
                                          disabled
                                          onChange={field.onChange}
                                          className="rounded border-gray-300"
                                          data-testid="checkbox-use-ssl"
                                        />
                                      </FormControl>
                                      <div className="space-y-1 leading-none">
                                        <FormLabel>Use SSL/TLS encryption (Required for IMAP)</FormLabel>
                                      </div>
                                    </FormItem>
                                  )}
                                />
                              )}
                              
                              {watchedProtocol === 'EWS' && (
                                <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
                                  <strong>Exchange Web Services (EWS)</strong> uses secure HTTPS connections by default. 
                                  No additional port or SSL configuration required.
                                </div>
                              )}
                              
                              <div className="flex gap-2 pt-2">
                                <Button 
                                  type="submit"
                                  disabled={createAccountMutation.isPending}
                                  className="hover-elevate active-elevate-2"
                                  data-testid="button-connect-account"
                                >
                                  {createAccountMutation.isPending ? "Testing Connection..." : "Test & Connect Account"}
                                </Button>
                                <Button 
                                  type="button"
                                  variant="outline" 
                                  onClick={() => setShowAddAccount(false)}
                                  data-testid="button-cancel-add-account"
                                >
                                  Cancel
                                </Button>
                              </div>
                            </form>
                          </Form>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Email Preferences</CardTitle>
                      <CardDescription>
                        Customize how emails are displayed and managed
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>Auto-mark as read</Label>
                          <p className="text-sm text-muted-foreground">
                            Automatically mark emails as read when opened
                          </p>
                        </div>
                        <Switch
                          checked={emailPrefs.autoMarkRead}
                          onCheckedChange={(checked) => setEmailPrefs({ ...emailPrefs, autoMarkRead: checked })}
                          data-testid="switch-auto-mark-read"
                        />
                      </div>

                      <Separator />

                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>Show email preview</Label>
                          <p className="text-sm text-muted-foreground">
                            Display email content preview in the list
                          </p>
                        </div>
                        <Switch
                          checked={emailPrefs.showPreview}
                          onCheckedChange={(checked) => setEmailPrefs({ ...emailPrefs, showPreview: checked })}
                          data-testid="switch-show-preview"
                        />
                      </div>

                      <Separator />

                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>Compact view</Label>
                          <p className="text-sm text-muted-foreground">
                            Show more emails by reducing spacing
                          </p>
                        </div>
                        <Switch
                          checked={emailPrefs.compactView}
                          onCheckedChange={(checked) => setEmailPrefs({ ...emailPrefs, compactView: checked })}
                          data-testid="switch-compact-view"
                        />
                      </div>

                      <Separator />

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Emails per page</Label>
                          <Select value={emailPrefs.emailsPerPage} onValueChange={(value) => setEmailPrefs({ ...emailPrefs, emailsPerPage: value })}>
                            <SelectTrigger data-testid="select-emails-per-page">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="10">10</SelectItem>
                              <SelectItem value="25">25</SelectItem>
                              <SelectItem value="50">50</SelectItem>
                              <SelectItem value="100">100</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label>Default folder</Label>
                          <Select value={emailPrefs.defaultFolder} onValueChange={(value) => setEmailPrefs({ ...emailPrefs, defaultFolder: value })}>
                            <SelectTrigger data-testid="select-default-folder">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="inbox">Inbox</SelectItem>
                              <SelectItem value="focus">Focus</SelectItem>
                              <SelectItem value="starred">Starred</SelectItem>
                              <SelectItem value="unread">Unread</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Sync Settings */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <RefreshCw className="h-4 w-4" />
                        Sync Settings
                      </CardTitle>
                      <CardDescription>
                        Configure how often emails are synchronized from your accounts
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label className="text-base">Auto-sync emails</Label>
                          <p className="text-sm text-muted-foreground">
                            Automatically sync emails in the background
                          </p>
                        </div>
                        <Switch
                          checked={emailPrefs.autoSync}
                          onCheckedChange={(checked) => setEmailPrefs({ ...emailPrefs, autoSync: checked })}
                          data-testid="switch-auto-sync"
                        />
                      </div>

                      {emailPrefs.autoSync && (
                        <div className="flex items-center justify-between">
                          <Label>Sync interval</Label>
                          <Select value={emailPrefs.syncInterval} onValueChange={(value) => setEmailPrefs({ ...emailPrefs, syncInterval: value })}>
                            <SelectTrigger className="w-48" data-testid="select-sync-interval">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="300">5 minutes</SelectItem>
                              <SelectItem value="600">10 minutes</SelectItem>
                              <SelectItem value="900">15 minutes</SelectItem>
                              <SelectItem value="1800">30 minutes</SelectItem>
                              <SelectItem value="3600">1 hour</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      <div className="pt-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            // Manual sync functionality - will implement this next
                            toast({
                              title: "Manual sync",
                              description: "Sync functionality will be implemented next"
                            });
                          }}
                          data-testid="button-manual-sync"
                          className="w-full"
                        >
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Sync Now
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Notifications Settings */}
                <TabsContent value="notifications" className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Notification Preferences</CardTitle>
                      <CardDescription>
                        Control how and when you receive notifications
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>Desktop notifications</Label>
                          <p className="text-sm text-muted-foreground">
                            Show notifications on your desktop when new emails arrive
                          </p>
                        </div>
                        <Switch
                          checked={notifications.desktopNotifications}
                          onCheckedChange={(checked) => setNotifications({ ...notifications, desktopNotifications: checked })}
                          data-testid="switch-desktop-notifications"
                        />
                      </div>

                      <Separator />

                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>Sound notifications</Label>
                          <p className="text-sm text-muted-foreground">
                            Play a sound when new emails arrive
                          </p>
                        </div>
                        <Switch
                          checked={notifications.soundNotifications}
                          onCheckedChange={(checked) => setNotifications({ ...notifications, soundNotifications: checked })}
                          data-testid="switch-sound-notifications"
                        />
                      </div>

                      <Separator />

                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>Email notifications</Label>
                          <p className="text-sm text-muted-foreground">
                            Send email summaries for important messages
                          </p>
                        </div>
                        <Switch
                          checked={notifications.emailNotifications}
                          onCheckedChange={(checked) => setNotifications({ ...notifications, emailNotifications: checked })}
                          data-testid="switch-email-notifications"
                        />
                      </div>

                      <Separator />

                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>Priority emails only</Label>
                          <p className="text-sm text-muted-foreground">
                            Only notify for high priority and VIP emails
                          </p>
                        </div>
                        <Switch
                          checked={notifications.priorityOnly}
                          onCheckedChange={(checked) => setNotifications({ ...notifications, priorityOnly: checked })}
                          data-testid="switch-priority-only"
                        />
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Appearance Settings */}
                <TabsContent value="appearance" className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Appearance Settings</CardTitle>
                      <CardDescription>
                        Customize the look and feel of your email client
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="space-y-2">
                        <Label>Theme</Label>
                        <Select value={themeSettings.theme} onValueChange={(value) => setThemeSettings({ ...themeSettings, theme: value })}>
                          <SelectTrigger data-testid="select-theme">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="light">Light</SelectItem>
                            <SelectItem value="dark">Dark</SelectItem>
                            <SelectItem value="system">System</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <Separator />

                      <div className="space-y-2">
                        <Label>Font size</Label>
                        <Select value={themeSettings.fontSize} onValueChange={(value) => setThemeSettings({ ...themeSettings, fontSize: value })}>
                          <SelectTrigger data-testid="select-font-size">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="small">Small</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="large">Large</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <Separator />

                      <div className="space-y-2">
                        <Label>Reading mode background</Label>
                        <Select value={themeSettings.readingModeBackground} onValueChange={(value) => setThemeSettings({ ...themeSettings, readingModeBackground: value })}>
                          <SelectTrigger data-testid="select-reading-background">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">Default</SelectItem>
                            <SelectItem value="sepia">Sepia</SelectItem>
                            <SelectItem value="dark">Dark</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </div>
            </Tabs>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={handleClose} data-testid="button-cancel-settings">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving} data-testid="button-save-settings">
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Account Confirmation Dialog */}
      <AlertDialog open={deleteAccountId !== null} onOpenChange={() => setDeleteAccountId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Email Account</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this email account? This action cannot be undone. 
              All synced emails and settings for this account will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDeleteAccount}
              disabled={deleteAccountMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteAccountMutation.isPending ? "Deleting..." : "Delete Account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}