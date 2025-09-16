import { useState, useRef, useEffect, memo, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  placeholder?: string;
  fallback?: string;
  webpSrc?: string;
  sizes?: string;
  loading?: 'lazy' | 'eager';
  onLoad?: () => void;
  onError?: () => void;
  quality?: 'low' | 'medium' | 'high';
  priority?: boolean;
  aspectRatio?: string;
  blurDataURL?: string;
}

export const LazyImage = memo(function LazyImage({
  src,
  alt,
  className,
  placeholder,
  fallback,
  webpSrc,
  sizes,
  loading = 'lazy',
  onLoad,
  onError,
  quality = 'medium',
  priority = false,
  aspectRatio,
  blurDataURL
}: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isInView, setIsInView] = useState(priority); // Load immediately if priority
  const imgRef = useRef<HTMLImageElement>(null);
  const [currentSrc, setCurrentSrc] = useState<string>('');

  // Intersection Observer for lazy loading
  useEffect(() => {
    if (priority || isInView) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true);
            observer.disconnect();
          }
        });
      },
      {
        threshold: 0.1,
        rootMargin: '50px' // Start loading 50px before image comes into view
      }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, [priority, isInView]);

  // Determine best image source and quality
  const getBestImageSrc = useCallback(() => {
    if (!isInView && !priority) return placeholder || blurDataURL || '';

    // Check for WebP support
    const supportsWebP = (() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    })();

    // Use WebP if supported and available
    if (supportsWebP && webpSrc) {
      return webpSrc;
    }

    // Apply quality parameters for optimization
    const qualityParams = (() => {
      switch (quality) {
        case 'low':
          return '?q=60&f=auto';
        case 'high':
          return '?q=90&f=auto';
        default:
          return '?q=75&f=auto';
      }
    })();

    // Append quality parameters if src supports them
    if (src.includes('http') && !src.includes('?')) {
      return `${src}${qualityParams}`;
    }

    return src;
  }, [src, webpSrc, quality, isInView, priority, placeholder, blurDataURL]);

  // Update current source when conditions change
  useEffect(() => {
    setCurrentSrc(getBestImageSrc());
  }, [getBestImageSrc]);

  const handleLoad = useCallback(() => {
    setIsLoaded(true);
    setHasError(false);
    onLoad?.();
  }, [onLoad]);

  const handleError = useCallback(() => {
    setHasError(true);
    if (fallback && currentSrc !== fallback) {
      setCurrentSrc(fallback);
      setHasError(false);
    } else {
      onError?.();
    }
  }, [fallback, currentSrc, onError]);

  // Container styles for aspect ratio and responsive design
  const containerStyle = aspectRatio ? {
    aspectRatio,
    position: 'relative' as const,
    overflow: 'hidden' as const
  } : {};

  // Don't render anything if not in view and not priority - LAYOUT SHIFT FIX: Add minimum dimensions
  if (!isInView && !priority) {
    return (
      <div
        ref={imgRef}
        className={cn(
          "bg-muted animate-pulse",
          aspectRatio && "relative overflow-hidden",
          !aspectRatio && "min-h-[32px] min-w-[32px]", // Minimum dimensions to prevent layout shift
          className
        )}
        style={{
          ...containerStyle,
          ...(aspectRatio ? {} : { height: 'auto', minHeight: '32px' }) // Fallback dimensions
        }}
        aria-label={alt}
      >
        {blurDataURL && (
          <img
            src={blurDataURL}
            alt=""
            className="absolute inset-0 w-full h-full object-cover blur-sm scale-110"
            aria-hidden="true"
            style={{ minHeight: '32px', minWidth: '32px' }} // Ensure minimum size
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden",
        aspectRatio && "relative overflow-hidden",
        className
      )}
      style={containerStyle}
    >
      {/* Loading placeholder */}
      {(!isLoaded && !hasError) && (
        <div
          className={cn(
            "absolute inset-0 bg-muted animate-pulse",
            "flex items-center justify-center"
          )}
        >
          {blurDataURL ? (
            <img
              src={blurDataURL}
              alt=""
              className="w-full h-full object-cover blur-sm scale-110"
              aria-hidden="true"
            />
          ) : (
            <div className="w-8 h-8 bg-muted-foreground/20 rounded" />
          )}
        </div>
      )}

      {/* Error state */}
      {hasError && !fallback && (
        <div className="absolute inset-0 bg-muted flex items-center justify-center">
          <div className="text-muted-foreground text-sm">Failed to load image</div>
        </div>
      )}

      {/* Actual image */}
      {currentSrc && (
        <picture>
          {/* WebP source if available */}
          {webpSrc && (
            <source
              srcSet={webpSrc}
              type="image/webp"
              sizes={sizes}
            />
          )}
          
          {/* Fallback image */}
          <img
            ref={imgRef}
            src={currentSrc}
            alt={alt}
            className={cn(
              "transition-opacity duration-300",
              isLoaded ? "opacity-100" : "opacity-0",
              aspectRatio ? "absolute inset-0 w-full h-full object-cover" : "w-full h-auto",
              className
            )}
            loading={loading}
            sizes={sizes}
            onLoad={handleLoad}
            onError={handleError}
            decoding="async"
            data-testid="lazy-image"
          />
        </picture>
      )}
    </div>
  );
});

// Preload critical images for performance
export function preloadImage(src: string, webpSrc?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Try WebP first if supported and available
    const supportsWebP = (() => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
      } catch {
        return false;
      }
    })();

    const imageSrc = (supportsWebP && webpSrc) ? webpSrc : src;
    
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Failed to preload image: ${imageSrc}`));
    img.src = imageSrc;
  });
}

// Hook for managing multiple image preloading
export function useImagePreloader() {
  const [loadingImages, setLoadingImages] = useState<Set<string>>(new Set());
  
  const preloadImages = useCallback(async (images: Array<{ src: string; webpSrc?: string; priority?: boolean }>) => {
    // Sort by priority
    const sortedImages = images.sort((a, b) => {
      if (a.priority && !b.priority) return -1;
      if (!a.priority && b.priority) return 1;
      return 0;
    });

    // Preload in batches to avoid overwhelming the browser
    const batchSize = 3;
    
    for (let i = 0; i < sortedImages.length; i += batchSize) {
      const batch = sortedImages.slice(i, i + batchSize);
      
      const promises = batch.map(async ({ src, webpSrc }) => {
        setLoadingImages(prev => new Set(prev).add(src));
        
        try {
          await preloadImage(src, webpSrc);
        } catch (error) {
          console.warn(`Failed to preload image: ${src}`, error);
        } finally {
          setLoadingImages(prev => {
            const newSet = new Set(prev);
            newSet.delete(src);
            return newSet;
          });
        }
      });

      // Wait for current batch before starting next
      await Promise.allSettled(promises);
    }
  }, []);

  return {
    preloadImages,
    loadingImages: Array.from(loadingImages),
    isLoading: loadingImages.size > 0
  };
}

export default LazyImage;