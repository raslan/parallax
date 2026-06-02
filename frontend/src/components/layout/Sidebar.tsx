import { useState, useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Library, Film, Activity, Settings, Archive, Copy, Scissors, Wand2,
  Images, ShieldAlert, FolderX, ChevronDown, Captions, Minimize2, Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { ParallaxLogo } from "@/components/ParallaxLogo";

const videoItems = [
  { to: "/libraries",  icon: Library,   label: "Libraries" },
  { to: "/files",      icon: Film,      label: "Files" },
  { to: "/duplicates", icon: Copy,      label: "Duplicates" },
  { to: "/cleanup",    icon: Scissors,  label: "Cleanup" },
  { to: "/compress",   icon: Minimize2, label: "Compress" },
  { to: "/originals",  icon: Archive,   label: "Originals" },
];

const toolItems = [
  { to: "/identify",   icon: Wand2,    label: "Identify" },
  { to: "/subtitles",  icon: Captions, label: "Subtitles" },
  { to: "/downloads",  icon: Download, label: "Downloads" },
];

const imageItems = [
  { to: "/image-libraries",   icon: Library,     label: "Libraries" },
  { to: "/images",            icon: Images,      label: "Images" },
  { to: "/image-duplicates",  icon: Copy,        label: "Duplicates" },
  { to: "/content-review",    icon: ShieldAlert, label: "Content Review" },
  { to: "/image-quarantined", icon: FolderX,     label: "Quarantined" },
];

function navClass(isActive: boolean) {
  return cn(
    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
    isActive
      ? "bg-primary/10 text-primary font-medium"
      : "text-muted-foreground hover:bg-[hsl(var(--sidebar-accent))] hover:text-foreground"
  );
}

function SectionGroup({
  label,
  items,
  storageKey,
  forceOpen,
}: {
  label: string;
  items: { to: string; icon: React.ElementType; label: string }[];
  storageKey: string;
  forceOpen: boolean;
}) {
  const [open, setOpen] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    return stored !== null ? stored === "true" : true;
  });

  useEffect(() => {
    if (forceOpen && !open) setOpen(true);
  }, [forceOpen, open]);

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      localStorage.setItem(storageKey, String(next));
      return next;
    });
  };

  return (
    <div>
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between px-3 pb-1 pt-3 group"
      >
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 group-hover:text-muted-foreground transition-colors">
          {label}
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground transition-all",
            !open && "-rotate-90"
          )}
        />
      </button>
      {open && (
        <div className="space-y-0.5">
          {items.map(({ to, icon: Icon, label: itemLabel }) => (
            <NavLink key={to} to={to} className={({ isActive }) => navClass(isActive)}>
              <Icon className="h-4 w-4 shrink-0" />
              {itemLabel}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const { pathname } = useLocation();

  const videoActive = videoItems.some((i) => pathname.startsWith(i.to));
  const imageActive = imageItems.some((i) => pathname.startsWith(i.to));
  const toolActive  = toolItems.some((i) => pathname.startsWith(i.to));

  return (
    <aside className="flex h-screen w-56 flex-col border-r bg-[hsl(var(--sidebar))] border-[hsl(var(--sidebar-border))]">
      <div className="flex items-center gap-2.5 px-4 py-5">
        <ParallaxLogo className="h-5 w-5 shrink-0" />
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Parallax
        </span>
      </div>

      <Separator className="bg-[hsl(var(--sidebar-border))]" />

      <nav className="flex-1 overflow-y-auto px-2 py-2">
        <SectionGroup
          label="Videos"
          items={videoItems}
          storageKey="sidebar-videos-open"
          forceOpen={videoActive}
        />
        <SectionGroup
          label="Images"
          items={imageItems}
          storageKey="sidebar-images-open"
          forceOpen={imageActive}
        />
        <SectionGroup
          label="Tools"
          items={toolItems}
          storageKey="sidebar-tools-open"
          forceOpen={toolActive}
        />

        <div className="px-3 pb-1 pt-3" />
        <div className="space-y-0.5">
          <NavLink to="/jobs" className={({ isActive }) => navClass(isActive)}>
            <Activity className="h-4 w-4 shrink-0" />
            Jobs
          </NavLink>
        </div>
      </nav>

      <Separator className="bg-[hsl(var(--sidebar-border))]" />

      <div className="px-2 py-3">
        <NavLink to="/settings" className={({ isActive }) => navClass(isActive)}>
          <Settings className="h-4 w-4 shrink-0" />
          Settings
        </NavLink>
      </div>
    </aside>
  );
}
