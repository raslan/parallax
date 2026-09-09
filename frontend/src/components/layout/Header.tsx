import { Link, NavLink } from "react-router-dom";
import { Settings } from "lucide-react";
import { ParallaxLogo } from "@/components/ParallaxLogo";
import { Separator } from "@/components/ui/separator";
import { SECTIONS, useSectionNav } from "./nav-config";
import { JobsMenu } from "./JobsMenu";
import { cn } from "@/lib/utils";

/** @public */
export function Header() {
  const { activeTab } = useSectionNav();
  const n = SECTIONS.length;
  const activeIdx = SECTIONS.findIndex((s) => s.id === activeTab);
  const pct = 100 / n;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-[hsl(var(--sidebar))] px-4 border-[hsl(var(--sidebar-border))]">
      <Link to="/libraries" className="flex items-center gap-2.5">
        <ParallaxLogo className="h-5 w-5 shrink-0" />
        <span className="hidden text-sm font-semibold tracking-tight text-foreground sm:inline">
          Parallax
        </span>
      </Link>

      <Separator
        orientation="vertical"
        className="mx-1 hidden h-6 bg-[hsl(var(--sidebar-border))] md:block"
      />

      <nav
        className="relative hidden min-w-0 flex-1 items-center md:flex"
        style={{ maxWidth: `${n * 8}rem` }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-1 left-0 rounded-md bg-primary/10 transition-[transform,opacity] duration-300 ease-out"
          style={{
            width: `${pct}%`,
            transform: `translateX(${Math.max(activeIdx, 0) * 100}%)`,
            opacity: activeIdx < 0 ? 0 : 1,
          }}
        />
        {SECTIONS.map((s) => (
          <Link
            key={s.id}
            to={s.items[0]!.to}
            aria-label={s.label}
            data-active={String(activeTab === s.id)}
            aria-current={activeTab === s.id ? "page" : undefined}
            style={{ width: `${pct}%` }}
            className={cn(
              "relative z-10 flex min-h-11 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
              activeTab === s.id
                ? "text-primary font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <s.icon className="h-4 w-4 shrink-0" />
            <span className="hidden lg:inline">{s.label}</span>
          </Link>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-1">
        <JobsMenu />
        <NavLink
          to="/settings"
          aria-label="Settings"
          className={({ isActive }) =>
            cn(
              "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md transition-colors",
              isActive
                ? "text-primary"
                : "text-muted-foreground hover:bg-[hsl(var(--sidebar-accent))] hover:text-foreground",
            )
          }
        >
          <Settings className="h-4 w-4" />
        </NavLink>
      </div>
    </header>
  );
}
