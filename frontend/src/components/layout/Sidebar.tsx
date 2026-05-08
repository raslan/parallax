import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Library,
  Film,
  Activity,
  Settings,
  Clapperboard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/libraries", icon: Library, label: "Libraries" },
  { to: "/files", icon: Film, label: "Files" },
  { to: "/jobs", icon: Activity, label: "Jobs" },
];

export function Sidebar() {
  return (
    <aside className="flex h-screen w-56 flex-col border-r bg-[hsl(var(--sidebar))] border-[hsl(var(--sidebar-border))]">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
          <Clapperboard className="h-4 w-4 text-primary" />
        </div>
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Transcoder
        </span>
      </div>

      <Separator className="bg-[hsl(var(--sidebar-border))]" />

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-[hsl(var(--sidebar-accent))] text-foreground font-medium"
                  : "text-muted-foreground hover:bg-[hsl(var(--sidebar-accent))] hover:text-foreground"
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <Separator className="bg-[hsl(var(--sidebar-border))]" />

      {/* Settings at bottom */}
      <div className="px-2 py-3">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              isActive
                ? "bg-[hsl(var(--sidebar-accent))] text-foreground font-medium"
                : "text-muted-foreground hover:bg-[hsl(var(--sidebar-accent))] hover:text-foreground"
            )
          }
        >
          <Settings className="h-4 w-4 shrink-0" />
          Settings
        </NavLink>
      </div>
    </aside>
  );
}
