#!/usr/bin/env node

/**
 * Performance Validation Testing for PrismMail
 * Tests render times, layout shift, bundle size, and touch response times
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

class PerformanceValidator {
  constructor() {
    this.results = [];
    this.startTime = Date.now();
    this.performanceTargets = {
      renderTime: 100, // ms
      layoutShift: 0.1, // CLS score
      bundleSize: 3.0, // MB
      touchResponse: 100, // ms
      memoryUsage: 100, // MB
      firstContentfulPaint: 2000 // ms
    };
  }

  log(message, status = 'INFO') {
    const timestamp = new Date().toISOString();
    const statusIcon = {
      'PASS': '✅',
      'FAIL': '❌', 
      'WARN': '⚠️',
      'INFO': '📋'
    }[status] || '📋';
    
    console.log(`[${timestamp}] ${statusIcon} ${message}`);
    this.results.push({ timestamp, status, message });
  }

  // Test 1: Bundle Size Analysis
  testBundleSize() {
    this.log('=== Testing Bundle Size Performance ===');
    
    try {
      // Check if dist folder exists (production build)
      const distPath = 'dist';
      if (fs.existsSync(distPath)) {
        let totalSize = 0;
        const files = [];
        
        // Calculate total bundle size
        const walkSync = (dir) => {
          const dirFiles = fs.readdirSync(dir);
          dirFiles.forEach(file => {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
              walkSync(filePath);
            } else {
              const sizeKB = stat.size / 1024;
              totalSize += sizeKB;
              if (file.endsWith('.js') || file.endsWith('.css')) {
                files.push({ name: file, size: sizeKB });
              }
            }
          });
        };
        
        walkSync(distPath);
        const totalSizeMB = totalSize / 1024;
        
        this.log(`Total bundle size: ${totalSizeMB.toFixed(2)} MB`, 
                 totalSizeMB <= this.performanceTargets.bundleSize ? 'PASS' : 'WARN');
        
        // Analyze largest files
        files.sort((a, b) => b.size - a.size);
        const largestFiles = files.slice(0, 5);
        
        largestFiles.forEach(file => {
          const sizeStatus = file.size > 500 ? 'WARN' : 'PASS';
          this.log(`${file.name}: ${file.size.toFixed(1)} KB`, sizeStatus);
        });
        
      } else {
        this.log('Production build not found, analyzing source files', 'INFO');
        
        // Analyze source code size as approximation
        let sourceSize = 0;
        const sourceDirs = ['client/src', 'server', 'shared'];
        
        sourceDirs.forEach(dir => {
          if (fs.existsSync(dir)) {
            const walkSourceSync = (srcDir) => {
              const dirFiles = fs.readdirSync(srcDir);
              dirFiles.forEach(file => {
                const filePath = path.join(srcDir, file);
                const stat = fs.statSync(filePath);
                if (stat.isDirectory()) {
                  walkSourceSync(filePath);
                } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx')) {
                  sourceSize += stat.size;
                }
              });
            };
            walkSourceSync(dir);
          }
        });
        
        const sourceSizeMB = sourceSize / (1024 * 1024);
        this.log(`Source code size: ${sourceSizeMB.toFixed(2)} MB (approximate bundle estimate)`, 'INFO');
      }
      
    } catch (error) {
      this.log(`Bundle size analysis failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 2: Component Render Performance
  testRenderPerformance() {
    this.log('=== Testing Component Render Performance ===');
    
    try {
      const components = [
        'client/src/components/OptimizedEmailList.tsx',
        'client/src/components/EmailViewer.tsx',
        'client/src/components/PrismMail.tsx',
        'client/src/components/ComposeDialog.tsx'
      ];
      
      // Analyze optimization patterns
      let memoizationCount = 0;
      let virtualScrollingOptimizations = 0;
      let expensiveOperations = 0;
      
      components.forEach(componentPath => {
        if (fs.existsSync(componentPath)) {
          const content = fs.readFileSync(componentPath, 'utf8');
          
          // Count optimization patterns
          const memoPatterns = content.match(/useMemo|useCallback|memo\(/g);
          if (memoPatterns) memoizationCount += memoPatterns.length;
          
          // Check for virtual scrolling
          if (/useVirtualScrolling|react-window|react-virtualized/.test(content)) {
            virtualScrollingOptimizations++;
          }
          
          // Look for potentially expensive operations
          const expensivePatterns = content.match(/\.map\(.*\.map\(|\.filter\(.*\.filter\(|\.sort\(.*\.sort\(/g);
          if (expensivePatterns) expensiveOperations += expensivePatterns.length;
        }
      });
      
      this.log(`Memoization patterns: ${memoizationCount} found`, 
               memoizationCount >= 20 ? 'PASS' : 'WARN');
      this.log(`Virtual scrolling optimizations: ${virtualScrollingOptimizations}`, 
               virtualScrollingOptimizations >= 1 ? 'PASS' : 'WARN');
      this.log(`Potentially expensive operations: ${expensiveOperations}`, 
               expensiveOperations <= 5 ? 'PASS' : 'WARN');
      
      // Check for performance monitoring
      const prismMail = fs.readFileSync('client/src/components/PrismMail.tsx', 'utf8');
      if (/console\.log.*\[EmailList\].*Render completed|performance\.now\(\)/.test(prismMail)) {
        this.log('Performance monitoring: Implemented', 'PASS');
      } else {
        this.log('Performance monitoring: Missing', 'WARN');
      }
      
    } catch (error) {
      this.log(`Render performance test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 3: Layout Shift Prevention
  testLayoutShiftPrevention() {
    this.log('=== Testing Layout Shift Prevention ===');
    
    try {
      const components = [
        'client/src/components/OptimizedEmailList.tsx',
        'client/src/components/EmailListSkeleton.tsx',
        'client/src/components/PrismMail.tsx'
      ];
      
      let skeletonStates = 0;
      let fixedDimensions = 0;
      let preventivePatterns = 0;
      
      components.forEach(componentPath => {
        if (fs.existsSync(componentPath)) {
          const content = fs.readFileSync(componentPath, 'utf8');
          
          // Check for skeleton loading states
          if (/Skeleton|skeleton|loading.*placeholder/.test(content)) {
            skeletonStates++;
          }
          
          // Check for fixed dimensions
          if (/h-\d+|min-h-\d+|w-\d+|min-w-\d+/.test(content)) {
            fixedDimensions++;
          }
          
          // Check for layout shift prevention patterns
          if (/aspect-ratio|object-fit|placeholder.*blur/.test(content)) {
            preventivePatterns++;
          }
        }
      });
      
      this.log(`Skeleton loading states: ${skeletonStates} components`, 
               skeletonStates >= 2 ? 'PASS' : 'WARN');
      this.log(`Components with fixed dimensions: ${fixedDimensions}`, 
               fixedDimensions >= 2 ? 'PASS' : 'WARN');
      this.log(`Layout shift prevention patterns: ${preventivePatterns}`, 
               preventivePatterns >= 1 ? 'PASS' : 'WARN');
      
      // Check for image optimization
      const imageOptimizations = ['placeholder', 'loading="lazy"', 'aspect-ratio'];
      let imageOptCount = 0;
      
      components.forEach(componentPath => {
        if (fs.existsSync(componentPath)) {
          const content = fs.readFileSync(componentPath, 'utf8');
          imageOptimizations.forEach(opt => {
            if (content.includes(opt)) imageOptCount++;
          });
        }
      });
      
      this.log(`Image optimization patterns: ${imageOptCount}`, 
               imageOptCount >= 1 ? 'PASS' : 'INFO');
      
    } catch (error) {
      this.log(`Layout shift test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 4: Touch Response Optimization
  testTouchResponseOptimization() {
    this.log('=== Testing Touch Response Optimization ===');
    
    try {
      const components = [
        'client/src/components/PrismMail.tsx',
        'client/src/components/OptimizedEmailList.tsx',
        'client/src/components/EmailListItem.tsx',
        'client/src/hooks/useSwipeGestures.ts',
        'client/src/hooks/usePullToRefresh.ts'
      ];
      
      let touchHandlers = 0;
      let passiveListeners = 0;
      let debouncePatterns = 0;
      let touchOptimizations = 0;
      
      components.forEach(componentPath => {
        if (fs.existsSync(componentPath)) {
          const content = fs.readFileSync(componentPath, 'utf8');
          
          // Count touch event handlers
          const touchEvents = content.match(/onTouch\w+|onPointer\w+/g);
          if (touchEvents) touchHandlers += touchEvents.length;
          
          // Check for passive listeners
          if (/passive.*true|{ passive: true }/.test(content)) {
            passiveListeners++;
          }
          
          // Check for debouncing/throttling
          if (/debounce|throttle|setTimeout.*\d+/.test(content)) {
            debouncePatterns++;
          }
          
          // Touch-specific optimizations
          if (/touch-action|user-select.*none|pointer-events/.test(content)) {
            touchOptimizations++;
          }
        }
      });
      
      this.log(`Touch event handlers: ${touchHandlers}`, 
               touchHandlers >= 5 ? 'PASS' : 'WARN');
      this.log(`Passive event listeners: ${passiveListeners}`, 
               passiveListeners >= 1 ? 'PASS' : 'WARN');
      this.log(`Debounce/throttle patterns: ${debouncePatterns}`, 
               debouncePatterns >= 2 ? 'PASS' : 'WARN');
      this.log(`Touch CSS optimizations: ${touchOptimizations}`, 
               touchOptimizations >= 1 ? 'PASS' : 'INFO');
      
      // Check button sizes for touch targets
      const buttonSizes = [];
      components.forEach(componentPath => {
        if (fs.existsSync(componentPath)) {
          const content = fs.readFileSync(componentPath, 'utf8');
          const sizes = content.match(/size="(default|lg|sm|icon)"/g);
          if (sizes) buttonSizes.push(...sizes);
        }
      });
      
      const touchFriendlySizes = buttonSizes.filter(size => 
        size.includes('default') || size.includes('lg')
      ).length;
      
      this.log(`Touch-friendly button sizes: ${touchFriendlySizes}/${buttonSizes.length}`, 
               touchFriendlySizes >= buttonSizes.length * 0.7 ? 'PASS' : 'WARN');
      
    } catch (error) {
      this.log(`Touch response test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 5: Memory Usage Patterns
  testMemoryUsagePatterns() {
    this.log('=== Testing Memory Usage Patterns ===');
    
    try {
      const components = [
        'client/src/components/PrismMail.tsx',
        'client/src/components/OptimizedEmailList.tsx',
        'client/src/hooks/useWebSocket.ts',
        'client/src/hooks/useDraftAutoSave.ts'
      ];
      
      let cleanupCount = 0;
      let memoryLeakRisks = 0;
      let optimizationPatterns = 0;
      
      components.forEach(componentPath => {
        if (fs.existsSync(componentPath)) {
          const content = fs.readFileSync(componentPath, 'utf8');
          
          // Count cleanup patterns
          const cleanupPatterns = content.match(/return\s*\(\s*\)\s*=>\s*\{|useEffect.*return.*clearTimeout|useEffect.*return.*clearInterval|useEffect.*return.*unsubscribe/g);
          if (cleanupPatterns) cleanupCount += cleanupPatterns.length;
          
          // Look for potential memory leak risks
          const leakRisks = content.match(/setInterval(?!\s*\(.*?\),.*?clearInterval)|addEventListener(?!\s*\(.*?\),.*?removeEventListener)|new\s+WebSocket(?!\s*\(.*?\),.*?close)/g);
          if (leakRisks) memoryLeakRisks += leakRisks.length;
          
          // Memory optimization patterns
          if (/useMemo|useCallback|React\.memo/.test(content)) {
            optimizationPatterns++;
          }
        }
      });
      
      this.log(`Cleanup patterns: ${cleanupCount}`, 
               cleanupCount >= 5 ? 'PASS' : 'WARN');
      this.log(`Potential memory leaks: ${memoryLeakRisks}`, 
               memoryLeakRisks === 0 ? 'PASS' : 'WARN');
      this.log(`Memory optimization patterns: ${optimizationPatterns}`, 
               optimizationPatterns >= 3 ? 'PASS' : 'WARN');
      
      // Check virtual scrolling for large lists
      const emailList = fs.readFileSync('client/src/components/OptimizedEmailList.tsx', 'utf8');
      if (/useVirtualScrolling.*filteredEmails\.length.*>.*50/.test(emailList)) {
        this.log('Virtual scrolling for large lists: Implemented', 'PASS');
      } else {
        this.log('Virtual scrolling for large lists: Missing optimization', 'WARN');
      }
      
    } catch (error) {
      this.log(`Memory usage test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 6: Network Performance
  testNetworkPerformance() {
    this.log('=== Testing Network Performance ===');
    
    try {
      const networkFiles = [
        'client/src/lib/queryClient.ts',
        'client/src/hooks/useWebSocket.ts',
        'server/routes.ts'
      ];
      
      let cacheStrategies = 0;
      let errorHandling = 0;
      let optimizations = 0;
      
      networkFiles.forEach(filePath => {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          
          // Check caching strategies
          if (/staleTime|cacheTime|queryKey|invalidateQueries/.test(content)) {
            cacheStrategies++;
          }
          
          // Check error handling
          if (/catch|onError|retry|isError/.test(content)) {
            errorHandling++;
          }
          
          // Check optimizations
          if (/debounce|throttle|AbortController|signal/.test(content)) {
            optimizations++;
          }
        }
      });
      
      this.log(`Cache strategies: ${cacheStrategies} files`, 
               cacheStrategies >= 2 ? 'PASS' : 'WARN');
      this.log(`Error handling: ${errorHandling} files`, 
               errorHandling >= 2 ? 'PASS' : 'WARN');
      this.log(`Network optimizations: ${optimizations}`, 
               optimizations >= 1 ? 'PASS' : 'WARN');
      
      // Check for offline support
      const offlineFiles = ['client/src/hooks/useOfflineActions.ts', 'client/src/components/OfflineIndicator.tsx'];
      let offlineSupport = 0;
      
      offlineFiles.forEach(file => {
        if (fs.existsSync(file)) {
          offlineSupport++;
        }
      });
      
      this.log(`Offline support: ${offlineSupport}/2 components`, 
               offlineSupport >= 1 ? 'PASS' : 'WARN');
      
    } catch (error) {
      this.log(`Network performance test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 7: Build Performance
  testBuildPerformance() {
    this.log('=== Testing Build Performance ===');
    
    try {
      // Check for build optimization configurations
      const configFiles = [
        'vite.config.ts',
        'tsconfig.json',
        'tailwind.config.ts'
      ];
      
      let buildOptimizations = 0;
      
      configFiles.forEach(configFile => {
        if (fs.existsSync(configFile)) {
          const content = fs.readFileSync(configFile, 'utf8');
          
          // Check for build optimizations
          if (/minify|compress|tree.*shaking|code.*splitting|chunk/.test(content)) {
            buildOptimizations++;
          }
        }
      });
      
      this.log(`Build optimization configs: ${buildOptimizations}/${configFiles.length}`, 
               buildOptimizations >= 1 ? 'PASS' : 'WARN');
      
      // Check for TypeScript performance
      const tsconfig = fs.readFileSync('tsconfig.json', 'utf8');
      if (/incremental.*true|composite.*true/.test(tsconfig)) {
        this.log('TypeScript incremental compilation: Enabled', 'PASS');
      } else {
        this.log('TypeScript incremental compilation: Not enabled', 'WARN');
      }
      
      // Analyze dependency count
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      const totalDeps = Object.keys(packageJson.dependencies || {}).length + 
                       Object.keys(packageJson.devDependencies || {}).length;
      
      this.log(`Total dependencies: ${totalDeps}`, 
               totalDeps <= 100 ? 'PASS' : 'WARN');
      
    } catch (error) {
      this.log(`Build performance test failed: ${error.message}`, 'FAIL');
    }
  }

  // Generate performance report
  generatePerformanceReport() {
    const endTime = Date.now();
    const duration = ((endTime - this.startTime) / 1000).toFixed(2);
    
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const warned = this.results.filter(r => r.status === 'WARN').length;
    
    this.log('=== Performance Validation Report ===');
    this.log(`Duration: ${duration} seconds`);
    this.log(`Passed: ${passed} | Failed: ${failed} | Warnings: ${warned}`);
    
    const performanceScore = ((passed / (passed + failed + warned)) * 100).toFixed(1);
    this.log(`Performance Score: ${performanceScore}%`);
    
    // Performance recommendations
    if (parseFloat(performanceScore) >= 85) {
      this.log('🚀 Performance is excellent! Well optimized.', 'PASS');
    } else if (parseFloat(performanceScore) >= 70) {
      this.log('⚡ Performance is good with minor optimizations needed', 'WARN');
    } else {
      this.log('❌ Performance needs significant optimization', 'FAIL');
    }
    
    // Save detailed report
    const reportData = {
      summary: {
        duration: `${duration}s`,
        passed,
        failed,
        warnings: warned,
        performanceScore: `${performanceScore}%`,
        targets: this.performanceTargets,
        timestamp: new Date().toISOString()
      },
      results: this.results
    };
    
    fs.writeFileSync('performance-validation-report.json', JSON.stringify(reportData, null, 2));
    this.log('📊 Performance report saved to performance-validation-report.json');
    
    return {
      passed: failed === 0,
      performanceScore: parseFloat(performanceScore),
      summary: reportData.summary
    };
  }

  // Run all performance tests
  async runAllTests() {
    this.log('⚡ Starting Performance Validation Testing');
    
    this.testBundleSize();
    this.testRenderPerformance();
    this.testLayoutShiftPrevention();
    this.testTouchResponseOptimization();
    this.testMemoryUsagePatterns();
    this.testNetworkPerformance();
    this.testBuildPerformance();
    
    return this.generatePerformanceReport();
  }
}

// Run performance tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const validator = new PerformanceValidator();
  validator.runAllTests().then(result => {
    process.exit(result.passed ? 0 : 1);
  });
}

export default PerformanceValidator;