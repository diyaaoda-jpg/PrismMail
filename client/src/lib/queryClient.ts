import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  // Handle FormData differently - don't set Content-Type header and don't stringify
  const isFormData = data instanceof FormData;
  
  const res = await fetch(url, {
    method,
    headers: data && !isFormData ? { "Content-Type": "application/json" } : {},
    body: data ? (isFormData ? data : JSON.stringify(data)) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      // Mobile-optimized query configuration
      refetchInterval: false,
      refetchOnWindowFocus: false, // Disable for mobile battery optimization
      refetchOnReconnect: true, // Re-fetch when network reconnects
      staleTime: 1000 * 60 * 10, // 10 minutes - longer cache for mobile
      gcTime: 1000 * 60 * 30, // 30 minutes - keep in memory longer
      retry: (failureCount, error: any) => {
        // Don't retry on 4xx errors (client errors)
        if (error?.status >= 400 && error?.status < 500) {
          return false;
        }
        // Retry up to 2 times for network errors (mobile networks are unreliable)
        return failureCount < 2;
      },
      retryDelay: (attemptIndex) => 
        Math.min(1000 * 2 ** attemptIndex, 5000), // Exponential backoff, max 5s
    },
    mutations: {
      retry: (failureCount, error: any) => {
        // Same retry logic for mutations
        if (error?.status >= 400 && error?.status < 500) {
          return false;
        }
        return failureCount < 1; // Only retry once for mutations
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 3000),
    },
  },
  // Mobile-specific configuration
});
