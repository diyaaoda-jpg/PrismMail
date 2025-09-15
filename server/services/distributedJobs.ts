import { storage } from '../storage';
import { PriorityEngine } from './priorityEngine';
import type { MailMessage } from '@shared/schema';

/**
 * Job types for the simple background job system
 */
export interface RescoringJobData {
  userId: string;
  accountId?: string;
  ruleId?: string;
  batchSize?: number;
  cursor?: string; // For pagination
  priority?: 'high' | 'normal' | 'low';
}

export interface AnalyticsJobData {
  userId: string;
  accountId?: string;
  metricType: string;
  periodStart: Date;
  periodEnd: Date;
}

export interface PriorityJobData {
  emailId: string;
  accountId: string;
  userId: string;
  forceRescore?: boolean;
}

type JobData = RescoringJobData | AnalyticsJobData | PriorityJobData;

interface Job<T = any> {
  id: string;
  type: 'priority' | 'rescoring' | 'analytics';
  data: T;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  processAt?: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

/**
 * Simplified in-memory background job service for clean PrismMail installation
 * This replaces the complex BullMQ/Redis system that was causing LSP errors
 */
export class DistributedJobService {
  private static instance: DistributedJobService;
  
  // Simple in-memory job queues
  private priorityJobs: Map<string, Job<PriorityJobData>> = new Map();
  private rescoringJobs: Map<string, Job<RescoringJobData>> = new Map();
  private analyticsJobs: Map<string, Job<AnalyticsJobData>> = new Map();
  
  // Processing intervals
  private processingInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;
  
  // Job processing metrics
  private metrics = {
    priorityJobsProcessed: 0,
    rescoringJobsProcessed: 0,
    analyticsJobsProcessed: 0,
    failedJobs: 0,
    averageProcessingTime: 0,
    totalJobs: 0
  };

  private constructor() {
    this.startJobProcessor();
    console.log('Simple background job service initialized');
  }

  static getInstance(): DistributedJobService {
    if (!DistributedJobService.instance) {
      DistributedJobService.instance = new DistributedJobService();
    }
    return DistributedJobService.instance;
  }

  /**
   * Start the job processor with simple interval-based processing
   */
  private startJobProcessor(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }

    this.processingInterval = setInterval(async () => {
      if (this.isProcessing) return;
      
      this.isProcessing = true;
      try {
        await this.processJobs();
      } catch (error) {
        console.error('Job processing error:', error);
      } finally {
        this.isProcessing = false;
      }
    }, 5000); // Process every 5 seconds
  }

  /**
   * Process pending jobs from all queues
   */
  private async processJobs(): Promise<void> {
    const now = new Date();

    // Process priority jobs first
    for (const [jobId, job] of Array.from(this.priorityJobs.entries())) {
      if (job.status === 'pending' && (!job.processAt || job.processAt <= now)) {
        await this.processJob(job, 'priority');
      }
    }

    // Process rescoring jobs
    for (const [jobId, job] of Array.from(this.rescoringJobs.entries())) {
      if (job.status === 'pending' && (!job.processAt || job.processAt <= now)) {
        await this.processJob(job, 'rescoring');
      }
    }

    // Process analytics jobs (lowest priority)
    for (const [jobId, job] of Array.from(this.analyticsJobs.entries())) {
      if (job.status === 'pending' && (!job.processAt || job.processAt <= now)) {
        await this.processJob(job, 'analytics');
      }
    }

    // Clean up completed and old failed jobs
    this.cleanupJobs();
  }

  /**
   * Process a single job
   */
  private async processJob(job: Job, type: string): Promise<void> {
    const startTime = Date.now();
    job.status = 'processing';
    job.attempts++;

    try {
      let result;
      switch (type) {
        case 'priority':
          result = await this.processPriorityJob(job.data as PriorityJobData);
          this.metrics.priorityJobsProcessed++;
          break;
        case 'rescoring':
          result = await this.processRescoringJob(job.data as RescoringJobData);
          this.metrics.rescoringJobsProcessed++;
          break;
        case 'analytics':
          result = await this.processAnalyticsJob(job.data as AnalyticsJobData);
          this.metrics.analyticsJobsProcessed++;
          break;
        default:
          throw new Error(`Unknown job type: ${type}`);
      }

      job.status = 'completed';
      this.metrics.totalJobs++;
      
      // Update average processing time
      const processingTime = Date.now() - startTime;
      this.metrics.averageProcessingTime = 
        (this.metrics.averageProcessingTime * (this.metrics.totalJobs - 1) + processingTime) / this.metrics.totalJobs;

    } catch (error) {
      console.error(`Job ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts}):`, error);
      
      if (job.attempts >= job.maxAttempts) {
        job.status = 'failed';
        this.metrics.failedJobs++;
      } else {
        // Retry with exponential backoff
        job.status = 'pending';
        job.processAt = new Date(Date.now() + Math.pow(2, job.attempts) * 1000);
      }
    }
  }

  /**
   * Clean up old completed and failed jobs
   */
  private cleanupJobs(): void {
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

    const cleanupQueue = (queue: Map<string, Job>) => {
      for (const [jobId, job] of Array.from(queue.entries())) {
        if ((job.status === 'completed' || job.status === 'failed') && job.createdAt < cutoffTime) {
          queue.delete(jobId);
        }
      }
    };

    cleanupQueue(this.priorityJobs);
    cleanupQueue(this.rescoringJobs);
    cleanupQueue(this.analyticsJobs);
  }

  /**
   * Add a priority scoring job
   */
  async addPriorityJob(data: PriorityJobData, options: { delay?: number } = {}): Promise<string> {
    const jobId = `priority-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const job: Job<PriorityJobData> = {
      id: jobId,
      type: 'priority',
      data,
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date(),
      processAt: options.delay ? new Date(Date.now() + options.delay) : new Date(),
      status: 'pending'
    };

    this.priorityJobs.set(jobId, job);
    return jobId;
  }

  /**
   * Add a rescoring job
   */
  async addRescoringJob(data: RescoringJobData, options: { delay?: number } = {}): Promise<string> {
    const jobId = `rescoring-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const job: Job<RescoringJobData> = {
      id: jobId,
      type: 'rescoring',
      data,
      attempts: 0,
      maxAttempts: 2,
      createdAt: new Date(),
      processAt: options.delay ? new Date(Date.now() + options.delay) : new Date(),
      status: 'pending'
    };

    this.rescoringJobs.set(jobId, job);
    return jobId;
  }

  /**
   * Add an analytics job
   */
  async addAnalyticsJob(data: AnalyticsJobData, options: { delay?: number } = {}): Promise<string> {
    const jobId = `analytics-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const job: Job<AnalyticsJobData> = {
      id: jobId,
      type: 'analytics',
      data,
      attempts: 0,
      maxAttempts: 1,
      createdAt: new Date(),
      processAt: options.delay ? new Date(Date.now() + options.delay) : new Date(),
      status: 'pending'
    };

    this.analyticsJobs.set(jobId, job);
    return jobId;
  }

  /**
   * Process priority scoring job
   */
  private async processPriorityJob(data: PriorityJobData): Promise<any> {
    try {
      const priorityEngine = new PriorityEngine();
      const messages = await storage.getMailMessagesByIds([data.emailId]);
      
      if (!messages || messages.length === 0) {
        throw new Error(`Email not found: ${data.emailId}`);
      }
      
      const message = messages[0];
      const result = await priorityEngine.calculatePriority(message, data.accountId, data.userId);
      
      // Update the email with new priority score
      await storage.updateMailPriority(
        data.emailId, 
        result.priority, 
        result.prioritySource, 
        result.ruleId
      );
      
      return { success: true, priority: result.priority, score: result.priorityScore };
    } catch (error) {
      console.error('Priority job processing failed:', error);
      throw error;
    }
  }

  /**
   * Process rescoring job
   */
  private async processRescoringJob(data: RescoringJobData): Promise<any> {
    try {
      const priorityEngine = new PriorityEngine();
      
      // Get emails to rescore using the partitioned method
      const result = await storage.getMailMessagesPartitioned(
        data.accountId || '',
        {
          limit: data.batchSize || 100,
          cursor: data.cursor,
          needsPriorityUpdate: true
        }
      );

      let processed = 0;
      for (const email of result.messages) {
        try {
          const priorityResult = await priorityEngine.calculatePriority(
            email, 
            data.accountId || email.accountId, 
            data.userId
          );
          await storage.updateMailPriority(
            email.id, 
            priorityResult.priority, 
            priorityResult.prioritySource,
            priorityResult.ruleId
          );
          processed++;
        } catch (error) {
          console.error(`Failed to rescore email ${email.id}:`, error);
        }
      }

      return { success: true, processed, nextCursor: result.nextCursor };
    } catch (error) {
      console.error('Rescoring job processing failed:', error);
      throw error;
    }
  }

  /**
   * Process analytics job
   */
  private async processAnalyticsJob(data: AnalyticsJobData): Promise<any> {
    try {
      // Simple analytics processing using available methods
      const daysDiff = Math.ceil(
        (data.periodEnd.getTime() - data.periodStart.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      // Get available analytics data
      const [priorityDistribution, vipStats] = await Promise.all([
        storage.getEmailPriorityDistribution(data.userId, daysDiff),
        storage.getVipInteractionStats(data.userId, daysDiff)
      ]);

      const analytics = {
        metricType: data.metricType,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        priorityDistribution,
        vipInteractionStats: vipStats
      };

      return { success: true, analytics };
    } catch (error) {
      console.error('Analytics job processing failed:', error);
      throw error;
    }
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: string): Job | null {
    return this.priorityJobs.get(jobId) || 
           this.rescoringJobs.get(jobId) || 
           this.analyticsJobs.get(jobId) || 
           null;
  }

  /**
   * Get queue metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      queueSizes: {
        priority: this.priorityJobs.size,
        rescoring: this.rescoringJobs.size,
        analytics: this.analyticsJobs.size
      }
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    
    // Wait for current processing to complete
    while (this.isProcessing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log('Background job service shutdown complete');
  }
}

// Export singleton instance
export const distributedJobService = DistributedJobService.getInstance();

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  await distributedJobService.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await distributedJobService.shutdown();
  process.exit(0);
});