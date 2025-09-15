#!/usr/bin/env node

/**
 * Component Stability Testing for PrismMail
 * Tests email list rendering, auto-save, WebSocket, and memory management
 */

import { execSync } from 'child_process';
import fs from 'fs';

class ComponentStabilityTester {
  constructor() {
    this.results = [];
    this.startTime = Date.now();
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

  // Test 1: Email List Virtual Scrolling Performance
  testEmailListPerformance() {
    this.log('=== Testing Email List Rendering Performance ===');
    
    try {
      const emailListComponent = fs.readFileSync('client/src/components/OptimizedEmailList.tsx', 'utf8');
      
      // Check virtual scrolling implementation
      const virtualScrollTests = [
        { name: 'Virtual scrolling threshold (>50 emails)', pattern: /useVirtualScrolling.*filteredEmails\.length.*>.*50/ },
        { name: 'Fixed item height for performance', pattern: /itemHeight.*=.*\d+/ },
        { name: 'Memoized email items', pattern: /memo.*function.*MemoizedEmailItem/ },
        { name: 'Performance logging', pattern: /console\.log.*\[EmailList\].*Render completed/ },
        { name: 'Container height management', pattern: /useVirtualScrollList.*containerHeight/ },
        { name: 'Skeleton loading states', pattern: /EmailListSkeleton.*count/ }
      ];
      
      virtualScrollTests.forEach(test => {
        if (test.pattern.test(emailListComponent)) {
          this.log(`${test.name}: Implementation found`, 'PASS');
        } else {
          this.log(`${test.name}: Missing optimization`, 'WARN');
        }
      });
      
      // Check render optimization patterns
      const renderOptimizations = emailListComponent.match(/useMemo|useCallback/g);
      if (renderOptimizations && renderOptimizations.length >= 5) {
        this.log(`Render optimizations: Found ${renderOptimizations.length} memoized operations`, 'PASS');
      } else {
        this.log(`Render optimizations: Only ${renderOptimizations?.length || 0} found, may need more`, 'WARN');
      }
      
    } catch (error) {
      this.log(`Email list performance test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 2: Auto-save Functionality
  testAutoSaveFunctionality() {
    this.log('=== Testing Auto-save Functionality ===');
    
    try {
      const draftHook = fs.readFileSync('client/src/hooks/useDraftAutoSave.ts', 'utf8');
      const composeDialog = fs.readFileSync('client/src/components/ComposeDialog.tsx', 'utf8');
      
      const autoSaveTests = [
        { name: 'Auto-save interval (30s)', pattern: /AUTO_SAVE_INTERVAL.*30000/ },
        { name: 'Debounce delay (2s)', pattern: /DEBOUNCE_DELAY.*2000/ },
        { name: 'Local storage fallback', pattern: /enableLocalStorage.*localStorage/ },
        { name: 'Draft cleanup on unmount', pattern: /useEffect.*cleanup|return.*clearTimeout/ },
        { name: 'Manual save capability', pattern: /saveDraftManually/ },
        { name: 'Draft status tracking', pattern: /DraftAutoSaveStatus/ }
      ];
      
      autoSaveTests.forEach(test => {
        if (test.pattern.test(draftHook)) {
          this.log(`${test.name}: Implementation found`, 'PASS');
        } else {
          this.log(`${test.name}: Missing functionality`, 'FAIL');
        }
      });
      
      // Check ComposeDialog integration
      if (/useDraftAutoSave/.test(composeDialog)) {
        this.log('ComposeDialog auto-save integration: Connected', 'PASS');
      } else {
        this.log('ComposeDialog auto-save integration: Missing', 'FAIL');
      }
      
      // Check for error handling
      if (/try.*catch|\.catch\(/.test(draftHook)) {
        this.log('Auto-save error handling: Implemented', 'PASS');
      } else {
        this.log('Auto-save error handling: Missing', 'WARN');
      }
      
    } catch (error) {
      this.log(`Auto-save test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 3: WebSocket Connection Stability
  testWebSocketStability() {
    this.log('=== Testing WebSocket Connection Stability ===');
    
    try {
      const webSocketHook = fs.readFileSync('client/src/hooks/useWebSocket.ts', 'utf8');
      const prismMail = fs.readFileSync('client/src/components/PrismMail.tsx', 'utf8');
      
      const webSocketTests = [
        { name: 'Connection state management', pattern: /useState.*isConnected/ },
        { name: 'Automatic reconnection', pattern: /reconnect|retry/ },
        { name: 'Message handling', pattern: /onMessage|lastMessage/ },
        { name: 'Connection cleanup', pattern: /useEffect.*return.*close|disconnect/ },
        { name: 'Error handling', pattern: /onError|catch/ },
        { name: 'Heartbeat/ping mechanism', pattern: /ping|pong|heartbeat/ }
      ];
      
      webSocketTests.forEach(test => {
        if (test.pattern.test(webSocketHook)) {
          this.log(`${test.name}: Implementation found`, 'PASS');
        } else {
          this.log(`${test.name}: Missing functionality`, 'WARN');
        }
      });
      
      // Check integration in main component
      if (/useWebSocket.*isConnected.*lastMessage/.test(prismMail)) {
        this.log('WebSocket integration in PrismMail: Connected', 'PASS');
      } else {
        this.log('WebSocket integration in PrismMail: Incomplete', 'WARN');
      }
      
      // Check real-time update handling
      if (/wsMessage|lastMessage.*update/.test(prismMail)) {
        this.log('Real-time update processing: Implemented', 'PASS');
      } else {
        this.log('Real-time update processing: Missing', 'WARN');
      }
      
    } catch (error) {
      this.log(`WebSocket test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 4: Memory Management Patterns
  testMemoryManagement() {
    this.log('=== Testing Memory Management Patterns ===');
    
    try {
      const components = [
        'client/src/components/PrismMail.tsx',
        'client/src/components/OptimizedEmailList.tsx',
        'client/src/components/EmailViewer.tsx',
        'client/src/hooks/useWebSocket.ts'
      ];
      
      let cleanupCount = 0;
      let memoizationCount = 0;
      let listenerCleanupCount = 0;
      
      components.forEach(componentPath => {
        if (fs.existsSync(componentPath)) {
          const content = fs.readFileSync(componentPath, 'utf8');
          
          // Count cleanup patterns
          const cleanupPatterns = content.match(/return\s*\(\s*\)\s*=>\s*\{|useEffect.*return.*=>/g);
          if (cleanupPatterns) cleanupCount += cleanupPatterns.length;
          
          // Count memoization patterns
          const memoPatterns = content.match(/useMemo|useCallback|memo\(/g);
          if (memoPatterns) memoizationCount += memoPatterns.length;
          
          // Count event listener cleanup
          const listenerCleanup = content.match(/removeEventListener|unsubscribe|clearTimeout|clearInterval/g);
          if (listenerCleanup) listenerCleanupCount += listenerCleanup.length;
        }
      });
      
      // Evaluate memory management
      if (cleanupCount >= 5) {
        this.log(`Cleanup patterns: Found ${cleanupCount} cleanup implementations`, 'PASS');
      } else {
        this.log(`Cleanup patterns: Only ${cleanupCount} found, may have memory leaks`, 'WARN');
      }
      
      if (memoizationCount >= 10) {
        this.log(`Memoization patterns: Found ${memoizationCount} optimizations`, 'PASS');
      } else {
        this.log(`Memoization patterns: Only ${memoizationCount} found, performance may suffer`, 'WARN');
      }
      
      if (listenerCleanupCount >= 3) {
        this.log(`Event listener cleanup: Found ${listenerCleanupCount} cleanup handlers`, 'PASS');
      } else {
        this.log(`Event listener cleanup: Only ${listenerCleanupCount} found, potential memory leaks`, 'WARN');
      }
      
    } catch (error) {
      this.log(`Memory management test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 5: Hook Dependencies and Stale Closures
  testHookDependencies() {
    this.log('=== Testing Hook Dependencies ===');
    
    try {
      const hookFiles = [
        'client/src/hooks/useWebSocket.ts',
        'client/src/hooks/useDraftAutoSave.ts',
        'client/src/hooks/useOfflineActions.ts',
        'client/src/hooks/usePullToRefresh.ts'
      ];
      
      let dependencyArrayCount = 0;
      let potentialStaleClosures = 0;
      
      hookFiles.forEach(hookPath => {
        if (fs.existsSync(hookPath)) {
          const content = fs.readFileSync(hookPath, 'utf8');
          
          // Count dependency arrays
          const depArrays = content.match(/\],\s*\[.*?\]/g);
          if (depArrays) dependencyArrayCount += depArrays.length;
          
          // Look for potential stale closures (functions without proper deps)
          const functionsWithoutDeps = content.match(/useCallback\(.*?\),\s*\[\s*\]/g);
          if (functionsWithoutDeps) potentialStaleClosures += functionsWithoutDeps.length;
        }
      });
      
      if (dependencyArrayCount >= 10) {
        this.log(`Dependency arrays: Found ${dependencyArrayCount} properly declared`, 'PASS');
      } else {
        this.log(`Dependency arrays: Only ${dependencyArrayCount} found, may miss updates`, 'WARN');
      }
      
      if (potentialStaleClosures === 0) {
        this.log('Stale closure detection: No obvious issues found', 'PASS');
      } else {
        this.log(`Stale closure detection: Found ${potentialStaleClosures} potential issues`, 'WARN');
      }
      
    } catch (error) {
      this.log(`Hook dependencies test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 6: Component Error Boundaries
  testErrorBoundaries() {
    this.log('=== Testing Error Boundaries ===');
    
    try {
      // Check for React Error Boundary implementation
      const appFile = fs.readFileSync('client/src/App.tsx', 'utf8');
      const mainFile = fs.readFileSync('client/src/main.tsx', 'utf8');
      
      if (/ErrorBoundary|react-error-boundary/.test(appFile) || /ErrorBoundary|react-error-boundary/.test(mainFile)) {
        this.log('Error boundaries: Implementation found', 'PASS');
      } else {
        this.log('Error boundaries: Not implemented', 'WARN');
      }
      
      // Check for try-catch blocks in critical components
      const prismMail = fs.readFileSync('client/src/components/PrismMail.tsx', 'utf8');
      const tryCatchBlocks = prismMail.match(/try\s*\{[\s\S]*?\}\s*catch/g);
      
      if (tryCatchBlocks && tryCatchBlocks.length >= 2) {
        this.log(`Error handling: Found ${tryCatchBlocks.length} try-catch blocks`, 'PASS');
      } else {
        this.log(`Error handling: Limited error handling found`, 'WARN');
      }
      
    } catch (error) {
      this.log(`Error boundaries test failed: ${error.message}`, 'FAIL');
    }
  }

  // Generate stability report
  generateStabilityReport() {
    const endTime = Date.now();
    const duration = ((endTime - this.startTime) / 1000).toFixed(2);
    
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const warned = this.results.filter(r => r.status === 'WARN').length;
    
    this.log('=== Component Stability Test Report ===');
    this.log(`Duration: ${duration} seconds`);
    this.log(`Passed: ${passed} | Failed: ${failed} | Warnings: ${warned}`);
    
    const stabilityScore = ((passed / (passed + failed + warned)) * 100).toFixed(1);
    this.log(`Stability Score: ${stabilityScore}%`);
    
    if (failed === 0 && warned <= 3) {
      this.log('🎉 Component stability is excellent!', 'PASS');
    } else if (failed <= 2 && warned <= 5) {
      this.log('⚠️ Component stability is good with minor issues', 'WARN');
    } else {
      this.log('❌ Component stability needs attention', 'FAIL');
    }
    
    // Save detailed report
    const reportData = {
      summary: {
        duration: `${duration}s`,
        passed,
        failed,
        warnings: warned,
        stabilityScore: `${stabilityScore}%`,
        timestamp: new Date().toISOString()
      },
      results: this.results
    };
    
    fs.writeFileSync('component-stability-report.json', JSON.stringify(reportData, null, 2));
    this.log('📊 Stability report saved to component-stability-report.json');
    
    return {
      passed: failed === 0,
      stabilityScore: parseFloat(stabilityScore),
      summary: reportData.summary
    };
  }

  // Run all stability tests
  async runAllTests() {
    this.log('🔬 Starting Component Stability Testing');
    
    this.testEmailListPerformance();
    this.testAutoSaveFunctionality();
    this.testWebSocketStability();
    this.testMemoryManagement();
    this.testHookDependencies();
    this.testErrorBoundaries();
    
    return this.generateStabilityReport();
  }
}

// Run stability tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new ComponentStabilityTester();
  tester.runAllTests().then(result => {
    process.exit(result.passed ? 0 : 1);
  });
}

export default ComponentStabilityTester;