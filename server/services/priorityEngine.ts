import { storage } from "../storage";
import type { MailMessage, PriorityRule, VipContact } from "@shared/schema";

/**
 * Priority factors that contribute to the overall priority score
 */
interface PriorityFactors {
  vipBonus: number;
  ruleScore: number;
  keywordScore: number;
  urgencyScore: number;
  threadScore: number;
  attachmentScore: number;
  timeScore: number;
}

/**
 * Rule condition for priority evaluation
 */
interface RuleCondition {
  field: 'from' | 'to' | 'subject' | 'body' | 'hasAttachments';
  operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'regex' | 'domain';
  value: string;
  caseSensitive?: boolean;
}

/**
 * Priority rule with parsed conditions
 */
interface ParsedPriorityRule extends Omit<PriorityRule, 'conditionsJson'> {
  conditions: {
    logic: 'AND' | 'OR';
    rules: RuleCondition[];
  };
}

/**
 * Priority scoring engine that evaluates emails and assigns intelligent priority scores
 */
export class PriorityEngine {
  private urgencyKeywords = [
    'urgent', 'asap', 'immediately', 'deadline', 'critical', 'emergency', 
    'priority', 'important', 'rush', 'time sensitive', 'breaking'
  ];

  private lowPriorityKeywords = [
    'newsletter', 'unsubscribe', 'marketing', 'promotion', 'spam',
    'no-reply', 'automated', 'notification', 'update', 'digest'
  ];

  /**
   * Calculate the intelligent priority score for an email
   */
  async calculatePriority(
    email: Partial<MailMessage>, 
    accountId: string, 
    userId: string
  ): Promise<{
    priority: number;
    autoPriority: number;
    priorityScore: number;
    priorityFactors: PriorityFactors;
    prioritySource: string;
    ruleId?: string;
    isVip: boolean;
  }> {
    const factors: PriorityFactors = {
      vipBonus: 0,
      ruleScore: 0,
      keywordScore: 0,
      urgencyScore: 0,
      threadScore: 0,
      attachmentScore: 0,
      timeScore: 0
    };

    // Check if sender is VIP
    const vipContact = email.from ? await storage.getVipContactByEmail(userId, this.extractEmail(email.from)) : null;
    const isVip = !!vipContact;

    if (isVip && vipContact) {
      factors.vipBonus = vipContact.priority * 15; // VIP priority boost (0-45 points)
      
      // Update VIP interaction count
      await storage.updateVipInteraction(userId, vipContact.email);
    }

    // Evaluate priority rules
    const { ruleScore, matchedRuleId } = await this.evaluatePriorityRules(email, accountId);
    factors.ruleScore = ruleScore;

    // Calculate keyword-based scores
    factors.keywordScore = this.calculateKeywordScore(email);
    factors.urgencyScore = this.calculateUrgencyScore(email);
    factors.attachmentScore = this.calculateAttachmentScore(email);
    factors.timeScore = this.calculateTimeScore(email);

    // Calculate total priority score (0-100)
    const totalScore = Object.values(factors).reduce((sum, score) => sum + score, 0);
    const clampedScore = Math.min(100, Math.max(0, totalScore));

    // Convert to 0-3 priority scale
    const autoPriority = this.scoreToPriority(clampedScore);
    
    // Determine priority source
    let prioritySource = 'auto';
    if (matchedRuleId) {
      prioritySource = 'rule';
    } else if (isVip) {
      prioritySource = 'vip';
    }

    return {
      priority: email.priority || autoPriority,
      autoPriority,
      priorityScore: clampedScore,
      priorityFactors: factors,
      prioritySource,
      ruleId: matchedRuleId,
      isVip
    };
  }

  /**
   * Evaluate priority rules against an email
   */
  private async evaluatePriorityRules(
    email: Partial<MailMessage>, 
    accountId: string
  ): Promise<{ ruleScore: number; matchedRuleId?: string }> {
    const rules = await storage.getPriorityRules(accountId);
    const activeRules = rules
      .filter(rule => rule.isActive)
      .sort((a, b) => (a.executionOrder || 0) - (b.executionOrder || 0));

    for (const rule of activeRules) {
      try {
        const parsedRule = this.parseRule(rule);
        if (this.evaluateRule(parsedRule, email)) {
          // Update rule statistics
          await storage.updatePriorityRuleStats(rule.id, 1);
          
          return {
            ruleScore: rule.priority * 20, // Rule priority contributes 0-60 points
            matchedRuleId: rule.id
          };
        }
      } catch (error) {
        console.error(`Error evaluating priority rule ${rule.id}:`, error);
      }
    }

    return { ruleScore: 0 };
  }

  /**
   * Parse priority rule JSON conditions
   */
  private parseRule(rule: PriorityRule): ParsedPriorityRule {
    try {
      const conditions = JSON.parse(rule.conditionsJson);
      return {
        ...rule,
        conditions
      };
    } catch (error) {
      throw new Error(`Invalid rule conditions JSON: ${error}`);
    }
  }

  /**
   * Evaluate a single rule against an email
   */
  private evaluateRule(rule: ParsedPriorityRule, email: Partial<MailMessage>): boolean {
    const { logic, rules } = rule.conditions;
    
    const results = rules.map(condition => this.evaluateCondition(condition, email));
    
    if (logic === 'AND') {
      return results.every(result => result);
    } else {
      return results.some(result => result);
    }
  }

  /**
   * Evaluate a single condition against an email
   */
  private evaluateCondition(condition: RuleCondition, email: Partial<MailMessage>): boolean {
    let fieldValue = '';
    
    switch (condition.field) {
      case 'from':
        fieldValue = email.from || '';
        break;
      case 'to':
        fieldValue = email.to || '';
        break;
      case 'subject':
        fieldValue = email.subject || '';
        break;
      case 'body':
        fieldValue = (email.bodyText || email.bodyHtml || '');
        break;
      case 'hasAttachments':
        return condition.value.toLowerCase() === String(email.hasAttachments).toLowerCase();
      default:
        return false;
    }

    if (!condition.caseSensitive) {
      fieldValue = fieldValue.toLowerCase();
      condition.value = condition.value.toLowerCase();
    }

    switch (condition.operator) {
      case 'contains':
        return fieldValue.includes(condition.value);
      case 'equals':
        return fieldValue === condition.value;
      case 'startsWith':
        return fieldValue.startsWith(condition.value);
      case 'endsWith':
        return fieldValue.endsWith(condition.value);
      case 'domain':
        const emailDomain = this.extractDomain(fieldValue);
        return emailDomain === condition.value;
      case 'regex':
        try {
          const regex = new RegExp(condition.value, condition.caseSensitive ? '' : 'i');
          return regex.test(fieldValue);
        } catch {
          return false;
        }
      default:
        return false;
    }
  }

  /**
   * Calculate keyword-based priority score
   */
  private calculateKeywordScore(email: Partial<MailMessage>): number {
    const text = `${email.subject || ''} ${email.bodyText || ''}`.toLowerCase();
    
    // Check for low priority indicators first
    for (const keyword of this.lowPriorityKeywords) {
      if (text.includes(keyword)) {
        return -10; // Negative score for low priority emails
      }
    }

    // Check for urgent keywords
    let urgentKeywordCount = 0;
    for (const keyword of this.urgencyKeywords) {
      if (text.includes(keyword)) {
        urgentKeywordCount++;
      }
    }

    return Math.min(15, urgentKeywordCount * 5); // Up to 15 points for keywords
  }

  /**
   * Calculate urgency score based on indicators
   */
  private calculateUrgencyScore(email: Partial<MailMessage>): number {
    let score = 0;
    const subject = (email.subject || '').toLowerCase();
    
    // Exclamation marks indicate urgency
    const exclamationCount = (subject.match(/!/g) || []).length;
    score += Math.min(5, exclamationCount * 2);
    
    // ALL CAPS words indicate shouting/urgency
    const allCapsWords = subject.match(/\b[A-Z]{3,}\b/g) || [];
    score += Math.min(5, allCapsWords.length * 1);
    
    // FW: or RE: patterns for thread priority
    if (subject.includes('re:') || subject.includes('fw:')) {
      score += 2;
    }
    
    return score;
  }

  /**
   * Calculate attachment-based score
   */
  private calculateAttachmentScore(email: Partial<MailMessage>): number {
    return email.hasAttachments ? 3 : 0;
  }

  /**
   * Calculate time-based score (recent emails get slight boost)
   */
  private calculateTimeScore(email: Partial<MailMessage>): number {
    if (!email.date) return 0;
    
    const emailDate = new Date(email.date);
    const now = new Date();
    const hoursDiff = (now.getTime() - emailDate.getTime()) / (1000 * 60 * 60);
    
    // Recent emails (within 2 hours) get a small boost
    if (hoursDiff <= 2) {
      return 2;
    }
    
    return 0;
  }

  /**
   * Convert 0-100 score to 0-3 priority scale
   */
  private scoreToPriority(score: number): number {
    if (score >= 70) return 3; // Critical
    if (score >= 50) return 2; // High
    if (score >= 20) return 1; // Normal
    return 0; // Low
  }

  /**
   * Extract email address from "Name <email@domain.com>" format
   */
  private extractEmail(fromField: string): string {
    const match = fromField.match(/<([^>]+)>/);
    return match ? match[1] : fromField.trim();
  }

  /**
   * Extract domain from email address
   */
  private extractDomain(email: string): string {
    const cleanEmail = this.extractEmail(email);
    const atIndex = cleanEmail.lastIndexOf('@');
    return atIndex > -1 ? cleanEmail.substring(atIndex + 1).toLowerCase() : '';
  }

  /**
   * Batch process emails for priority calculation with optimized bulk updates
   */
  async processBatchPriorities(emails: MailMessage[], accountId: string, userId: string): Promise<void> {
    if (emails.length === 0) return;
    
    console.log(`Processing priority batch: ${emails.length} emails for account ${accountId}`);
    const startTime = Date.now();
    
    // Process priorities in parallel with controlled concurrency
    const batchSize = 10; // Process 10 emails at a time
    const updates: Array<{
      id: string;
      priority: number;
      prioritySource: string;
      ruleId?: string;
      priorityScore?: number;
      priorityFactors?: any;
      isVip?: boolean;
      autoPriority?: number;
      isInFocus?: boolean;
    }> = [];
    
    // Process emails in smaller concurrent batches
    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (email) => {
        try {
          const priorityData = await this.calculatePriority(email, accountId, userId);
          
          return {
            id: email.id,
            priority: priorityData.priority,
            prioritySource: priorityData.prioritySource,
            ruleId: priorityData.ruleId,
            priorityScore: priorityData.priorityScore,
            priorityFactors: priorityData.priorityFactors,
            isVip: priorityData.isVip,
            autoPriority: priorityData.autoPriority,
            isInFocus: priorityData.autoPriority >= 2 || priorityData.isVip || priorityData.priority >= 2
          };
        } catch (error) {
          console.error(`Error processing priority for email ${email.id}:`, error);
          return null;
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      updates.push(...batchResults.filter(Boolean) as any[]);
    }
    
    // Bulk update all priorities at once for efficiency
    if (updates.length > 0) {
      const updatedCount = await storage.bulkUpdateMailPriorities(updates);
      const processingTime = Date.now() - startTime;
      console.log(`Bulk priority update completed: ${updatedCount} emails in ${processingTime}ms`);
    }
  }

  /**
   * Optimized partitioned rescoring for massive email volumes
   */
  async processPartitionedRescoring(
    accountId: string, 
    userId: string,
    options: {
      batchSize?: number;
      ruleId?: string;
      folder?: string;
      modifiedSince?: Date;
      onProgress?: (processed: number, total?: number) => void;
    } = {}
  ): Promise<{ processedCount: number; errors: number }> {
    const batchSize = Math.min(options.batchSize || 100, 200);
    let processedCount = 0;
    let errors = 0;
    let cursor: string | undefined;
    
    console.log(`Starting partitioned rescoring for account ${accountId}, batch size ${batchSize}`);
    
    // Count total emails for progress tracking (if requested)
    let totalCount: number | undefined;
    if (options.onProgress) {
      totalCount = await storage.countEmailsNeedingPriorityUpdate(accountId, options.modifiedSince);
      console.log(`Total emails needing priority update: ${totalCount}`);
    }
    
    // Process emails in partitioned batches using cursor-based pagination
    do {
      try {
        const result = await storage.getMailMessagesPartitioned(accountId, {
          limit: batchSize,
          cursor,
          folder: options.folder,
          needsPriorityUpdate: true,
          modifiedSince: options.modifiedSince
        });
        
        if (result.messages.length === 0) {
          console.log('No more emails to process');
          break;
        }
        
        console.log(`Processing batch of ${result.messages.length} emails`);
        
        // Process batch priorities
        await this.processBatchPriorities(result.messages, accountId, userId);
        
        processedCount += result.messages.length;
        cursor = result.nextCursor;
        
        // Report progress
        if (options.onProgress) {
          options.onProgress(processedCount, totalCount);
        }
        
        // Add small delay between batches to prevent overwhelming the database
        if (cursor) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        
      } catch (error) {
        console.error('Error processing email batch:', error);
        errors++;
        
        // Break if too many consecutive errors
        if (errors > 5) {
          console.error('Too many errors, stopping partitioned rescoring');
          break;
        }
      }
    } while (cursor);
    
    console.log(`Partitioned rescoring completed: ${processedCount} emails processed, ${errors} errors`);
    return { processedCount, errors };
  }

  /**
   * Incremental rescoring for rule changes - only process affected emails
   */
  async processIncrementalRescoring(
    ruleId: string,
    accountId: string,
    userId: string,
    options: {
      batchSize?: number;
      onProgress?: (processed: number, total: number) => void;
    } = {}
  ): Promise<{ processedCount: number; errors: number }> {
    const batchSize = options.batchSize || 100;
    let processedCount = 0;
    let errors = 0;
    
    console.log(`Starting incremental rescoring for rule ${ruleId} in account ${accountId}`);
    
    try {
      // Get emails affected by this specific rule
      const affectedEmails = await storage.getEmailsAffectedByRule(ruleId, accountId, 10000);
      
      console.log(`Found ${affectedEmails.length} emails affected by rule ${ruleId}`);
      
      // Process in batches
      for (let i = 0; i < affectedEmails.length; i += batchSize) {
        const batch = affectedEmails.slice(i, i + batchSize);
        
        try {
          await this.processBatchPriorities(batch, accountId, userId);
          processedCount += batch.length;
          
          // Report progress
          if (options.onProgress) {
            options.onProgress(processedCount, affectedEmails.length);
          }
          
          console.log(`Incremental rescoring progress: ${processedCount}/${affectedEmails.length} emails`);
          
        } catch (batchError) {
          console.error(`Error processing incremental batch ${i}-${i + batch.length}:`, batchError);
          errors++;
        }
      }
      
    } catch (error) {
      console.error(`Error in incremental rescoring for rule ${ruleId}:`, error);
      errors++;
    }
    
    console.log(`Incremental rescoring completed: ${processedCount} emails processed, ${errors} errors`);
    return { processedCount, errors };
  }
}

// Export singleton instance
export const priorityEngine = new PriorityEngine();