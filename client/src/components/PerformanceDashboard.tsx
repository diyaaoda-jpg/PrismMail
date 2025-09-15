import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { RefreshCw, Activity, Zap, Gauge, Download } from 'lucide-react';
import { performanceMonitor } from '@/lib/performanceMonitor';
import { cn } from '@/lib/utils';

interface PerformanceMetrics {
  fcp?: number;
  lcp?: number;
  fid?: number;
  cls?: number;
  ttfb?: number;
  bundleSize?: number;
  memoryUsage?: number;
  emailListRenderTime?: number;
  searchTime?: number;
  bundleDetails?: any;
  mobileMetrics?: any;
}

export function PerformanceDashboard() {
  const [metrics, setMetrics] = useState<PerformanceMetrics>({});
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [lastReport, setLastReport] = useState<string>('');

  // Subscribe to performance updates
  useEffect(() => {
    const unsubscribe = performanceMonitor.subscribe(setMetrics);
    
    // Get initial metrics
    setMetrics(performanceMonitor.getMetrics());
    
    return unsubscribe;
  }, []);

  // Initialize comprehensive performance measurement
  const runComprehensiveTest = useCallback(async () => {
    setIsRunningTests(true);
    
    try {
      console.log('🚀 Running comprehensive performance test...');
      
      // 1. Measure bundle size
      performanceMonitor.measureBundleSizeDetailed();
      
      // 2. Measure mobile performance
      await performanceMonitor.measureMobilePerformance();
      
      // 3. Store metrics for regression detection
      performanceMonitor.storeMetrics();
      
      // 4. Generate comprehensive report
      const report = performanceMonitor.generateReport();
      setLastReport(report);
      console.log(report);
      
      // 5. Simulate Lighthouse-style scoring
      const lighthouseScore = calculateLighthouseScore();
      console.log(`🏆 Lighthouse-style Score: ${lighthouseScore}/100`);
      
    } catch (error) {
      console.error('Performance test failed:', error);
    } finally {
      setIsRunningTests(false);
    }
  }, []);

  const calculateLighthouseScore = () => {
    let score = 100;
    
    // Performance scoring based on Lighthouse criteria
    if (metrics.fcp && metrics.fcp > 1500) score -= 15;
    if (metrics.lcp && metrics.lcp > 2500) score -= 20;
    if (metrics.fid && metrics.fid > 100) score -= 15;
    if (metrics.cls && metrics.cls > 0.1) score -= 15;
    if (metrics.bundleSize && metrics.bundleSize > 500) score -= 10;
    if (metrics.memoryUsage && metrics.memoryUsage > 100) score -= 10;
    if (metrics.emailListRenderTime && metrics.emailListRenderTime > 100) score -= 10;
    
    return Math.max(0, Math.min(100, score));
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getMetricStatus = (value: number | undefined, target: number) => {
    if (value === undefined) return 'unknown';
    return value <= target ? 'good' : 'poor';
  };

  const StatusBadge = ({ status }: { status: string }) => (
    <Badge 
      variant={status === 'good' ? 'default' : status === 'poor' ? 'destructive' : 'secondary'}
      className="ml-2"
    >
      {status === 'good' ? '✅' : status === 'poor' ? '⚠️' : '❓'}
    </Badge>
  );

  const lighthouseScore = calculateLighthouseScore();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Performance Dashboard</h1>
          <p className="text-muted-foreground">Real-time performance monitoring and analysis</p>
        </div>
        <Button 
          onClick={runComprehensiveTest} 
          disabled={isRunningTests}
          className="gap-2"
          data-testid="button-run-performance-test"
        >
          {isRunningTests ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Activity className="h-4 w-4" />
          )}
          {isRunningTests ? 'Testing...' : 'Run Test'}
        </Button>
      </div>

      {/* Overall Score */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5" />
            Performance Score
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-6xl font-bold mb-2">
            <span className={getScoreColor(lighthouseScore)}>
              {lighthouseScore}
            </span>
            <span className="text-2xl text-muted-foreground">/100</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Lighthouse-style mobile performance score
          </p>
        </CardContent>
      </Card>

      {/* Core Web Vitals */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Core Web Vitals
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">First Contentful Paint</span>
                <StatusBadge status={getMetricStatus(metrics.fcp, 1500)} />
              </div>
              <div className="text-2xl font-bold">
                {metrics.fcp ? `${metrics.fcp.toFixed(0)}ms` : 'Not measured'}
              </div>
              <div className="text-xs text-muted-foreground">Target: &lt;1500ms</div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Largest Contentful Paint</span>
                <StatusBadge status={getMetricStatus(metrics.lcp, 2500)} />
              </div>
              <div className="text-2xl font-bold">
                {metrics.lcp ? `${metrics.lcp.toFixed(0)}ms` : 'Not measured'}
              </div>
              <div className="text-xs text-muted-foreground">Target: &lt;2500ms</div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">First Input Delay</span>
                <StatusBadge status={getMetricStatus(metrics.fid, 100)} />
              </div>
              <div className="text-2xl font-bold">
                {metrics.fid ? `${metrics.fid.toFixed(0)}ms` : 'Not measured'}
              </div>
              <div className="text-xs text-muted-foreground">Target: &lt;100ms</div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Cumulative Layout Shift</span>
                <StatusBadge status={getMetricStatus(metrics.cls, 0.1)} />
              </div>
              <div className="text-2xl font-bold">
                {metrics.cls ? metrics.cls.toFixed(3) : 'Not measured'}
              </div>
              <div className="text-xs text-muted-foreground">Target: &lt;0.1</div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Bundle Size (Gzipped)</span>
                <StatusBadge status={getMetricStatus(metrics.bundleSize, 500)} />
              </div>
              <div className="text-2xl font-bold">
                {metrics.bundleSize ? `${metrics.bundleSize.toFixed(0)}KB` : 'Not measured'}
              </div>
              <div className="text-xs text-muted-foreground">Target: &lt;500KB</div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Email List Render</span>
                <StatusBadge status={getMetricStatus(metrics.emailListRenderTime, 100)} />
              </div>
              <div className="text-2xl font-bold">
                {metrics.emailListRenderTime ? `${metrics.emailListRenderTime.toFixed(0)}ms` : 'Not measured'}
              </div>
              <div className="text-xs text-muted-foreground">Target: &lt;100ms</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bundle Analysis */}
      {(metrics as any).bundleDetails && (
        <Card>
          <CardHeader>
            <CardTitle>Bundle Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {(metrics as any).bundleDetails.jsSize.toFixed(0)}KB
                </div>
                <div className="text-sm text-muted-foreground">JavaScript</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {(metrics as any).bundleDetails.cssSize.toFixed(0)}KB
                </div>
                <div className="text-sm text-muted-foreground">CSS</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">
                  {(metrics as any).bundleDetails.gzippedSize.toFixed(0)}KB
                </div>
                <div className="text-sm text-muted-foreground">Total Gzipped</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mobile Device Info */}
      {(metrics as any).mobileMetrics && (
        <Card>
          <CardHeader>
            <CardTitle>Mobile Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-lg font-bold">
                  {(metrics as any).mobileMetrics.deviceMemory}GB
                </div>
                <div className="text-sm text-muted-foreground">Device Memory</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold">
                  {(metrics as any).mobileMetrics.hardwareConcurrency}
                </div>
                <div className="text-sm text-muted-foreground">CPU Cores</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold">
                  {(metrics as any).mobileMetrics.connectionType}
                </div>
                <div className="text-sm text-muted-foreground">Network</div>
              </div>
              <div className="text-center">
                <div className={cn("text-lg font-bold", getScoreColor((metrics as any).mobileMetrics.performanceScore))}>
                  {(metrics as any).mobileMetrics.performanceScore}/100
                </div>
                <div className="text-sm text-muted-foreground">Mobile Score</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Button 
              variant="outline" 
              onClick={() => {
                console.log(performanceMonitor.generateReport());
                setLastReport(performanceMonitor.generateReport());
              }}
              className="gap-2"
              data-testid="button-generate-report"
            >
              <Download className="h-4 w-4" />
              Generate Report
            </Button>
            <Button 
              variant="outline"
              onClick={() => performanceMonitor.measureBundleSizeDetailed()}
              className="gap-2"
              data-testid="button-measure-bundle"
            >
              <Activity className="h-4 w-4" />
              Measure Bundle
            </Button>
          </div>
          
          {lastReport && (
            <div className="mt-4">
              <Separator className="mb-4" />
              <h3 className="text-lg font-semibold mb-2">Latest Report</h3>
              <pre className="text-xs bg-muted p-4 rounded-lg overflow-auto max-h-96">
                {lastReport}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}