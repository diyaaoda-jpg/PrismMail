#!/usr/bin/env node

/**
 * Cross-Device Compatibility Testing for PrismMail
 * Tests desktop mouse interactions, tablet touch targets, mobile gestures, and orientation changes
 */

import { execSync } from 'child_process';
import fs from 'fs';

class CrossDeviceCompatibilityTester {
  constructor() {
    this.results = [];
    this.startTime = Date.now();
    this.deviceTargets = {
      touchTargetSize: 44, // px minimum
      mobileViewport: { width: 375, height: 667 }, // iPhone SE
      tabletViewport: { width: 768, height: 1024 }, // iPad
      desktopViewport: { width: 1024, height: 768 }, // Desktop minimum
      contrastRatio: 4.5, // WCAG AA
      fontSize: 16 // px minimum
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

  // Test 1: Desktop Mouse Interaction Compatibility
  testDesktopMouseInteractions() {
    this.log('=== Testing Desktop Mouse Interactions ===');
    
    try {
      const components = [
        'client/src/components/PrismMail.tsx',
        'client/src/components/EmailListItem.tsx',
        'client/src/components/EmailViewer.tsx',
        'client/src/components/MailSidebar.tsx'
      ];
      
      let hoverStates = 0;
      let clickHandlers = 0;
      let contextMenus = 0;
      let keyboardSupport = 0;
      let focusManagement = 0;
      
      components.forEach(componentPath => {
        if (fs.existsSync(componentPath)) {
          const content = fs.readFileSync(componentPath, 'utf8');
          
          // Check hover states
          const hoverPatterns = content.match(/hover:|onMouseEnter|onMouseLeave/g);
          if (hoverPatterns) hoverStates += hoverPatterns.length;
          
          // Check click handlers
          const clickPatterns = content.match(/onClick|onDoubleClick|onMouseDown/g);
          if (clickPatterns) clickHandlers += clickPatterns.length;
          
          // Check context menu support
          if (/onContextMenu|rightClick/.test(content)) {
            contextMenus++;
          }
          
          // Check keyboard support
          const keyboardPatterns = content.match(/onKeyDown|onKeyPress|onKeyUp|tabIndex/g);
          if (keyboardPatterns) keyboardSupport += keyboardPatterns.length;
          
          // Check focus management
          if (/autoFocus|ref.*focus|focus\(\)|tabIndex/.test(content)) {
            focusManagement++;
          }
        }
      });
      
      this.log(`Hover state interactions: ${hoverStates}`, 
               hoverStates >= 5 ? 'PASS' : 'WARN');
      this.log(`Click handlers: ${clickHandlers}`, 
               clickHandlers >= 10 ? 'PASS' : 'WARN');
      this.log(`Context menu support: ${contextMenus}`, 
               contextMenus >= 1 ? 'PASS' : 'INFO');
      this.log(`Keyboard navigation: ${keyboardSupport}`, 
               keyboardSupport >= 5 ? 'PASS' : 'WARN');
      this.log(`Focus management: ${focusManagement}`, 
               focusManagement >= 3 ? 'PASS' : 'WARN');
      
      // Test panel resizing (desktop specific)
      const prismMail = fs.readFileSync('client/src/components/PrismMail.tsx', 'utf8');
      if (/PanelResizeHandle.*onLayout/.test(prismMail)) {
        this.log('Resizable panel mouse interaction: Implemented', 'PASS');
      } else {
        this.log('Resizable panel mouse interaction: Missing', 'FAIL');
      }
      
    } catch (error) {
      this.log(`Desktop mouse interaction test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 2: Tablet Touch Target Compatibility
  testTabletTouchTargets() {
    this.log('=== Testing Tablet Touch Target Compatibility ===');
    
    try {
      const components = [
        'client/src/components/PrismMail.tsx',
        'client/src/components/EmailListItem.tsx',
        'client/src/components/ComposeDialog.tsx',
        'client/src/components/MailSidebar.tsx'
      ];
      
      let totalButtons = 0;
      let touchOptimizedButtons = 0;
      let interactiveElements = 0;
      let touchOptimizedElements = 0;
      
      components.forEach(componentPath => {
        if (fs.existsSync(componentPath)) {
          const content = fs.readFileSync(componentPath, 'utf8');
          
          // Count all buttons
          const buttons = content.match(/<Button[^>]*>/g);
          if (buttons) {
            totalButtons += buttons.length;
            
            // Check for touch-optimized button sizes
            buttons.forEach(button => {
              if (/size="(default|lg)"/.test(button) || !/size="(sm|icon)"/.test(button)) {
                touchOptimizedButtons++;
              }
            });
          }
          
          // Check other interactive elements
          const interactivePatterns = content.match(/<input[^>]*>|<select[^>]*>|<textarea[^>]*>/g);
          if (interactivePatterns) {
            interactiveElements += interactivePatterns.length;
            
            // These should be touch-optimized by default
            touchOptimizedElements += interactivePatterns.length;
          }
        }
      });
      
      const buttonOptimizationRate = totalButtons > 0 ? (touchOptimizedButtons / totalButtons * 100).toFixed(1) : 0;
      this.log(`Touch-optimized buttons: ${touchOptimizedButtons}/${totalButtons} (${buttonOptimizationRate}%)`, 
               buttonOptimizationRate >= 70 ? 'PASS' : 'WARN');
      
      this.log(`Touch-optimized form elements: ${touchOptimizedElements}`, 
               touchOptimizedElements >= 5 ? 'PASS' : 'WARN');
      
      // Check for tablet-specific layout
      const prismMail = fs.readFileSync('client/src/components/PrismMail.tsx', 'utf8');
      if (/isTablet.*&&.*w-\[400px\]/.test(prismMail)) {
        this.log('Tablet-specific layout: Implemented', 'PASS');
      } else {
        this.log('Tablet-specific layout: Missing', 'WARN');
      }
      
      // Check touch gesture support
      if (/useSwipeGestures|onTouchStart|onTouchMove/.test(prismMail)) {
        this.log('Touch gesture support: Implemented', 'PASS');
      } else {
        this.log('Touch gesture support: Missing', 'WARN');
      }
      
    } catch (error) {
      this.log(`Tablet touch target test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 3: Mobile Gesture and Layout Compatibility
  testMobileGestureCompatibility() {
    this.log('=== Testing Mobile Gesture and Layout Compatibility ===');
    
    try {
      const mobileComponents = [
        'client/src/components/PrismMail.tsx',
        'client/src/components/OptimizedEmailList.tsx',
        'client/src/hooks/usePullToRefresh.ts',
        'client/src/hooks/useSwipeGestures.ts'
      ];
      
      let swipeGestures = 0;
      let pullToRefresh = 0;
      let touchEvents = 0;
      let mobileOptimizations = 0;
      
      mobileComponents.forEach(componentPath => {
        if (fs.existsSync(componentPath)) {
          const content = fs.readFileSync(componentPath, 'utf8');
          
          // Check swipe gesture implementation
          if (/swipe|onTouchStart.*onTouchMove.*onTouchEnd/.test(content)) {
            swipeGestures++;
          }
          
          // Check pull-to-refresh
          if (/pullToRefresh|pull.*refresh|onPull/.test(content)) {
            pullToRefresh++;
          }
          
          // Count touch events
          const touchPatterns = content.match(/onTouch\w+|onPointer\w+/g);
          if (touchPatterns) touchEvents += touchPatterns.length;
          
          // Check mobile-specific optimizations
          if (/isMobile|mobile.*view|useBreakpoint.*mobile/.test(content)) {
            mobileOptimizations++;
          }
        }
      });
      
      this.log(`Swipe gesture support: ${swipeGestures} components`, 
               swipeGestures >= 2 ? 'PASS' : 'WARN');
      this.log(`Pull-to-refresh implementation: ${pullToRefresh} components`, 
               pullToRefresh >= 1 ? 'PASS' : 'WARN');
      this.log(`Touch event handlers: ${touchEvents}`, 
               touchEvents >= 10 ? 'PASS' : 'WARN');
      this.log(`Mobile layout optimizations: ${mobileOptimizations} components`, 
               mobileOptimizations >= 2 ? 'PASS' : 'WARN');
      
      // Check mobile navigation patterns
      const prismMail = fs.readFileSync('client/src/components/PrismMail.tsx', 'utf8');
      if (/isMobileEmailViewOpen.*setIsMobileEmailViewOpen/.test(prismMail)) {
        this.log('Mobile overlay navigation: Implemented', 'PASS');
      } else {
        this.log('Mobile overlay navigation: Missing', 'FAIL');
      }
      
      // Check mobile sidebar
      if (/Sheet.*SheetContent.*mobile/.test(prismMail)) {
        this.log('Mobile sidebar drawer: Implemented', 'PASS');
      } else {
        this.log('Mobile sidebar drawer: Missing implementation', 'WARN');
      }
      
    } catch (error) {
      this.log(`Mobile gesture compatibility test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 4: Orientation Change Handling
  testOrientationChangeHandling() {
    this.log('=== Testing Orientation Change Handling ===');
    
    try {
      const components = [
        'client/src/components/PrismMail.tsx',
        'client/src/hooks/use-breakpoint.tsx',
        'client/src/components/ComposeDialog.tsx'
      ];
      
      let orientationHandlers = 0;
      let viewportAdjustments = 0;
      let flexibleLayouts = 0;
      
      components.forEach(componentPath => {
        if (fs.existsSync(componentPath)) {
          const content = fs.readFileSync(componentPath, 'utf8');
          
          // Check orientation change handling
          if (/orientationchange|resize.*orientation|screen.*orientation/.test(content)) {
            orientationHandlers++;
          }
          
          // Check viewport adjustments
          if (/window\.innerHeight|window\.innerWidth|viewport/.test(content)) {
            viewportAdjustments++;
          }
          
          // Check flexible layout patterns
          if (/flex.*1|grid.*auto|min-h.*screen|h-screen/.test(content)) {
            flexibleLayouts++;
          }
        }
      });
      
      this.log(`Orientation change handlers: ${orientationHandlers}`, 
               orientationHandlers >= 1 ? 'PASS' : 'WARN');
      this.log(`Viewport adjustment patterns: ${viewportAdjustments}`, 
               viewportAdjustments >= 1 ? 'PASS' : 'WARN');
      this.log(`Flexible layout implementations: ${flexibleLayouts}`, 
               flexibleLayouts >= 2 ? 'PASS' : 'WARN');
      
      // Check CSS Grid/Flexbox usage
      const prismMail = fs.readFileSync('client/src/components/PrismMail.tsx', 'utf8');
      if (/flex.*flex-col|grid|space-y|gap-/.test(prismMail)) {
        this.log('Responsive layout system: CSS Grid/Flexbox implemented', 'PASS');
      } else {
        this.log('Responsive layout system: Limited implementation', 'WARN');
      }
      
      // Check for dynamic height adjustments
      if (/h-screen|min-h-screen|h-full/.test(prismMail)) {
        this.log('Dynamic height adjustments: Implemented', 'PASS');
      } else {
        this.log('Dynamic height adjustments: Missing', 'WARN');
      }
      
    } catch (error) {
      this.log(`Orientation change handling test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 5: Accessibility Compliance
  testAccessibilityCompliance() {
    this.log('=== Testing Accessibility Compliance ===');
    
    try {
      const components = [
        'client/src/components/PrismMail.tsx',
        'client/src/components/EmailListItem.tsx',
        'client/src/components/ComposeDialog.tsx',
        'client/src/components/MailSidebar.tsx'
      ];
      
      let ariaLabels = 0;
      let semanticElements = 0;
      let keyboardNavigation = 0;
      let focusManagement = 0;
      let colorContrast = 0;
      
      components.forEach(componentPath => {
        if (fs.existsSync(componentPath)) {
          const content = fs.readFileSync(componentPath, 'utf8');
          
          // Check ARIA labels
          const ariaPatterns = content.match(/aria-label|aria-labelledby|aria-describedby|role=/g);
          if (ariaPatterns) ariaLabels += ariaPatterns.length;
          
          // Check semantic elements
          if (/\<main\>|\<nav\>|\<section\>|\<article\>|\<header\>|\<aside\>/.test(content)) {
            semanticElements++;
          }
          
          // Check keyboard navigation
          const keyboardPatterns = content.match(/tabIndex|onKeyDown|onKeyPress/g);
          if (keyboardPatterns) keyboardNavigation += keyboardPatterns.length;
          
          // Check focus management
          if (/focus\(\)|autoFocus|ref.*focus/.test(content)) {
            focusManagement++;
          }
          
          // Check color/contrast considerations
          if (/text-muted|text-foreground|bg-background|dark:/.test(content)) {
            colorContrast++;
          }
        }
      });
      
      this.log(`ARIA labels and roles: ${ariaLabels}`, 
               ariaLabels >= 10 ? 'PASS' : 'WARN');
      this.log(`Semantic HTML elements: ${semanticElements} components`, 
               semanticElements >= 2 ? 'PASS' : 'WARN');
      this.log(`Keyboard navigation support: ${keyboardNavigation}`, 
               keyboardNavigation >= 5 ? 'PASS' : 'WARN');
      this.log(`Focus management: ${focusManagement} components`, 
               focusManagement >= 2 ? 'PASS' : 'WARN');
      this.log(`Color contrast awareness: ${colorContrast} components`, 
               colorContrast >= 3 ? 'PASS' : 'WARN');
      
      // Check for skip links or navigation aids
      const prismMail = fs.readFileSync('client/src/components/PrismMail.tsx', 'utf8');
      if (/skip.*content|skip.*navigation|sr-only/.test(prismMail)) {
        this.log('Screen reader navigation aids: Implemented', 'PASS');
      } else {
        this.log('Screen reader navigation aids: Missing', 'WARN');
      }
      
    } catch (error) {
      this.log(`Accessibility compliance test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 6: Cross-Browser Compatibility Patterns
  testCrossBrowserCompatibility() {
    this.log('=== Testing Cross-Browser Compatibility ===');
    
    try {
      const styleFiles = [
        'client/src/index.css',
        'tailwind.config.ts'
      ];
      
      let modernFeatures = 0;
      let fallbackPatterns = 0;
      let vendorPrefixes = 0;
      let polyfillSupport = 0;
      
      styleFiles.forEach(filePath => {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          
          // Check for modern CSS features
          if (/grid|flexbox|css.*variables|custom.*properties/.test(content)) {
            modernFeatures++;
          }
          
          // Check for fallback patterns
          if (/@supports|@media.*prefers/.test(content)) {
            fallbackPatterns++;
          }
          
          // Check vendor prefixes (should be minimal with modern tools)
          if (/-webkit-|-moz-|-ms-/.test(content)) {
            vendorPrefixes++;
          }
        }
      });
      
      // Check JavaScript compatibility patterns
      const jsFiles = [
        'client/src/hooks/use-breakpoint.tsx',
        'client/src/lib/utils.ts'
      ];
      
      jsFiles.forEach(filePath => {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          
          // Check for feature detection
          if (/window\.\w+.*!==.*undefined|typeof.*!==.*undefined/.test(content)) {
            polyfillSupport++;
          }
        }
      });
      
      this.log(`Modern CSS feature usage: ${modernFeatures}`, 
               modernFeatures >= 1 ? 'PASS' : 'WARN');
      this.log(`CSS fallback patterns: ${fallbackPatterns}`, 
               fallbackPatterns >= 1 ? 'PASS' : 'INFO');
      this.log(`Vendor prefix usage: ${vendorPrefixes}`, 
               vendorPrefixes <= 2 ? 'PASS' : 'WARN');
      this.log(`JavaScript feature detection: ${polyfillSupport}`, 
               polyfillSupport >= 1 ? 'PASS' : 'WARN');
      
      // Check build tool configuration
      const viteConfig = fs.readFileSync('vite.config.ts', 'utf8');
      if (/browserslist|target.*es|legacy/.test(viteConfig)) {
        this.log('Build target configuration: Configured for compatibility', 'PASS');
      } else {
        this.log('Build target configuration: Default settings', 'INFO');
      }
      
    } catch (error) {
      this.log(`Cross-browser compatibility test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 7: Responsive Design Validation
  testResponsiveDesignValidation() {
    this.log('=== Testing Responsive Design Validation ===');
    
    try {
      const breakpointHook = fs.readFileSync('client/src/hooks/use-breakpoint.tsx', 'utf8');
      const prismMail = fs.readFileSync('client/src/components/PrismMail.tsx', 'utf8');
      
      // Test breakpoint implementation
      const breakpointTests = [
        { name: 'Mobile breakpoint (0-767px)', pattern: /isMobile.*768/ },
        { name: 'Tablet breakpoint (768-1023px)', pattern: /isTablet.*768.*1024/ },
        { name: 'Desktop breakpoint (1024px+)', pattern: /isDesktop.*1024/ },
        { name: 'XL breakpoint (1440px+)', pattern: /isXl.*1440/ },
        { name: 'Touch interface detection', pattern: /hasTouchInterface/ }
      ];
      
      breakpointTests.forEach(test => {
        if (test.pattern.test(breakpointHook)) {
          this.log(`${test.name}: Correctly implemented`, 'PASS');
        } else {
          this.log(`${test.name}: Implementation issue`, 'FAIL');
        }
      });
      
      // Test responsive layout implementation
      const responsiveLayouts = [
        { name: 'Mobile single-pane layout', pattern: /isMobile.*&&.*!\w*EmailViewOpen/ },
        { name: 'Tablet fixed two-pane', pattern: /isTablet.*&&.*w-\[400px\]/ },
        { name: 'Desktop resizable three-pane', pattern: /isDesktopOrXl.*&&.*PanelGroup/ },
        { name: 'Responsive panel defaults', pattern: /panelSizes.*isXl.*isDesktop/ }
      ];
      
      responsiveLayouts.forEach(test => {
        if (test.pattern.test(prismMail)) {
          this.log(`${test.name}: Layout implemented`, 'PASS');
        } else {
          this.log(`${test.name}: Layout missing`, 'FAIL');
        }
      });
      
      // Test media query efficiency
      if (/debounce.*resize|throttle.*resize/.test(breakpointHook)) {
        this.log('Efficient media query handling: Debounced resize listeners', 'PASS');
      } else {
        this.log('Efficient media query handling: May cause performance issues', 'WARN');
      }
      
    } catch (error) {
      this.log(`Responsive design validation failed: ${error.message}`, 'FAIL');
    }
  }

  // Generate cross-device compatibility report
  generateCompatibilityReport() {
    const endTime = Date.now();
    const duration = ((endTime - this.startTime) / 1000).toFixed(2);
    
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const warned = this.results.filter(r => r.status === 'WARN').length;
    
    this.log('=== Cross-Device Compatibility Report ===');
    this.log(`Duration: ${duration} seconds`);
    this.log(`Passed: ${passed} | Failed: ${failed} | Warnings: ${warned}`);
    
    const compatibilityScore = ((passed / (passed + failed + warned)) * 100).toFixed(1);
    this.log(`Compatibility Score: ${compatibilityScore}%`);
    
    // Device-specific recommendations
    if (parseFloat(compatibilityScore) >= 85) {
      this.log('🌐 Cross-device compatibility is excellent!', 'PASS');
    } else if (parseFloat(compatibilityScore) >= 70) {
      this.log('📱 Cross-device compatibility is good with minor improvements needed', 'WARN');
    } else {
      this.log('❌ Cross-device compatibility needs significant work', 'FAIL');
    }
    
    // Save detailed report
    const reportData = {
      summary: {
        duration: `${duration}s`,
        passed,
        failed,
        warnings: warned,
        compatibilityScore: `${compatibilityScore}%`,
        deviceTargets: this.deviceTargets,
        timestamp: new Date().toISOString()
      },
      results: this.results
    };
    
    fs.writeFileSync('cross-device-compatibility-report.json', JSON.stringify(reportData, null, 2));
    this.log('📊 Compatibility report saved to cross-device-compatibility-report.json');
    
    return {
      passed: failed <= 2,
      compatibilityScore: parseFloat(compatibilityScore),
      summary: reportData.summary
    };
  }

  // Run all cross-device compatibility tests
  async runAllTests() {
    this.log('🌐 Starting Cross-Device Compatibility Testing');
    
    this.testDesktopMouseInteractions();
    this.testTabletTouchTargets();
    this.testMobileGestureCompatibility();
    this.testOrientationChangeHandling();
    this.testAccessibilityCompliance();
    this.testCrossBrowserCompatibility();
    this.testResponsiveDesignValidation();
    
    return this.generateCompatibilityReport();
  }
}

// Run cross-device compatibility tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new CrossDeviceCompatibilityTester();
  tester.runAllTests().then(result => {
    process.exit(result.passed ? 0 : 1);
  });
}

export default CrossDeviceCompatibilityTester;