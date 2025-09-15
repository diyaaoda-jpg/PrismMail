// Performance monitoring and metrics collection for mobile optimization
import * as React from 'react';
import { onCLS, onINP, onFCP, onLCP, onTTFB } from 'web-vitals';

interface PerformanceMetrics {
  fcp?: number;
  lcp?: number;
  inp?: number; // INP replaced FID in web-vitals v5
  cls?: number;
  ttfb?: number;
  bundleSize?: number;
  memoryUsage?: number;
  emailListRenderTime?: number;
  searchTime?: number;
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics = {};
  private observers: Array<(metrics: PerformanceMetrics) => void> = [];
  private isEnabled = true;
  private reportingTimeout: number | null = null; // Add debouncing for performance reports

  constructor() {
    this.initializeWebVitals();
    this.setupPerformanceObserver();
    this.monitorMemoryUsage();
  }

  private initializeWebVitals() {
    if (!this.isEnabled) return;

    try {
      // Core Web Vitals - Critical for mobile performance
      onCLS((metric) => {
        this.metrics.cls = metric.value;
        this.reportMetric('CLS', metric.value, 0.1); // Target < 0.1
        this.notifyObservers();
      });

      onINP((metric) => {
        this.metrics.inp = metric.value;
        this.reportMetric('INP', metric.value, 200); // Target < 200ms (INP threshold)
        this.notifyObservers();
      });

      onFCP((metric) => {
        this.metrics.fcp = metric.value;
        this.reportMetric('FCP', metric.value, 1500); // Target < 1.5s
        this.notifyObservers();
      });

      onLCP((metric) => {
        this.metrics.lcp = metric.value;
        this.reportMetric('LCP', metric.value, 2500); // Target < 2.5s
        this.notifyObservers();
      });

      onTTFB((metric) => {
        this.metrics.ttfb = metric.value;
        this.reportMetric('TTFB', metric.value, 800); // Target < 800ms
        this.notifyObservers();
      });
    } catch (error) {
      console.warn('[Performance] Web Vitals not available:', error);
    }
  }

  private setupPerformanceObserver() {
    if (!('PerformanceObserver' in window)) return;

    try {
      // Monitor long tasks (blocking main thread)
      const longTaskObserver = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          if (entry.duration > 50) { // Tasks longer than 50ms
            console.warn(`[Performance] Long task detected: ${entry.duration}ms`);
            this.reportCustomMetric('longTask', entry.duration, 50);
          }
        });
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });

      // Monitor layout shifts
      const layoutShiftObserver = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry: any) => {
          if (entry.hadRecentInput) return; // Ignore user-initiated shifts
          
          if (entry.value > 0.1) {
            console.warn(`[Performance] Layout shift detected: ${entry.value}`);
          }
        });
      });
      layoutShiftObserver.observe({ entryTypes: ['layout-shift'] });

    } catch (error) {
      console.warn('[Performance] Performance Observer setup failed:', error);
    }
  }

  private monitorMemoryUsage() {
    if (!('memory' in performance)) return;

    const checkMemory = () => {
      try {
        const memory = (performance as any).memory;
        const memoryUsageMB = memory.usedJSHeapSize / 1024 / 1024;
        
        this.metrics.memoryUsage = memoryUsageMB;
        
        // Warn if memory usage exceeds 100MB (mobile target)
        if (memoryUsageMB > 100) {
          console.warn(`[Performance] High memory usage: ${memoryUsageMB.toFixed(2)}MB`);
          this.reportCustomMetric('memoryUsage', memoryUsageMB, 100);
        }
        
        this.notifyObservers();
      } catch (error) {
        console.warn('[Performance] Memory monitoring failed:', error);
      }
    };

    // Check memory usage every 30 seconds
    setInterval(checkMemory, 30000);
    checkMemory(); // Initial check
  }

  // Measure email list rendering performance - Fixed to prevent render loops and reduce overhead
  measureEmailListRender<T>(callback: () => T): T {
    const startTime = performance.now();
    const result = callback();
    const endTime = performance.now();
    
    const renderTime = endTime - startTime;
    this.metrics.emailListRenderTime = renderTime;
    
    // Debounce reporting to prevent excessive logging and observer notifications
    if (this.reportingTimeout) {
      clearTimeout(this.reportingTimeout);
    }
    
    this.reportingTimeout = setTimeout(() => {
      // Target: < 100ms for 1000 emails
      this.reportMetric('EmailListRender', renderTime, 100);
      this.notifyObservers();
    }, 100);
    
    return result;
  }

  // Measure search performance
  measureSearchTime<T>(callback: () => Promise<T>): Promise<T> {
    const startTime = performance.now();
    
    return callback().then(result => {
      const endTime = performance.now();
      const searchTime = endTime - startTime;
      
      this.metrics.searchTime = searchTime;
      
      // Target: < 200ms response time
      this.reportMetric('SearchTime', searchTime, 200);
      this.notifyObservers();
      
      return result;
    });
  }

  // Measure bundle size (called after app loads)
  measureBundleSize() {
    if (!('getEntriesByType' in performance)) return;

    try {
      const resourceEntries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      let totalBundleSize = 0;

      resourceEntries.forEach(entry => {
        if (entry.name.includes('.js') || entry.name.includes('.css')) {
          totalBundleSize += entry.transferSize || 0;
        }
      });

      this.metrics.bundleSize = totalBundleSize / 1024; // Convert to KB
      
      // Target: < 500KB gzipped for initial load
      this.reportMetric('BundleSize', this.metrics.bundleSize, 500);
      this.notifyObservers();
    } catch (error) {
      console.warn('[Performance] Bundle size measurement failed:', error);
    }
  }

  private reportMetric(name: string, value: number, target: number) {
    const status = value <= target ? '✅' : '⚠️';
    const percentage = ((value / target) * 100).toFixed(1);
    
    console.log(`[Performance] ${status} ${name}: ${value.toFixed(2)} (target: ${target}, ${percentage}% of target)`);
    
    // Report to analytics if available
    if ('gtag' in window) {
      (window as any).gtag('event', 'performance_metric', {
        metric_name: name,
        metric_value: value,
        target_value: target,
        exceeds_target: value > target
      });
    }
  }

  private reportCustomMetric(name: string, value: number, target: number) {
    this.reportMetric(name, value, target);
  }

  // Subscribe to performance updates
  subscribe(callback: (metrics: PerformanceMetrics) => void): () => void {
    this.observers.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.observers.indexOf(callback);
      if (index > -1) {
        this.observers.splice(index, 1);
      }
    };
  }

  private notifyObservers() {
    this.observers.forEach(callback => {
      try {
        callback({ ...this.metrics });
      } catch (error) {
        console.error('[Performance] Observer callback failed:', error);
      }
    });
  }

  // Get current metrics snapshot
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  // Enhanced bundle size measurement and tracking
  measureBundleSizeDetailed() {
    if (!('getEntriesByType' in performance)) return;

    try {
      const resourceEntries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      let jsSize = 0;
      let cssSize = 0;
      let totalSize = 0;
      let gzippedSize = 0;
      
      const bundleDetails: any[] = [];

      resourceEntries.forEach(entry => {
        const url = entry.name;
        const transferSize = entry.transferSize || 0;
        const decodedSize = entry.decodedBodySize || 0;
        
        if (url.includes('.js') && !url.includes('node_modules')) {
          jsSize += transferSize;
          bundleDetails.push({
            type: 'JavaScript',
            url: url.split('/').pop(),
            transferSize: transferSize / 1024,
            decodedSize: decodedSize / 1024,
            compression: decodedSize > 0 ? (1 - transferSize / decodedSize) * 100 : 0
          });
        } else if (url.includes('.css')) {
          cssSize += transferSize;
          bundleDetails.push({
            type: 'CSS',
            url: url.split('/').pop(),
            transferSize: transferSize / 1024,
            decodedSize: decodedSize / 1024,
            compression: decodedSize > 0 ? (1 - transferSize / decodedSize) * 100 : 0
          });
        }
        
        if (url.includes('.js') || url.includes('.css')) {
          totalSize += transferSize;
          gzippedSize += transferSize;
        }
      });

      const bundleMetrics = {
        jsSize: jsSize / 1024, // KB
        cssSize: cssSize / 1024, // KB
        totalSize: totalSize / 1024, // KB
        gzippedSize: gzippedSize / 1024, // KB
        details: bundleDetails
      };

      this.metrics.bundleSize = bundleMetrics.gzippedSize;
      
      // Enhanced reporting
      console.log(`[Performance] Bundle Analysis:
📦 JavaScript: ${bundleMetrics.jsSize.toFixed(2)}KB
🎨 CSS: ${bundleMetrics.cssSize.toFixed(2)}KB
📊 Total Gzipped: ${bundleMetrics.gzippedSize.toFixed(2)}KB
🎯 Target: <500KB (${(bundleMetrics.gzippedSize/500*100).toFixed(1)}% of target)`);

      // Store detailed metrics
      (this.metrics as any).bundleDetails = bundleMetrics;
      
      this.reportMetric('Bundle Size (Gzipped)', bundleMetrics.gzippedSize, 500);
      this.notifyObservers();
      
      return bundleMetrics;
    } catch (error) {
      console.warn('[Performance] Bundle size measurement failed:', error);
    }
  }

  // Lighthouse-style mobile performance measurement
  measureMobilePerformance() {
    return new Promise((resolve) => {
      const startTime = performance.now();
      
      // Simulate mobile throttling conditions for measurement
      const mobileMetrics = {
        networkSpeed: this.measureNetworkSpeed(),
        deviceMemory: (navigator as any).deviceMemory || 'unknown',
        hardwareConcurrency: navigator.hardwareConcurrency || 'unknown',
        connectionType: (navigator as any).connection?.effectiveType || 'unknown'
      };
      
      // Calculate mobile performance score based on Web Vitals
      const performanceScore = this.calculateMobileScore();
      
      console.log(`[Performance] Mobile Analysis:
📱 Device Memory: ${mobileMetrics.deviceMemory}GB
🏃 CPU Cores: ${mobileMetrics.hardwareConcurrency}
🌐 Network: ${mobileMetrics.connectionType}
📊 Performance Score: ${performanceScore}/100`);
      
      (this.metrics as any).mobileMetrics = {
        ...mobileMetrics,
        performanceScore,
        measurementTime: performance.now() - startTime
      };
      
      this.notifyObservers();
      resolve(performanceScore);
    });
  }

  private calculateMobileScore(): number {
    let score = 100;
    
    // Deduct points based on Web Vitals
    if (this.metrics.fcp && this.metrics.fcp > 1500) score -= 15;
    if (this.metrics.lcp && this.metrics.lcp > 2500) score -= 20;
    if (this.metrics.inp && this.metrics.inp > 200) score -= 15;
    if (this.metrics.cls && this.metrics.cls > 0.1) score -= 15;
    if (this.metrics.bundleSize && this.metrics.bundleSize > 500) score -= 10;
    if (this.metrics.memoryUsage && this.metrics.memoryUsage > 100) score -= 10;
    
    return Math.max(0, Math.min(100, score));
  }

  private measureNetworkSpeed(): string {
    if ('connection' in navigator) {
      const connection = (navigator as any).connection;
      return connection.effectiveType || 'unknown';
    }
    return 'unknown';
  }

  // Persistent metrics storage and regression detection
  storeMetrics() {
    if (typeof localStorage === 'undefined') return;
    
    try {
      const timestamp = Date.now();
      const metricsWithTimestamp = {
        ...this.metrics,
        timestamp,
        url: window.location.pathname
      };
      
      // Store current metrics
      localStorage.setItem('prismmail-performance-latest', JSON.stringify(metricsWithTimestamp));
      
      // Store historical data (last 10 measurements)
      const historyKey = 'prismmail-performance-history';
      const history = JSON.parse(localStorage.getItem(historyKey) || '[]');
      history.push(metricsWithTimestamp);
      
      // Keep only last 10 measurements
      if (history.length > 10) {
        history.splice(0, history.length - 10);
      }
      
      localStorage.setItem(historyKey, JSON.stringify(history));
      
      // Check for regressions
      this.detectRegressions(history);
      
    } catch (error) {
      console.warn('[Performance] Failed to store metrics:', error);
    }
  }

  private detectRegressions(history: any[]) {
    if (history.length < 2) return;
    
    const current = history[history.length - 1];
    const previous = history[history.length - 2];
    
    // Check for significant regressions (>20% worse)
    const regressions = [];
    
    if (current.fcp && previous.fcp && current.fcp > previous.fcp * 1.2) {
      regressions.push(`FCP regression: ${previous.fcp.toFixed(2)}ms → ${current.fcp.toFixed(2)}ms`);
    }
    
    if (current.lcp && previous.lcp && current.lcp > previous.lcp * 1.2) {
      regressions.push(`LCP regression: ${previous.lcp.toFixed(2)}ms → ${current.lcp.toFixed(2)}ms`);
    }
    
    if (current.bundleSize && previous.bundleSize && current.bundleSize > previous.bundleSize * 1.2) {
      regressions.push(`Bundle size regression: ${previous.bundleSize.toFixed(2)}KB → ${current.bundleSize.toFixed(2)}KB`);
    }
    
    if (regressions.length > 0) {
      console.warn('[Performance] Regressions detected:', regressions);
      
      // Report to analytics if available
      if ('gtag' in window) {
        (window as any).gtag('event', 'performance_regression', {
          regressions: regressions.join(', ')
        });
      }
    }
  }

  // Generate comprehensive performance report
  generateReport(): string {
    const metrics = this.getMetrics();
    const bundleDetails = (metrics as any).bundleDetails;
    const mobileMetrics = (metrics as any).mobileMetrics;
    
    const formatMetric = (name: string, value: number | undefined, unit: string, target: number) => {
      if (value === undefined) return `${name}: Not measured`;
      const status = value <= target ? '✅' : '⚠️';
      const percentage = target > 0 ? ` (${(value/target*100).toFixed(1)}% of target)` : '';
      return `${status} ${name}: ${value.toFixed(2)}${unit} (target: ${target}${unit})${percentage}`;
    };

    const report = [
      '📊 PrismMail Performance Report',
      '================================',
      '',
      '🎯 Core Web Vitals:',
      formatMetric('First Contentful Paint', metrics.fcp, 'ms', 1500),
      formatMetric('Largest Contentful Paint', metrics.lcp, 'ms', 2500),
      formatMetric('Interaction to Next Paint', metrics.inp, 'ms', 200),
      formatMetric('Cumulative Layout Shift', metrics.cls, '', 0.1),
      formatMetric('Time to First Byte', metrics.ttfb, 'ms', 800),
      '',
      '📱 Mobile Performance:',
      formatMetric('Bundle Size (Gzipped)', metrics.bundleSize, 'KB', 500),
      formatMetric('Memory Usage', metrics.memoryUsage, 'MB', 100),
      formatMetric('Email List Render', metrics.emailListRenderTime, 'ms', 100),
      formatMetric('Search Time', metrics.searchTime, 'ms', 200)
    ];

    if (bundleDetails) {
      report.push('', '📦 Bundle Analysis:');
      report.push(`JavaScript: ${bundleDetails.jsSize.toFixed(2)}KB`);
      report.push(`CSS: ${bundleDetails.cssSize.toFixed(2)}KB`);
      report.push(`Total Gzipped: ${bundleDetails.gzippedSize.toFixed(2)}KB`);
    }

    if (mobileMetrics) {
      report.push('', '📱 Mobile Device Info:');
      report.push(`Device Memory: ${mobileMetrics.deviceMemory}GB`);
      report.push(`CPU Cores: ${mobileMetrics.hardwareConcurrency}`);
      report.push(`Network: ${mobileMetrics.connectionType}`);
      report.push(`Performance Score: ${mobileMetrics.performanceScore}/100`);
    }

    report.push('', `Generated at: ${new Date().toISOString()}`);
    
    return report.join('\n');
  }

  // Enable/disable monitoring
  setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
  }
}

// Global performance monitor instance
export const performanceMonitor = new PerformanceMonitor();

// Hook for React components
export function usePerformanceMonitor() {
  const [metrics, setMetrics] = useState<PerformanceMetrics>({});

  React.useEffect(() => {
    const unsubscribe = performanceMonitor.subscribe(setMetrics);
    
    // Get initial metrics
    setMetrics(performanceMonitor.getMetrics());
    
    return unsubscribe;
  }, []);

  return {
    metrics,
    measureEmailListRender: performanceMonitor.measureEmailListRender.bind(performanceMonitor),
    measureSearchTime: performanceMonitor.measureSearchTime.bind(performanceMonitor),
    generateReport: performanceMonitor.generateReport.bind(performanceMonitor)
  };
}

// Initialize bundle size measurement after app loads
setTimeout(() => {
  performanceMonitor.measureBundleSize();
}, 1000);

export default performanceMonitor;