import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  AlertTriangle,
  Bell,
  BellOff,
  BellRing,
  Check,
  Clock,
  Globe,
  Mail,
  Monitor,
  MoreHorizontal,
  Send,
  Settings,
  Shield,
  Smartphone,
  Star,
  TestTube,
  User,
  Volume2,
  VolumeX,
  Zap
} from 'lucide-react';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useQuery } from '@tanstack/react-query';
import type { AccountConnection } from '@shared/schema';

// Global preferences form schema
const globalPrefsSchema = z.object({
  enableNotifications: z.boolean(),
  enableNewEmailNotifications: z.boolean(),
  enableVipNotifications: z.boolean(),
  enableSystemNotifications: z.boolean(),
  enableQuietHours: z.boolean(),
  quietStartHour: z.number().min(0).max(23),
  quietEndHour: z.number().min(0).max(23),
  quietTimezone: z.string(),
  enableGrouping: z.boolean(),
  enableSound: z.boolean(),
  enableVibration: z.boolean(),
  priorityFilter: z.enum(['all', 'vip', 'none']),
  batchDelaySeconds: z.number().min(0).max(300),
  maxNotificationsPerHour: z.number().min(1).max(100),
});

type GlobalPrefsFormData = z.infer<typeof globalPrefsSchema>;

// Account preferences form schema
const accountPrefsSchema = z.object({
  accountId: z.string(),
  enableNotifications: z.boolean(),
  notifyForFolders: z.string(),
  enableVipFiltering: z.boolean(),
  enablePriorityFiltering: z.boolean(),
  minimumPriority: z.number().min(0).max(5),
});

type AccountPrefsFormData = z.infer<typeof accountPrefsSchema>;

interface NotificationSettingsProps {
  className?: string;
}

export function NotificationSettings({ className }: NotificationSettingsProps) {
  const [activeTab, setActiveTab] = React.useState('overview');
  const [selectedAccountId, setSelectedAccountId] = React.useState<string>('');
  
  const {
    permission,
    isSupported,
    isSubscribed,
    subscriptionLoading,
    preferences,
    preferencesLoading,
    requestPermission,
    subscribe,
    unsubscribe,
    updateGlobalPreferences,
    updateAccountPreferences,
    testNotification,
    refreshPreferences
  } = usePushNotifications();

  // Get user accounts for account-specific settings
  const { data: accountsData } = useQuery<{data: AccountConnection[]}>({
    queryKey: ['/api/accounts'],
    retry: false
  });

  const accounts = accountsData?.data || [];

  // Global preferences form
  const globalForm = useForm<GlobalPrefsFormData>({
    resolver: zodResolver(globalPrefsSchema),
    defaultValues: {
      enableNotifications: true,
      enableNewEmailNotifications: true,
      enableVipNotifications: true,
      enableSystemNotifications: true,
      enableQuietHours: false,
      quietStartHour: 22,
      quietEndHour: 8,
      quietTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      enableGrouping: true,
      enableSound: true,
      enableVibration: true,
      priorityFilter: 'all',
      batchDelaySeconds: 30,
      maxNotificationsPerHour: 20,
    }
  });

  // Account preferences form
  const accountForm = useForm<AccountPrefsFormData>({
    resolver: zodResolver(accountPrefsSchema),
    defaultValues: {
      accountId: '',
      enableNotifications: true,
      notifyForFolders: 'inbox,sent',
      enableVipFiltering: true,
      enablePriorityFiltering: false,
      minimumPriority: 0,
    }
  });

  // Update forms when preferences load
  React.useEffect(() => {
    if (preferences?.preferences?.global) {
      const global = preferences.preferences.global;
      globalForm.reset({
        enableNotifications: global.enableNotifications,
        enableNewEmailNotifications: global.enableNewEmailNotifications,
        enableVipNotifications: global.enableVipNotifications,
        enableSystemNotifications: global.enableSystemNotifications,
        enableQuietHours: global.enableQuietHours,
        quietStartHour: global.quietStartHour,
        quietEndHour: global.quietEndHour,
        quietTimezone: global.quietTimezone,
        enableGrouping: global.enableGrouping,
        enableSound: global.enableSound,
        enableVibration: global.enableVibration,
        priorityFilter: global.priorityFilter as 'all' | 'vip' | 'none',
        batchDelaySeconds: global.batchDelaySeconds,
        maxNotificationsPerHour: global.maxNotificationsPerHour,
      });
    }
  }, [preferences, globalForm]);

  // Update account form when account is selected
  React.useEffect(() => {
    if (selectedAccountId && preferences?.preferences?.accounts) {
      const accountPref = preferences.preferences.accounts.find(
        acc => acc.accountId === selectedAccountId
      );
      
      if (accountPref) {
        accountForm.reset({
          accountId: selectedAccountId,
          enableNotifications: accountPref.enableNotifications,
          notifyForFolders: accountPref.notifyForFolders,
          enableVipFiltering: accountPref.enableVipFiltering,
          enablePriorityFiltering: accountPref.enablePriorityFiltering,
          minimumPriority: accountPref.minimumPriority,
        });
      }
    }
  }, [selectedAccountId, preferences, accountForm]);

  // Handle global preferences submission
  const onGlobalSubmit = async (data: GlobalPrefsFormData) => {
    try {
      await updateGlobalPreferences(data);
      refreshPreferences();
    } catch (error) {
      console.error('Failed to update global preferences:', error);
    }
  };

  // Handle account preferences submission
  const onAccountSubmit = async (data: AccountPrefsFormData) => {
    try {
      await updateAccountPreferences(data);
      refreshPreferences();
    } catch (error) {
      console.error('Failed to update account preferences:', error);
    }
  };

  // Permission status component
  const PermissionStatus = () => {
    const getPermissionIcon = () => {
      switch (permission) {
        case 'granted':
          return <Check className="h-4 w-4 text-green-600" data-testid="icon-permission-granted" />;
        case 'denied':
          return <AlertTriangle className="h-4 w-4 text-red-600" data-testid="icon-permission-denied" />;
        default:
          return <BellOff className="h-4 w-4 text-gray-500" data-testid="icon-permission-default" />;
      }
    };

    const getPermissionText = () => {
      switch (permission) {
        case 'granted':
          return 'Notifications enabled';
        case 'denied':
          return 'Notifications blocked';
        default:
          return 'Notifications not requested';
      }
    };

    const getPermissionVariant = (): 'default' | 'destructive' | 'secondary' => {
      switch (permission) {
        case 'granted':
          return 'default';
        case 'denied':
          return 'destructive';
        default:
          return 'secondary';
      }
    };

    return (
      <div className="flex items-center gap-2">
        {getPermissionIcon()}
        <Badge variant={getPermissionVariant()} data-testid="badge-permission-status">
          {getPermissionText()}
        </Badge>
      </div>
    );
  };

  if (!isSupported) {
    return (
      <div className={className}>
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Push notifications are not supported in this browser. Please try using a modern browser like Chrome, Firefox, or Safari.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <div className="flex flex-col space-y-2">
        <h2 className="text-2xl font-bold tracking-tight" data-testid="heading-notifications">
          Notification Settings
        </h2>
        <p className="text-muted-foreground">
          Manage your push notification preferences and get real-time email alerts.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="tabs-notification-settings">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview" data-testid="tab-overview">
            <Bell className="h-4 w-4 mr-2" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="global" data-testid="tab-global">
            <Globe className="h-4 w-4 mr-2" />
            Global
          </TabsTrigger>
          <TabsTrigger value="accounts" data-testid="tab-accounts">
            <User className="h-4 w-4 mr-2" />
            Accounts
          </TabsTrigger>
          <TabsTrigger value="advanced" data-testid="tab-advanced">
            <Settings className="h-4 w-4 mr-2" />
            Advanced
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Permission Status
              </CardTitle>
              <CardDescription>
                Browser permission status for push notifications
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="font-medium">Browser Permission</p>
                  <PermissionStatus />
                </div>
                {permission !== 'granted' && (
                  <Button
                    onClick={requestPermission}
                    size="sm"
                    data-testid="button-request-permission"
                  >
                    <Bell className="h-4 w-4 mr-2" />
                    Enable Notifications
                  </Button>
                )}
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="font-medium">Push Subscription</p>
                  <div className="flex items-center gap-2">
                    {subscriptionLoading ? (
                      <>
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-r-transparent" />
                        <Badge variant="secondary">Processing...</Badge>
                      </>
                    ) : isSubscribed ? (
                      <>
                        <Check className="h-4 w-4 text-green-600" />
                        <Badge variant="default" data-testid="badge-subscribed">Active</Badge>
                      </>
                    ) : (
                      <>
                        <BellOff className="h-4 w-4 text-gray-500" />
                        <Badge variant="secondary" data-testid="badge-not-subscribed">Not Active</Badge>
                      </>
                    )}
                  </div>
                </div>
                {permission === 'granted' && (
                  <div className="flex gap-2">
                    {!isSubscribed ? (
                      <Button
                        onClick={subscribe}
                        disabled={subscriptionLoading}
                        size="sm"
                        data-testid="button-subscribe"
                      >
                        <BellRing className="h-4 w-4 mr-2" />
                        Subscribe
                      </Button>
                    ) : (
                      <Button
                        onClick={unsubscribe}
                        disabled={subscriptionLoading}
                        variant="outline"
                        size="sm"
                        data-testid="button-unsubscribe"
                      >
                        <BellOff className="h-4 w-4 mr-2" />
                        Unsubscribe
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {isSubscribed && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="font-medium">Test Notifications</p>
                      <p className="text-sm text-muted-foreground">
                        Send a test notification to verify everything is working
                      </p>
                    </div>
                    <Button
                      onClick={testNotification}
                      variant="outline"
                      size="sm"
                      data-testid="button-test-notification"
                    >
                      <TestTube className="h-4 w-4 mr-2" />
                      Send Test
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Quick Stats */}
          {preferences && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Email Notifications</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    {preferences.preferences.global.enableNewEmailNotifications ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <BellOff className="h-4 w-4 text-gray-500" />
                    )}
                    <span className="text-sm">
                      {preferences.preferences.global.enableNewEmailNotifications ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">VIP Notifications</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    {preferences.preferences.global.enableVipNotifications ? (
                      <Star className="h-4 w-4 text-yellow-600" />
                    ) : (
                      <BellOff className="h-4 w-4 text-gray-500" />
                    )}
                    <span className="text-sm">
                      {preferences.preferences.global.enableVipNotifications ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Quiet Hours</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    {preferences.preferences.global.enableQuietHours ? (
                      <Clock className="h-4 w-4 text-blue-600" />
                    ) : (
                      <BellRing className="h-4 w-4 text-gray-500" />
                    )}
                    <span className="text-sm">
                      {preferences.preferences.global.enableQuietHours 
                        ? `${preferences.preferences.global.quietStartHour}:00 - ${preferences.preferences.global.quietEndHour}:00`
                        : 'Disabled'
                      }
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* Global Settings Tab */}
        <TabsContent value="global" className="space-y-4">
          {preferencesLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <Form {...globalForm}>
              <form onSubmit={globalForm.handleSubmit(onGlobalSubmit)} className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>General Settings</CardTitle>
                    <CardDescription>
                      Configure your global notification preferences
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={globalForm.control}
                      name="enableNotifications"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base">Master Switch</FormLabel>
                            <FormDescription>
                              Enable or disable all push notifications
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="switch-enable-notifications"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={globalForm.control}
                      name="enableNewEmailNotifications"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base flex items-center gap-2">
                              <Mail className="h-4 w-4" />
                              New Email Notifications
                            </FormLabel>
                            <FormDescription>
                              Get notified when new emails arrive
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              disabled={!globalForm.watch('enableNotifications')}
                              data-testid="switch-new-email-notifications"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={globalForm.control}
                      name="enableVipNotifications"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base flex items-center gap-2">
                              <Star className="h-4 w-4" />
                              VIP Notifications
                            </FormLabel>
                            <FormDescription>
                              Special notifications for important senders
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              disabled={!globalForm.watch('enableNotifications')}
                              data-testid="switch-vip-notifications"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={globalForm.control}
                      name="enableSystemNotifications"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base flex items-center gap-2">
                              <Monitor className="h-4 w-4" />
                              System Notifications
                            </FormLabel>
                            <FormDescription>
                              Notifications for sync status and app updates
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              disabled={!globalForm.watch('enableNotifications')}
                              data-testid="switch-system-notifications"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Quiet Hours</CardTitle>
                    <CardDescription>
                      Configure when you don't want to receive notifications
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={globalForm.control}
                      name="enableQuietHours"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base flex items-center gap-2">
                              <Clock className="h-4 w-4" />
                              Enable Quiet Hours
                            </FormLabel>
                            <FormDescription>
                              Disable notifications during specific hours
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="switch-quiet-hours"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    {globalForm.watch('enableQuietHours') && (
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={globalForm.control}
                          name="quietStartHour"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Start Time</FormLabel>
                              <Select onValueChange={(value) => field.onChange(parseInt(value))}>
                                <FormControl>
                                  <SelectTrigger data-testid="select-quiet-start">
                                    <SelectValue placeholder={`${field.value}:00`} />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {Array.from({ length: 24 }, (_, i) => (
                                    <SelectItem key={i} value={i.toString()}>
                                      {i.toString().padStart(2, '0')}:00
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={globalForm.control}
                          name="quietEndHour"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>End Time</FormLabel>
                              <Select onValueChange={(value) => field.onChange(parseInt(value))}>
                                <FormControl>
                                  <SelectTrigger data-testid="select-quiet-end">
                                    <SelectValue placeholder={`${field.value}:00`} />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {Array.from({ length: 24 }, (_, i) => (
                                    <SelectItem key={i} value={i.toString()}>
                                      {i.toString().padStart(2, '0')}:00
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Experience Settings</CardTitle>
                    <CardDescription>
                      Customize notification behavior and appearance
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={globalForm.control}
                      name="enableSound"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base flex items-center gap-2">
                              {field.value ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                              Notification Sound
                            </FormLabel>
                            <FormDescription>
                              Play sound when notifications arrive
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="switch-sound"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={globalForm.control}
                      name="enableVibration"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base flex items-center gap-2">
                              <Smartphone className="h-4 w-4" />
                              Vibration
                            </FormLabel>
                            <FormDescription>
                              Vibrate device on mobile when notifications arrive
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="switch-vibration"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={globalForm.control}
                      name="enableGrouping"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base">Group Notifications</FormLabel>
                            <FormDescription>
                              Group multiple email notifications together
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="switch-grouping"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={globalForm.control}
                      name="priorityFilter"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Priority Filter</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-priority-filter">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="all">All Emails</SelectItem>
                              <SelectItem value="vip">VIP Only</SelectItem>
                              <SelectItem value="none">None</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormDescription>
                            Choose which emails should trigger notifications
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>

                <div className="flex justify-end">
                  <Button type="submit" data-testid="button-save-global">
                    <Save className="h-4 w-4 mr-2" />
                    Save Settings
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </TabsContent>

        {/* Account Settings Tab */}
        <TabsContent value="accounts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Account-Specific Settings</CardTitle>
              <CardDescription>
                Configure notification preferences for each email account
              </CardDescription>
            </CardHeader>
            <CardContent>
              {accounts.length === 0 ? (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    No email accounts found. Please add an email account first.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="account-select">Select Account</Label>
                    <Select onValueChange={setSelectedAccountId} data-testid="select-account">
                      <SelectTrigger id="account-select">
                        <SelectValue placeholder="Choose an account to configure" />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            <div className="flex items-center gap-2">
                              <Mail className="h-4 w-4" />
                              {account.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedAccountId && (
                    <Form {...accountForm}>
                      <form onSubmit={accountForm.handleSubmit(onAccountSubmit)} className="space-y-4">
                        <FormField
                          control={accountForm.control}
                          name="enableNotifications"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                              <div className="space-y-0.5">
                                <FormLabel className="text-base">Enable Notifications</FormLabel>
                                <FormDescription>
                                  Enable push notifications for this account
                                </FormDescription>
                              </div>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                  data-testid="switch-account-notifications"
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={accountForm.control}
                          name="enableVipFiltering"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                              <div className="space-y-0.5">
                                <FormLabel className="text-base">VIP Filtering</FormLabel>
                                <FormDescription>
                                  Only notify for emails from VIP contacts
                                </FormDescription>
                              </div>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                  disabled={!accountForm.watch('enableNotifications')}
                                  data-testid="switch-account-vip"
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />

                        <div className="flex justify-end">
                          <Button type="submit" data-testid="button-save-account">
                            <Save className="h-4 w-4 mr-2" />
                            Save Account Settings
                          </Button>
                        </div>
                      </form>
                    </Form>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Advanced Tab */}
        <TabsContent value="advanced" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Advanced Settings</CardTitle>
              <CardDescription>
                Advanced notification configuration and troubleshooting
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <p className="font-medium">Refresh Preferences</p>
                    <p className="text-sm text-muted-foreground">
                      Reload notification preferences from server
                    </p>
                  </div>
                  <Button
                    onClick={refreshPreferences}
                    variant="outline"
                    size="sm"
                    data-testid="button-refresh-preferences"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                  </Button>
                </div>

                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    If notifications aren't working, try refreshing your preferences or resubscribing to push notifications.
                  </AlertDescription>
                </Alert>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}