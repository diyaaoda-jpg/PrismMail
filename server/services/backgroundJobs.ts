import { storage } from "../storage";
import { PriorityEngine } from "./priorityEngine";

interface BackgroundJob {
  id: string;
  type: 'rescore_emails' | 'refresh_analytics';
  userId: string;
  accountId?: string;
  ruleId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  progress?: {
    processed: number;
    total: number;
  };
  error?: string;
}

/**
 * Background job system for handling long-running tasks like email rescoring
 */
export class BackgroundJobService {
  private static instance: BackgroundJobService;
  private jobs = new Map<string, BackgroundJob>();
  private runningJobs = new Set<string>();
  
  static getInstance(): BackgroundJobService {
    if (!BackgroundJobService.instance) {
      BackgroundJobService.instance = new BackgroundJobService();
    }
    return BackgroundJobService.instance;
  }

  /**
   * Queue a job to rescore all emails for a user's accounts when rules change
   */
  async queueEmailRescoring(userId: string, accountId?: string, ruleId?: string): Promise<string> {
    const jobId = `rescore_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const job: BackgroundJob = {
      id: jobId,
      type: 'rescore_emails',
      userId,
      accountId,
      ruleId,
      status: 'pending',
      createdAt: new Date()
    };
    
    this.jobs.set(jobId, job);
    console.log(`Queued email rescoring job ${jobId} for user ${userId}, account ${accountId || 'all'}`);
    
    // Start processing immediately (in production, this would use a proper job queue)
    setImmediate(() => this.processJob(jobId));
    
    return jobId;
  }

  /**
   * Get job status by ID
   */
  getJobStatus(jobId: string): BackgroundJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get all jobs for a user
   */
  getUserJobs(userId: string): BackgroundJob[] {
    return Array.from(this.jobs.values()).filter(job => job.userId === userId);
  }

  /**
   * Process a background job
   */
  private async processJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || this.runningJobs.has(jobId)) {
      return;
    }

    this.runningJobs.add(jobId);
    job.status = 'running';
    job.startedAt = new Date();
    
    try {
      if (job.type === 'rescore_emails') {
        await this.processEmailRescoring(job);
      }
      
      job.status = 'completed';
      job.completedAt = new Date();
      console.log(`Background job ${jobId} completed successfully`);
      
    } catch (error: any) {
      job.status = 'failed';
      job.error = error.message;
      job.completedAt = new Date();
      console.error(`Background job ${jobId} failed:`, error);
      
    } finally {
      this.runningJobs.delete(jobId);
    }
  }

  /**
   * Process email rescoring for a user's accounts
   */
  private async processEmailRescoring(job: BackgroundJob): Promise<void> {
    const priorityEngine = new PriorityEngine();
    
    // Get user's account connections
    const userAccounts = await storage.getUserAccountConnections(job.userId);
    
    if (userAccounts.length === 0) {
      console.log(`No accounts found for user ${job.userId}`);
      return;
    }

    // Filter to specific account if provided
    const accountsToProcess = job.accountId 
      ? userAccounts.filter((acc: any) => acc.id === job.accountId)
      : userAccounts;

    let totalProcessed = 0;
    let totalEmails = 0;

    // Count total emails first for progress tracking
    for (const account of accountsToProcess) {
      const accountEmails = await storage.getMailMessages(account.id);
      totalEmails += accountEmails.length;
    }

    job.progress = { processed: 0, total: totalEmails };
    console.log(`Starting to rescore ${totalEmails} emails across ${accountsToProcess.length} accounts`);

    // Process emails in batches by account
    for (const account of accountsToProcess) {
      console.log(`Rescoring emails for account ${account.id} (${account.name})`);
      
      // Get all emails for this account
      const emails = await storage.getMailMessages(account.id);
      
      // Process in smaller batches to avoid memory issues
      const batchSize = 50;
      for (let i = 0; i < emails.length; i += batchSize) {
        const batch = emails.slice(i, i + batchSize);
        
        try {
          await priorityEngine.processBatchPriorities(batch, account.id, job.userId);
          
          totalProcessed += batch.length;
          job.progress = { processed: totalProcessed, total: totalEmails };
          
          console.log(`Processed batch: ${totalProcessed}/${totalEmails} emails (${Math.round(totalProcessed/totalEmails*100)}%)`);
          
          // Add small delay to prevent overwhelming the database
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (batchError) {
          console.error(`Error processing batch for account ${account.id}:`, batchError);
          // Continue with next batch
        }
      }
    }

    console.log(`Email rescoring completed: ${totalProcessed} emails processed`);
  }

  /**
   * Clean up old completed jobs (keep last 10 per user)
   */
  async cleanupOldJobs(): Promise<void> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    // Group jobs by user
    const jobsByUser = new Map<string, BackgroundJob[]>();
    const allJobs = Array.from(this.jobs.values());
    for (const job of allJobs) {
      if (!jobsByUser.has(job.userId)) {
        jobsByUser.set(job.userId, []);
      }
      jobsByUser.get(job.userId)!.push(job);
    }
    
    // Clean up old jobs for each user
    const userJobEntries = Array.from(jobsByUser.entries());
    for (const [userId, userJobs] of userJobEntries) {
      // Sort by creation date, newest first
      userJobs.sort((a: BackgroundJob, b: BackgroundJob) => b.createdAt.getTime() - a.createdAt.getTime());
      
      // Keep latest 10 jobs, remove older completed/failed jobs
      const toDelete = userJobs.slice(10).filter((job: BackgroundJob) => 
        (job.status === 'completed' || job.status === 'failed') && 
        job.createdAt < oneHourAgo
      );
      
      for (const job of toDelete) {
        this.jobs.delete(job.id);
      }
      
      if (toDelete.length > 0) {
        console.log(`Cleaned up ${toDelete.length} old jobs for user ${userId}`);
      }
    }
  }
}

// Export singleton instance
export const backgroundJobService = BackgroundJobService.getInstance();

// Clean up old jobs every hour
setInterval(() => {
  backgroundJobService.cleanupOldJobs().catch(error => {
    console.error('Error cleaning up old jobs:', error);
  });
}, 60 * 60 * 1000);