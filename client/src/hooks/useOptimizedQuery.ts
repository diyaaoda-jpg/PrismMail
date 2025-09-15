import { useQuery, useInfiniteQuery, QueryKey } from '@tanstack/react-query';
import { useMemo, useCallback } from 'react';
import { performanceMonitor } from '@/lib/performanceMonitor';

// Mobile-optimized query configuration
const MOBILE_QUERY_CONFIG = {
  // Aggressive caching for mobile performance
  staleTime: 1000 * 60 * 10, // 10 minutes - longer cache for mobile
  gcTime: 1000 * 60 * 30, // 30 minutes - keep in memory longer on mobile
  
  // Retry configuration optimized for mobile networks
  retry: (failureCount: number, error: any) => {
    // Don't retry on 4xx errors (client errors)
    if (error?.status >= 400 && error?.status < 500) {
      return false;
    }
    // Retry up to 2 times for network errors (mobile networks are unreliable)
    return failureCount < 2;
  },
  
  retryDelay: (attemptIndex: number) => 
    Math.min(1000 * 2 ** attemptIndex, 5000), // Exponential backoff, max 5s
  
  // Reduced refetch frequency for mobile battery optimization
  refetchOnWindowFocus: false,
  refetchOnReconnect: true,
  refetchOnMount: false,
};

// Optimized email query hook with performance monitoring
export function useOptimizedEmailQuery(
  queryKey: QueryKey,
  options: {
    enabled?: boolean;
    folder?: string;
    accountId?: string;
    limit?: number;
  } = {}
) {
  const { enabled = true, folder = 'INBOX', accountId, limit = 50 } = options;

  // Memoize query function for stable reference
  const queryFn = useCallback(async () => {
    const startTime = performance.now();
    
    try {
      let url = '/api/mail';
      const params = new URLSearchParams();
      
      if (folder) params.append('folder', folder);
      if (accountId) params.append('accountId', accountId);
      if (limit) params.append('limit', limit.toString());
      
      if (params.toString()) {
        url += `?${params.toString()}`;
      }
      
      const response = await fetch(url, {
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error(`Email fetch failed: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Measure and report performance
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      performanceMonitor.measureEmailListRender(() => {
        console.log(`Email query completed in ${duration.toFixed(2)}ms`);
        return data;
      });
      
      return data;
    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;
      console.error(`Email query failed after ${duration.toFixed(2)}ms:`, error);
      throw error;
    }
  }, [folder, accountId, limit]);

  return useQuery({
    queryKey,
    queryFn,
    enabled,
    ...MOBILE_QUERY_CONFIG,
    // Mobile-specific optimizations
    select: useCallback((data: any) => {
      // Only process and transform data that will be displayed
      // Reduce memory usage by not storing unnecessary data
      if (Array.isArray(data)) {
        return data;
      }
      return data?.success && Array.isArray(data.data) ? data.data : [];
    }, []),
  });
}

// Infinite query for large email lists with virtual scrolling
export function useInfiniteEmailQuery(
  queryKey: QueryKey,
  options: {
    enabled?: boolean;
    folder?: string;
    accountId?: string;
    pageSize?: number;
  } = {}
) {
  const { enabled = true, folder = 'INBOX', accountId, pageSize = 50 } = options;

  const queryFn = useCallback(async ({ pageParam = 0 }) => {
    const startTime = performance.now();
    
    try {
      let url = '/api/mail';
      const params = new URLSearchParams();
      
      if (folder) params.append('folder', folder);
      if (accountId) params.append('accountId', accountId);
      params.append('limit', pageSize.toString());
      params.append('offset', (pageParam * pageSize).toString());
      
      url += `?${params.toString()}`;
      
      const response = await fetch(url, {
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error(`Email fetch failed: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Performance monitoring
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log(`Infinite email query page ${pageParam} completed in ${duration.toFixed(2)}ms`);
      
      return {
        emails: Array.isArray(data) ? data : (data?.data || []),
        nextCursor: data?.hasMore ? pageParam + 1 : undefined,
        totalCount: data?.totalCount
      };
    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;
      console.error(`Infinite email query failed after ${duration.toFixed(2)}ms:`, error);
      throw error;
    }
  }, [folder, accountId, pageSize]);

  return useInfiniteQuery({
    queryKey,
    queryFn,
    enabled,
    ...MOBILE_QUERY_CONFIG,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    // Mobile memory optimization
    maxPages: 10, // Limit pages in memory for mobile devices
    select: useCallback((data: any) => {
      // Flatten pages and optimize for virtual scrolling
      const allEmails = data.pages.flatMap((page: any) => page.emails || []);
      return {
        emails: allEmails,
        totalCount: data.pages[0]?.totalCount || allEmails.length,
        hasNextPage: !!data.pages[data.pages.length - 1]?.nextCursor
      };
    }, []),
  });
}

// Optimized search query with debouncing
export function useOptimizedSearchQuery(
  searchTerm: string,
  options: {
    enabled?: boolean;
    accountId?: string;
    debounceMs?: number;
  } = {}
) {
  const { enabled = true, accountId, debounceMs = 300 } = options;

  // Debounce search term for mobile performance
  const debouncedSearchTerm = useMemo(() => {
    const timeoutId = setTimeout(() => searchTerm, debounceMs);
    return () => clearTimeout(timeoutId);
  }, [searchTerm, debounceMs]);

  const queryFn = useCallback(async () => {
    if (!searchTerm || searchTerm.length < 2) {
      return [];
    }

    return performanceMonitor.measureSearchTime(async () => {
      let url = '/api/search';
      const params = new URLSearchParams();
      
      params.append('q', searchTerm);
      if (accountId) params.append('accountId', accountId);
      
      url += `?${params.toString()}`;
      
      const response = await fetch(url, {
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }
      
      const data = await response.json();
      return Array.isArray(data) ? data : (data?.data || []);
    });
  }, [searchTerm, accountId]);

  return useQuery({
    queryKey: ['search', searchTerm, accountId],
    queryFn,
    enabled: enabled && !!searchTerm && searchTerm.length >= 2,
    ...MOBILE_QUERY_CONFIG,
    // Shorter stale time for search results
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}

// Prefetch utilities for mobile performance
export function usePrefetchOptimization() {
  const prefetchEmail = useCallback(async (emailId: string) => {
    // Prefetch email content for likely navigation
    const queryClient = (await import('@/lib/queryClient')).queryClient;
    
    queryClient.prefetchQuery({
      queryKey: ['/api/emails', emailId, 'content'],
      queryFn: () => fetch(`/api/emails/${emailId}/content`, {
        credentials: 'include'
      }).then(res => res.json()),
      staleTime: 1000 * 60 * 15, // 15 minutes cache
    });
  }, []);

  const prefetchFolder = useCallback(async (folder: string, accountId?: string) => {
    // Prefetch folder contents for faster navigation
    const queryClient = (await import('@/lib/queryClient')).queryClient;
    
    const queryKey = accountId 
      ? ['/api/mail', folder, accountId]
      : ['/api/mail/unified', folder];
    
    queryClient.prefetchQuery({
      queryKey,
      queryFn: () => {
        let url = accountId ? '/api/mail' : `/api/mail/unified/${folder}`;
        if (accountId) {
          url += `?folder=${folder}&accountId=${accountId}`;
        }
        
        return fetch(url, {
          credentials: 'include'
        }).then(res => res.json());
      },
      staleTime: 1000 * 60 * 5, // 5 minutes cache
    });
  }, []);

  return {
    prefetchEmail,
    prefetchFolder
  };
}

export default {
  useOptimizedEmailQuery,
  useInfiniteEmailQuery,
  useOptimizedSearchQuery,
  usePrefetchOptimization
};