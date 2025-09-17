import { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

interface DraftData {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  attachments?: any[];
  lastSaved?: Date;
}

interface UseDraftAutoSaveOptions {
  draftKey: string;
  autoSaveInterval?: number; // milliseconds
  debounceDelay?: number; // milliseconds
  onSave?: (draft: DraftData) => Promise<void>;
  onLoad?: () => Promise<DraftData | null>;
}

export function useDraftAutoSave({
  draftKey,
  autoSaveInterval = 30000, // 30 seconds
  debounceDelay = 2000, // 2 seconds
  onSave,
  onLoad
}: UseDraftAutoSaveOptions) {
  const { toast } = useToast();
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout>();
  const autoSaveTimerRef = useRef<NodeJS.Timeout>();
  const currentDraftRef = useRef<DraftData | null>(null);

  // Save draft to localStorage
  const saveToLocalStorage = useCallback((draft: DraftData) => {
    try {
      const draftWithTimestamp = {
        ...draft,
        lastSaved: new Date(),
      };
      localStorage.setItem(`email_draft_${draftKey}`, JSON.stringify(draftWithTimestamp));
      return true;
    } catch (error) {
      console.error('Failed to save draft to localStorage:', error);
      return false;
    }
  }, [draftKey]);

  // Load draft from localStorage
  const loadFromLocalStorage = useCallback((): DraftData | null => {
    try {
      const saved = localStorage.getItem(`email_draft_${draftKey}`);
      if (!saved) return null;
      
      const parsed = JSON.parse(saved);
      return {
        ...parsed,
        lastSaved: parsed.lastSaved ? new Date(parsed.lastSaved) : undefined,
      };
    } catch (error) {
      console.error('Failed to load draft from localStorage:', error);
      return null;
    }
  }, [draftKey]);

  // Save draft function
  const saveDraft = useCallback(async (draft: DraftData, showToast = false) => {
    if (!draft.to && !draft.subject && !draft.body) {
      // Don't save empty drafts
      return false;
    }

    setIsSaving(true);
    
    try {
      // Save to custom handler if provided
      if (onSave) {
        await onSave(draft);
      } else {
        // Fallback to localStorage
        if (!saveToLocalStorage(draft)) {
          throw new Error('Failed to save to localStorage');
        }
      }
      
      const now = new Date();
      setLastSaved(now);
      setHasUnsavedChanges(false);
      currentDraftRef.current = { ...draft, lastSaved: now };
      
      if (showToast) {
        toast({
          description: "Draft saved successfully",
          duration: 2000,
        });
      }
      
      return true;
    } catch (error) {
      console.error('Failed to save draft:', error);
      toast({
        description: "Failed to save draft",
        variant: "destructive",
        duration: 3000,
      });
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [draftKey, onSave, saveToLocalStorage, toast]);

  // Load draft function
  const loadDraft = useCallback(async (): Promise<DraftData | null> => {
    try {
      let draft: DraftData | null = null;
      
      if (onLoad) {
        draft = await onLoad();
      } else {
        draft = loadFromLocalStorage();
      }
      
      if (draft) {
        currentDraftRef.current = draft;
        setLastSaved(draft.lastSaved || null);
        setHasUnsavedChanges(false);
      }
      
      return draft;
    } catch (error) {
      console.error('Failed to load draft:', error);
      toast({
        description: "Failed to load draft",
        variant: "destructive",
        duration: 3000,
      });
      return null;
    }
  }, [onLoad, loadFromLocalStorage, toast]);

  // Delete draft function
  const deleteDraft = useCallback(async () => {
    try {
      localStorage.removeItem(`email_draft_${draftKey}`);
      setLastSaved(null);
      setHasUnsavedChanges(false);
      currentDraftRef.current = null;
      
      // Clear timers
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      
      return true;
    } catch (error) {
      console.error('Failed to delete draft:', error);
      return false;
    }
  }, [draftKey]);

  // Auto-save with debouncing
  const autoSave = useCallback((draft: DraftData) => {
    // Clear existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    // Mark as having unsaved changes
    setHasUnsavedChanges(true);
    currentDraftRef.current = draft;
    
    // Debounce the save operation
    debounceTimerRef.current = setTimeout(() => {
      saveDraft(draft, false);
    }, debounceDelay);
  }, [saveDraft, debounceDelay]);

  // Force save (for manual saves)
  const forceSave = useCallback((draft: DraftData) => {
    // Clear debounce timer since we're force saving
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    currentDraftRef.current = draft;
    return saveDraft(draft, true);
  }, [saveDraft]);

  // Set up auto-save interval
  useEffect(() => {
    if (autoSaveInterval > 0) {
      autoSaveTimerRef.current = setInterval(() => {
        if (hasUnsavedChanges && currentDraftRef.current) {
          saveDraft(currentDraftRef.current, false);
        }
      }, autoSaveInterval);
      
      return () => {
        if (autoSaveTimerRef.current) {
          clearInterval(autoSaveTimerRef.current);
        }
      };
    }
  }, [autoSaveInterval, hasUnsavedChanges, saveDraft]);

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

  // Get draft status info
  const getDraftStatus = useCallback(() => {
    const now = new Date();
    const timeSinceLastSave = lastSaved ? now.getTime() - lastSaved.getTime() : 0;
    
    let status = '';
    if (isSaving) {
      status = 'Saving...';
    } else if (hasUnsavedChanges) {
      status = 'Unsaved changes';
    } else if (lastSaved) {
      if (timeSinceLastSave < 60000) { // Less than 1 minute
        status = 'Saved just now';
      } else if (timeSinceLastSave < 3600000) { // Less than 1 hour
        const minutes = Math.floor(timeSinceLastSave / 60000);
        status = `Saved ${minutes} minute${minutes > 1 ? 's' : ''} ago`;
      } else {
        status = `Saved at ${lastSaved.toLocaleTimeString()}`;
      }
    }
    
    return {
      status,
      lastSaved,
      isSaving,
      hasUnsavedChanges,
    };
  }, [lastSaved, isSaving, hasUnsavedChanges]);

  return {
    autoSave,
    forceSave,
    loadDraft,
    deleteDraft,
    getDraftStatus,
    lastSaved,
    isSaving,
    hasUnsavedChanges,
  };
}