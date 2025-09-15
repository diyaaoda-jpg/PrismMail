#!/usr/bin/env node

/**
 * Production Build Analysis Tool for PrismMail
 * Verifies bundle size targets, analyzes build output, and generates performance reports
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { gzipSync } from 'zlib';

const BUILD_TARGETS = {
  GZIPPED_BUNDLE_MAX: 500, // KB
  INDIVIDUAL_CHUNK_MAX: 250, // KB
  CSS_MAX: 50, // KB
  VENDOR_CHUNK_MAX: 300, // KB
};

const PERFORMANCE_BUDGETS = {
  'First Contentful Paint': 1500, // ms
  'Largest Contentful Paint': 2500, // ms  
  'First Input Delay': 100, // ms
  'Cumulative Layout Shift': 0.1, // score
  'Bundle Size': 500, // KB gzipped
  'Memory Usage': 100, // MB
};

class ProductionBuildAnalyzer {
  constructor() {
    this.buildPath = 'dist/public';
    this.results = {
      timestamp: new Date().toISOString(),
      buildTime: 0,
      bundles: [],
      totalSize: 0,
      gzippedSize: 0,
      budgetStatus: {},
      recommendations: [],
      passed: true
    };
  }

  async analyze() {
    console.log('🚀 Starting Production Build Analysis...\n');
    
    try {
      // Step 1: Create production build
      await this.createProductionBuild();
      
      // Step 2: Analyze bundle sizes
      await this.analyzeBundleSizes();
      
      // Step 3: Check performance budgets
      this.checkPerformanceBudgets();
      
      // Step 4: Generate recommendations
      this.generateRecommendations();
      
      // Step 5: Create report
      await this.generateReport();
      
      console.log('\n✅ Production Build Analysis Complete!');
      console.log(`📊 Report saved to: ${path.join(process.cwd(), 'build-analysis-report.json')}`);
      
      if (!this.results.passed) {
        console.error('\n❌ Build failed to meet performance budgets');
        process.exit(1);
      }
      
    } catch (error) {
      console.error('\n❌ Production Build Analysis Failed:', error.message);
      process.exit(1);
    }
  }

  async createProductionBuild() {
    console.log('📦 Creating production build...');
    const startTime = Date.now();
    
    try {
      // Clean previous build
      await fs.rm(this.buildPath, { recursive: true, force: true });
      
      // Create production build
      const buildOutput = execSync('npm run build', { 
        encoding: 'utf-8',
        stdio: 'pipe',
        env: { 
          ...process.env, 
          NODE_ENV: 'production',
          VITE_BUILD_ANALYZE: 'true'
        }
      });
      
      this.results.buildTime = Date.now() - startTime;
      console.log(`✅ Build completed in ${this.results.buildTime}ms`);
      
    } catch (error) {
      throw new Error(`Production build failed: ${error.message}`);
    }
  }

  async analyzeBundleSizes() {
    console.log('📊 Analyzing bundle sizes...');
    
    try {
      const files = await this.getAllBuildFiles();
      
      for (const file of files) {
        const stats = await this.analyzeBundleFile(file);
        if (stats) {
          this.results.bundles.push(stats);
        }
      }
      
      // Calculate totals
      this.results.totalSize = this.results.bundles.reduce((sum, bundle) => sum + bundle.size, 0);
      this.results.gzippedSize = this.results.bundles.reduce((sum, bundle) => sum + bundle.gzippedSize, 0);
      
      console.log(`📊 Total Bundle Size: ${(this.results.totalSize / 1024).toFixed(2)}KB`);
      console.log(`🗜️  Gzipped Size: ${(this.results.gzippedSize / 1024).toFixed(2)}KB`);
      
    } catch (error) {
      throw new Error(`Bundle analysis failed: ${error.message}`);
    }
  }

  async getAllBuildFiles() {
    const files = [];
    
    async function scanDirectory(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          await scanDirectory(fullPath);
        } else if (entry.name.endsWith('.js') || entry.name.endsWith('.css')) {
          files.push(fullPath);
        }
      }
    }
    
    await scanDirectory(this.buildPath);
    return files;
  }

  async analyzeBundleFile(filePath) {
    try {
      const content = await fs.readFile(filePath);
      const gzippedContent = gzipSync(content);
      const relativePath = path.relative(this.buildPath, filePath);
      
      const stats = {
        name: relativePath,
        path: filePath,
        size: content.length,
        gzippedSize: gzippedContent.length,
        type: path.extname(filePath).substring(1),
        compressionRatio: (1 - gzippedContent.length / content.length) * 100
      };
      
      // Categorize bundle types
      if (stats.name.includes('vendor') || stats.name.includes('chunk')) {
        stats.category = 'vendor';
      } else if (stats.name.includes('index') || stats.name.includes('main')) {
        stats.category = 'main';
      } else {
        stats.category = 'other';
      }
      
      return stats;
      
    } catch (error) {
      console.warn(`⚠️  Could not analyze ${filePath}: ${error.message}`);
      return null;
    }
  }

  checkPerformanceBudgets() {
    console.log('🎯 Checking performance budgets...');
    
    // Check gzipped bundle size budget
    const gzippedSizeKB = this.results.gzippedSize / 1024;
    this.results.budgetStatus['Bundle Size'] = {
      actual: gzippedSizeKB,
      budget: BUILD_TARGETS.GZIPPED_BUNDLE_MAX,
      passed: gzippedSizeKB <= BUILD_TARGETS.GZIPPED_BUNDLE_MAX,
      unit: 'KB'
    };
    
    // Check individual chunk sizes
    for (const bundle of this.results.bundles) {
      const sizeKB = bundle.gzippedSize / 1024;
      const budget = bundle.category === 'vendor' ? BUILD_TARGETS.VENDOR_CHUNK_MAX : BUILD_TARGETS.INDIVIDUAL_CHUNK_MAX;
      
      if (sizeKB > budget) {
        this.results.budgetStatus[`${bundle.name} Size`] = {
          actual: sizeKB,
          budget: budget,
          passed: false,
          unit: 'KB'
        };
        this.results.passed = false;
      }
    }
    
    // Check CSS budget
    const cssFiles = this.results.bundles.filter(b => b.type === 'css');
    const totalCssSize = cssFiles.reduce((sum, css) => sum + css.gzippedSize, 0) / 1024;
    
    this.results.budgetStatus['CSS Bundle Size'] = {
      actual: totalCssSize,
      budget: BUILD_TARGETS.CSS_MAX,
      passed: totalCssSize <= BUILD_TARGETS.CSS_MAX,
      unit: 'KB'
    };
    
    // Update overall pass status
    const budgetsPassed = Object.values(this.results.budgetStatus).every(budget => budget.passed);
    this.results.passed = this.results.passed && budgetsPassed;
    
    // Log results
    for (const [name, budget] of Object.entries(this.results.budgetStatus)) {
      const status = budget.passed ? '✅' : '❌';
      const percentage = ((budget.actual / budget.budget) * 100).toFixed(1);
      console.log(`${status} ${name}: ${budget.actual.toFixed(2)}${budget.unit} (${percentage}% of ${budget.budget}${budget.unit} budget)`);
    }
  }

  generateRecommendations() {
    console.log('\n💡 Generating optimization recommendations...');
    
    const gzippedSizeKB = this.results.gzippedSize / 1024;
    
    // Bundle size recommendations
    if (gzippedSizeKB > BUILD_TARGETS.GZIPPED_BUNDLE_MAX * 0.8) {
      this.results.recommendations.push({
        type: 'bundle-size',
        priority: 'high',
        message: 'Bundle size is approaching limit. Consider code splitting or removing unused dependencies.',
        current: `${gzippedSizeKB.toFixed(2)}KB`,
        target: `<${BUILD_TARGETS.GZIPPED_BUNDLE_MAX}KB`
      });
    }
    
    // Large chunk recommendations
    const largeChunks = this.results.bundles.filter(b => b.gzippedSize / 1024 > 100);
    if (largeChunks.length > 0) {
      this.results.recommendations.push({
        type: 'code-splitting',
        priority: 'medium',
        message: `Found ${largeChunks.length} large chunks that could benefit from further splitting.`,
        chunks: largeChunks.map(chunk => ({
          name: chunk.name,
          size: `${(chunk.gzippedSize / 1024).toFixed(2)}KB`
        }))
      });
    }
    
    // Compression recommendations
    const poorlyCompressed = this.results.bundles.filter(b => b.compressionRatio < 60);
    if (poorlyCompressed.length > 0) {
      this.results.recommendations.push({
        type: 'compression',
        priority: 'low',
        message: `${poorlyCompressed.length} files have poor compression ratios. Consider minification improvements.`,
        files: poorlyCompressed.map(file => ({
          name: file.name,
          ratio: `${file.compressionRatio.toFixed(1)}%`
        }))
      });
    }
    
    // Print recommendations
    if (this.results.recommendations.length === 0) {
      console.log('✅ No optimization recommendations - bundle is well optimized!');
    } else {
      this.results.recommendations.forEach((rec, index) => {
        const priority = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢';
        console.log(`${priority} ${rec.message}`);
      });
    }
  }

  async generateReport() {
    const report = {
      ...this.results,
      buildTargets: BUILD_TARGETS,
      performanceBudgets: PERFORMANCE_BUDGETS,
      summary: {
        totalBundles: this.results.bundles.length,
        totalSizeKB: (this.results.totalSize / 1024).toFixed(2),
        gzippedSizeKB: (this.results.gzippedSize / 1024).toFixed(2),
        averageCompressionRatio: (this.results.bundles.reduce((sum, b) => sum + b.compressionRatio, 0) / this.results.bundles.length).toFixed(1),
        budgetsPassed: Object.values(this.results.budgetStatus).filter(b => b.passed).length,
        totalBudgets: Object.keys(this.results.budgetStatus).length
      }
    };
    
    // Save detailed report
    await fs.writeFile('build-analysis-report.json', JSON.stringify(report, null, 2));
    
    // Save CI-friendly summary
    const ciSummary = {
      passed: this.results.passed,
      gzippedSizeKB: parseFloat((this.results.gzippedSize / 1024).toFixed(2)),
      budgetsPassed: Object.values(this.results.budgetStatus).every(b => b.passed),
      timestamp: this.results.timestamp
    };
    
    await fs.writeFile('build-summary.json', JSON.stringify(ciSummary, null, 2));
    
    console.log('\n📋 Build Analysis Summary:');
    console.log(`   Bundle Count: ${report.summary.totalBundles}`);
    console.log(`   Total Size: ${report.summary.totalSizeKB}KB`); 
    console.log(`   Gzipped Size: ${report.summary.gzippedSizeKB}KB`);
    console.log(`   Compression: ${report.summary.averageCompressionRatio}%`);
    console.log(`   Budgets Passed: ${report.summary.budgetsPassed}/${report.summary.totalBudgets}`);
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const analyzer = new ProductionBuildAnalyzer();
  analyzer.analyze().catch(console.error);
}

export default ProductionBuildAnalyzer;