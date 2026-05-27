import { NavLink } from "react-router-dom";
import {
  Library, Film, Activity, Settings, Archive, Copy, Scissors, Wand2,
  Images, ShieldAlert, FolderX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { ParallaxLogo } from "@/components/ParallaxLogo";

const videoItems = [
  { to: "/libraries",  icon: Library,  label: "Libraries" },
  { to: "/files",      icon: Film,     label: "Files" },
  { to: "/duplicates", icon: Copy,     label: "Duplicates" },
  { to: "/cleanup",    icon: Scissors, label: "Cleanup" },
  { to: "/originals",  icon: Archive,  label: "Originals" },
  { to: "/identify",   icon: Wand2,    label: "Identify" },
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

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
      {label}
    </p>
  );
}

export function Sidebar() {
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
        <SectionLabel label="Videos" />
        <div className="space-y-0.5">
          {videoItems.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} className={({ isActive }) => navClass(isActive)}>
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </div>

        <SectionLabel label="Images" />
        <div className="space-y-0.5">
          {imageItems.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} className={({ isActive }) => navClass(isActive)}>
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </div>

        <SectionLabel label="" />
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
