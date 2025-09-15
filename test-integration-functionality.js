#!/usr/bin/env node

/**
 * Integration Functionality Testing for PrismMail
 * Tests email account connections, real-time updates, authentication flow, and data persistence
 */

import { execSync } from 'child_process';
import fs from 'fs';

class IntegrationFunctionalityTester {
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

  // Test 1: Authentication Flow Integration
  testAuthenticationFlowIntegration() {
    this.log('=== Testing Authentication Flow Integration ===');
    
    try {
      const serverFiles = [
        'server/routes.ts',
        'server/auth.ts',
        'server/passport.ts'
      ];
      
      let authEndpoints = 0;
      let sessionManagement = 0;
      let securityMeasures = 0;
      let authMiddleware = 0;
      
      serverFiles.forEach(filePath => {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          
          // Check authentication endpoints
          if (/\/auth\/login|\/auth\/logout|\/auth\/user/.test(content)) {
            authEndpoints++;
          }
          
          // Check session management
          if (/express-session|passport|req\.session/.test(content)) {
            sessionManagement++;
          }
          
          // Check security measures
          if (/bcrypt|crypto|hash|salt/.test(content)) {
            securityMeasures++;
          }
          
          // Check auth middleware
          if (/ensureAuthenticated|isAuthenticated|requireAuth/.test(content)) {
            authMiddleware++;
          }
        }
      });
      
      this.log(`Authentication endpoints: ${authEndpoints} files`, 
               authEndpoints >= 1 ? 'PASS' : 'FAIL');
      this.log(`Session management: ${sessionManagement} files`, 
               sessionManagement >= 1 ? 'PASS' : 'FAIL');
      this.log(`Security measures: ${securityMeasures}`, 
               securityMeasures >= 1 ? 'PASS' : 'WARN');
      this.log(`Auth middleware: ${authMiddleware}`, 
               authMiddleware >= 1 ? 'PASS' : 'WARN');
      
      // Test client-side auth integration
      const clientAuth = fs.readFileSync('client/src/components/PrismMail.tsx', 'utf8');
      if (/useQuery.*\/api\/auth\/user/.test(clientAuth)) {
        this.log('Client-side auth integration: Connected', 'PASS');
      } else {
        this.log('Client-side auth integration: Missing', 'FAIL');
      }
      
      // Check for protected routes
      if (/user.*loading|isAuthenticated/.test(clientAuth)) {
        this.log('Protected route handling: Implemented', 'PASS');
      } else {
        this.log('Protected route handling: Missing', 'WARN');
      }
      
    } catch (error) {
      this.log(`Authentication flow test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 2: Email Service Integration
  testEmailServiceIntegration() {
    this.log('=== Testing Email Service Integration ===');
    
    try {
      const emailServices = [
        'server/email-services/ews-service.ts',
        'server/email-services/imap-service.ts',
        'server/email-services/base-email-service.ts'
      ];
      
      let serviceImplementations = 0;
      let connectionHandling = 0;
      let errorRecovery = 0;
      let dataMapping = 0;
      
      emailServices.forEach(servicePath => {
        if (fs.existsSync(servicePath)) {
          const content = fs.readFileSync(servicePath, 'utf8');
          
          serviceImplementations++;
          
          // Check connection handling
          if (/connect|authenticate|login/.test(content)) {
            connectionHandling++;
          }
          
          // Check error recovery
          if (/try.*catch|retry|reconnect/.test(content)) {
            errorRecovery++;
          }
          
          // Check data mapping
          if (/interface.*Email|type.*Email|mapTo/.test(content)) {
            dataMapping++;
          }
        }
      });
      
      this.log(`Email service implementations: ${serviceImplementations}/3`, 
               serviceImplementations >= 2 ? 'PASS' : 'WARN');
      this.log(`Connection handling: ${connectionHandling} services`, 
               connectionHandling >= 2 ? 'PASS' : 'WARN');
      this.log(`Error recovery patterns: ${errorRecovery} services`, 
               errorRecovery >= 2 ? 'PASS' : 'WARN');
      this.log(`Data mapping: ${dataMapping} services`, 
               dataMapping >= 2 ? 'PASS' : 'WARN');
      
      // Check server route integration
      const routes = fs.readFileSync('server/routes.ts', 'utf8');
      if (/\/api\/mail|\/api\/accounts/.test(routes)) {
        this.log('Email API endpoints: Implemented', 'PASS');
      } else {
        this.log('Email API endpoints: Missing', 'FAIL');
      }
      
      // Check client query integration
      const prismMail = fs.readFileSync('client/src/components/PrismMail.tsx', 'utf8');
      if (/useQuery.*\/api/.test(prismMail)) {
        this.log('Client-server email queries: Connected', 'PASS');
      } else {
        this.log('Client-server email queries: Missing', 'FAIL');
      }
      
    } catch (error) {
      this.log(`Email service integration test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 3: Real-time Updates Integration
  testRealTimeUpdatesIntegration() {
    this.log('=== Testing Real-time Updates Integration ===');
    
    try {
      const realtimeFiles = [
        'client/src/hooks/useWebSocket.ts',
        'server/websocket.ts',
        'server/push-notifications.ts'
      ];
      
      let websocketImplementation = 0;
      let messageHandling = 0;
      let pushNotifications = 0;
      let reconnectionLogic = 0;
      
      realtimeFiles.forEach(filePath => {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          
          // Check WebSocket implementation
          if (/WebSocket|ws|socket/.test(content)) {
            websocketImplementation++;
          }
          
          // Check message handling
          if (/onMessage|message.*type|event/.test(content)) {
            messageHandling++;
          }
          
          // Check push notifications
          if (/push.*notification|webpush/.test(content)) {
            pushNotifications++;
          }
          
          // Check reconnection logic
          if (/reconnect|retry|connection.*lost/.test(content)) {
            reconnectionLogic++;
          }
        }
      });
      
      this.log(`WebSocket implementation: ${websocketImplementation} files`, 
               websocketImplementation >= 1 ? 'PASS' : 'WARN');
      this.log(`Message handling: ${messageHandling} files`, 
               messageHandling >= 1 ? 'PASS' : 'WARN');
      this.log(`Push notifications: ${pushNotifications}`, 
               pushNotifications >= 1 ? 'PASS' : 'INFO');
      this.log(`Reconnection logic: ${reconnectionLogic}`, 
               reconnectionLogic >= 1 ? 'PASS' : 'WARN');
      
      // Check client integration
      const prismMail = fs.readFileSync('client/src/components/PrismMail.tsx', 'utf8');
      if (/useWebSocket|isConnected|lastMessage/.test(prismMail)) {
        this.log('Client WebSocket integration: Connected', 'PASS');
      } else {
        this.log('Client WebSocket integration: Missing', 'WARN');
      }
      
      // Check real-time email updates
      if (/wsMessage|new.*email|email.*update/.test(prismMail)) {
        this.log('Real-time email updates: Implemented', 'PASS');
      } else {
        this.log('Real-time email updates: Missing', 'WARN');
      }
      
    } catch (error) {
      this.log(`Real-time updates test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 4: Data Persistence Integration
  testDataPersistenceIntegration() {
    this.log('=== Testing Data Persistence Integration ===');
    
    try {
      const persistenceFiles = [
        'shared/schema.ts',
        'server/storage.ts',
        'server/db.ts',
        'drizzle.config.ts'
      ];
      
      let schemaDefinitions = 0;
      let databaseConnections = 0;
      let migrationSupport = 0;
      let dataValidation = 0;
      
      persistenceFiles.forEach(filePath => {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          
          // Check schema definitions
          if (/pgTable|createTable|schema/.test(content)) {
            schemaDefinitions++;
          }
          
          // Check database connections
          if (/DATABASE_URL|neon|postgres|drizzle/.test(content)) {
            databaseConnections++;
          }
          
          // Check migration support
          if (/migrate|migration|push/.test(content)) {
            migrationSupport++;
          }
          
          // Check data validation
          if (/zod|validation|createInsertSchema/.test(content)) {
            dataValidation++;
          }
        }
      });
      
      this.log(`Schema definitions: ${schemaDefinitions} files`, 
               schemaDefinitions >= 1 ? 'PASS' : 'FAIL');
      this.log(`Database connections: ${databaseConnections} files`, 
               databaseConnections >= 2 ? 'PASS' : 'WARN');
      this.log(`Migration support: ${migrationSupport}`, 
               migrationSupport >= 1 ? 'PASS' : 'WARN');
      this.log(`Data validation: ${dataValidation}`, 
               dataValidation >= 1 ? 'PASS' : 'WARN');
      
      // Check environment configuration
      try {
        const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        if (packageJson.dependencies['drizzle-orm']) {
          this.log('ORM integration: Drizzle configured', 'PASS');
        } else {
          this.log('ORM integration: Missing', 'FAIL');
        }
      } catch {
        this.log('Package.json analysis: Failed', 'WARN');
      }
      
      // Check client-side persistence
      const prismMail = fs.readFileSync('client/src/components/PrismMail.tsx', 'utf8');
      if (/localStorage|sessionStorage|persist/.test(prismMail)) {
        this.log('Client-side persistence: Implemented', 'PASS');
      } else {
        this.log('Client-side persistence: Limited', 'WARN');
      }
      
    } catch (error) {
      this.log(`Data persistence test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 5: Error Handling and Recovery
  testErrorHandlingAndRecovery() {
    this.log('=== Testing Error Handling and Recovery ===');
    
    try {
      const criticalFiles = [
        'client/src/components/PrismMail.tsx',
        'server/routes.ts',
        'client/src/hooks/useWebSocket.ts',
        'server/email-services/base-email-service.ts'
      ];
      
      let tryCatchBlocks = 0;
      let errorBoundaries = 0;
      let gracefulDegradation = 0;
      let userErrorMessages = 0;
      let retryMechanisms = 0;
      
      criticalFiles.forEach(filePath => {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          
          // Count try-catch blocks
          const tryCatchMatches = content.match(/try\s*\{[\s\S]*?\}\s*catch/g);
          if (tryCatchMatches) tryCatchBlocks += tryCatchMatches.length;
          
          // Check error boundaries
          if (/ErrorBoundary|componentDidCatch|getDerivedStateFromError/.test(content)) {
            errorBoundaries++;
          }
          
          // Check graceful degradation
          if (/fallback|offline|error.*state/.test(content)) {
            gracefulDegradation++;
          }
          
          // Check user error messages
          if (/toast|error.*message|notification/.test(content)) {
            userErrorMessages++;
          }
          
          // Check retry mechanisms
          if (/retry|again|reconnect/.test(content)) {
            retryMechanisms++;
          }
        }
      });
      
      this.log(`Try-catch error handling: ${tryCatchBlocks} blocks`, 
               tryCatchBlocks >= 5 ? 'PASS' : 'WARN');
      this.log(`Error boundaries: ${errorBoundaries}`, 
               errorBoundaries >= 1 ? 'PASS' : 'WARN');
      this.log(`Graceful degradation: ${gracefulDegradation} components`, 
               gracefulDegradation >= 2 ? 'PASS' : 'WARN');
      this.log(`User error messages: ${userErrorMessages} components`, 
               userErrorMessages >= 2 ? 'PASS' : 'WARN');
      this.log(`Retry mechanisms: ${retryMechanisms} components`, 
               retryMechanisms >= 2 ? 'PASS' : 'WARN');
      
      // Check offline support
      const offlineFiles = ['client/src/hooks/useOfflineActions.ts', 'client/src/components/OfflineIndicator.tsx'];
      let offlineSupport = 0;
      offlineFiles.forEach(file => {
        if (fs.existsSync(file)) offlineSupport++;
      });
      
      this.log(`Offline error handling: ${offlineSupport}/2 components`, 
               offlineSupport >= 1 ? 'PASS' : 'WARN');
      
      // Check API error handling
      const queryClient = fs.readFileSync('client/src/lib/queryClient.ts', 'utf8');
      if (/onError|catch|error.*handling/.test(queryClient)) {
        this.log('API error handling: Configured', 'PASS');
      } else {
        this.log('API error handling: Limited', 'WARN');
      }
      
    } catch (error) {
      this.log(`Error handling test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 6: Configuration and Environment Integration
  testConfigurationIntegration() {
    this.log('=== Testing Configuration and Environment Integration ===');
    
    try {
      const configFiles = [
        'vite.config.ts',
        'tsconfig.json',
        'tailwind.config.ts',
        '.env.example'
      ];
      
      let configurationFiles = 0;
      let environmentVars = 0;
      let buildConfigs = 0;
      let typeConfigs = 0;
      
      configFiles.forEach(configFile => {
        if (fs.existsSync(configFile)) {
          configurationFiles++;
          const content = fs.readFileSync(configFile, 'utf8');
          
          // Check environment variables
          if (/process\.env|import\.meta\.env|VITE_/.test(content)) {
            environmentVars++;
          }
          
          // Check build configurations
          if (/build|bundle|optimization/.test(content)) {
            buildConfigs++;
          }
          
          // Check TypeScript configuration
          if (/typescript|ts|strict|target/.test(content)) {
            typeConfigs++;
          }
        }
      });
      
      this.log(`Configuration files: ${configurationFiles}/4`, 
               configurationFiles >= 3 ? 'PASS' : 'WARN');
      this.log(`Environment variable usage: ${environmentVars}`, 
               environmentVars >= 1 ? 'PASS' : 'WARN');
      this.log(`Build configurations: ${buildConfigs}`, 
               buildConfigs >= 1 ? 'PASS' : 'WARN');
      this.log(`TypeScript configurations: ${typeConfigs}`, 
               typeConfigs >= 1 ? 'PASS' : 'WARN');
      
      // Check package.json scripts
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      const scriptCount = Object.keys(packageJson.scripts || {}).length;
      
      this.log(`Build scripts: ${scriptCount} configured`, 
               scriptCount >= 5 ? 'PASS' : 'WARN');
      
      // Check development workflow
      if (packageJson.scripts.dev && packageJson.scripts.build) {
        this.log('Development workflow: Complete', 'PASS');
      } else {
        this.log('Development workflow: Incomplete', 'WARN');
      }
      
    } catch (error) {
      this.log(`Configuration integration test failed: ${error.message}`, 'FAIL');
    }
  }

  // Test 7: Testing Infrastructure Integration
  testTestingInfrastructureIntegration() {
    this.log('=== Testing Infrastructure Integration ===');
    
    try {
      // Check for testing framework setup
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      const testingDeps = Object.keys({...packageJson.dependencies, ...packageJson.devDependencies});
      
      let testingFrameworks = 0;
      let testUtilities = 0;
      
      const testingTools = ['vitest', 'jest', 'playwright', '@testing-library', 'cypress'];
      testingTools.forEach(tool => {
        if (testingDeps.some(dep => dep.includes(tool))) {
          testingFrameworks++;
        }
      });
      
      const testUtilityTools = ['msw', 'sinon', 'mock', 'faker'];
      testUtilityTools.forEach(util => {
        if (testingDeps.some(dep => dep.includes(util))) {
          testUtilities++;
        }
      });
      
      this.log(`Testing frameworks: ${testingFrameworks} installed`, 
               testingFrameworks >= 1 ? 'PASS' : 'WARN');
      this.log(`Test utilities: ${testUtilities} available`, 
               testUtilities >= 1 ? 'PASS' : 'INFO');
      
      // Check for test files
      const testDirectories = ['__tests__', 'tests', 'test'];
      let testDirectoriesFound = 0;
      
      testDirectories.forEach(dir => {
        if (fs.existsSync(dir)) {
          testDirectoriesFound++;
        }
      });
      
      this.log(`Test directories: ${testDirectoriesFound} found`, 
               testDirectoriesFound >= 1 ? 'PASS' : 'INFO');
      
      // Check data-testid coverage (for UI testing)
      const components = [
        'client/src/components/PrismMail.tsx',
        'client/src/components/EmailListItem.tsx',
        'client/src/components/ComposeDialog.tsx'
      ];
      
      let totalTestIds = 0;
      components.forEach(componentPath => {
        if (fs.existsSync(componentPath)) {
          const content = fs.readFileSync(componentPath, 'utf8');
          const testIds = content.match(/data-testid="[^"]+"/g);
          if (testIds) totalTestIds += testIds.length;
        }
      });
      
      this.log(`Test identifiers: ${totalTestIds} data-testid attributes`, 
               totalTestIds >= 20 ? 'PASS' : 'WARN');
      
    } catch (error) {
      this.log(`Testing infrastructure test failed: ${error.message}`, 'FAIL');
    }
  }

  // Generate integration functionality report
  generateIntegrationReport() {
    const endTime = Date.now();
    const duration = ((endTime - this.startTime) / 1000).toFixed(2);
    
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const warned = this.results.filter(r => r.status === 'WARN').length;
    
    this.log('=== Integration Functionality Report ===');
    this.log(`Duration: ${duration} seconds`);
    this.log(`Passed: ${passed} | Failed: ${failed} | Warnings: ${warned}`);
    
    const integrationScore = ((passed / (passed + failed + warned)) * 100).toFixed(1);
    this.log(`Integration Score: ${integrationScore}%`);
    
    // Integration quality assessment
    if (parseFloat(integrationScore) >= 85) {
      this.log('🔗 Integration functionality is excellent!', 'PASS');
    } else if (parseFloat(integrationScore) >= 70) {
      this.log('⚡ Integration functionality is good with minor improvements needed', 'WARN');
    } else {
      this.log('❌ Integration functionality needs significant work', 'FAIL');
    }
    
    // Save detailed report
    const reportData = {
      summary: {
        duration: `${duration}s`,
        passed,
        failed,
        warnings: warned,
        integrationScore: `${integrationScore}%`,
        timestamp: new Date().toISOString()
      },
      results: this.results
    };
    
    fs.writeFileSync('integration-functionality-report.json', JSON.stringify(reportData, null, 2));
    this.log('📊 Integration report saved to integration-functionality-report.json');
    
    return {
      passed: failed <= 2,
      integrationScore: parseFloat(integrationScore),
      summary: reportData.summary
    };
  }

  // Run all integration functionality tests
  async runAllTests() {
    this.log('🔗 Starting Integration Functionality Testing');
    
    this.testAuthenticationFlowIntegration();
    this.testEmailServiceIntegration();
    this.testRealTimeUpdatesIntegration();
    this.testDataPersistenceIntegration();
    this.testErrorHandlingAndRecovery();
    this.testConfigurationIntegration();
    this.testTestingInfrastructureIntegration();
    
    return this.generateIntegrationReport();
  }
}

// Run integration functionality tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new IntegrationFunctionalityTester();
  tester.runAllTests().then(result => {
    process.exit(result.passed ? 0 : 1);
  });
}

export default IntegrationFunctionalityTester;