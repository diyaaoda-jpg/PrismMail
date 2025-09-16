import { useAuth } from "@/hooks/useAuth";
import { PrismMail } from "@/components/PrismMail";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import * as React from "react";
import type { User } from "@shared/schema";

export default function Home() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const { toast } = useToast();

  // Handle unauthorized access
  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <div className="text-lg font-medium">Loading PrismMail...</div>
          <div className="text-sm text-muted-foreground">Setting up your email workspace</div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return null; // Will redirect via React.useEffect
  }

  const handleLogout = () => {
    const typedUser = user as User | undefined;
    console.log('Logging out user:', typedUser?.email || typedUser?.id);
  };

  // Safely cast user data with proper type checking
  const typedUser = user as User | undefined;
  const safeUser = {
    id: typedUser?.id || 'demo-user',
    firstName: typedUser?.firstName || 'Demo',
    lastName: typedUser?.lastName || 'User',
    email: typedUser?.email || 'demo@example.com',
    profileImageUrl: typedUser?.profileImageUrl || undefined
  };

  // Temporary: Show simple authenticated view to diagnose white page issue
  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-card rounded-lg shadow-lg p-6 mb-6">
          <h1 className="text-3xl font-bold mb-4">✅ Authentication Successful!</h1>
          <div className="space-y-2 text-lg">
            <p>Welcome, <strong>{safeUser.firstName} {safeUser.lastName}</strong></p>
            <p>Email: <strong>{safeUser.email}</strong></p>
            <p>User ID: <strong>{safeUser.id}</strong></p>
          </div>
          <div className="mt-6 space-x-4">
            <Button onClick={() => window.location.href = '/api/logout'} variant="outline">
              Logout
            </Button>
            <Button onClick={() => window.location.reload()} variant="default">
              Refresh Page
            </Button>
          </div>
        </div>
        
        <div className="bg-muted rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-3">Debug Information</h2>
          <div className="space-y-1 text-sm font-mono">
            <p>Authenticated: ✅ {String(isAuthenticated)}</p>
            <p>Loading: {String(isLoading)}</p>
            <p>Timestamp: {new Date().toLocaleString()}</p>
          </div>
        </div>
        
        <div className="mt-6 text-center text-muted-foreground">
          <p>If you see this page, authentication is working correctly.</p>
          <p>The main PrismMail component has been temporarily replaced for debugging.</p>
        </div>
      </div>
    </div>
  );
  
  // Original code (temporarily commented out):
  // return (
  //   <PrismMail 
  //     user={safeUser}
  //     onLogout={handleLogout}
  //   />
  // );
}