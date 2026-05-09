import { NavLink } from "react-router-dom";
import { LayoutDashboard, Library, Film, Activity, Settings, Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/libraries", icon: Library, label: "Libraries" },
  { to: "/files", icon: Film, label: "Files" },
  { to: "/jobs", icon: Activity, label: "Jobs" },
  { to: "/originals", icon: Archive, label: "Originals" },
];

function PrismLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      {/* Prism body */}
      <path
        d="M10 2L2 17.5h16L10 2z"
        stroke="#8b5cf6"
        strokeWidth="1.25"
        strokeLinejoin="round"
        fill="#8b5cf6"
        fillOpacity="0.12"
      />
      {/* Refracted beams */}
      <line x1="10" y1="7" x2="6.5" y2="17.5" stroke="#a78bfa" strokeWidth="0.9" strokeOpacity="0.55" />
      <line x1="10" y1="7" x2="10"   y2="17.5" stroke="#c4b5fd" strokeWidth="0.9" strokeOpacity="0.7" />
      <line x1="10" y1="7" x2="13.5" y2="17.5" stroke="#a78bfa" strokeWidth="0.9" strokeOpacity="0.55" />
    </svg>
  );
}

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
      {/* Wordmark */}
      <div className="flex items-center gap-2.5 px-4 py-5">
        <PrismLogo className="h-5 w-5 shrink-0" />
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Refract
        </span>
      </div>

      <Separator className="bg-[hsl(var(--sidebar-border))]" />

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => navClass(isActive)}>
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <Separator className="bg-[hsl(var(--sidebar-border))]" />

      {/* Settings at bottom */}
      <div className="px-2 py-3">
        <NavLink to="/settings" className={({ isActive }) => navClass(isActive)}>
          <Settings className="h-4 w-4 shrink-0" />
          Settings
        </NavLink>
      </div>
    </aside>
  );
}
