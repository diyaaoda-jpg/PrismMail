import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { useAuth } from "@/hooks/useAuth";
import { LazyRouteWrapper, createLazyRoute } from "@/components/LazyRouteWrapper";
import { performanceMonitor } from "@/lib/performanceMonitor";
import { useEffect, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

// Lazy-loaded route components for optimal bundle splitting
const LazyLanding = createLazyRoute(
  () => import("@/pages/Landing"),
  "Landing"
);

const LazyHome = createLazyRoute(
  () => import("@/pages/Home"),
  "Home"
);

const LazyNotFound = createLazyRoute(
  () => import("@/pages/not-found"),
  "NotFound"
);

// Error fallback component for debugging
function ErrorFallback({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-background">
      <div className="max-w-md text-center space-y-4">
        <h2 className="text-2xl font-bold text-destructive">Something went wrong</h2>
        <pre className="text-sm bg-muted p-4 rounded overflow-auto">
          {error.message}
        </pre>
        <div className="space-x-2">
          <button 
            onClick={resetErrorBoundary}
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
          >
            Try again
          </button>
          <button 
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}

// Loading fallback for Suspense
function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  );
}

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  // Preload routes based on authentication state for better UX
  useEffect(() => {
    if (isAuthenticated) {
      // Preload Home route when authenticated
      import("@/pages/Home").catch(console.warn);
    } else {
      // Preload Landing route when not authenticated
      import("@/pages/Landing").catch(console.warn);
    }
  }, [isAuthenticated]);

  return (
    <Switch>
      {isLoading || !isAuthenticated ? (
        <Route path="/">
          <LazyRouteWrapper name="Landing">
            <LazyLanding />
          </LazyRouteWrapper>
        </Route>
      ) : (
        <>
          <Route path="/">
            <LazyRouteWrapper name="Home">
              <LazyHome />
            </LazyRouteWrapper>
          </Route>
        </>
      )}
      <Route>
        <LazyRouteWrapper name="NotFound">
          <LazyNotFound />
        </LazyRouteWrapper>
      </Route>
    </Switch>
  );
}

function App() {
  // Initialize performance monitoring
  useEffect(() => {
    // Start performance monitoring
    console.log('[App] Performance monitoring initialized');
    
    // Report bundle size after app loads
    setTimeout(() => {
      performanceMonitor.measureBundleSize();
    }, 2000);

    // Clean up on unmount
    return () => {
      console.log('[App] Cleaning up performance monitoring');
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultMode="light" defaultPalette="default">
        <TooltipProvider>
          <ErrorBoundary
            FallbackComponent={ErrorFallback}
            onError={(error) => {
              console.error('[App] Error caught by boundary:', error);
            }}
          >
            <Suspense fallback={<LoadingFallback />}>
              <Router />
            </Suspense>
          </ErrorBoundary>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
