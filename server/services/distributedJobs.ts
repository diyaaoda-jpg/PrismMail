import { Queue, Worker, Job, JobsOptions } from 'bullmq';
import { redis } from '../config/redis';
import { storage } from '../storage';
import { PriorityEngine } from './priorityEngine';
import type { MailMessage } from '@shared/schema';

/**
 * Job types for the distributed queue system
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

/**
 * Distributed background job service using BullMQ for scalability
 */
export class DistributedJobService {
  private static instance: DistributedJobService;
  
  // Different queues for different job types with different priorities
  private priorityQueue: Queue<PriorityJobData>;
  private rescoringQueue: Queue<RescoringJobData>;
  private analyticsQueue: Queue<AnalyticsJobData>;
  
  // Workers for processing jobs
  private priorityWorker!: Worker<PriorityJobData>;
  private rescoringWorker!: Worker<RescoringJobData>;
  private analyticsWorker!: Worker<AnalyticsJobData>;
  
  // Job processing metrics
  private metrics = {
    priorityJobsProcessed: 0,
    rescoringJobsProcessed: 0,
    analyticsJobsProcessed: 0,
    failedJobs: 0,
    averageProcessingTime: 0
  };

  private isRedisAvailable: boolean = false;
  private fallbackJobs: Array<{ type: string, data: JobData, options?: JobsOptions }> = [];

  private constructor() {
    this.checkRedisAvailability();
  }

  private async checkRedisAvailability(): Promise<void> {
    try {
      // Check if Redis is connected using our safe connection
      this.isRedisAvailable = (redis as any).isConnected && (redis as any).isConnected();
      
      if (this.isRedisAvailable) {
        console.log('Distributed job service: Redis available - initializing queues');
        this.initializeQueues();
        this.initializeWorkers();
      } else {
        console.log('Distributed job service: Redis unavailable - using fallback mode');
        this.setupFallbackProcessing();
      }
    } catch (error) {
      console.log('Distributed job service: Redis check failed - using fallback mode');
      this.isRedisAvailable = false;
      this.setupFallbackProcessing();
    }
  }

  private initializeQueues(): void {
    // Initialize queues with different priorities and settings
    this.priorityQueue = new Queue<PriorityJobData>('priority-scoring', {
      connection: redis,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      }
    });

    this.rescoringQueue = new Queue<RescoringJobData>('email-rescoring', {
      connection: redis,
      defaultJobOptions: {
        removeOnComplete: 20,
        removeOnFail: 10,
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 5000
        }
      }
    });

    this.analyticsQueue = new Queue<AnalyticsJobData>('analytics-refresh', {
      connection: redis,
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 5,
        attempts: 1
      }
    });
  }

  private setupFallbackProcessing(): void {
    // Set up periodic processing of fallback jobs
    setInterval(() => {
      this.processFallbackJobs();
    }, 10000); // Process fallback jobs every 10 seconds
  }

  static getInstance(): DistributedJobService {
    if (!DistributedJobService.instance) {
      DistributedJobService.instance = new DistributedJobService();
    }
    return DistributedJobService.instance;
  }

  /**
   * Initialize workers with bounded concurrency for scalability
   */
  private initializeWorkers(): void {
    if (!this.isRedisAvailable) {
      console.log('Skipping worker initialization - Redis unavailable');
      return;
    }

    try {
      // High-priority, low-latency worker for individual email priority scoring
      this.priorityWorker = new Worker<PriorityJobData>(
        'priority-scoring',
        async (job: Job<PriorityJobData>) => {
          return this.processPriorityJob(job.data);
        },
        {
          connection: redis,
          concurrency: 10, // Process up to 10 priority jobs concurrently
          maxStalledCount: 1,
          stalledInterval: 30 * 1000
        }
      );
    } catch (error) {
      console.log('Failed to initialize priority worker - using fallback mode');
      this.isRedisAvailable = false;
    }

    try {
      // Medium-concurrency worker for batch rescoring
      this.rescoringWorker = new Worker<RescoringJobData>(
        'email-rescoring',
        async (job: Job<RescoringJobData>) => {
          return this.processRescoringJob(job.data, job);
        },
        {
          connection: redis,
          concurrency: 3, // Limit concurrency to prevent overwhelming the database
          maxStalledCount: 2,
          stalledInterval: 60 * 1000
        }
      );
    } catch (error) {
      console.log('Failed to initialize rescoring worker - using fallback mode');
      this.isRedisAvailable = false;
    }

    try {
      // Low-priority worker for analytics
      this.analyticsWorker = new Worker<AnalyticsJobData>(
        'analytics-refresh',
        async (job: Job<AnalyticsJobData>) => {
          return this.processAnalyticsJob(job.data);
        },
        {
          connection: redis,
          concurrency: 1, // Analytics jobs are lower priority
          maxStalledCount: 1,
          stalledInterval: 120 * 1000
        }
      );
    } catch (error) {
      console.log('Failed to initialize analytics worker - using fallback mode');
      this.isRedisAvailable = false;
    }

    // Add error handling and metrics collection
    this.setupWorkerEventHandlers();
  }

  /**
   * Setup event handlers for monitoring and error handling
   */
  private setupWorkerEventHandlers(): void {
    [this.priorityWorker, this.rescoringWorker, this.analyticsWorker].forEach(worker => {
      worker.on('completed', (job) => {
        console.log(`Job ${job.id} completed successfully`);
        if (job.name === 'priority-scoring') this.metrics.priorityJobsProcessed++;
        else if (job.name === 'email-rescoring') this.metrics.rescoringJobsProcessed++;
        else if (job.name === 'analytics-refresh') this.metrics.analyticsJobsProcessed++;
      });

      worker.on('failed', (job, err) => {
        console.error(`Job ${job?.id} failed:`, err);
        this.metrics.failedJobs++;
      });

      worker.on('error', (err) => {
        console.error('Worker error:', err);
      });
    });
  }

  /**
   * Queue high-priority individual email priority scoring
   */
  async queuePriorityScoring(
    emailId: string, 
    accountId: string, 
    userId: string, 
    options: { priority?: 'high' | 'normal'; forceRescore?: boolean } = {}
  ): Promise<string> {
    const jobOptions: JobsOptions = {
      priority: options.priority === 'high' ? 1 : 10,
      delay: 0 // Process immediately
    };

    const job = await this.priorityQueue.add(
      'score-email-priority',
      {
        emailId,
        accountId,
        userId,
        forceRescore: options.forceRescore || false
      },
      jobOptions
    );

    console.log(`Queued priority scoring job ${job.id} for email ${emailId}`);
    return job.id!;
  }

  /**
   * Queue batch email rescoring with pagination support
   */
  async queueEmailRescoring(
    userId: string,
    options: {
      accountId?: string;
      ruleId?: string;
      batchSize?: number;
      priority?: 'high' | 'normal' | 'low';
    } = {}
  ): Promise<string> {
    const jobOptions: JobsOptions = {
      priority: options.priority === 'high' ? 1 : options.priority === 'low' ? 50 : 10,
      delay: options.priority === 'low' ? 5000 : 0 // Delay low-priority jobs slightly
    };

    const job = await this.rescoringQueue.add(
      'rescore-emails-batch',
      {
        userId,
        accountId: options.accountId,
        ruleId: options.ruleId,
        batchSize: options.batchSize || 100,
        priority: options.priority || 'normal'
      },
      jobOptions
    );

    console.log(`Queued email rescoring job ${job.id} for user ${userId}`);
    return job.id!;
  }

  /**
   * Process individual email priority scoring job
   */
  private async processPriorityJob(data: PriorityJobData): Promise<{ success: boolean; priority?: number }> {
    const startTime = Date.now();
    
    try {
      console.log(`Processing priority job for email ${data.emailId}`);
      
      // Resolve userId if needed (for sync context jobs)
      let userId = data.userId;
      if (userId === 'sync-context') {
        // Look up userId from accountId
        const accounts = await storage.getUserAccountConnections(''); // This needs to be fixed
        const account = accounts.find(acc => acc.id === data.accountId);
        if (account) {
          // Extract userId from account connection - need to get all accounts and find matching accountId
          const allUsers = await this.getUserIdFromAccountId(data.accountId);
          userId = allUsers || 'unknown';
        }
        
        if (userId === 'unknown' || userId === 'sync-context') {
          console.warn(`Could not resolve userId for account ${data.accountId}`);
          return { success: false };
        }
      }
      
      // Get email from database
      const emails = await storage.getMailMessages(data.accountId, undefined, 1, 0);
      const email = emails.find(e => e.id === data.emailId);
      
      if (!email) {
        console.warn(`Email ${data.emailId} not found`);
        return { success: false };
      }

      // Skip if already has priority and not forcing rescore
      if (!data.forceRescore && email.priority !== null && email.priority !== undefined) {
        console.log(`Email ${data.emailId} already has priority ${email.priority}, skipping`);
        return { success: true, priority: email.priority };
      }

      // Calculate priority using the priority engine
      const priorityEngine = new PriorityEngine();
      const result = await priorityEngine.calculatePriority(email, data.accountId, userId);

      // Update email priority in database
      await storage.updateMailPriority(
        data.emailId,
        result.autoPriority,
        result.prioritySource,
        result.ruleId
      );

      const processingTime = Date.now() - startTime;
      console.log(`Priority job completed for email ${data.emailId} in ${processingTime}ms - Priority: ${result.autoPriority}`);
      
      return { success: true, priority: result.autoPriority };
      
    } catch (error) {
      console.error(`Error processing priority job for email ${data.emailId}:`, error);
      throw error;
    }
  }

  /**
   * Helper method to resolve userId from accountId
   */
  private async getUserIdFromAccountId(accountId: string): Promise<string | null> {
    try {
      return await storage.getUserIdFromAccountId(accountId);
    } catch (error) {
      console.error(`Error resolving userId from accountId ${accountId}:`, error);
      return null;
    }
  }

  /**
   * Process batch email rescoring with pagination and performance controls
   */
  private async processRescoringJob(
    data: RescoringJobData, 
    job: Job<RescoringJobData>
  ): Promise<{ success: boolean; processedCount: number; nextCursor?: string }> {
    const startTime = Date.now();
    const batchSize = Math.min(data.batchSize || 100, 200); // Cap batch size
    
    try {
      console.log(`Processing rescoring job for user ${data.userId}, batch size ${batchSize}`);
      
      // Get user's accounts
      const userAccounts = await storage.getUserAccountConnections(data.userId);
      if (userAccounts.length === 0) {
        return { success: true, processedCount: 0 };
      }

      // Filter to specific account if provided
      const accountsToProcess = data.accountId 
        ? userAccounts.filter(acc => acc.id === data.accountId)
        : userAccounts;

      let totalProcessed = 0;
      
      // Process each account with pagination
      for (const account of accountsToProcess) {
        console.log(`Rescoring emails for account ${account.id}`);
        
        // Use pagination to avoid loading all emails at once
        let offset = 0;
        let hasMore = true;
        
        while (hasMore) {
          // Get emails in smaller batches with pagination
          const emails = await storage.getMailMessages(account.id, undefined, batchSize, offset);
          
          if (emails.length === 0) {
            hasMore = false;
            continue;
          }

          // Process batch with priority engine
          const priorityEngine = new PriorityEngine();
          const processedBatch = await priorityEngine.processBatchPriorities(
            emails, 
            account.id, 
            data.userId
          );
          
          totalProcessed += emails.length;
          offset += emails.length;

          // Update job progress
          await job.updateProgress({
            processed: totalProcessed,
            accountId: account.id
          });

          // Add backpressure control - small delay between batches
          await new Promise(resolve => setTimeout(resolve, 50));
          
          // Check if we have fewer emails than batch size (last batch)
          if (emails.length < batchSize) {
            hasMore = false;
          }
        }
      }

      const processingTime = Date.now() - startTime;
      console.log(`Rescoring job completed: ${totalProcessed} emails processed in ${processingTime}ms`);
      
      return { success: true, processedCount: totalProcessed };
      
    } catch (error) {
      console.error(`Error processing rescoring job for user ${data.userId}:`, error);
      throw error;
    }
  }

  /**
   * Process analytics refresh job
   */
  private async processAnalyticsJob(data: AnalyticsJobData): Promise<{ success: boolean }> {
    try {
      console.log(`Processing analytics job for user ${data.userId}`);
      
      // Implement analytics refresh logic here
      // For now, just a placeholder
      
      return { success: true };
      
    } catch (error) {
      console.error(`Error processing analytics job for user ${data.userId}:`, error);
      throw error;
    }
  }

  /**
   * Get job status by ID
   */
  async getJobStatus(jobId: string, queueName: 'priority-scoring' | 'email-rescoring' | 'analytics-refresh') {
    const queue = queueName === 'priority-scoring' ? this.priorityQueue :
                  queueName === 'email-rescoring' ? this.rescoringQueue :
                  this.analyticsQueue;
    
    const job = await queue.getJob(jobId);
    if (!job) return null;
    
    return {
      id: job.id,
      name: job.name,
      data: job.data,
      progress: job.progress,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      failedReason: job.failedReason,
      opts: job.opts
    };
  }

  /**
   * Process fallback jobs when Redis is unavailable
   */
  private processFallbackJobs(): void {
    try {
      // When Redis is unavailable, process jobs directly in memory
      // This is a simplified fallback that processes jobs synchronously
      
      if (this.isRedisAvailable) {
        return; // No need to process fallback jobs if Redis is available
      }
      
      // Process any queued fallback jobs
      // In a real implementation, this would handle jobs that were queued
      // while Redis was unavailable
      
      console.log('Processing fallback jobs (Redis unavailable)');
      
      // Clear any accumulated metrics for fallback processing
      if (this.metrics.totalJobs > 1000) {
        // Reset metrics periodically to prevent memory buildup
        this.metrics = {
          totalJobs: 0,
          successfulJobs: 0,
          failedJobs: 0,
          averageProcessingTime: 0
        };
      }
      
    } catch (error) {
      console.error('Error processing fallback jobs:', error);
      // Don't let fallback job processing errors crash the application
    }
  }

  /**
   * Get metrics for monitoring
   */
  getMetrics() {
    return {
      ...this.metrics,
      queues: {
        priority: { waiting: this.priorityQueue.getWaiting().then(jobs => jobs.length) },
        rescoring: { waiting: this.rescoringQueue.getWaiting().then(jobs => jobs.length) },
        analytics: { waiting: this.analyticsQueue.getWaiting().then(jobs => jobs.length) }
      }
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log('Shutting down distributed job service...');
    
    await Promise.all([
      this.priorityWorker.close(),
      this.rescoringWorker.close(),
      this.analyticsWorker.close()
    ]);

    await Promise.all([
      this.priorityQueue.close(),
      this.rescoringQueue.close(),
      this.analyticsQueue.close()
    ]);
    
    console.log('Distributed job service shutdown complete');
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