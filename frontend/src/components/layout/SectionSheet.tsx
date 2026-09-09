import { NavLink } from "react-router-dom";
import { Briefcase, Settings } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { SECTIONS, sectionItemsById, useSectionNav, type SectionId } from "./nav-config";
import { cn } from "@/lib/utils";

const rowClass = (isActive: boolean) =>
  cn(
    "flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
    isActive
      ? "bg-primary/10 text-primary font-medium"
      : "text-muted-foreground hover:bg-[hsl(var(--sidebar-accent))] hover:text-foreground",
  );

/** @public — mobile page picker for one section; opened by BottomBar. */
export function SectionSheet({
  sectionId,
  open,
  onOpenChange,
}: {
  sectionId: SectionId | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { hasVideoLibraries, hasImageLibraries } = useSectionNav();
  const section = sectionId ? SECTIONS.find((s) => s.id === sectionId) : null;
  const items = sectionId ? sectionItemsById(sectionId, hasVideoLibraries, hasImageLibraries) : [];
  const close = () => onOpenChange(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-72">
        <SheetTitle className="mt-1 px-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {section?.label ?? "Navigation"}
        </SheetTitle>
        <SheetDescription className="sr-only">
          Pages in the {section?.label ?? "current"} section.
        </SheetDescription>
        <nav className="mt-4 flex flex-col gap-1">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={close}
              className={({ isActive }) => rowClass(isActive)}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
          <div className="my-2 h-px bg-[hsl(var(--sidebar-border))]" />
          <NavLink to="/jobs" onClick={close} className={({ isActive }) => rowClass(isActive)}>
            <Briefcase className="h-4 w-4 shrink-0" />
            Jobs
          </NavLink>
          <NavLink to="/settings" onClick={close} className={({ isActive }) => rowClass(isActive)}>
            <Settings className="h-4 w-4 shrink-0" />
            Settings
          </NavLink>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
