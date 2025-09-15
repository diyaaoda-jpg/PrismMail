import * as React from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { performanceMonitor } from '@/lib/performanceMonitor';

interface LazyRouteWrapperProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  errorFallback?: React.ComponentType<{ error: Error; resetErrorBoundary: () => void }>;
  name?: string;
}

// Default loading skeleton for routes
const DefaultRouteSkeleton = React.memo(() => (
  <div className="h-screen flex items-center justify-center bg-background">
    <div className="text-center space-y-4">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
      <div className="text-lg font-medium">Loading...</div>
      <div className="text-sm text-muted-foreground">Preparing your workspace</div>
    </div>
  </div>
));

// Default error fallback for routes
const DefaultErrorFallback = React.memo(({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) => (
  <div className="h-screen flex items-center justify-center bg-background p-4">
    <div className="text-center space-y-4 max-w-md">
      <div className="text-destructive text-2xl">⚠️</div>
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">
        {error.message || 'An unexpected error occurred while loading this page.'}
      </p>
      <button
        onClick={resetErrorBoundary}
        className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
      >
        Try again
      </button>
    </div>
  </div>
));

// Wrapper component for React.lazy-loaded routes with performance monitoring
export const LazyRouteWrapper = React.memo(function LazyRouteWrapper({
  children,
  fallback,
  errorFallback,
  name = 'Route'
}: LazyRouteWrapperProps) {
  return (
    <ErrorBoundary
      FallbackComponent={errorFallback || DefaultErrorFallback}
      onError={(error, errorInfo) => {
        console.error(`[${name}] Route error:`, error, errorInfo);
        // Report to monitoring service if available
        if ('gtag' in window) {
          (window as any).gtag('event', 'exception', {
            description: error.message,
            fatal: false,
            route_name: name
          });
        }
      }}
    >
      <React.Suspense fallback={fallback || <DefaultRouteSkeleton />}>
        {children}
      </React.Suspense>
    </ErrorBoundary>
  );
});

// Helper function to create React.lazy route components with performance monitoring
export function createLazyRoute<T extends React.ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
  name: string
): React.ComponentType<React.ComponentProps<T>> {
  const LazyComponent = React.lazy(async () => {
    const startTime = performance.now();
    
    try {
      console.log(`[${name}] Starting route load...`);
      
      // Load the component
      const module = await importFn();
      
      const endTime = performance.now();
      const loadTime = endTime - startTime;
      
      console.log(`[${name}] Route loaded in ${loadTime.toFixed(2)}ms`);
      
      // Report performance metrics
      performanceMonitor.measureEmailListRender(() => {
        console.log(`Route ${name} load time: ${loadTime}ms`);
        return module;
      });
      
      // Track in analytics if available
      if ('gtag' in window) {
        (window as any).gtag('event', 'route_load_time', {
          route_name: name,
          load_time: loadTime,
          performance_mark: loadTime < 1000 ? 'good' : loadTime < 2500 ? 'needs_improvement' : 'poor'
        });
      }
      
      return module;
    } catch (error) {
      const endTime = performance.now();
      const loadTime = endTime - startTime;
      
      console.error(`[${name}] Route load failed after ${loadTime.toFixed(2)}ms:`, error);
      
      // Track errors in analytics
      if ('gtag' in window) {
        (window as any).gtag('event', 'exception', {
          description: `Route load failed: ${name}`,
          fatal: false,
          load_time: loadTime
        });
      }
      
      throw error;
    }
  });
  
  // Add display name for debugging
  LazyComponent.displayName = `Lazy(${name})`;
  
  return LazyComponent;
}

// Pre-built React.lazy route components for common patterns
export const LazyHomeRoute = createLazyRoute(
  () => import('@/pages/Home'),
  'Home'
);

export const LazyLandingRoute = createLazyRoute(
  () => import('@/pages/Landing'),
  'Landing'
);

// HOC for React.lazy loading any component with performance monitoring
export function withLazyLoading<T extends React.ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
  name: string,
  options: {
    fallback?: React.ReactNode;
    errorFallback?: React.ComponentType<{ error: Error; resetErrorBoundary: () => void }>;
  } = {}
) {
  const LazyComponent = createLazyRoute(importFn, name);
  
  return function WrappedLazyComponent(props: React.ComponentProps<T>) {
    return (
      <LazyRouteWrapper
        fallback={options.fallback}
        errorFallback={options.errorFallback}
        name={name}
      >
        <LazyComponent {...props} />
      </LazyRouteWrapper>
    );
  };
}

// Utility for preloading routes for better user experience
export function preloadRoute(importFn: () => Promise<any>, name: string) {
  const startTime = performance.now();
  
  console.log(`[${name}] Preloading route...`);
  
  importFn()
    .then(() => {
      const endTime = performance.now();
      const loadTime = endTime - startTime;
      console.log(`[${name}] Route preloaded in ${loadTime.toFixed(2)}ms`);
    })
    .catch((error) => {
      const endTime = performance.now();
      const loadTime = endTime - startTime;
      console.warn(`[${name}] Route preload failed after ${loadTime.toFixed(2)}ms:`, error);
    });
}

// Hook for managing route preloading based on user behavior
export function useRoutePreloading() {
  const preloadHomeRoute = () => preloadRoute(() => import('@/pages/Home'), 'Home');
  const preloadLandingRoute = () => preloadRoute(() => import('@/pages/Landing'), 'Landing');
  
  return {
    preloadHomeRoute,
    preloadLandingRoute,
    preloadRoute
  };
}

export default LazyRouteWrapper;