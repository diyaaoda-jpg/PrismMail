import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { useAuth } from "@/hooks/useAuth";
import { LazyRouteWrapper, createLazyRoute } from "@/components/LazyRouteWrapper";
import { performanceMonitor } from "@/lib/performanceMonitor";
import * as React from "react";

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

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  // Preload routes based on authentication state for better UX
  React.useEffect(() => {
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
  React.useEffect(() => {
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
          <Router />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
