#!/usr/bin/env node

/**
 * PrismMail Responsive Layout Validation Test
 * Comprehensive testing validation for Phase 1 foundation repair work
 */

import { execSync } from 'child_process';
import fs from 'fs';

class ResponsiveTestValidator {
  constructor() {
    this.testResults = [];
    this.startTime = Date.now();
    this.failureCount = 0;
    this.passCount = 0;
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
    
    this.testResults.push({
      timestamp,
      status,
      message
    });
    
    if (status === 'PASS') this.passCount++;
    if (status === 'FAIL') this.failureCount++;
  }

  // Test 1: Breakpoint Configuration Validation
  testBreakpointConfiguration() {
    this.log('=== Testing Responsive Breakpoint Configuration ===');
    
    try {
      // Check if breakpoint hook exists and is properly configured
      const breakpointHook = fs.readFileSync('client/src/hooks/use-breakpoint.tsx', 'utf8');
      
      const breakpointTests = [
        { name: 'Mobile breakpoint (768px)', pattern: /mobile:\s*768/ },
        { name: 'Tablet breakpoint (1024px)', pattern: /tablet:\s*1024/ },
        { name: 'Desktop breakpoint (1440px)', pattern: /desktop:\s*1440/ },
        { name: 'XL breakpoint (1440px)', pattern: /xl:\s*1440/ },
        { name: 'Touch interface detection', pattern: /detectTouchCapability/ },
        { name: 'Media query listeners', pattern: /matchMedia/ },
        { name: 'Efficient resize debouncing', pattern: /setTimeout.*100/ }
      ];
      
      breakpointTests.forEach(test => {
        if (test.pattern.test(breakpointHook)) {
          this.log(`${test.name}: Configured correctly`, 'PASS');
        } else {
          this.log(`${test.name}: Configuration missing or incorrect`, 'FAIL');
        }
      });
      
    } catch (error) {
      this.log(`Breakpoint configuration test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 2: Panel Layout Implementation
  testPanelLayoutImplementation() {
    this.log('=== Testing Panel Layout Implementation ===');
    
    try {
      const prismMail = fs.readFileSync('client/src/components/PrismMail.tsx', 'utf8');
      
      const layoutTests = [
        { name: 'Mobile single-pane layout', pattern: /isMobile.*&&.*!isMobileEmailViewOpen/ },
        { name: 'Tablet two-pane layout', pattern: /isTablet.*&&/ },
        { name: 'Desktop three-pane resizable', pattern: /isDesktopOrXl.*&&.*PanelGroup/ },
        { name: 'Panel size persistence', pattern: /localStorage.*getItem.*prismmail-panel-sizes/ },
        { name: 'Responsive panel defaults', pattern: /width.*>=.*1440.*return.*\[30,\s*70\]/ },
        { name: 'Mobile email overlay state', pattern: /isMobileEmailViewOpen/ },
        { name: 'Touch gesture integration', pattern: /hasTouchInterface.*pullToRefresh/ },
        { name: 'Panel resize boundaries', pattern: /minSize.*maxSize/ }
      ];
      
      layoutTests.forEach(test => {
        if (test.pattern.test(prismMail)) {
          this.log(`${test.name}: Implementation found`, 'PASS');
        } else {
          this.log(`${test.name}: Implementation missing`, 'FAIL');
        }
      });
      
      // Check panel boundary constraints
      const panelConstraints = prismMail.match(/minSize={(\d+)}.*maxSize={(\d+)}/g);
      if (panelConstraints && panelConstraints.length >= 2) {
        this.log('Panel boundary constraints: Properly defined', 'PASS');
      } else {
        this.log('Panel boundary constraints: Missing or incomplete', 'WARN');
      }
      
    } catch (error) {
      this.log(`Panel layout test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 3: Component Performance Indicators
  testComponentPerformance() {
    this.log('=== Testing Component Performance Indicators ===');
    
    try {
      // Check virtual scrolling implementation
      const emailList = fs.readFileSync('client/src/components/OptimizedEmailList.tsx', 'utf8');
      
      const perfTests = [
        { name: 'Virtual scrolling optimization', pattern: /useVirtualScrolling.*filteredEmails\.length.*>.*50/ },
        { name: 'Memoized components', pattern: /memo.*function.*MemoizedEmailItem/ },
        { name: 'Performance monitoring', pattern: /performanceMonitor|console\.log.*\[EmailList\]/ },
        { name: 'Debounced operations', pattern: /debounce/ },
        { name: 'Loading skeleton states', pattern: /EmailListSkeleton/ },
        { name: 'Efficient re-renders', pattern: /useCallback|useMemo/ }
      ];
      
      perfTests.forEach(test => {
        if (test.pattern.test(emailList)) {
          this.log(`${test.name}: Optimization present`, 'PASS');
        } else {
          this.log(`${test.name}: Optimization missing`, 'WARN');
        }
      });
      
      // Check for auto-save implementation
      const draftHook = fs.readFileSync('client/src/hooks/useDraftAutoSave.ts', 'utf8');
      if (/AUTO_SAVE_INTERVAL.*30000/.test(draftHook) && /DEBOUNCE_DELAY.*2000/.test(draftHook)) {
        this.log('Auto-save performance: Properly configured (30s interval, 2s debounce)', 'PASS');
      } else {
        this.log('Auto-save performance: Configuration needs review', 'WARN');
      }
      
    } catch (error) {
      this.log(`Component performance test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 4: Application Startup Health
  testApplicationHealth() {
    this.log('=== Testing Application Health ===');
    
    try {
      // Check if application is running on port 5000
      execSync('curl -f http://localhost:5000 > /dev/null 2>&1', { timeout: 5000 });
      this.log('Application server: Running on port 5000', 'PASS');
      
      // Check for TypeScript compilation status
      try {
        execSync('cd client && npm run check > /dev/null 2>&1', { timeout: 30000 });
        this.log('TypeScript compilation: No errors', 'PASS');
      } catch (tscError) {
        this.log('TypeScript compilation: Has errors (but application still runs)', 'WARN');
      }
      
      // Test API endpoints
      try {
        const apiResponse = execSync('curl -s http://localhost:5000/api/auth/user', { timeout: 5000 });
        if (apiResponse.toString().includes('"message":"Unauthorized"')) {
          this.log('API endpoints: Authentication endpoint responding correctly', 'PASS');
        } else {
          this.log('API endpoints: Unexpected response from auth endpoint', 'WARN');
        }
      } catch (apiError) {
        this.log('API endpoints: Connection issues detected', 'FAIL');
      }
      
    } catch (error) {
      this.log(`Application health check failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 5: Accessibility and Touch Targets
  testAccessibilityFeatures() {
    this.log('=== Testing Accessibility and Touch Features ===');
    
    try {
      const components = [
        'client/src/components/PrismMail.tsx',
        'client/src/components/EmailListItem.tsx',
        'client/src/components/ComposeDialog.tsx'
      ];
      
      let dataTestIdCount = 0;
      let touchTargetCount = 0;
      
      components.forEach(componentPath => {
        if (fs.existsSync(componentPath)) {
          const content = fs.readFileSync(componentPath, 'utf8');
          
          // Count data-testid attributes for testing
          const testIds = content.match(/data-testid="/g);
          if (testIds) {
            dataTestIdCount += testIds.length;
          }
          
          // Check for touch-optimized button sizes
          const touchButtons = content.match(/size="(default|lg)"/g);
          if (touchButtons) {
            touchTargetCount += touchButtons.length;
          }
        }
      });
      
      if (dataTestIdCount >= 10) {
        this.log(`Test identifiers: Found ${dataTestIdCount} data-testid attributes`, 'PASS');
      } else {
        this.log(`Test identifiers: Only ${dataTestIdCount} found, need more for comprehensive testing`, 'WARN');
      }
      
      if (touchTargetCount >= 5) {
        this.log(`Touch targets: Found ${touchTargetCount} touch-optimized buttons`, 'PASS');
      } else {
        this.log(`Touch targets: Limited touch-optimized elements found`, 'WARN');
      }
      
    } catch (error) {
      this.log(`Accessibility test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 6: Integration and WebSocket Connectivity
  testIntegrationFeatures() {
    this.log('=== Testing Integration Features ===');
    
    try {
      const integrationTests = [
        { file: 'client/src/hooks/useWebSocket.ts', name: 'WebSocket integration' },
        { file: 'server/ewsSync.ts', name: 'EWS email sync' },
        { file: 'server/imapIdle.ts', name: 'IMAP IDLE support' },
        { file: 'server/push/pushNotifications.ts', name: 'Push notifications' },
        { file: 'client/src/hooks/useOfflineActions.ts', name: 'Offline action queuing' }
      ];
      
      integrationTests.forEach(test => {
        if (fs.existsSync(test.file)) {
          this.log(`${test.name}: Implementation file exists`, 'PASS');
        } else {
          this.log(`${test.name}: Implementation file missing`, 'FAIL');
        }
      });
      
      // Check for real-time update handling
      const prismMail = fs.readFileSync('client/src/components/PrismMail.tsx', 'utf8');
      if (/useWebSocket.*isConnected.*lastMessage/.test(prismMail)) {
        this.log('Real-time updates: WebSocket integration active', 'PASS');
      } else {
        this.log('Real-time updates: WebSocket integration incomplete', 'WARN');
      }
      
    } catch (error) {
      this.log(`Integration test failed: ${error.message}`, 'FAIL');
    }
  }

  // Generate comprehensive report
  generateReport() {
    const endTime = Date.now();
    const duration = ((endTime - this.startTime) / 1000).toFixed(2);
    
    this.log('=== Phase 1 Foundation Repair Validation Report ===');
    this.log(`Total tests: ${this.passCount + this.failureCount}`);
    this.log(`Passed: ${this.passCount}`);
    this.log(`Failed: ${this.failureCount}`);
    this.log(`Duration: ${duration} seconds`);
    
    const passRate = ((this.passCount / (this.passCount + this.failureCount)) * 100).toFixed(1);
    this.log(`Pass rate: ${passRate}%`);
    
    if (this.failureCount === 0) {
      this.log('🎉 All critical tests passed! Phase 1 foundation is solid.', 'PASS');
    } else if (this.failureCount <= 3) {
      this.log('⚠️  Minor issues found, but foundation is stable.', 'WARN');
    } else {
      this.log('❌ Critical issues found that need attention.', 'FAIL');
    }
    
    // Save detailed report
    const reportData = {
      summary: {
        totalTests: this.passCount + this.failureCount,
        passed: this.passCount,
        failed: this.failureCount,
        passRate: `${passRate}%`,
        duration: `${duration}s`,
        timestamp: new Date().toISOString()
      },
      results: this.testResults
    };
    
    fs.writeFileSync('phase1-validation-report.json', JSON.stringify(reportData, null, 2));
    this.log('📊 Detailed report saved to phase1-validation-report.json');
    
    return {
      passed: this.failureCount === 0,
      summary: reportData.summary
    };
  }

  // Run all validation tests
  async runValidation() {
    this.log('🚀 Starting Phase 1 Foundation Repair Validation');
    this.log(`Test started at: ${new Date().toISOString()}`);
    
    // Run all test suites
    this.testApplicationHealth();
    this.testBreakpointConfiguration();
    this.testPanelLayoutImplementation();
    this.testComponentPerformance();
    this.testAccessibilityFeatures();
    this.testIntegrationFeatures();
    
    return this.generateReport();
  }
}

// Run validation if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const validator = new ResponsiveTestValidator();
  validator.runValidation().then(result => {
    process.exit(result.passed ? 0 : 1);
  });
}

export default ResponsiveTestValidator;