import { useAuth } from "@/hooks/useAuth";
import { PrismMail } from "@/components/PrismMail";
import { useToast } from "@/hooks/use-toast";
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

  return (
    <PrismMail 
      user={safeUser}
      onLogout={handleLogout}
    />
  );
}