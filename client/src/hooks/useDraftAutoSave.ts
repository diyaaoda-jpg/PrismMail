import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { SaveDraftRequest, SaveDraftResponse, DraftAutoSaveStatus, DraftContent } from '@shared/schema';
import { useToast } from '@/hooks/use-toast';

interface UseDraftAutoSaveOptions {
  accountId?: string;
  draftId?: string;
  autoSaveInterval?: number; // milliseconds, default 30 seconds
  debounceDelay?: number; // milliseconds, default 2 seconds
  enableLocalStorage?: boolean; // default true
}

interface UseDraftAutoSaveReturn {
  saveDraft: (draftData: Partial<DraftContent>) => void;
  saveDraftManually: (draftData: Partial<DraftContent>) => Promise<void>;
  deleteDraft: (draftId: string) => Promise<void>;
  status: DraftAutoSaveStatus;
  currentDraftId: string | undefined;
  clearDraft: () => void;
}

const DRAFT_STORAGE_PREFIX = 'prismmail_draft_';
const AUTO_SAVE_INTERVAL = 30000; // 30 seconds
const DEBOUNCE_DELAY = 2000; // 2 seconds

export function useDraftAutoSave(options: UseDraftAutoSaveOptions): UseDraftAutoSaveReturn {
  const {
    accountId,
    draftId: initialDraftId,
    autoSaveInterval = AUTO_SAVE_INTERVAL,
    debounceDelay = DEBOUNCE_DELAY,
    enableLocalStorage = true
  } = options;

  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // State for draft status and current draft ID
  const [status, setStatus] = useState<DraftAutoSaveStatus>({
    isAutoSaving: false,
    hasUnsavedChanges: false
  });
  const [currentDraftId, setCurrentDraftId] = useState<string | undefined>(initialDraftId);

  // Refs for managing timers and current draft data
  const debounceTimerRef = useRef<NodeJS.Timeout>();
  const autoSaveTimerRef = useRef<NodeJS.Timeout>();
  const lastSavedDataRef = useRef<string>('');
  const pendingDraftDataRef = useRef<Partial<DraftContent>>({});

  // Local storage key based on account and draft
  const getLocalStorageKey = useCallback((drafId?: string) => {
    if (drafId) {
      return `${DRAFT_STORAGE_PREFIX}${drafId}`;
    }
    return accountId ? `${DRAFT_STORAGE_PREFIX}${accountId}_new` : `${DRAFT_STORAGE_PREFIX}new`;
  }, [accountId]);

  // Save to local storage
  const saveToLocalStorage = useCallback((draftData: Partial<DraftContent>) => {
    if (!enableLocalStorage) return;
    
    try {
      const storageKey = getLocalStorageKey(currentDraftId);
      const dataWithTimestamp = {
        ...draftData,
        lastSavedLocally: new Date().toISOString(),
        accountId
      };
      localStorage.setItem(storageKey, JSON.stringify(dataWithTimestamp));
    } catch (error) {
      console.warn('Failed to save draft to localStorage:', error);
    }
  }, [enableLocalStorage, getLocalStorageKey, currentDraftId, accountId]);

  // Load from local storage
  const loadFromLocalStorage = useCallback((): Partial<DraftContent> | null => {
    if (!enableLocalStorage) return null;
    
    try {
      const storageKey = getLocalStorageKey(currentDraftId);
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Failed to load draft from localStorage:', error);
    }
    return null;
  }, [enableLocalStorage, getLocalStorageKey, currentDraftId]);

  // Clear local storage
  const clearLocalStorage = useCallback(() => {
    if (!enableLocalStorage) return;
    
    try {
      const storageKey = getLocalStorageKey(currentDraftId);
      localStorage.removeItem(storageKey);
    } catch (error) {
      console.warn('Failed to clear draft from localStorage:', error);
    }
  }, [enableLocalStorage, getLocalStorageKey, currentDraftId]);

  // Mutation for saving drafts
  const saveDraftMutation = useMutation({
    mutationFn: async ({ draftData, isManual = false }: { draftData: Partial<DraftContent>, isManual?: boolean }) => {
      if (!accountId) {
        throw new Error('Account ID is required to save draft');
      }

      const requestData: SaveDraftRequest = {
        accountId,
        to: draftData.to,
        cc: draftData.cc,
        bcc: draftData.bcc,
        subject: draftData.subject,
        body: draftData.body,
        bodyHtml: draftData.bodyHtml,
        attachmentIds: draftData.attachmentIds || [],
        draftId: currentDraftId
      };

      const endpoint = currentDraftId 
        ? `/api/accounts/${accountId}/drafts/${currentDraftId}`
        : `/api/accounts/${accountId}/drafts`;
      
      const method = currentDraftId ? 'PUT' : 'POST';
      
      const response = await apiRequest(method, endpoint, requestData);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to save draft');
      }

      const result = await response.json();
      return { response: result.data as SaveDraftResponse, isManual };
    },
    onSuccess: ({ response, isManual }) => {
      setCurrentDraftId(response.draftId);
      setStatus(prev => ({
        ...prev,
        isAutoSaving: false,
        hasUnsavedChanges: false,
        lastSavedAt: response.savedAt,
        autoSaveError: undefined
      }));

      // Update local storage with saved data
      saveToLocalStorage(pendingDraftDataRef.current);
      
      // Update last saved data reference
      lastSavedDataRef.current = JSON.stringify(pendingDraftDataRef.current);

      if (isManual) {
        toast({
          title: "Draft Saved",
          description: "Your draft has been saved successfully.",
        });
      }

      // Invalidate relevant queries
      if (accountId) {
        queryClient.invalidateQueries({ queryKey: ['/api/accounts', accountId, 'drafts'] });
        queryClient.invalidateQueries({ queryKey: ['/api/drafts'] });
      }
    },
    onError: (error: Error, { isManual }) => {
      console.error('Draft save failed:', error);
      
      setStatus(prev => ({
        ...prev,
        isAutoSaving: false,
        autoSaveError: error.message
      }));

      if (isManual) {
        toast({
          title: "Failed to Save Draft",
          description: error.message || "An error occurred while saving the draft.",
          variant: "destructive"
        });
      }
    }
  });

  // Mutation for deleting drafts
  const deleteDraftMutation = useMutation({
    mutationFn: async (draftIdToDelete: string) => {
      if (!accountId) {
        throw new Error('Account ID is required to delete draft');
      }

      const response = await apiRequest('DELETE', `/api/accounts/${accountId}/drafts/${draftIdToDelete}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to delete draft');
      }
    },
    onSuccess: () => {
      clearLocalStorage();
      setCurrentDraftId(undefined);
      setStatus({
        isAutoSaving: false,
        hasUnsavedChanges: false
      });

      // Invalidate relevant queries
      if (accountId) {
        queryClient.invalidateQueries({ queryKey: ['/api/accounts', accountId, 'drafts'] });
        queryClient.invalidateQueries({ queryKey: ['/api/drafts'] });
      }

      toast({
        title: "Draft Deleted",
        description: "The draft has been deleted successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Delete Draft",
        description: error.message || "An error occurred while deleting the draft.",
        variant: "destructive"
      });
    }
  });

  // Debounced save function
  const saveDraft = useCallback((draftData: Partial<DraftContent>) => {
    // Store the data for later use
    pendingDraftDataRef.current = { ...pendingDraftDataRef.current, ...draftData };
    
    // Save to local storage immediately
    saveToLocalStorage(pendingDraftDataRef.current);
    
    // Check if data has changed
    const currentDataString = JSON.stringify(pendingDraftDataRef.current);
    const hasChanged = currentDataString !== lastSavedDataRef.current;
    
    setStatus(prev => ({
      ...prev,
      hasUnsavedChanges: hasChanged
    }));

    if (!hasChanged || !accountId) {
      return;
    }

    // Clear existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set up new debounced save
    debounceTimerRef.current = setTimeout(() => {
      if (!saveDraftMutation.isPending) {
        setStatus(prev => ({ ...prev, isAutoSaving: true }));
        saveDraftMutation.mutate({ draftData: pendingDraftDataRef.current });
      }
    }, debounceDelay);
  }, [accountId, debounceDelay, saveToLocalStorage, saveDraftMutation]);

  // Manual save function (immediate)
  const saveDraftManually = useCallback(async (draftData: Partial<DraftContent>) => {
    pendingDraftDataRef.current = { ...pendingDraftDataRef.current, ...draftData };
    
    if (!accountId) {
      throw new Error('Account ID is required to save draft');
    }

    // Clear any pending debounced save
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    setStatus(prev => ({ ...prev, isAutoSaving: true }));
    
    try {
      await saveDraftMutation.mutateAsync({ draftData: pendingDraftDataRef.current, isManual: true });
    } catch (error) {
      throw error;
    }
  }, [accountId, saveDraftMutation]);

  // Delete draft function
  const deleteDraft = useCallback(async (draftIdToDelete: string) => {
    await deleteDraftMutation.mutateAsync(draftIdToDelete);
  }, [deleteDraftMutation]);

  // Clear draft function (clears local storage and resets state)
  const clearDraft = useCallback(() => {
    // Clear timers
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // Clear local storage
    clearLocalStorage();

    // Reset state
    setStatus({
      isAutoSaving: false,
      hasUnsavedChanges: false
    });
    setCurrentDraftId(undefined);
    pendingDraftDataRef.current = {};
    lastSavedDataRef.current = '';
  }, [clearLocalStorage]);

  // Set up periodic auto-save
  useEffect(() => {
    if (!accountId) return;

    const setupAutoSave = () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }

      autoSaveTimerRef.current = setTimeout(() => {
        // Only auto-save if there are unsaved changes and we're not currently saving
        if (status.hasUnsavedChanges && !saveDraftMutation.isPending) {
          setStatus(prev => ({ ...prev, isAutoSaving: true }));
          saveDraftMutation.mutate({ draftData: pendingDraftDataRef.current });
        }
        
        // Schedule next auto-save
        setupAutoSave();
      }, autoSaveInterval);
    };

    setupAutoSave();

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [accountId, autoSaveInterval, status.hasUnsavedChanges, saveDraftMutation]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  return {
    saveDraft,
    saveDraftManually,
    deleteDraft,
    status,
    currentDraftId,
    clearDraft
  };
}