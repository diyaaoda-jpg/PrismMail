import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PanelLeftClose, PanelLeftOpen, ArrowLeft, Mail } from 'lucide-react';

export type LayoutMode = 'classic' | 'wide' | 'compact';

export interface PanelSizes {
  sidebar: number;
  messageList: number; 
  readingPane: number;
}

export interface LayoutPreferences {
  mode: LayoutMode;
  sizes: PanelSizes;
  sidebarCollapsed: boolean;
  mobileView?: 'sidebar' | 'messageList' | 'readingPane'; // Mobile navigation state
}

const DEFAULT_PREFERENCES: LayoutPreferences = {
  mode: 'classic',
  sizes: {
    sidebar: 20, // 20% of total width
    messageList: 32, // 40% of remaining width after sidebar
    readingPane: 48, // 60% of remaining width after sidebar
  },
  sidebarCollapsed: false,
  mobileView: 'messageList',
};

interface ResizablePanelLayoutProps {
  children: {
    sidebar: React.ReactNode;
    messageList: React.ReactNode;
    readingPane: React.ReactNode;
  };
  className?: string;
  layoutMode?: LayoutMode;
  onLayoutChange?: (preferences: LayoutPreferences) => void;
  initialPreferences?: Partial<LayoutPreferences>;
  // Mobile navigation props
  selectedEmail?: any; // When an email is selected on mobile, show reading pane
  onMobileViewChange?: (view: 'sidebar' | 'messageList' | 'readingPane') => void;
}

// Custom resize handle with visual feedback
const ResizeHandle = ({ className, ...props }: React.ComponentProps<typeof PanelResizeHandle>) => (
  <PanelResizeHandle
    className={cn(
      "group relative flex items-center justify-center",
      "w-1 bg-border hover:bg-accent-foreground/20 transition-all duration-200",
      "data-[resize-handle-active]:bg-accent-foreground/40",
      "data-[resize-handle-active]:w-2",
      className
    )}
    {...props}
  >
    <div className="h-8 w-0.5 bg-border group-hover:bg-accent-foreground/40 transition-colors duration-200" />
  </PanelResizeHandle>
);

// Debounce utility for performance optimization
function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let timeoutId: NodeJS.Timeout | null = null;
  return ((...args: any[]) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  }) as T;
}

export function ResizablePanelLayout({
  children,
  className,
  layoutMode = 'classic',
  onLayoutChange,
  initialPreferences,
  selectedEmail,
  onMobileViewChange,
}: ResizablePanelLayoutProps) {
  const [preferences, setPreferences] = useState<LayoutPreferences>(() => {
    // Load from localStorage first, then use initial preferences, then defaults
    const stored = localStorage.getItem('prismmail-layout-preferences');
    const storedPrefs = stored ? JSON.parse(stored) : {};
    
    return {
      ...DEFAULT_PREFERENCES,
      ...storedPrefs,
      ...initialPreferences,
      mode: layoutMode, // Always use the prop for mode
    };
  });

  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);
  
  // Refs for tracking internal state
  const currentPreferencesRef = useRef(preferences);
  currentPreferencesRef.current = preferences;

  // Responsive breakpoint detection
  useEffect(() => {
    const checkBreakpoints = () => {
      const width = window.innerWidth;
      setIsMobile(width < 768);
      setIsTablet(width >= 768 && width < 1024);
    };

    checkBreakpoints();
    window.addEventListener('resize', checkBreakpoints);
    return () => window.removeEventListener('resize', checkBreakpoints);
  }, []);

  // Mobile view state management - navigate to reading pane when email selected
  useEffect(() => {
    if (isMobile && selectedEmail && preferences.mobileView !== 'readingPane') {
      updatePreferences({ mobileView: 'readingPane' });
    }
  }, [selectedEmail, isMobile, updatePreferences, preferences.mobileView]);

  // Debounced localStorage save function for performance during drag
  const debouncedSaveToStorage = useCallback(
    debounce((updatedPrefs: LayoutPreferences) => {
      localStorage.setItem('prismmail-layout-preferences', JSON.stringify(updatedPrefs));
      onLayoutChange?.(updatedPrefs);
    }, 250),
    [onLayoutChange]
  );

  // Save preferences to localStorage and notify parent
  const updatePreferences = useCallback((newPrefs: Partial<LayoutPreferences>) => {
    const updatedPrefs = { ...currentPreferencesRef.current, ...newPrefs };
    setPreferences(updatedPrefs);
    debouncedSaveToStorage(updatedPrefs);
  }, [debouncedSaveToStorage]);

  // Mobile navigation handlers
  const setMobileView = useCallback((view: 'sidebar' | 'messageList' | 'readingPane') => {
    updatePreferences({ mobileView: view });
    onMobileViewChange?.(view);
  }, [updatePreferences, onMobileViewChange]);

  // Handle sidebar toggle for mobile/tablet
  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      // On mobile, toggle between sidebar and current view
      const newView = preferences.mobileView === 'sidebar' ? 'messageList' : 'sidebar';
      setMobileView(newView);
    } else {
      updatePreferences({ sidebarCollapsed: !preferences.sidebarCollapsed });
    }
  }, [isMobile, preferences.mobileView, preferences.sidebarCollapsed, updatePreferences, setMobileView]);

  // Handle desktop outer panel group resize (sidebar + content)
  const handleOuterPanelResize = useCallback((sizes: number[]) => {
    if (sizes.length >= 2) {
      const [sidebarSize] = sizes;
      updatePreferences({
        sizes: {
          ...currentPreferencesRef.current.sizes,
          sidebar: sidebarSize || DEFAULT_PREFERENCES.sizes.sidebar,
        },
      });
    }
  }, [updatePreferences]);

  // Handle inner panel group resize (messageList + readingPane)
  const handleInnerPanelResize = useCallback((sizes: number[]) => {
    if (sizes.length >= 2) {
      const [messageListSize, readingPaneSize] = sizes;
      updatePreferences({
        sizes: {
          ...currentPreferencesRef.current.sizes,
          messageList: messageListSize || DEFAULT_PREFERENCES.sizes.messageList,
          readingPane: readingPaneSize || DEFAULT_PREFERENCES.sizes.readingPane,
        },
      });
    }
  }, [updatePreferences]);

  // Reset to default layout
  const resetLayout = useCallback(() => {
    updatePreferences(DEFAULT_PREFERENCES);
  }, [updatePreferences]);

  // Mobile layout: Single panel with navigation between views
  if (isMobile) {
    const currentView = preferences.mobileView || 'messageList';
    
    const renderMobileHeader = () => {
      switch (currentView) {
        case 'sidebar':
          return (
            <div className="h-14 border-b flex items-center justify-between px-4 bg-card">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground"
                  disabled
                  data-testid="icon-folders"
                >
                  <PanelLeftOpen />
                </Button>
                <h1 className="font-semibold">Folders</h1>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMobileView('messageList')}
                data-testid="button-mobile-to-inbox"
              >
                <Mail className="h-4 w-4 mr-1" />
                Inbox
              </Button>
            </div>
          );
        case 'readingPane':
          return (
            <div className="h-14 border-b flex items-center justify-between px-4 bg-card">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMobileView('messageList')}
                data-testid="button-mobile-back-to-list"
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileView('sidebar')}
                data-testid="button-mobile-to-folders"
              >
                <PanelLeftOpen />
              </Button>
            </div>
          );
        case 'messageList':
        default:
          return (
            <div className="h-14 border-b flex items-center justify-between px-4 bg-card">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileView('sidebar')}
                data-testid="button-mobile-sidebar-toggle"
              >
                <PanelLeftOpen />
              </Button>
              <h1 className="font-semibold">Inbox</h1>
              <div className="w-10" /> {/* Spacer for center alignment */}
            </div>
          );
      }
    };

    const renderMobileContent = () => {
      switch (currentView) {
        case 'sidebar':
          return <div className="h-full">{children.sidebar}</div>;
        case 'readingPane':
          return <div className="h-full">{children.readingPane}</div>;
        case 'messageList':
        default:
          return <div className="h-full">{children.messageList}</div>;
      }
    };

    return (
      <div className={cn("h-screen flex flex-col bg-background", className)}>
        {renderMobileHeader()}
        <div className="flex-1 overflow-hidden">
          {renderMobileContent()}
        </div>
      </div>
    );
  }

  // Tablet layout: Collapsible sidebar + two-panel content
  if (isTablet) {
    return (
      <div className={cn("h-screen flex bg-background", className)}>
        {!preferences.sidebarCollapsed && (
          <div className="w-64 border-r transition-all duration-200">
            {children.sidebar}
          </div>
        )}
        
        <div className="flex-1 flex flex-col">
          <div className="h-14 border-b flex items-center px-4 bg-card">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              className="mr-2"
              data-testid="button-tablet-sidebar-toggle"
            >
              {preferences.sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </Button>
          </div>
          
          <PanelGroup
            direction="horizontal"
            onLayout={handleInnerPanelResize}
            className="flex-1"
          >
            <Panel
              defaultSize={40}
              minSize={25}
              maxSize={75}
              id="tablet-message-list"
            >
              {children.messageList}
            </Panel>
            
            <ResizeHandle />
            
            <Panel
              defaultSize={60}
              minSize={25}
              maxSize={75}
              id="tablet-reading-pane"
            >
              {children.readingPane}
            </Panel>
          </PanelGroup>
        </div>
      </div>
    );
  }

  // Desktop layout: Full three-panel resizable
  return (
    <div className={cn("h-screen bg-background", className)}>
      <PanelGroup
        direction="horizontal"
        onLayout={handleOuterPanelResize}
        className="h-full"
      >
        {/* Sidebar Panel */}
        <Panel
          defaultSize={preferences.sizes.sidebar}
          minSize={15}
          maxSize={30}
          collapsible
          collapsedSize={0}
          id="desktop-sidebar"
          onCollapse={() => updatePreferences({ sidebarCollapsed: true })}
          onExpand={() => updatePreferences({ sidebarCollapsed: false })}
        >
          <div className="h-full transition-all duration-200">
            {children.sidebar}
          </div>
        </Panel>

        <ResizeHandle />

        {/* Content Panel Group */}
        <Panel
          defaultSize={preferences.sizes.messageList + preferences.sizes.readingPane}
          minSize={50}
          id="desktop-content"
        >
          <PanelGroup
            direction={layoutMode === 'wide' ? 'vertical' : 'horizontal'}
            onLayout={handleInnerPanelResize}
            className="h-full"
          >
            {/* Message List Panel */}
            <Panel
              defaultSize={
                layoutMode === 'wide' 
                  ? 40 // In wide mode, message list takes 40% of vertical space
                  : (preferences.sizes.messageList / (preferences.sizes.messageList + preferences.sizes.readingPane)) * 100
              }
              minSize={25}
              maxSize={75}
              id="desktop-message-list"
            >
              <div className="h-full transition-all duration-200">
                {children.messageList}
              </div>
            </Panel>

            <ResizeHandle />

            {/* Reading Pane Panel */}
            <Panel
              defaultSize={
                layoutMode === 'wide'
                  ? 60 // In wide mode, reading pane takes 60% of vertical space
                  : (preferences.sizes.readingPane / (preferences.sizes.messageList + preferences.sizes.readingPane)) * 100
              }
              minSize={25}
              maxSize={75}
              id="desktop-reading-pane"
            >
              <div className="h-full transition-all duration-200">
                {children.readingPane}
              </div>
            </Panel>
          </PanelGroup>
        </Panel>
      </PanelGroup>

      {/* Development helper: Reset layout button (hidden in production) */}
      {process.env.NODE_ENV === 'development' && (
        <Button
          onClick={resetLayout}
          className="fixed bottom-4 right-4 z-50 opacity-20 hover:opacity-100 transition-opacity"
          variant="outline"
          size="sm"
          data-testid="button-reset-layout"
        >
          Reset Layout
        </Button>
      )}
    </div>
  );
}

// Hook to access layout preferences and controls
export function useLayoutPreferences() {
  const [preferences, setPreferences] = useState<LayoutPreferences>(() => {
    const stored = localStorage.getItem('prismmail-layout-preferences');
    return stored ? JSON.parse(stored) : DEFAULT_PREFERENCES;
  });

  const updatePreferences = useCallback((newPrefs: Partial<LayoutPreferences>) => {
    const updatedPrefs = { ...preferences, ...newPrefs };
    setPreferences(updatedPrefs);
    localStorage.setItem('prismmail-layout-preferences', JSON.stringify(updatedPrefs));
  }, [preferences]);

  const resetToDefaults = useCallback(() => {
    setPreferences(DEFAULT_PREFERENCES);
    localStorage.setItem('prismmail-layout-preferences', JSON.stringify(DEFAULT_PREFERENCES));
  }, []);

  return {
    preferences,
    updatePreferences,
    resetToDefaults,
  };
}