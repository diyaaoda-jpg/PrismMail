#!/usr/bin/env node

/**
 * Bundle Budget Enforcement System for CI/CD
 * Ensures bundle sizes stay within performance budgets
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

const BUNDLE_BUDGETS = {
  // Production bundle size budgets (KB gzipped)
  TOTAL_GZIPPED: 500,
  MAIN_CHUNK: 250,
  VENDOR_CHUNK: 300, 
  CSS_TOTAL: 50,
  INDIVIDUAL_ASSET: 100,
  
  // Performance thresholds for CI
  WARNING_THRESHOLD: 0.8,  // 80% of budget
  ERROR_THRESHOLD: 1.0,    // 100% of budget (fail CI)
  
  // Trend analysis
  GROWTH_LIMIT: 1.1,       // 10% growth from baseline
  REGRESSION_LIMIT: 1.05   // 5% growth triggers warning
};

const LIGHTHOUSE_BUDGETS = {
  // Lighthouse performance budgets
  PERFORMANCE_SCORE: 90,
  FCP: 1500,
  LCP: 2500,
  FID: 100,
  CLS: 0.1,
  TTI: 3500,
  TBT: 300
};

class BundleBudgetChecker {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      budgets: BUNDLE_BUDGETS,
      checks: [],
      summary: {
        passed: true,
        warnings: 0,
        errors: 0,
        totalSize: 0,
        gzippedSize: 0,
        budgetUtilization: 0
      },
      recommendations: [],
      trends: null
    };
  }

  async checkBudgets() {
    console.log('🔍 Checking Bundle Budgets for CI/CD...\n');
    
    try {
      // Step 1: Run production build analysis
      await this.runBuildAnalysis();
      
      // Step 2: Load build results
      const buildResults = await this.loadBuildResults();
      
      // Step 3: Check against budgets
      await this.verifyBudgets(buildResults);
      
      // Step 4: Compare against baselines
      await this.checkTrends();
      
      // Step 5: Generate CI report
      await this.generateCIReport();
      
      // Step 6: Exit with appropriate code
      this.exitWithStatus();
      
    } catch (error) {
      console.error('❌ Bundle budget check failed:', error.message);
      process.exit(1);
    }
  }

  async runBuildAnalysis() {
    console.log('📦 Running production build analysis...');
    
    try {
      // Check if build analysis script exists
      const analysisScript = 'scripts/production-build-analysis.js';
      
      try {
        await fs.access(analysisScript);
        execSync(`node ${analysisScript}`, { stdio: 'inherit' });
      } catch {
        // Fallback to manual analysis
        console.log('⚠️  Production build analysis script not found, running manual analysis...');
        await this.manualBuildAnalysis();
      }
      
    } catch (error) {
      throw new Error(`Build analysis failed: ${error.message}`);
    }
  }

  async manualBuildAnalysis() {
    // Manual fallback analysis
    const buildPath = 'dist/public';
    
    try {
      // Ensure build exists
      await fs.access(buildPath);
    } catch {
      // Create production build
      console.log('🔨 Creating production build...');
      execSync('npm run build', { stdio: 'inherit' });
    }

    // Basic size analysis
    const files = await this.scanBuildFiles(buildPath);
    const analysis = {
      bundles: files,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
      gzippedSize: files.reduce((sum, f) => sum + f.gzippedSize, 0)
    };

    // Save analysis results
    await fs.writeFile('build-analysis-report.json', JSON.stringify(analysis, null, 2));
  }

  async scanBuildFiles(buildPath) {
    const files = [];
    const { gzipSync } = await import('zlib');
    
    async function scanDir(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.name.endsWith('.js') || entry.name.endsWith('.css')) {
          const content = await fs.readFile(fullPath);
          const gzippedContent = gzipSync(content);
          
          files.push({
            name: path.relative(buildPath, fullPath),
            size: content.length,
            gzippedSize: gzippedContent.length,
            type: path.extname(entry.name).substring(1)
          });
        }
      }
    }
    
    await scanDir(buildPath);
    return files;
  }

  async loadBuildResults() {
    try {
      const reportPath = 'build-analysis-report.json';
      const reportContent = await fs.readFile(reportPath, 'utf-8');
      return JSON.parse(reportContent);
    } catch (error) {
      throw new Error(`Failed to load build results: ${error.message}`);
    }
  }

  async verifyBudgets(buildResults) {
    console.log('🎯 Verifying bundle budgets...\n');
    
    const { bundles } = buildResults;
    const gzippedSizeKB = (buildResults.gzippedSize || 0) / 1024;
    
    // Check total gzipped size
    this.addBudgetCheck(
      'Total Bundle Size (Gzipped)',
      gzippedSizeKB,
      BUNDLE_BUDGETS.TOTAL_GZIPPED,
      'KB'
    );

    // Check individual chunks
    if (bundles) {
      for (const bundle of bundles) {
        const sizeKB = bundle.gzippedSize / 1024;
        let budget = BUNDLE_BUDGETS.INDIVIDUAL_ASSET;
        
        if (bundle.name.includes('vendor')) {
          budget = BUNDLE_BUDGETS.VENDOR_CHUNK;
        } else if (bundle.name.includes('index') || bundle.name.includes('main')) {
          budget = BUNDLE_BUDGETS.MAIN_CHUNK;
        }
        
        this.addBudgetCheck(
          `${bundle.name}`,
          sizeKB,
          budget,
          'KB',
          bundle.type
        );
      }
      
      // Check CSS total
      const cssFiles = bundles.filter(b => b.type === 'css');
      const totalCssSize = cssFiles.reduce((sum, css) => sum + css.gzippedSize, 0) / 1024;
      
      this.addBudgetCheck(
        'Total CSS Size',
        totalCssSize,
        BUNDLE_BUDGETS.CSS_TOTAL,
        'KB'
      );
    }
    
    // Update summary
    this.results.summary.totalSize = buildResults.totalSize || 0;
    this.results.summary.gzippedSize = buildResults.gzippedSize || 0;
    this.results.summary.budgetUtilization = (gzippedSizeKB / BUNDLE_BUDGETS.TOTAL_GZIPPED) * 100;
    
    // Generate recommendations
    this.generateBudgetRecommendations();
  }

  addBudgetCheck(name, actual, budget, unit, type = null) {
    const utilization = actual / budget;
    let status = 'PASS';
    
    if (utilization >= BUNDLE_BUDGETS.ERROR_THRESHOLD) {
      status = 'FAIL';
      this.results.summary.errors++;
      this.results.summary.passed = false;
    } else if (utilization >= BUNDLE_BUDGETS.WARNING_THRESHOLD) {
      status = 'WARN';
      this.results.summary.warnings++;
    }
    
    const check = {
      name,
      actual: parseFloat(actual.toFixed(2)),
      budget,
      unit,
      utilization: parseFloat((utilization * 100).toFixed(1)),
      status,
      type
    };
    
    this.results.checks.push(check);
    
    // Log result
    const emoji = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️' : '❌';
    console.log(`${emoji} ${name}: ${actual.toFixed(2)}${unit} (${check.utilization}% of ${budget}${unit} budget)`);
  }

  generateBudgetRecommendations() {
    const failedChecks = this.results.checks.filter(c => c.status === 'FAIL');
    const warningChecks = this.results.checks.filter(c => c.status === 'WARN');
    
    // High priority recommendations for failed budgets
    for (const check of failedChecks) {
      this.results.recommendations.push({
        priority: 'CRITICAL',
        type: 'budget-exceeded',
        message: `${check.name} exceeds budget by ${(check.utilization - 100).toFixed(1)}%`,
        action: this.getBudgetAction(check)
      });
    }
    
    // Medium priority for warnings
    for (const check of warningChecks) {
      this.results.recommendations.push({
        priority: 'WARNING',
        type: 'budget-approaching',
        message: `${check.name} approaching budget limit (${check.utilization}% used)`,
        action: this.getBudgetAction(check)
      });
    }
    
    // General recommendations
    if (this.results.summary.budgetUtilization > 80) {
      this.results.recommendations.push({
        priority: 'HIGH',
        type: 'general-optimization',
        message: 'Bundle size approaching limit - consider optimization strategies',
        action: 'Review dependencies, implement code splitting, or tree shaking'
      });
    }
  }

  getBudgetAction(check) {
    if (check.type === 'css') {
      return 'Remove unused CSS, optimize stylesheets, or use CSS purging';
    } else if (check.name.includes('vendor')) {
      return 'Review third-party dependencies, implement dynamic imports, or optimize bundles';
    } else if (check.name.includes('main') || check.name.includes('index')) {
      return 'Implement code splitting, lazy loading, or remove unused code';
    } else {
      return 'Optimize bundle size through code splitting or dependency analysis';
    }
  }

  async checkTrends() {
    console.log('\n📈 Checking bundle size trends...');
    
    try {
      // Load historical data
      const historyFile = 'bundle-size-history.json';
      let history = [];
      
      try {
        const historyContent = await fs.readFile(historyFile, 'utf-8');
        history = JSON.parse(historyContent);
      } catch {
        console.log('📝 No historical data found, creating baseline...');
        history = [];
      }
      
      // Add current results to history
      const currentEntry = {
        timestamp: this.results.timestamp,
        gzippedSize: this.results.summary.gzippedSize,
        totalSize: this.results.summary.totalSize,
        budgetUtilization: this.results.summary.budgetUtilization
      };
      
      history.push(currentEntry);
      
      // Keep last 30 entries
      if (history.length > 30) {
        history = history.slice(-30);
      }
      
      // Analyze trends
      if (history.length >= 2) {
        const previous = history[history.length - 2];
        const current = history[history.length - 1];
        const growth = current.gzippedSize / previous.gzippedSize;
        
        this.results.trends = {
          growth: parseFloat(((growth - 1) * 100).toFixed(1)),
          growthRatio: growth,
          previousSize: previous.gzippedSize,
          sizeIncrease: current.gzippedSize - previous.gzippedSize
        };
        
        // Check growth limits
        if (growth > BUNDLE_BUDGETS.GROWTH_LIMIT) {
          this.results.recommendations.push({
            priority: 'CRITICAL',
            type: 'size-growth',
            message: `Bundle size increased by ${this.results.trends.growth}% since last build`,
            action: 'Investigate recent changes causing size increase'
          });
          
          this.results.summary.passed = false;
          this.results.summary.errors++;
        } else if (growth > BUNDLE_BUDGETS.REGRESSION_LIMIT) {
          this.results.recommendations.push({
            priority: 'WARNING', 
            type: 'size-growth',
            message: `Bundle size increased by ${this.results.trends.growth}%`,
            action: 'Monitor bundle size growth'
          });
          
          this.results.summary.warnings++;
        }
        
        console.log(`📊 Bundle size trend: ${this.results.trends.growth >= 0 ? '+' : ''}${this.results.trends.growth}% from previous build`);
      }
      
      // Save updated history
      await fs.writeFile(historyFile, JSON.stringify(history, null, 2));
      
    } catch (error) {
      console.warn('⚠️  Failed to analyze trends:', error.message);
    }
  }

  async generateCIReport() {
    console.log('\n📋 Generating CI report...\n');
    
    // Console summary
    const summary = this.results.summary;
    console.log(`📦 Bundle Size: ${(summary.gzippedSize / 1024).toFixed(2)}KB gzipped`);
    console.log(`🎯 Budget Utilization: ${summary.budgetUtilization.toFixed(1)}%`);
    console.log(`✅ Checks Passed: ${this.results.checks.filter(c => c.status === 'PASS').length}`);
    console.log(`⚠️  Warnings: ${summary.warnings}`);
    console.log(`❌ Errors: ${summary.errors}`);
    
    if (this.results.trends) {
      console.log(`📈 Size Change: ${this.results.trends.growth >= 0 ? '+' : ''}${this.results.trends.growth}%`);
    }
    
    // Recommendations
    if (this.results.recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      this.results.recommendations.forEach(rec => {
        const emoji = rec.priority === 'CRITICAL' ? '🔴' : rec.priority === 'HIGH' ? '🟠' : '🟡';
        console.log(`${emoji} ${rec.message}`);
        console.log(`   Action: ${rec.action}`);
      });
    }
    
    // Save CI artifacts
    await fs.writeFile('bundle-budget-report.json', JSON.stringify(this.results, null, 2));
    
    // Create GitHub Actions annotations if in CI
    if (process.env.GITHUB_ACTIONS) {
      await this.createGitHubAnnotations();
    }
  }

  async createGitHubAnnotations() {
    const failedChecks = this.results.checks.filter(c => c.status === 'FAIL');
    const warningChecks = this.results.checks.filter(c => c.status === 'WARN');
    
    // Error annotations
    for (const check of failedChecks) {
      console.log(`::error title=Bundle Budget Exceeded::${check.name} is ${check.actual}${check.unit} (${check.utilization}% of ${check.budget}${check.unit} budget)`);
    }
    
    // Warning annotations
    for (const check of warningChecks) {
      console.log(`::warning title=Bundle Budget Warning::${check.name} is ${check.actual}${check.unit} (${check.utilization}% of ${check.budget}${check.unit} budget)`);
    }
    
    // Summary annotation
    console.log(`::notice title=Bundle Analysis Complete::Total size: ${(this.results.summary.gzippedSize / 1024).toFixed(2)}KB gzipped (${this.results.summary.budgetUtilization.toFixed(1)}% of budget)`);
  }

  exitWithStatus() {
    console.log('\n' + '='.repeat(50));
    
    if (this.results.summary.passed) {
      console.log('✅ Bundle budget check PASSED');
      console.log(`📊 All bundles within performance budgets`);
      process.exit(0);
    } else {
      console.log('❌ Bundle budget check FAILED');
      console.log(`📊 ${this.results.summary.errors} budget(s) exceeded`);
      
      // Print critical recommendations
      const criticalRecs = this.results.recommendations.filter(r => r.priority === 'CRITICAL');
      if (criticalRecs.length > 0) {
        console.log('\n🚨 Critical Actions Required:');
        criticalRecs.forEach(rec => {
          console.log(`   • ${rec.message}`);
          console.log(`     Action: ${rec.action}`);
        });
      }
      
      process.exit(1);
    }
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const checker = new BundleBudgetChecker();
  checker.checkBudgets().catch(console.error);
}

export { BundleBudgetChecker, BUNDLE_BUDGETS, LIGHTHOUSE_BUDGETS };