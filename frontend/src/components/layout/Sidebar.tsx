import { NavLink } from "react-router-dom";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSectionNav } from "./nav-config";

function navClass(isActive: boolean) {
  return cn(
    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
    isActive
      ? "bg-primary/10 text-primary font-medium"
      : "text-muted-foreground hover:bg-[hsl(var(--sidebar-accent))] hover:text-foreground",
  );
}

export function Sidebar({ className }: { className?: string }) {
  const { items } = useSectionNav();

  return (
    <aside
      className={cn(
        "flex h-full w-56 flex-col border-r bg-[hsl(var(--sidebar))] border-[hsl(var(--sidebar-border))]",
        className,
      )}
    >
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="space-y-0.5">
          {items.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} className={({ isActive }) => navClass(isActive)}>
              <Icon className="h-4 w-4 shrink-0" />
              {label}
              {label === "Libraries" && (
                <Plus aria-hidden className="ml-auto h-3.5 w-3.5 opacity-40" />
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      <div className="px-4 py-3">
        <span className="text-[10px] text-muted-foreground/40 tabular-nums">
          {import.meta.env.VITE_APP_VERSION ?? "dev"}
          {import.meta.env.VITE_RUNTIME && import.meta.env.VITE_RUNTIME !== "cpu"
            ? `-${import.meta.env.VITE_RUNTIME}`
            : ""}
        </span>
      </div>
    </aside>
  );
}
