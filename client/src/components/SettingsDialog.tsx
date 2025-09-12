import { useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { X, Save, Mail, User, Shield, Palette } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

export function SettingsDialog({ isOpen, onClose, user }: SettingsDialogProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("account");
  const [isSaving, setIsSaving] = useState(false);
  
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
    defaultFolder: "inbox"
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
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
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
        
        <div className="flex-1 overflow-hidden">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
            <TabsList className="grid w-full grid-cols-4">
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

            <div className="flex-1 overflow-y-auto pt-6">
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
              </TabsContent>

              {/* Notification Settings */}
              <TabsContent value="notifications" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Notification Preferences</CardTitle>
                    <CardDescription>
                      Control when and how you receive notifications
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Desktop notifications</Label>
                        <p className="text-sm text-muted-foreground">
                          Show browser notifications for new emails
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
                        <Label>High priority only</Label>
                        <p className="text-sm text-muted-foreground">
                          Only notify for high priority emails
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
                      Customize the look and feel of PrismMail
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
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
                    </div>

                    <div className="space-y-2">
                      <Label>Reading mode background</Label>
                      <Select value={themeSettings.readingModeBackground} onValueChange={(value) => setThemeSettings({ ...themeSettings, readingModeBackground: value })}>
                        <SelectTrigger data-testid="select-reading-background">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">Default</SelectItem>
                          <SelectItem value="mountain">Mountain Vista</SelectItem>
                          <SelectItem value="ocean">Ocean Waves</SelectItem>
                          <SelectItem value="forest">Forest Path</SelectItem>
                          <SelectItem value="sunset">City Sunset</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </div>
          </Tabs>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            Changes are saved automatically when you close this dialog
          </div>
          
          <div className="flex items-center space-x-2">
            <Button 
              variant="outline" 
              onClick={handleClose}
              data-testid="button-cancel-settings"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSave} 
              disabled={isSaving}
              data-testid="button-save-settings"
            >
              {isSaving ? (
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  <span>Saving...</span>
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <Save className="h-4 w-4" />
                  <span>Save Changes</span>
                </div>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}