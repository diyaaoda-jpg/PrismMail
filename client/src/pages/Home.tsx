import { useAuth } from "@/hooks/useAuth";
import { PrismMail } from "@/components/PrismMail";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";

export default function Home() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const { toast } = useToast();

  // Handle unauthorized access
  useEffect(() => {
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
    return null; // Will redirect via useEffect
  }

  const handleLogout = () => {
    console.log('Logging out user:', user?.email || user?.id);
  };

  return (
    <PrismMail 
      user={user as any} // todo: fix type compatibility with auth user
      onLogout={handleLogout}
    />
  );
}