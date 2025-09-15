import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initializeServiceWorker } from "./lib/serviceWorker";
import { performanceMonitor } from "./lib/performanceMonitor";

// Initialize service worker for offline support
initializeServiceWorker().then((registered) => {
  if (registered) {
    console.log('Service worker registered successfully');
  } else {
    console.log('Service worker registration failed or not supported');
  }
}).catch((error) => {
  console.error('Service worker initialization error:', error);
});

// Initialize comprehensive performance monitoring after app loads
setTimeout(() => {
  console.log('🚀 Initializing comprehensive performance monitoring...');
  
  // 1. Measure bundle size with detailed analysis
  performanceMonitor.measureBundleSizeDetailed();
  
  // 2. Measure mobile performance and calculate Lighthouse-style score
  performanceMonitor.measureMobilePerformance().then((score) => {
    console.log(`🏆 Mobile Performance Score: ${score}/100`);
    
    // 3. Store metrics for regression tracking
    performanceMonitor.storeMetrics();
    
    // 4. Generate comprehensive report
    const report = performanceMonitor.generateReport();
    console.log('\n📊 Performance Report:\n' + report);
    
    // 5. Verify critical performance targets
    const metrics = performanceMonitor.getMetrics();
    const targetVerification = {
      bundleSize: { value: metrics.bundleSize, target: 500, unit: 'KB' },
      fcp: { value: metrics.fcp, target: 1500, unit: 'ms' },
      lcp: { value: metrics.lcp, target: 2500, unit: 'ms' },
      fid: { value: metrics.fid, target: 100, unit: 'ms' },
      cls: { value: metrics.cls, target: 0.1, unit: '' }
    };
    
    console.log('🎯 Performance Target Verification:');
    let allTargetsMet = true;
    
    Object.entries(targetVerification).forEach(([metric, { value, target, unit }]) => {
      if (value !== undefined) {
        const met = value <= target;
        const status = met ? '✅' : '⚠️';
        console.log(`${status} ${metric}: ${value.toFixed(2)}${unit} (target: ${target}${unit})`);
        if (!met) allTargetsMet = false;
      }
    });
    
    if (allTargetsMet) {
      console.log('🎉 ALL PHASE 3 PERFORMANCE TARGETS MET!');
    } else {
      console.warn('⚠️ Some performance targets need attention');
    }
  });
}, 3000); // Wait for app to fully load and stabilize

createRoot(document.getElementById("root")!).render(<App />);
