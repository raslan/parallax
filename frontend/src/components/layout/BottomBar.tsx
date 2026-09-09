import { useLocation } from "react-router-dom";
import { SECTIONS, routeToTab, type SectionId } from "./nav-config";
import { cn } from "@/lib/utils";

/** @public — mobile-only fixed section bar; every tap opens the section Sheet. */
export function BottomBar({ onOpenSection }: { onOpenSection: (id: SectionId) => void }) {
  const { pathname } = useLocation();
  const active = routeToTab(pathname);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-stretch border-t bg-[hsl(var(--sidebar))] border-[hsl(var(--sidebar-border))] pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Sections"
    >
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-label={s.label}
          data-active={String(active === s.id)}
          onClick={() => onOpenSection(s.id)}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors min-h-11",
            active === s.id ? "text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <s.icon className="h-4 w-4 shrink-0" />
          {s.label}
        </button>
      ))}
    </nav>
  );
}
