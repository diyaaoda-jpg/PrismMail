import * as React from "react";

type ThemeMode = "light" | "dark" | "system";
type ThemePalette = "default" | "ocean" | "forest" | "amber" | "rose" | "grape";

type ThemeConfig = {
  mode: ThemeMode;
  palette: ThemePalette;
};

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultMode?: ThemeMode;
  defaultPalette?: ThemePalette;
  modeStorageKey?: string;
  paletteStorageKey?: string;
};

type ThemeProviderState = {
  mode: ThemeMode;
  palette: ThemePalette;
  effectiveMode: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  setPalette: (palette: ThemePalette) => void;
  setTheme: (config: ThemeConfig) => void;
};

const initialState: ThemeProviderState = {
  mode: "light",
  palette: "default",
  effectiveMode: "light",
  setMode: () => null,
  setPalette: () => null,
  setTheme: () => null,
};

const ThemeProviderContext = React.createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultMode = "light",
  defaultPalette = "default",
  modeStorageKey = "prism-ui-mode",
  paletteStorageKey = "prism-ui-palette",
  ...props
}: ThemeProviderProps) {
  const [mode, setModeState] = React.useState<ThemeMode>(
    () => (localStorage.getItem(modeStorageKey) as ThemeMode) || defaultMode
  );
  
  const [palette, setPaletteState] = React.useState<ThemePalette>(
    () => (localStorage.getItem(paletteStorageKey) as ThemePalette) || defaultPalette
  );

  // Calculate effective mode (resolve "system" preference)
  const [effectiveMode, setEffectiveMode] = React.useState<"light" | "dark">("light");

  React.useEffect(() => {
    const updateEffectiveMode = () => {
      if (mode === "system") {
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        setEffectiveMode(mediaQuery.matches ? "dark" : "light");
      } else {
        setEffectiveMode(mode);
      }
    };

    updateEffectiveMode();

    // Listen for system theme changes when in system mode
    if (mode === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const listener = (e: MediaQueryListEvent) => {
        setEffectiveMode(e.matches ? "dark" : "light");
      };
      
      mediaQuery.addEventListener("change", listener);
      return () => mediaQuery.removeEventListener("change", listener);
    }
  }, [mode]);

  React.useEffect(() => {
    const root = window.document.documentElement;

    // Remove all theme classes
    root.classList.remove("light", "dark");
    root.classList.remove("palette-default", "palette-ocean", "palette-forest", "palette-amber", "palette-rose", "palette-grape");

    // Apply mode class
    root.classList.add(effectiveMode);
    
    // Apply palette class
    root.classList.add(`palette-${palette}`);
  }, [effectiveMode, palette]);

  const setMode = (newMode: ThemeMode) => {
    localStorage.setItem(modeStorageKey, newMode);
    setModeState(newMode);
  };

  const setPalette = (newPalette: ThemePalette) => {
    localStorage.setItem(paletteStorageKey, newPalette);
    setPaletteState(newPalette);
  };

  const setTheme = (config: ThemeConfig) => {
    setMode(config.mode);
    setPalette(config.palette);
  };

  const value = {
    mode,
    palette,
    effectiveMode,
    setMode,
    setPalette,
    setTheme,
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = React.useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};

// Legacy compatibility for existing theme toggle
export const useLegacyTheme = () => {
  const { mode, effectiveMode, setMode } = useTheme();
  
  return {
    theme: effectiveMode,
    setTheme: (theme: "light" | "dark") => setMode(theme),
  };
};

// Theme palette definitions for reference
export const THEME_PALETTES = {
  default: {
    name: "Default",
    description: "Clean and minimal",
    accent: "hsl(217, 91%, 60%)",
  },
  ocean: {
    name: "Ocean",
    description: "Deep blues and teals", 
    accent: "hsl(200, 85%, 55%)",
  },
  forest: {
    name: "Forest",
    description: "Rich greens and earth tones",
    accent: "hsl(142, 76%, 36%)",
  },
  amber: {
    name: "Amber",
    description: "Warm oranges and yellows",
    accent: "hsl(45, 85%, 60%)",
  },
  rose: {
    name: "Rose",
    description: "Soft pinks and roses",
    accent: "hsl(350, 75%, 65%)",
  },
  grape: {
    name: "Grape",
    description: "Deep purples and violets",
    accent: "hsl(270, 75%, 65%)",
  },
} as const;