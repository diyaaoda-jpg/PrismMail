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
import { AlertCircle, Plus, Trash2, Server, RefreshCw, Edit } from "lucide-react";
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
import { X, Save, Mail, User, Shield, Palette, CheckCircle, Loader2, HelpCircle } from "lucide-react";
import { ThemeMenu } from "./ThemeMenu";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertAccountConnectionSchema, type AccountConnection, type UserPrefs, imapSettingsSchema, ewsSettingsSchema, smtpSettingsSchema } from "@shared/schema";
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

// Enhanced account form validation schema with better error messages and validation
const accountFormSchema = z.object({
  name: z.string()
    .min(1, "Account name is required")
    .max(100, "Account name is too long")
    .refine(
      (name) => name.trim().length > 0,
      "Account name cannot be just whitespace"
    ),
  protocol: z.enum(["IMAP", "EWS"], {
    errorMap: () => ({ message: "Please select either IMAP or EWS protocol" })
  }),
  host: z.string()
    .min(1, "Mail server is required")
    .max(255, "Server name is too long")
    .refine(
      (host) => {
        // Enhanced hostname validation
        const hostnameRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*|(?:[0-9]{1,3}\.){3}[0-9]{1,3})$/;
        // For EWS, also allow URLs
        const urlRegex = /^https?:\/\/.+/;
        return hostnameRegex.test(host) || urlRegex.test(host);
      },
      "Please enter a valid server name (e.g., imap.gmail.com) or URL for EWS"
    ),
  port: z.coerce.number()
    .int("Port must be a whole number")
    .min(1, "Port must be greater than 0")
    .max(65535, "Port must be less than 65536"),
  username: z.string()
    .min(1, "Username is required")
    .max(255, "Username is too long")
    .refine(
      (username) => {
        // Basic email validation or domain\username format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const domainUserRegex = /^[^\\]+\\[^\\]+$/;
        return emailRegex.test(username) || domainUserRegex.test(username) || username.length > 0;
      },
      "Username is typically your email address or DOMAIN\\username format"
    ),
  password: z.string()
    .min(1, "Password is required")
    .max(1024, "Password is too long"),
  useSSL: z.boolean(),
  // SMTP configuration fields (only for IMAP)
  smtpHost: z.string().optional(),
  smtpPort: z.coerce.number()
    .int("Port must be a whole number")
    .min(1, "Port must be greater than 0")
    .max(65535, "Port must be less than 65536")
    .optional(),
  smtpSecure: z.boolean().optional(),
  smtpUsername: z.string().optional(),
  smtpPassword: z.string().optional(),
  enableCustomSmtp: z.boolean().optional(),
}).superRefine((data, ctx) => {
  // Essential validation - only add issues for actual blocking errors
  if (data.protocol === 'IMAP') {
    // IMAP port validation - check if numeric value exists
    if (!data.port || data.port < 1 || data.port > 65535) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Port is required for IMAP connections (typically 993 for SSL or 143 for STARTTLS)",
        path: ["port"]
      });
    }
    
    // Critical validation only - port 993 must have SSL enabled
    if (data.port === 993 && !data.useSSL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Port 993 requires SSL to be enabled for secure connections",
        path: ["useSSL"]
      });
    }
    
    // SMTP validation for IMAP accounts when custom SMTP is enabled
    if (data.enableCustomSmtp) {
      if (!data.smtpHost || data.smtpHost.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "SMTP server is required when custom SMTP is enabled",
          path: ["smtpHost"]
        });
      }
      if (!data.smtpPort || data.smtpPort < 1 || data.smtpPort > 65535) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "SMTP port is required when custom SMTP is enabled",
          path: ["smtpPort"]
        });
      }
    }
  } else if (data.protocol === 'EWS') {
    // Essential EWS validation only
    if (data.host.startsWith('http')) {
      try {
        const url = new URL(data.host);
        if (url.protocol !== 'https:') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "EWS must use HTTPS protocol for security",
            path: ["host"]
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid EWS URL format",
          path: ["host"]
        });
      }
    } else if (!data.host.includes('.')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Exchange server must be a valid domain with TLD (e.g., mail.company.com)",
        path: ["host"]
      });
    }
  }
});

type AccountFormData = z.infer<typeof accountFormSchema>;

export function SettingsDialog({ isOpen, onClose, user }: SettingsDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("account");
  const [isSaving, setIsSaving] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [editAccountId, setEditAccountId] = useState<string | null>(null);
  const [deleteAccountId, setDeleteAccountId] = useState<string | null>(null);
  const [syncingAccounts, setSyncingAccounts] = useState<Set<string>>(new Set());
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{
    success: boolean;
    message: string;
    details?: any;
  } | null>(null);
  const [showConnectionHelp, setShowConnectionHelp] = useState(false);

  // Manual sync mutation
  const manualSyncMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/sync/all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        let errorMessage = `Sync failed: ${response.statusText}`;
        try {
          const error = await response.json();
          errorMessage = error.message || errorMessage;
        } catch {
          // If JSON parsing fails, use response status text
          errorMessage = response.statusText || 'Sync failed';
        }
        throw new Error(errorMessage);
      }
      
      try {
        return await response.json();
      } catch (error) {
        // If successful response isn't valid JSON, return a default success response
        return { accountsProcessed: 1, success: true };
      }
    },
    onSuccess: (data) => {
      toast({
        title: "Manual sync completed",
        description: `Successfully synced ${data.accountsProcessed} accounts`
      });
      // Invalidate all mail queries to refresh the data
      queryClient.invalidateQueries({ queryKey: ['/api/mail'] });
    },
    onError: (error: any) => {
      console.error('Manual sync failed:', error);
      toast({
        title: "Manual sync failed", 
        description: error.message || "Failed to synchronize emails",
        variant: "destructive"
      });
    }
  });

  // Save preferences mutation
  const savePreferencesMutation = useMutation({
    mutationFn: async (prefs: Partial<UserPrefs>) => {
      return await apiRequest('POST', '/api/preferences', prefs);
    },
    onSuccess: () => {
      toast({
        title: "Settings saved",
        description: "Your preferences have been updated successfully."
      });
      queryClient.invalidateQueries({ queryKey: ['/api/preferences'] });
    },
    onError: (error: any) => {
      console.error('Save preferences failed:', error);
      toast({
        title: "Save failed", 
        description: error.message || "Failed to save settings",
        variant: "destructive"
      });
    }
  });
  
  // Account form setup with validation
  const accountForm = useForm<AccountFormData>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: {
      name: "",
      protocol: "IMAP",
      host: "",
      port: 993, // Default IMAP SSL port
      username: "",
      password: "",
      useSSL: true,
      // SMTP defaults for IMAP accounts
      enableCustomSmtp: false,
      smtpHost: "",
      smtpPort: 587, // Default SMTP submission port
      smtpSecure: true,
      smtpUsername: "",
      smtpPassword: "",
    },
  });
  
  // Watch protocol and form changes for real-time validation feedback
  const watchedProtocol = accountForm.watch("protocol");
  const watchedHost = accountForm.watch("host");
  const watchedPort = accountForm.watch("port");
  const watchedEnableCustomSmtp = accountForm.watch("enableCustomSmtp");
  
  // Real-time validation state
  const formErrors = accountForm.formState.errors;
  const isFormValid = Object.keys(formErrors).length === 0 && accountForm.formState.isDirty;
  
  // Fetch user preferences from API first
  const { data: userPrefs, isLoading: prefsLoading } = useQuery<UserPrefs>({ 
    queryKey: ['/api/preferences'],
    enabled: isOpen
  });
  
  // Consolidated protocol configuration - single source of truth
  useEffect(() => {
    if (watchedProtocol === 'IMAP') {
      // IMAP defaults: SSL port 993, SSL enabled
      accountForm.setValue('port', 993);
      accountForm.setValue('useSSL', true);
      
      // Auto-configure SMTP settings if host is provided and custom SMTP not enabled
      if (watchedHost && watchedHost.includes('.') && !watchedEnableCustomSmtp) {
        const autoSmtpHost = watchedHost.replace(/^imap\./, 'smtp.');
        accountForm.setValue('smtpHost', autoSmtpHost);
        accountForm.setValue('smtpPort', 587);
        accountForm.setValue('smtpSecure', false); // STARTTLS
      }
    } else if (watchedProtocol === 'EWS') {
      // EWS defaults: HTTPS port 443, SSL always enabled
      accountForm.setValue('port', 443);
      accountForm.setValue('useSSL', true);
      
      // Clear SMTP settings for EWS (not applicable)
      accountForm.setValue('smtpHost', '');
      accountForm.setValue('smtpPort', 587); // Default numeric value instead of empty string
      accountForm.setValue('enableCustomSmtp', false);
    }
  }, [watchedProtocol, watchedHost, watchedEnableCustomSmtp, accountForm]);

  // Account settings
  const [accountData, setAccountData] = useState({
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    email: user.email || "",
    signature: "Best regards,\n" + (user.firstName || "User")
  });

  // Email preferences for form handling
  const [emailPrefs, setEmailPrefs] = useState({
    autoMarkRead: true,
    showPreview: true,
    compactView: false,
    emailsPerPage: "25",
    defaultFolder: "inbox",
    autoSync: true,
    syncInterval: "600" // 10 minutes in seconds
  });

  // Update email preferences when userPrefs changes
  useEffect(() => {
    if (userPrefs) {
      setEmailPrefs(prev => ({
        ...prev,
        autoSync: userPrefs.autoSync ?? true,
        syncInterval: userPrefs.syncInterval?.toString() ?? "600"
      }));
    }
  }, [userPrefs]);

  // Notification settings
  const [notifications, setNotifications] = useState({
    desktopNotifications: true,
    soundNotifications: false,
    emailNotifications: true,
    priorityOnly: false
  });

  // Appearance settings (non-theme)
  const [appearanceSettings, setAppearanceSettings] = useState({
    fontSize: "medium",
    readingModeBackground: "default"
  });

  // Account connections API with proper typing
  const { data: accountsResponse, isLoading: accountsLoading } = useQuery<{success: boolean, data: AccountConnection[]}>({
    queryKey: ['/api/accounts'],
    enabled: isOpen
  });
  
  // Extract accounts from API response and ensure it's always an array
  const accounts = Array.isArray(accountsResponse?.data) ? accountsResponse.data : [];

  // Enhanced connection test with detailed progress and error handling
  const testConnectionMutation = useMutation({
    mutationFn: async (data: AccountFormData) => {
      setIsTestingConnection(true);
      setConnectionTestResult(null);
      
      try {
        const response = await fetch('/api/accounts/test-connection', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
          signal: AbortSignal.timeout(30000), // 30 second timeout
        });
        
        const responseData = await response.json();
        
        if (!response.ok) {
          throw new Error(responseData.message || 'Connection test failed');
        }
        
        return responseData;
      } catch (error: any) {
        if (error.name === 'AbortError') {
          throw new Error('Connection test timed out. Please check your server settings and network connection.');
        }
        throw error;
      } finally {
        setIsTestingConnection(false);
      }
    },
    onSuccess: (data) => {
      setConnectionTestResult({
        success: true,
        message: data.message || "Connection test successful! Your account settings are valid.",
        details: data
      });
      toast({
        title: "Connection test successful",
        description: data.message || "Account settings are valid"
      });
    },
    onError: (error: any) => {
      console.error('Connection test failed:', error);
      setConnectionTestResult({
        success: false,
        message: error.message || "Unable to connect with these settings"
      });
      toast({
        title: "Connection test failed", 
        description: error.message || "Unable to connect with these settings",
        variant: "destructive"
      });
    }
  });

  const onTestConnection = () => {
    // Clear previous test results
    setConnectionTestResult(null);
    
    // Validate form before testing
    accountForm.trigger().then((isValid) => {
      if (!isValid) {
        toast({
          title: "Validation errors",
          description: "Please fix the form errors before testing the connection",
          variant: "destructive"
        });
        return;
      }
      
      const data = accountForm.getValues();
      testConnectionMutation.mutate(data);
    });
  };
  
  // Helper function to get connection guidance based on protocol
  const getConnectionGuidance = (protocol: string) => {
    if (protocol === 'IMAP') {
      return {
        title: "IMAP Configuration Guide",
        items: [
          "Use port 993 with SSL enabled for secure connections",
          "Your username is typically your full email address",
          "Use an app-specific password if you have 2FA enabled",
          "Common IMAP servers: imap.gmail.com, outlook.office365.com",
          "SMTP will be auto-configured or you can customize it"
        ]
      };
    } else if (protocol === 'EWS') {
      return {
        title: "Exchange Web Services (EWS) Configuration Guide",
        items: [
          "Enter your Exchange server name (e.g., mail.company.com)",
          "Username can be email format or DOMAIN\\username",
          "EWS uses HTTPS and handles both incoming and outgoing email",
          "No separate SMTP configuration needed",
          "Contact your IT administrator if you're unsure about server details"
        ]
      };
    }
    return null;
  };

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
          // Include SMTP settings for IMAP accounts
          enableCustomSmtp: accountData.enableCustomSmtp,
          smtpHost: accountData.smtpHost,
          smtpPort: accountData.smtpPort,
          smtpSecure: accountData.smtpSecure,
          smtpUsername: accountData.smtpUsername,
          smtpPassword: accountData.smtpPassword,
        })
      });
      
      if (!testResponse.ok) {
        const error = await testResponse.json();
        throw new Error(error.message || 'Connection test failed');
      }
      
      // If test successful, create account - backend now handles settingsJson construction
      const response = await apiRequest('POST', '/api/accounts', {
        name: accountData.name,
        protocol: accountData.protocol,
        host: accountData.host,
        username: accountData.username,
        password: accountData.password,
        useSSL: accountData.protocol === 'IMAP' ? true : undefined,
        // Include SMTP settings for IMAP accounts
        enableCustomSmtp: accountData.enableCustomSmtp,
        smtpHost: accountData.smtpHost,
        smtpPort: accountData.smtpPort,
        smtpSecure: accountData.smtpSecure,
        smtpUsername: accountData.smtpUsername,
        smtpPassword: accountData.smtpPassword,
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
      setConnectionTestResult(null);
      setShowConnectionHelp(false);
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

  const updateAccountMutation = useMutation({
    mutationFn: async ({ accountId, accountData }: { accountId: string; accountData: AccountFormData }) => {
      // Test connection first, just like create mutation
      const testResponse = await fetch('/api/accounts/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          protocol: accountData.protocol,
          host: accountData.host,
          port: accountData.protocol === 'IMAP' ? '993' : undefined,
          username: accountData.username,
          password: accountData.password,
          useSSL: accountData.protocol === 'IMAP' ? true : undefined,
          // Include SMTP settings for IMAP accounts (CRITICAL FIX)
          enableCustomSmtp: accountData.enableCustomSmtp,
          smtpHost: accountData.smtpHost,
          smtpPort: accountData.smtpPort,
          smtpSecure: accountData.smtpSecure,
          smtpUsername: accountData.smtpUsername,
          smtpPassword: accountData.smtpPassword,
        })
      });
      
      if (!testResponse.ok) {
        const error = await testResponse.json();
        throw new Error(error.message || 'Connection test failed');
      }
      
      // If test successful, update account - backend handles settingsJson construction
      return await apiRequest('PUT', `/api/accounts/${accountId}`, {
        name: accountData.name,
        protocol: accountData.protocol,
        host: accountData.host,
        username: accountData.username,
        password: accountData.password,
        useSSL: accountData.protocol === 'IMAP' ? true : undefined,
        // Include SMTP settings for IMAP accounts
        enableCustomSmtp: accountData.enableCustomSmtp,
        smtpHost: accountData.smtpHost,
        smtpPort: accountData.smtpPort,
        smtpSecure: accountData.smtpSecure,
        smtpUsername: accountData.smtpUsername,
        smtpPassword: accountData.smtpPassword,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounts'] });
      toast({
        title: "Account Updated Successfully", 
        description: "Connection test passed. Your email account has been updated."
      });
      setEditAccountId(null);
      setConnectionTestResult(null);
      setShowConnectionHelp(false);
      accountForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update your email account. Please check your settings.",
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

  const handleEditAccount = (account: AccountConnection) => {
    try {
      // Parse current settings to pre-fill the form
      const settings = JSON.parse(account.settingsJson);
      
      // Pre-fill the form with current account data
      accountForm.setValue('name', account.name);
      accountForm.setValue('protocol', account.protocol as 'IMAP' | 'EWS');
      accountForm.setValue('host', settings.host || '');
      accountForm.setValue('port', settings.port || (account.protocol === 'IMAP' ? 993 : 443));
      accountForm.setValue('username', settings.username || '');
      accountForm.setValue('password', ''); // Don't pre-fill password for security
      accountForm.setValue('useSSL', settings.useSSL ?? true);
      
      // CRITICAL FIX: Pre-fill SMTP settings for IMAP accounts
      if (account.protocol === 'IMAP' && settings.smtp) {
        accountForm.setValue('enableCustomSmtp', !!settings.smtp);
        accountForm.setValue('smtpHost', settings.smtp.host || '');
        accountForm.setValue('smtpPort', settings.smtp.port || 587);
        accountForm.setValue('smtpSecure', settings.smtp.secure ?? false);
        accountForm.setValue('smtpUsername', settings.smtp.username || '');
        accountForm.setValue('smtpPassword', ''); // Don't pre-fill SMTP password for security
      } else if (account.protocol === 'IMAP') {
        // Default SMTP values for IMAP accounts without custom SMTP
        accountForm.setValue('enableCustomSmtp', false);
        accountForm.setValue('smtpHost', '');
        accountForm.setValue('smtpPort', '');
        accountForm.setValue('smtpSecure', false);
        accountForm.setValue('smtpUsername', '');
        accountForm.setValue('smtpPassword', '');
      }
      
      // Enter edit mode
      setEditAccountId(account.id);
      setShowAddAccount(false); // Close add account form if open
    } catch (error) {
      console.error('Failed to parse account settings:', error);
      toast({
        title: "Edit Failed",
        description: "Failed to load account settings for editing.",
        variant: "destructive"
      });
    }
  };

  const handleCancelEdit = () => {
    setEditAccountId(null);
    setConnectionTestResult(null);
    setShowConnectionHelp(false);
    accountForm.reset();
  };

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
        let errorMessage = 'Failed to sync account';
        try {
          const error = await response.json();
          errorMessage = error.message || errorMessage;
        } catch {
          // If JSON parsing fails, use response status text
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
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
    // Validate that editAccountId corresponds to an existing account
    const isValidEdit = editAccountId && accounts.some(account => account.id === editAccountId);
    
    if (isValidEdit) {
      // We're editing an existing account
      updateAccountMutation.mutate({ accountId: editAccountId, accountData: data });
    } else {
      // We're adding a new account (or editAccountId is stale)
      if (editAccountId && !isValidEdit) {
        console.warn(`Invalid editAccountId ${editAccountId} - treating as new account creation`);
        setEditAccountId(null); // Clear stale ID
      }
      createAccountMutation.mutate(data);
    }
  };

  const addAccountMutation = editAccountId ? updateAccountMutation : createAccountMutation;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[700px] h-[90vh] overflow-auto" data-testid="dialog-settings">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Manage your account settings, email connections, and preferences.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="account" data-testid="tab-account">
                <User className="w-4 h-4 mr-2" />
                Account
              </TabsTrigger>
              <TabsTrigger value="mail" data-testid="tab-mail">
                <Mail className="w-4 h-4 mr-2" />
                Email
              </TabsTrigger>
              <TabsTrigger value="theme" data-testid="tab-theme">
                <Palette className="w-4 h-4 mr-2" />
                Theme
              </TabsTrigger>
              <TabsTrigger value="security" data-testid="tab-security">
                <Shield className="w-4 h-4 mr-2" />
                Security
              </TabsTrigger>
            </TabsList>

            {/* Account Tab */}
            <TabsContent value="account" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Account Information</CardTitle>
                  <CardDescription>Your Replit account details</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="firstName">First Name</Label>
                      <Input
                        id="firstName"
                        value={accountData.firstName}
                        onChange={(e) => setAccountData(prev => ({ ...prev, firstName: e.target.value }))}
                        data-testid="input-first-name"
                      />
                    </div>
                    <div>
                      <Label htmlFor="lastName">Last Name</Label>
                      <Input
                        id="lastName"
                        value={accountData.lastName}
                        onChange={(e) => setAccountData(prev => ({ ...prev, lastName: e.target.value }))}
                        data-testid="input-last-name"
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      value={accountData.email}
                      disabled
                      className="bg-muted"
                      data-testid="input-email"
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Email Tab */}
            <TabsContent value="mail" className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Email Accounts</h3>
                  <p className="text-sm text-muted-foreground">Manage your connected email accounts</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => manualSyncMutation.mutate()}
                    disabled={manualSyncMutation.isPending}
                    variant="outline"
                    size="sm"
                    data-testid="button-manual-sync"
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${manualSyncMutation.isPending ? 'animate-spin' : ''}`} />
                    {manualSyncMutation.isPending ? 'Syncing...' : 'Sync All'}
                  </Button>
                  <Button
                    onClick={() => setShowAddAccount(true)}
                    size="sm"
                    data-testid="button-add-account"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Account
                  </Button>
                </div>
              </div>

              {/* Account List */}
              <div className="space-y-3">
                {accountsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span className="ml-2">Loading accounts...</span>
                  </div>
                ) : accounts.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-8">
                      <Mail className="w-12 h-12 text-muted-foreground mb-4" />
                      <h3 className="text-lg font-semibold mb-2">No Email Accounts</h3>
                      <p className="text-muted-foreground text-center mb-4">
                        Add your first email account to start managing your messages in PrismMail.
                      </p>
                      <Button onClick={() => setShowAddAccount(true)} data-testid="button-add-first-account">
                        <Plus className="w-4 h-4 mr-2" />
                        Add Your First Account
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  accounts.map((account) => (
                    <Card key={account.id} className="hover-elevate">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="flex items-center space-x-2">
                              <Badge variant={account.protocol === 'IMAP' ? 'default' : 'secondary'}>
                                {account.protocol}
                              </Badge>
                              <Badge variant={account.isActive ? 'default' : 'destructive'}>
                                {account.isActive ? 'Active' : 'Inactive'}
                              </Badge>
                              {account.lastError && (
                                <Badge variant="destructive">
                                  <AlertCircle className="w-3 h-3 mr-1" />
                                  Error
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSyncAccount(account.id)}
                              disabled={syncingAccounts.has(account.id)}
                              data-testid={`button-sync-${account.id}`}
                            >
                              <RefreshCw className={`w-4 h-4 ${syncingAccounts.has(account.id) ? 'animate-spin' : ''}`} />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEditAccount(account)}
                              data-testid={`button-edit-${account.id}`}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDeleteAccount(account.id)}
                              data-testid={`button-delete-${account.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                        <div className="mt-3">
                          <h4 className="font-medium">{account.name}</h4>
                          <p className="text-sm text-muted-foreground">
                            Last checked: {account.lastChecked ? new Date(account.lastChecked).toLocaleString() : 'Never'}
                          </p>
                          {account.lastError && (
                            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                              {account.lastError}
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>

              {/* Add/Edit Account Form */}
              {(showAddAccount || editAccountId) && (
                <Card>
                  <CardHeader>
                    <CardTitle>{editAccountId ? 'Edit Account' : 'Add Email Account'}</CardTitle>
                    <CardDescription>
                      {editAccountId ? 'Update your email account settings' : 'Connect a new email account to PrismMail'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Form {...accountForm}>
                      <form onSubmit={accountForm.handleSubmit(onSubmitAccount)} className="space-y-4">
                        <FormField
                          control={accountForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Account Name <span className="text-red-500">*</span></FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  placeholder="My Work Email"
                                  data-testid="input-account-name"
                                />
                              </FormControl>
                              <FormMessage />
                              <p className="text-xs text-muted-foreground mt-1">
                                A friendly name to identify this account
                              </p>
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={accountForm.control}
                          name="protocol"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Protocol <span className="text-red-500">*</span></FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value} data-testid="select-protocol">
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select protocol" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="IMAP">IMAP (Most email providers)</SelectItem>
                                  <SelectItem value="EWS">EWS (Exchange Server)</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                              <p className="text-xs text-muted-foreground mt-1">
                                {watchedProtocol === 'IMAP' 
                                  ? 'IMAP works with Gmail, Outlook.com, Yahoo, and most email providers'
                                  : 'EWS is used for corporate Exchange servers'
                                }
                              </p>
                            </FormItem>
                          )}
                        />

                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={accountForm.control}
                            name="host"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Mail Server <span className="text-red-500">*</span></FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder={watchedProtocol === 'IMAP' ? 'imap.gmail.com' : 'mail.company.com'}
                                    data-testid="input-host"
                                  />
                                </FormControl>
                                <FormMessage />
                                <p className="text-xs text-muted-foreground mt-1">
                                  {watchedProtocol === 'IMAP' 
                                    ? 'IMAP server hostname (e.g., imap.gmail.com, outlook.office365.com)'
                                    : 'Exchange server hostname or full EWS URL'
                                  }
                                </p>
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={accountForm.control}
                            name="port"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Port {watchedProtocol === 'IMAP' && <span className="text-red-500">*</span>}</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder={watchedProtocol === 'IMAP' ? '993 (SSL)' : 'Not required for EWS'}
                                    disabled={watchedProtocol === "EWS"}
                                    data-testid="input-port"
                                  />
                                </FormControl>
                                <FormMessage />
                                {watchedProtocol === 'IMAP' && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    Use port 993 for secure IMAP over SSL
                                  </p>
                                )}
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={accountForm.control}
                            name="username"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Username <span className="text-red-500">*</span></FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder={watchedProtocol === 'EWS' ? 'user@company.com or DOMAIN\\username' : 'your.email@example.com'}
                                    data-testid="input-username"
                                  />
                                </FormControl>
                                <FormMessage />
                                <p className="text-xs text-muted-foreground mt-1">
                                  {watchedProtocol === 'IMAP' 
                                    ? 'Your full email address'
                                    : 'Email address or DOMAIN\\username format'
                                  }
                                </p>
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={accountForm.control}
                            name="password"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Password <span className="text-red-500">*</span></FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    type="password"
                                    placeholder="••••••••"
                                    data-testid="input-password"
                                  />
                                </FormControl>
                                <FormMessage />
                                <p className="text-xs text-muted-foreground mt-1">
                                  Use an app-specific password if you have 2FA enabled
                                </p>
                              </FormItem>
                            )}
                          />
                        </div>

                        {/* SMTP Configuration for IMAP */}
                        {watchedProtocol === 'IMAP' && (
                          <div className="space-y-4">
                            <Separator />
                            <div className="space-y-4">
                              <FormField
                                control={accountForm.control}
                                name="enableCustomSmtp"
                                render={({ field }) => (
                                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                    <div className="space-y-0.5">
                                      <FormLabel className="text-base">Custom SMTP Configuration</FormLabel>
                                      <div className="text-sm text-muted-foreground">
                                        Override automatic SMTP settings for sending emails
                                      </div>
                                    </div>
                                    <FormControl>
                                      <Switch
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                        data-testid="switch-custom-smtp"
                                      />
                                    </FormControl>
                                  </FormItem>
                                )}
                              />

                              {watchedEnableCustomSmtp && (
                                <div className="grid grid-cols-2 gap-4">
                                  <FormField
                                    control={accountForm.control}
                                    name="smtpHost"
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel>SMTP Server <span className="text-red-500">*</span></FormLabel>
                                        <FormControl>
                                          <Input
                                            {...field}
                                            placeholder="smtp.gmail.com"
                                            data-testid="input-smtp-host"
                                          />
                                        </FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />

                                  <FormField
                                    control={accountForm.control}
                                    name="smtpPort"
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel>SMTP Port <span className="text-red-500">*</span></FormLabel>
                                        <FormControl>
                                          <Input
                                            {...field}
                                            placeholder="587"
                                            data-testid="input-smtp-port"
                                          />
                                        </FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <Button 
                              type="button" 
                              variant="outline" 
                              onClick={onTestConnection}
                              disabled={isTestingConnection || !isFormValid}
                              data-testid="button-test-connection"
                              className="flex-1"
                            >
                              {isTestingConnection ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              ) : (
                                <Server className="w-4 h-4 mr-2" />
                              )}
                              {isTestingConnection ? 'Testing Connection...' : 'Test Connection'}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => setShowConnectionHelp(!showConnectionHelp)}
                              data-testid="button-connection-help"
                            >
                              <HelpCircle className="w-4 h-4" />
                            </Button>
                          </div>
                          
                          {/* Connection test result */}
                          {connectionTestResult && (
                            <div className={`p-3 rounded-md text-sm ${
                              connectionTestResult.success 
                                ? 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                                : 'bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                            }`}>
                              <div className="flex items-start gap-2">
                                {connectionTestResult.success ? (
                                  <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                                ) : (
                                  <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                                )}
                                <div>
                                  <p className="font-medium">
                                    {connectionTestResult.success ? 'Connection Successful' : 'Connection Failed'}
                                  </p>
                                  <p className="mt-1">{connectionTestResult.message}</p>
                                </div>
                              </div>
                            </div>
                          )}
                          
                          {/* Connection guidance */}
                          {showConnectionHelp && (
                            <div className="p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-md">
                              {(() => {
                                const guidance = getConnectionGuidance(watchedProtocol);
                                if (!guidance) return null;
                                return (
                                  <div>
                                    <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
                                      {guidance.title}
                                    </h4>
                                    <ul className="space-y-1 text-sm text-blue-700 dark:text-blue-300">
                                      {guidance.items.map((item, index) => (
                                        <li key={index} className="flex items-start gap-2">
                                          <span className="text-blue-500 mt-1">•</span>
                                          <span>{item}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                );
                              })()} 
                            </div>
                          )}
                        </div>

                        <div className="flex justify-end space-x-2">
                          <Button 
                            variant="outline" 
                            type="button"
                            onClick={() => {
                              setShowAddAccount(false);
                              setEditAccountId(null);
                              setConnectionTestResult(null);
                              setShowConnectionHelp(false);
                              accountForm.reset();
                            }}
                            data-testid="button-cancel-account"
                          >
                            <X className="w-4 h-4 mr-2" />
                            Cancel
                          </Button>
                          <Button 
                            type="submit" 
                            disabled={addAccountMutation.isPending || !isFormValid}
                            data-testid="button-save-account"
                          >
                            {addAccountMutation.isPending ? (
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                              <Save className="w-4 h-4 mr-2" />
                            )}
                            {addAccountMutation.isPending ? 'Saving...' : editAccountId ? 'Update Account' : 'Add Account'}
                          </Button>
                        </div>
                        
                        {Object.keys(formErrors).length > 0 && (
                          <div className="mt-2 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-md">
                            <p className="text-sm text-red-700 dark:text-red-300 font-medium mb-1">
                              Please fix the following errors:
                            </p>
                            <ul className="text-sm text-red-600 dark:text-red-400 space-y-1">
                              {Object.entries(formErrors).map(([field, error]) => (
                                <li key={field} className="flex items-start gap-2">
                                  <span className="text-red-500 mt-1">•</span>
                                  <span>{error?.message || `Error in ${field}`}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              )}

              {/* Email Preferences */}
              <Card>
                <CardHeader>
                  <CardTitle>Email Preferences</CardTitle>
                  <CardDescription>Configure how emails are displayed and managed</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="emailsPerPage">Emails per page</Label>
                      <Select value={emailPrefs.emailsPerPage} onValueChange={(value) => setEmailPrefs(prev => ({ ...prev, emailsPerPage: value }))}>
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
                    <div>
                      <Label htmlFor="defaultFolder">Default folder</Label>
                      <Select value={emailPrefs.defaultFolder} onValueChange={(value) => setEmailPrefs(prev => ({ ...prev, defaultFolder: value }))}>
                        <SelectTrigger data-testid="select-default-folder">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inbox">Inbox</SelectItem>
                          <SelectItem value="sent">Sent</SelectItem>
                          <SelectItem value="drafts">Drafts</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="autoMarkRead">Auto-mark emails as read</Label>
                      <Switch
                        id="autoMarkRead"
                        checked={emailPrefs.autoMarkRead}
                        onCheckedChange={(checked) => setEmailPrefs(prev => ({ ...prev, autoMarkRead: checked }))}
                        data-testid="switch-auto-mark-read"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="showPreview">Show email preview</Label>
                      <Switch
                        id="showPreview"
                        checked={emailPrefs.showPreview}
                        onCheckedChange={(checked) => setEmailPrefs(prev => ({ ...prev, showPreview: checked }))}
                        data-testid="switch-show-preview"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="compactView">Compact view</Label>
                      <Switch
                        id="compactView"
                        checked={emailPrefs.compactView}
                        onCheckedChange={(checked) => setEmailPrefs(prev => ({ ...prev, compactView: checked }))}
                        data-testid="switch-compact-view"
                      />
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <h4 className="font-medium">Sync Settings</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="syncInterval">Sync interval</Label>
                        <Select value={emailPrefs.syncInterval} onValueChange={(value) => setEmailPrefs(prev => ({ ...prev, syncInterval: value }))}>
                          <SelectTrigger data-testid="select-sync-interval">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="60">1 minute</SelectItem>
                            <SelectItem value="300">5 minutes</SelectItem>
                            <SelectItem value="600">10 minutes</SelectItem>
                            <SelectItem value="1800">30 minutes</SelectItem>
                            <SelectItem value="3600">1 hour</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center space-x-2 pt-6">
                        <Switch
                          id="autoSync"
                          checked={emailPrefs.autoSync}
                          onCheckedChange={(checked) => setEmailPrefs(prev => ({ ...prev, autoSync: checked }))}
                          data-testid="switch-auto-sync"
                        />
                        <Label htmlFor="autoSync">Enable auto-sync</Label>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      onClick={() => {
                        const prefs: Partial<UserPrefs> = {
                          autoSync: emailPrefs.autoSync,
                          syncInterval: parseInt(emailPrefs.syncInterval)
                        };
                        savePreferencesMutation.mutate(prefs);
                      }}
                      disabled={savePreferencesMutation.isPending}
                      data-testid="button-save-email-prefs"
                    >
                      {savePreferencesMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4 mr-2" />
                      )}
                      Save Email Preferences
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Theme Tab */}
            <TabsContent value="theme" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Theme & Appearance</CardTitle>
                  <CardDescription>Customize the look and feel of PrismMail</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <ThemeMenu />
                </CardContent>
              </Card>
            </TabsContent>

            {/* Security Tab */}
            <TabsContent value="security" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Security & Privacy</CardTitle>
                  <CardDescription>Manage your security and privacy settings</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="desktopNotifications">Desktop notifications</Label>
                      <Switch
                        id="desktopNotifications"
                        checked={notifications.desktopNotifications}
                        onCheckedChange={(checked) => setNotifications(prev => ({ ...prev, desktopNotifications: checked }))}
                        data-testid="switch-desktop-notifications"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="soundNotifications">Sound notifications</Label>
                      <Switch
                        id="soundNotifications"
                        checked={notifications.soundNotifications}
                        onCheckedChange={(checked) => setNotifications(prev => ({ ...prev, soundNotifications: checked }))}
                        data-testid="switch-sound-notifications"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="priorityOnly">Priority emails only</Label>
                      <Switch
                        id="priorityOnly"
                        checked={notifications.priorityOnly}
                        onCheckedChange={(checked) => setNotifications(prev => ({ ...prev, priorityOnly: checked }))}
                        data-testid="switch-priority-only"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Delete Account Confirmation Dialog */}
      <AlertDialog open={!!deleteAccountId} onOpenChange={() => setDeleteAccountId(null)}>
        <AlertDialogContent data-testid="dialog-delete-confirmation">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Email Account</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this email account? This will remove all synced emails and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteAccount}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete Account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}