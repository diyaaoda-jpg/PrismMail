#!/usr/bin/env node

/**
 * User Interaction Flow Testing for PrismMail
 * Tests email management flows, navigation, and UI across different layouts
 */

import { execSync } from 'child_process';
import fs from 'fs';

class UserInteractionFlowTester {
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

  // Test 1: Email Management Flow Implementation
  testEmailManagementFlows() {
    this.log('=== Testing Email Management Flows ===');
    
    try {
      const prismMail = fs.readFileSync('client/src/components/PrismMail.tsx', 'utf8');
      const emailList = fs.readFileSync('client/src/components/OptimizedEmailList.tsx', 'utf8');
      const emailViewer = fs.readFileSync('client/src/components/EmailViewer.tsx', 'utf8');
      
      // Test email loading and display
      const emailLoadingTests = [
        { name: 'Email query implementation', pattern: /useQuery.*\/api\/mail/ },
        { name: 'Email state management', pattern: /selectedEmail.*setSelectedEmail/ },
        { name: 'Email filtering by folder', pattern: /selectedFolder.*folder/ },
        { name: 'Unified vs account view', pattern: /selectedAccount.*unified/ },
        { name: 'Loading states handling', pattern: /isLoading.*emailsLoading/ },
        { name: 'Empty state handling', pattern: /filteredEmails\.length.*===.*0/ }
      ];
      
      emailLoadingTests.forEach(test => {
        if (test.pattern.test(prismMail)) {
          this.log(`${test.name}: Implementation found`, 'PASS');
        } else {
          this.log(`${test.name}: Missing implementation`, 'FAIL');
        }
      });
      
      // Test email interaction handlers
      const interactionTests = [
        { name: 'Email selection handler', pattern: /handleEmailSelect|onEmailSelect/ },
        { name: 'Mark read/unread toggle', pattern: /handleToggleRead|onToggleRead/ },
        { name: 'Star/unstar functionality', pattern: /handleStar|onToggleStar/ },
        { name: 'Flag email functionality', pattern: /handleToggleFlagged|onToggleFlagged/ },
        { name: 'Archive email action', pattern: /handleArchive|onArchive/ },
        { name: 'Delete email action', pattern: /handleDelete|onDelete/ }
      ];
      
      interactionTests.forEach(test => {
        if (test.pattern.test(prismMail) || test.pattern.test(emailList)) {
          this.log(`${test.name}: Handler implemented`, 'PASS');
        } else {
          this.log(`${test.name}: Handler missing`, 'FAIL');
        }
      });
      
      // Test mobile-specific flow
      if (/isMobileEmailViewOpen.*setIsMobileEmailViewOpen/.test(prismMail)) {
        this.log('Mobile email overlay flow: Implemented', 'PASS');
      } else {
        this.log('Mobile email overlay flow: Missing', 'FAIL');
      }
      
    } catch (error) {
      this.log(`Email management flow test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 2: Navigation and Layout Switching
  testNavigationFlows() {
    this.log('=== Testing Navigation Flows ===');
    
    try {
      const prismMail = fs.readFileSync('client/src/components/PrismMail.tsx', 'utf8');
      const mailSidebar = fs.readFileSync('client/src/components/MailSidebar.tsx', 'utf8');
      
      // Test sidebar functionality
      const sidebarTests = [
        { name: 'Sidebar state management', pattern: /isSidebarOpen.*setIsSidebarOpen/ },
        { name: 'Folder selection', pattern: /selectedFolder.*setSelectedFolder/ },
        { name: 'Account switching', pattern: /selectedAccount.*setSelectedAccount/ },
        { name: 'Mobile sidebar drawer', pattern: /Sheet.*SheetContent/ },
        { name: 'Sidebar collapse/expand', pattern: /Menu.*ArrowLeft/ },
        { name: 'Folder navigation', pattern: /inbox|sent|drafts|trash/ }
      ];
      
      sidebarTests.forEach(test => {
        if (test.pattern.test(prismMail) || test.pattern.test(mailSidebar)) {
          this.log(`${test.name}: Implementation found`, 'PASS');
        } else {
          this.log(`${test.name}: Missing implementation`, 'WARN');
        }
      });
      
      // Test responsive layout switching
      const layoutTests = [
        { name: 'Mobile single-pane detection', pattern: /isMobile.*&&.*!isMobileEmailViewOpen/ },
        { name: 'Tablet two-pane layout', pattern: /isTablet.*&&.*w-\[400px\]/ },
        { name: 'Desktop three-pane layout', pattern: /isDesktopOrXl.*&&.*PanelGroup/ },
        { name: 'Layout state persistence', pattern: /localStorage.*panel-sizes/ },
        { name: 'Breakpoint-based rendering', pattern: /useBreakpoint/ }
      ];
      
      layoutTests.forEach(test => {
        if (test.pattern.test(prismMail)) {
          this.log(`${test.name}: Layout switching implemented`, 'PASS');
        } else {
          this.log(`${test.name}: Layout switching incomplete`, 'FAIL');
        }
      });
      
    } catch (error) {
      this.log(`Navigation flow test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 3: Compose Dialog Functionality
  testComposeDialogFlows() {
    this.log('=== Testing Compose Dialog Flows ===');
    
    try {
      const composeDialog = fs.readFileSync('client/src/components/ComposeDialog.tsx', 'utf8');
      const prismMail = fs.readFileSync('client/src/components/PrismMail.tsx', 'utf8');
      
      // Test compose dialog implementation
      const composeTests = [
        { name: 'Compose dialog state', pattern: /isComposeOpen.*setIsComposeOpen/ },
        { name: 'Reply functionality', pattern: /handleReply.*makeReply/ },
        { name: 'Reply-all functionality', pattern: /handleReplyAll.*makeReplyAll/ },
        { name: 'Forward functionality', pattern: /handleForward.*makeForward/ },
        { name: 'Draft auto-save integration', pattern: /useDraftAutoSave/ },
        { name: 'Form validation', pattern: /useForm.*zodResolver/ }
      ];
      
      composeTests.forEach(test => {
        if (test.pattern.test(composeDialog) || test.pattern.test(prismMail)) {
          this.log(`${test.name}: Implementation found`, 'PASS');
        } else {
          this.log(`${test.name}: Missing implementation`, 'FAIL');
        }
      });
      
      // Test mobile-specific compose features
      const mobileComposeTests = [
        { name: 'Mobile compose optimization', pattern: /useMobileCompose/ },
        { name: 'Auto-resize text areas', pattern: /useAutoResize/ },
        { name: 'Keyboard adjustment', pattern: /keyboardAdjustment/ },
        { name: 'Sheet-based mobile UI', pattern: /Sheet.*mobile/ }
      ];
      
      mobileComposeTests.forEach(test => {
        if (test.pattern.test(composeDialog)) {
          this.log(`${test.name}: Mobile optimization present`, 'PASS');
        } else {
          this.log(`${test.name}: Mobile optimization missing`, 'WARN');
        }
      });
      
    } catch (error) {
      this.log(`Compose dialog test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 4: Search and Filtering
  testSearchAndFilteringFlows() {
    this.log('=== Testing Search and Filtering Flows ===');
    
    try {
      const prismMail = fs.readFileSync('client/src/components/PrismMail.tsx', 'utf8');
      const searchDialog = fs.readFileSync('client/src/components/SearchDialog.tsx', 'utf8');
      const emailList = fs.readFileSync('client/src/components/OptimizedEmailList.tsx', 'utf8');
      
      // Test search functionality
      const searchTests = [
        { name: 'Search dialog state', pattern: /isSearchOpen.*setIsSearchOpen/ },
        { name: 'Search query state', pattern: /searchQuery.*setSearchQuery/ },
        { name: 'Search filtering logic', pattern: /filteredEmails.*searchQuery/ },
        { name: 'Search across email fields', pattern: /from.*subject.*snippet.*toLowerCase/ },
        { name: 'Empty search results', pattern: /searchQuery.*No matching emails/ }
      ];
      
      searchTests.forEach(test => {
        const searchContent = searchDialog + prismMail + emailList;
        if (test.pattern.test(searchContent)) {
          this.log(`${test.name}: Implementation found`, 'PASS');
        } else {
          this.log(`${test.name}: Missing implementation`, 'WARN');
        }
      });
      
      // Test folder filtering
      if (/mockUnreadCounts.*inbox.*focus.*unread/.test(prismMail)) {
        this.log('Folder filtering system: Basic implementation present', 'PASS');
      } else {
        this.log('Folder filtering system: Implementation incomplete', 'WARN');
      }
      
    } catch (error) {
      this.log(`Search and filtering test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 5: Touch and Gesture Interactions
  testTouchAndGestureFlows() {
    this.log('=== Testing Touch and Gesture Interactions ===');
    
    try {
      const prismMail = fs.readFileSync('client/src/components/PrismMail.tsx', 'utf8');
      const emailList = fs.readFileSync('client/src/components/OptimizedEmailList.tsx', 'utf8');
      
      // Test touch interface detection
      const touchTests = [
        { name: 'Touch interface detection', pattern: /hasTouchInterface/ },
        { name: 'Pull-to-refresh implementation', pattern: /usePullToRefresh/ },
        { name: 'Swipe gesture support', pattern: /useSwipeGestures/ },
        { name: 'Touch event handlers', pattern: /onTouchStart.*onTouchMove.*onTouchEnd/ },
        { name: 'Pointer event support', pattern: /onPointerDown.*onPointerMove.*onPointerUp/ },
        { name: 'Haptic feedback', pattern: /triggerHapticFeedback/ }
      ];
      
      touchTests.forEach(test => {
        if (test.pattern.test(prismMail) || test.pattern.test(emailList)) {
          this.log(`${test.name}: Implementation found`, 'PASS');
        } else {
          this.log(`${test.name}: Missing implementation`, 'WARN');
        }
      });
      
      // Test button sizes for touch targets
      const components = [prismMail, emailList];
      let touchOptimizedButtons = 0;
      
      components.forEach(content => {
        const buttons = content.match(/size="(default|lg)"/g);
        if (buttons) touchOptimizedButtons += buttons.length;
      });
      
      if (touchOptimizedButtons >= 10) {
        this.log(`Touch targets: Found ${touchOptimizedButtons} touch-optimized buttons`, 'PASS');
      } else {
        this.log(`Touch targets: Only ${touchOptimizedButtons} touch-optimized buttons found`, 'WARN');
      }
      
    } catch (error) {
      this.log(`Touch and gesture test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 6: Theme and Settings Flows
  testThemeAndSettingsFlows() {
    this.log('=== Testing Theme and Settings Flows ===');
    
    try {
      const prismMail = fs.readFileSync('client/src/components/PrismMail.tsx', 'utf8');
      const settingsDialog = fs.readFileSync('client/src/components/SettingsDialog.tsx', 'utf8');
      const themeProvider = fs.readFileSync('client/src/components/ThemeProvider.tsx', 'utf8');
      
      // Test settings functionality
      const settingsTests = [
        { name: 'Settings dialog state', pattern: /isSettingsOpen.*setIsSettingsOpen/ },
        { name: 'Theme switching', pattern: /ThemeMenu|ThemeToggle/ },
        { name: 'Theme provider integration', pattern: /ThemeProvider/ },
        { name: 'Dark mode support', pattern: /darkMode|dark:/ },
        { name: 'User preferences', pattern: /userPrefs|preferences/ }
      ];
      
      settingsTests.forEach(test => {
        const allContent = prismMail + settingsDialog + themeProvider;
        if (test.pattern.test(allContent)) {
          this.log(`${test.name}: Implementation found`, 'PASS');
        } else {
          this.log(`${test.name}: Missing implementation`, 'WARN');
        }
      });
      
      // Test offline indicator
      if (/OfflineIndicator/.test(prismMail)) {
        this.log('Offline status indication: Implemented', 'PASS');
      } else {
        this.log('Offline status indication: Missing', 'WARN');
      }
      
    } catch (error) {
      this.log(`Theme and settings test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 7: Data Testid Coverage for Testing
  testDataTestidCoverage() {
    this.log('=== Testing Data-Testid Coverage ===');
    
    try {
      const components = [
        'client/src/components/PrismMail.tsx',
        'client/src/components/EmailListItem.tsx',
        'client/src/components/EmailViewer.tsx',
        'client/src/components/ComposeDialog.tsx',
        'client/src/components/MailSidebar.tsx'
      ];
      
      let totalTestIds = 0;
      let criticalUIElementsWithTestIds = 0;
      
      const criticalElements = [
        'button-compose', 'button-reply', 'button-forward', 'button-archive', 'button-delete',
        'input-search', 'button-search', 'button-settings', 'handle-resize-panels',
        'button-sidebar-toggle', 'list-emails', 'viewer-email'
      ];
      
      components.forEach(componentPath => {
        if (fs.existsSync(componentPath)) {
          const content = fs.readFileSync(componentPath, 'utf8');
          
          // Count all data-testid attributes
          const testIds = content.match(/data-testid="[^"]+"/g);
          if (testIds) {
            totalTestIds += testIds.length;
            
            // Check for critical UI elements
            criticalElements.forEach(element => {
              if (content.includes(`data-testid="${element}"`)) {
                criticalUIElementsWithTestIds++;
              }
            });
          }
        }
      });
      
      this.log(`Total data-testid attributes: ${totalTestIds}`, totalTestIds >= 20 ? 'PASS' : 'WARN');
      this.log(`Critical UI elements with testids: ${criticalUIElementsWithTestIds}/${criticalElements.length}`, 
               criticalUIElementsWithTestIds >= 8 ? 'PASS' : 'WARN');
      
      // Test for consistent naming pattern
      const allComponents = components.filter(fs.existsSync)
        .map(path => fs.readFileSync(path, 'utf8')).join('\n');
      
      const testIdPattern = /data-testid="(button|input|list|viewer|handle|text|img|card|row)-[a-z-]+"/g;
      const wellFormedTestIds = allComponents.match(testIdPattern);
      
      if (wellFormedTestIds && wellFormedTestIds.length >= 15) {
        this.log(`Well-formed testid patterns: ${wellFormedTestIds.length} found`, 'PASS');
      } else {
        this.log(`Well-formed testid patterns: Only ${wellFormedTestIds?.length || 0} found`, 'WARN');
      }
      
    } catch (error) {
      this.log(`Data-testid coverage test failed: ${error.message}`, 'FAIL');
    }
  }

  // Generate interaction flow report
  generateInteractionReport() {
    const endTime = Date.now();
    const duration = ((endTime - this.startTime) / 1000).toFixed(2);
    
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const warned = this.results.filter(r => r.status === 'WARN').length;
    
    this.log('=== User Interaction Flow Test Report ===');
    this.log(`Duration: ${duration} seconds`);
    this.log(`Passed: ${passed} | Failed: ${failed} | Warnings: ${warned}`);
    
    const flowScore = ((passed / (passed + failed + warned)) * 100).toFixed(1);
    this.log(`User Flow Score: ${flowScore}%`);
    
    if (failed === 0 && warned <= 5) {
      this.log('🎉 User interaction flows are excellent!', 'PASS');
    } else if (failed <= 3 && warned <= 8) {
      this.log('⚠️ User interaction flows are good with minor gaps', 'WARN');
    } else {
      this.log('❌ User interaction flows need significant improvement', 'FAIL');
    }
    
    // Save detailed report
    const reportData = {
      summary: {
        duration: `${duration}s`,
        passed,
        failed,
        warnings: warned,
        flowScore: `${flowScore}%`,
        timestamp: new Date().toISOString()
      },
      results: this.results
    };
    
    fs.writeFileSync('user-interaction-flows-report.json', JSON.stringify(reportData, null, 2));
    this.log('📊 User flow report saved to user-interaction-flows-report.json');
    
    return {
      passed: failed <= 2,
      flowScore: parseFloat(flowScore),
      summary: reportData.summary
    };
  }

  // Run all interaction flow tests
  async runAllTests() {
    this.log('👤 Starting User Interaction Flow Testing');
    
    this.testEmailManagementFlows();
    this.testNavigationFlows();
    this.testComposeDialogFlows();
    this.testSearchAndFilteringFlows();
    this.testTouchAndGestureFlows();
    this.testThemeAndSettingsFlows();
    this.testDataTestidCoverage();
    
    return this.generateInteractionReport();
  }
}

// Run interaction flow tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new UserInteractionFlowTester();
  tester.runAllTests().then(result => {
    process.exit(result.passed ? 0 : 1);
  });
}

export default UserInteractionFlowTester;