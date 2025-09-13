import { Check, Palette, Monitor, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme, THEME_PALETTES } from "./ThemeProvider";
import { cn } from "@/lib/utils";

type ThemeMode = "light" | "dark" | "system";
type ThemePalette = "default" | "ocean" | "forest" | "amber" | "rose" | "grape";

interface ThemeMenuProps {
  variant?: "dropdown" | "inline";
  className?: string;
}

export function ThemeMenu({ variant = "dropdown", className }: ThemeMenuProps) {
  const { mode, palette, setMode, setPalette } = useTheme();

  const modeOptions: { value: ThemeMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

  const paletteOptions = Object.entries(THEME_PALETTES).map(([key, value]) => ({
    value: key as ThemePalette,
    ...value,
  }));

  if (variant === "inline") {
    return (
      <div className={cn("space-y-6", className)}>
        {/* Mode Selection */}
        <div>
          <h3 className="text-sm font-medium mb-3">Appearance Mode</h3>
          <div className="grid grid-cols-3 gap-2">
            {modeOptions.map((option) => {
              const IconComponent = option.icon;
              return (
                <Button
                  key={option.value}
                  variant={mode === option.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setMode(option.value)}
                  className="flex flex-col items-center gap-2 h-auto py-3 hover-elevate active-elevate-2"
                  data-testid={`mode-${option.value}`}
                >
                  <IconComponent className="h-4 w-4" />
                  <span className="text-xs">{option.label}</span>
                </Button>
              );
            })}
          </div>
        </div>

        {/* Palette Selection */}
        <div>
          <h3 className="text-sm font-medium mb-3">Color Palette</h3>
          <div className="grid grid-cols-2 gap-2">
            {paletteOptions.map((option) => (
              <Button
                key={option.value}
                variant={palette === option.value ? "default" : "outline"}
                size="sm"
                onClick={() => setPalette(option.value)}
                className="flex flex-col items-start text-left h-auto py-3 hover-elevate active-elevate-2"
                data-testid={`palette-${option.value}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div 
                    className="w-3 h-3 rounded-full border"
                    style={{ backgroundColor: option.accent }}
                  />
                  <span className="font-medium text-sm">{option.name}</span>
                  {palette === option.value && <Check className="h-3 w-3 ml-auto" />}
                </div>
                <span className="text-xs text-muted-foreground">{option.description}</span>
              </Button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("hover-elevate active-elevate-2", className)}
          data-testid="button-theme-menu"
        >
          <Palette className="h-4 w-4" />
          <span className="sr-only">Theme options</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Appearance Mode</DropdownMenuLabel>
        {modeOptions.map((option) => {
          const IconComponent = option.icon;
          return (
            <DropdownMenuItem
              key={option.value}
              onClick={() => setMode(option.value)}
              data-testid={`mode-${option.value}`}
            >
              <IconComponent className="h-4 w-4 mr-2" />
              {option.label}
              {mode === option.value && <Check className="h-4 w-4 ml-auto" />}
            </DropdownMenuItem>
          );
        })}
        
        <DropdownMenuSeparator />
        
        <DropdownMenuLabel>Color Palette</DropdownMenuLabel>
        {paletteOptions.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => setPalette(option.value)}
            data-testid={`palette-${option.value}`}
          >
            <div 
              className="w-3 h-3 rounded-full border mr-2"
              style={{ backgroundColor: option.accent }}
            />
            <div className="flex-1">
              <div className="font-medium">{option.name}</div>
              <div className="text-xs text-muted-foreground">{option.description}</div>
            </div>
            {palette === option.value && <Check className="h-4 w-4 ml-2" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}