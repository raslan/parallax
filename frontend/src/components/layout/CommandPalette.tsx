import { useEffect } from "react";
import { useNavigate } from "react-router";
import { Activity, House, Palette, Settings } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useTheme } from "@/components/ThemeProvider";
import { THEMES } from "@/types/theme";
import { SECTIONS, filterSectionItems, useSectionNav } from "./nav-config";

/**
 * Jump-to-anything palette. Pages come from `SECTIONS` (respecting which media
 * libraries exist), so a route that is deliberately kept out of the nav can't
 * appear here either. Opens with ⌘K / Ctrl+K or the header search button.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { setTheme } = useTheme();
  const { hasVideoLibraries, hasImageLibraries, hasAudioLibraries } = useSectionNav();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Command
        label="Command palette"
        className="relative z-50 mx-4 h-auto w-full max-w-lg rounded-lg border bg-card shadow-lg"
      >
        <CommandInput placeholder="Jump to a page or run an action…" autoFocus />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          {SECTIONS.map((section) => (
            <CommandGroup key={section.id} heading={section.label}>
              {filterSectionItems(
                section,
                hasVideoLibraries,
                hasImageLibraries,
                hasAudioLibraries,
              ).map((item) => (
                <CommandItem
                  key={item.to}
                  value={`${section.label} ${item.label}`}
                  onSelect={() => run(() => navigate(item.to))}
                >
                  <item.icon />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          <CommandSeparator />
          <CommandGroup heading="Actions">
            <CommandItem value="Open Home overview" onSelect={() => run(() => navigate("/"))}>
              <House />
              Home
            </CommandItem>
            <CommandItem value="Open Jobs" onSelect={() => run(() => navigate("/jobs"))}>
              <Activity />
              Jobs
            </CommandItem>
            <CommandItem value="Open Settings" onSelect={() => run(() => navigate("/settings"))}>
              <Settings />
              Settings
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Theme">
            {THEMES.map((t) => (
              <CommandItem
                key={t}
                value={`Switch theme ${t}`}
                onSelect={() => run(() => setTheme(t))}
              >
                <Palette />
                <span className="capitalize">{t}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </Dialog>
  );
}
