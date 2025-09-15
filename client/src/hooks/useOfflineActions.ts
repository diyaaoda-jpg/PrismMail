// Offline Actions Hook
// Provides email actions that work both online and offline

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useOfflineStatus } from '@/hooks/useOfflineStatus';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import type { OfflineAction } from '@/lib/serviceWorker';

export interface EmailAction {
  emailId: string;
  accountId?: string;
  folderId?: string;
}

export interface SendEmailData {
  accountId: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  attachments?: any[];
}

export interface MarkReadData extends EmailAction {
  isRead: boolean;
}

export interface StarEmailData extends EmailAction {
  isStarred: boolean;
}

export interface SaveDraftData {
  accountId: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body?: string;
  bodyHtml?: string;
  attachmentIds?: string[];
  draftId?: string;
}

export function useOfflineActions() {
  const { queueAction, isOnline } = useOfflineStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Send Email Action
  const sendEmail = useMutation({
    mutationFn: async (data: SendEmailData) => {
      if (!isOnline) {
        queueAction({
          type: 'SEND_EMAIL',
          data
        });
        return { queued: true, messageId: null };
      }
      
      const response = await apiRequest('POST', '/api/emails/send', data);
      return await response.json();
    },
    onSuccess: (result, variables) => {
      if (result.queued) {
        toast({
          title: "Email Queued",
          description: "Your email will be sent when you're back online.",
          variant: "default"
        });
      } else {
        toast({
          title: "Email Sent",
          description: "Your email was sent successfully.",
          variant: "default"
        });
        
        // Invalidate relevant queries
        queryClient.invalidateQueries({ queryKey: ['/api/emails'] });
        queryClient.invalidateQueries({ queryKey: ['/api/drafts'] });
      }
    },
    onError: (error) => {
      console.error('Send email error:', error);
      toast({
        title: "Send Failed",
        description: "Failed to send email. Please try again.",
        variant: "destructive"
      });
    }
  });

  // Mark Email as Read/Unread
  const markEmailRead = useMutation({
    mutationFn: async (data: MarkReadData) => {
      if (!isOnline) {
        queueAction({
          type: 'MARK_READ',
          data
        });
        return { queued: true };
      }
      
      const response = await apiRequest('PATCH', `/api/emails/${data.emailId}/read`, {
        isRead: data.isRead
      });
      return await response.json();
    },
    onMutate: async (data) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ['/api/emails'] });
      
      const previousEmails = queryClient.getQueryData(['/api/emails']);
      
      queryClient.setQueryData(['/api/emails'], (old: any) => {
        if (!old?.data) return old;
        
        return {
          ...old,
          data: old.data.map((email: any) => 
            email.id === data.emailId 
              ? { ...email, isRead: data.isRead }
              : email
          )
        };
      });
      
      return { previousEmails };
    },
    onError: (err, data, context) => {
      // Revert optimistic update
      if (context?.previousEmails) {
        queryClient.setQueryData(['/api/emails'], context.previousEmails);
      }
      
      toast({
        title: "Action Failed",
        description: isOnline ? "Failed to update email status." : "Action will retry when online.",
        variant: isOnline ? "destructive" : "default"
      });
    },
    onSuccess: (result) => {
      if (!result.queued && isOnline) {
        queryClient.invalidateQueries({ queryKey: ['/api/emails'] });
      }
    }
  });

  // Star/Unstar Email
  const starEmail = useMutation({
    mutationFn: async (data: StarEmailData) => {
      if (!isOnline) {
        queueAction({
          type: 'STAR_EMAIL',
          data
        });
        return { queued: true };
      }
      
      const response = await apiRequest('PATCH', `/api/emails/${data.emailId}/star`, {
        isStarred: data.isStarred
      });
      return await response.json();
    },
    onMutate: async (data) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ['/api/emails'] });
      
      const previousEmails = queryClient.getQueryData(['/api/emails']);
      
      queryClient.setQueryData(['/api/emails'], (old: any) => {
        if (!old?.data) return old;
        
        return {
          ...old,
          data: old.data.map((email: any) => 
            email.id === data.emailId 
              ? { ...email, isStarred: data.isStarred }
              : email
          )
        };
      });
      
      return { previousEmails };
    },
    onError: (err, data, context) => {
      // Revert optimistic update
      if (context?.previousEmails) {
        queryClient.setQueryData(['/api/emails'], context.previousEmails);
      }
      
      toast({
        title: "Action Failed",
        description: isOnline ? "Failed to update email star status." : "Action will retry when online.",
        variant: isOnline ? "destructive" : "default"
      });
    },
    onSuccess: (result) => {
      if (!result.queued && isOnline) {
        queryClient.invalidateQueries({ queryKey: ['/api/emails'] });
      }
    }
  });

  // Delete Email
  const deleteEmail = useMutation({
    mutationFn: async (data: EmailAction) => {
      if (!isOnline) {
        queueAction({
          type: 'DELETE_EMAIL',
          data
        });
        return { queued: true };
      }
      
      const response = await apiRequest('DELETE', `/api/emails/${data.emailId}`);
      return await response.json();
    },
    onMutate: async (data) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ['/api/emails'] });
      
      const previousEmails = queryClient.getQueryData(['/api/emails']);
      
      queryClient.setQueryData(['/api/emails'], (old: any) => {
        if (!old?.data) return old;
        
        return {
          ...old,
          data: old.data.filter((email: any) => email.id !== data.emailId)
        };
      });
      
      return { previousEmails };
    },
    onError: (err, data, context) => {
      // Revert optimistic update
      if (context?.previousEmails) {
        queryClient.setQueryData(['/api/emails'], context.previousEmails);
      }
      
      toast({
        title: "Delete Failed",
        description: isOnline ? "Failed to delete email." : "Delete will complete when online.",
        variant: isOnline ? "destructive" : "default"
      });
    },
    onSuccess: (result, variables) => {
      if (result.queued) {
        toast({
          title: "Delete Queued",
          description: "Email will be deleted when you're back online.",
          variant: "default"
        });
      } else {
        toast({
          title: "Email Deleted",
          description: "Email was deleted successfully.",
          variant: "default"
        });
        
        queryClient.invalidateQueries({ queryKey: ['/api/emails'] });
      }
    }
  });

  // Save Draft
  const saveDraft = useMutation({
    mutationFn: async (data: SaveDraftData) => {
      if (!isOnline) {
        queueAction({
          type: 'SAVE_DRAFT',
          data
        });
        return { queued: true, draftId: data.draftId || 'offline-' + Date.now() };
      }
      
      const response = await apiRequest('POST', '/api/drafts', data);
      return await response.json();
    },
    onSuccess: (result, variables) => {
      if (result.queued) {
        toast({
          title: "Draft Saved Offline",
          description: "Your draft will sync when you're back online.",
          variant: "default"
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ['/api/drafts'] });
      }
    },
    onError: (error) => {
      console.error('Save draft error:', error);
      toast({
        title: "Save Failed",
        description: "Failed to save draft. Changes may be lost.",
        variant: "destructive"
      });
    }
  });

  return {
    sendEmail,
    markEmailRead,
    starEmail,
    deleteEmail,
    saveDraft,
    isOnline
  };
}