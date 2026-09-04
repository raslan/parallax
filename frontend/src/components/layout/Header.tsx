import { Link, NavLink } from "react-router-dom";
import { Settings } from "lucide-react";
import { ParallaxLogo } from "@/components/ParallaxLogo";
import { Separator } from "@/components/ui/separator";
import { SECTIONS, useSectionNav } from "./nav-config";
import { JobsMenu } from "./JobsMenu";
import { MobileNav } from "./MobileNav";
import { cn } from "@/lib/utils";

/** @public */
export function Header() {
  const { activeTab } = useSectionNav();
  const activeIdx = SECTIONS.findIndex((s) => s.id === activeTab);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-[hsl(var(--sidebar))] px-4 border-[hsl(var(--sidebar-border))]">
      <MobileNav />

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

      <nav className="relative hidden items-center md:flex">
        {/* The active-tab highlight is one element that slides between the
            equal-width (w-28 = 7rem) tabs; fades out on routes with no tab. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-28 rounded-md bg-primary/10 transition-[transform,opacity] duration-300 ease-out"
          style={{
            transform: `translateX(${Math.max(activeIdx, 0) * 7}rem)`,
            opacity: activeIdx < 0 ? 0 : 1,
          }}
        />
        {SECTIONS.map((s) => (
          <Link
            key={s.id}
            // Every Section has >= 3 items, so items[0] is always defined.
            to={s.items[0]!.to}
            data-active={String(activeTab === s.id)}
            aria-current={activeTab === s.id ? "page" : undefined}
            className={cn(
              "relative z-10 flex w-28 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
              activeTab === s.id
                ? "text-primary font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <s.icon className="h-4 w-4 shrink-0" />
            {s.label}
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
