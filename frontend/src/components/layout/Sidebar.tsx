import { NavLink } from "react-router-dom";
import { Library, Film, Activity, Settings, Archive, Copy, Scissors, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { ParallaxLogo } from "@/components/ParallaxLogo";

const navItems = [
  { to: "/libraries", icon: Library, label: "Libraries" },
  { to: "/files", icon: Film, label: "Files" },
  { to: "/originals", icon: Archive, label: "Originals" },
  { to: "/duplicates", icon: Copy, label: "Duplicates" },
  { to: "/cleanup",    icon: Scissors, label: "Cleanup" },
  { to: "/identify",   icon: Wand2,    label: "Identify" },
  { to: "/jobs",       icon: Activity, label: "Jobs" },
];

function navClass(isActive: boolean) {
  return cn(
    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
    isActive
      ? "bg-primary/10 text-primary font-medium"
      : "text-muted-foreground hover:bg-[hsl(var(--sidebar-accent))] hover:text-foreground"
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

      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => navClass(isActive)}>
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
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
