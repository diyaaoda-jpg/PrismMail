import * as React from "react"

// Breakpoint definitions following Tailwind CSS conventions with mobile-first approach
const BREAKPOINTS = {
  mobile: 768,    // 0-767px
  tablet: 1024,   // 768-1023px  
  desktop: 1440,  // 1024-1439px
  xl: 1440        // 1440px+
} as const

export interface BreakpointConfig {
  isMobile: boolean;    // 0-767px
  isTablet: boolean;    // 768-1023px  
  isDesktop: boolean;   // 1024-1439px
  isXl: boolean;        // 1440px+
  currentBreakpoint: 'mobile' | 'tablet' | 'desktop' | 'xl';
  width: number;
  // Derived helper values to eliminate redundant hook calls
  isTabletOrMobile: boolean;
  isDesktopOrXl: boolean;
  hasTouchInterface: boolean;
}

export function useBreakpoint(): BreakpointConfig {
  const [breakpointState, setBreakpointState] = React.useState<BreakpointConfig>(() => {
    // Initialize with current window size if available
    if (typeof window !== 'undefined') {
      const width = window.innerWidth
      return calculateBreakpointConfig(width)
    }
    
    // Default to desktop for SSR
    return {
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      isXl: false,
      currentBreakpoint: 'desktop',
      width: 1024
    }
  })

  React.useEffect(() => {
    // Create media query listeners for efficient breakpoint detection
    const mediaQueries = {
      mobile: window.matchMedia(`(max-width: ${BREAKPOINTS.mobile - 1}px)`),
      tablet: window.matchMedia(`(min-width: ${BREAKPOINTS.mobile}px) and (max-width: ${BREAKPOINTS.tablet - 1}px)`),
      desktop: window.matchMedia(`(min-width: ${BREAKPOINTS.tablet}px) and (max-width: ${BREAKPOINTS.xl - 1}px)`),
      xl: window.matchMedia(`(min-width: ${BREAKPOINTS.xl}px)`)
    }

    const updateBreakpoint = () => {
      const width = window.innerWidth
      setBreakpointState(calculateBreakpointConfig(width))
    }

    // Set initial state
    updateBreakpoint()

    // Add efficient listeners to each media query
    Object.values(mediaQueries).forEach(mq => {
      mq.addEventListener('change', updateBreakpoint)
    })

    // Also listen to resize for width updates (debounced)
    let resizeTimer: number
    const handleResize = () => {
      clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(updateBreakpoint, 100)
    }

    window.addEventListener('resize', handleResize)

    // Cleanup
    return () => {
      Object.values(mediaQueries).forEach(mq => {
        mq.removeEventListener('change', updateBreakpoint)
      })
      window.removeEventListener('resize', handleResize)
      clearTimeout(resizeTimer)
    }
  }, [])

  return breakpointState
}

// Robust touch detection - detect actual touch capability, not just screen size
function detectTouchCapability(): boolean {
  if (typeof window === 'undefined') return false;
  
  // Use multiple methods for robust touch detection
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    // @ts-ignore - some older browsers may not have this
    (navigator.msMaxTouchPoints && navigator.msMaxTouchPoints > 0) ||
    window.matchMedia('(pointer: coarse)').matches
  );
}

function calculateBreakpointConfig(width: number): BreakpointConfig {
  const isMobile = width < BREAKPOINTS.mobile
  const isTablet = width >= BREAKPOINTS.mobile && width < BREAKPOINTS.tablet
  const isDesktop = width >= BREAKPOINTS.tablet && width < BREAKPOINTS.xl
  const isXl = width >= BREAKPOINTS.xl

  let currentBreakpoint: 'mobile' | 'tablet' | 'desktop' | 'xl'
  if (isMobile) currentBreakpoint = 'mobile'
  else if (isTablet) currentBreakpoint = 'tablet'
  else if (isXl) currentBreakpoint = 'xl'
  else currentBreakpoint = 'desktop'

  // Calculate derived values once to avoid redundant hook calls
  const isTabletOrMobile = isMobile || isTablet;
  const isDesktopOrXl = isDesktop || isXl;
  const hasTouchInterface = detectTouchCapability();

  return {
    isMobile,
    isTablet,
    isDesktop,
    isXl,
    currentBreakpoint,
    width,
    isTabletOrMobile,
    isDesktopOrXl,
    hasTouchInterface
  }
}

// Legacy hook for backwards compatibility - will be deprecated
// These hooks now use the derived values from useBreakpoint to avoid redundant listeners
export function useIsMobile(): boolean {
  const { isMobile } = useBreakpoint()
  return isMobile
}

// DEPRECATED: Use breakpoint.isTabletOrMobile instead to avoid redundant hook calls
export function useIsTabletOrMobile(): boolean {
  const { isTabletOrMobile } = useBreakpoint()
  return isTabletOrMobile
}

// DEPRECATED: Use breakpoint.isDesktopOrXl instead to avoid redundant hook calls
export function useIsDesktopOrXl(): boolean {
  const { isDesktopOrXl } = useBreakpoint()
  return isDesktopOrXl
}

// DEPRECATED: Use breakpoint.hasTouchInterface instead to avoid redundant hook calls
// This now uses actual touch capability detection, not width-based detection
export function useHasTouchInterface(): boolean {
  const { hasTouchInterface } = useBreakpoint()
  return hasTouchInterface
}