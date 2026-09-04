import { useState } from "react";
import { NavLink, Link } from "react-router-dom";
import { Menu, Plus } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SECTIONS, useSectionNav } from "./nav-config";
import { cn } from "@/lib/utils";

/** @public */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const { activeTab, items } = useSectionNav();

  // Close whenever the user navigates.
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Open navigation"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground md:hidden"
      >
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-72">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">Browse sections and pages.</SheetDescription>
        <nav className="mt-6 flex flex-col gap-1">
          {SECTIONS.map((s) => (
            <Link
              key={s.id}
              // Every Section has >= 3 items, so items[0] is always defined.
              to={s.items[0]!.to}
              onClick={close}
              data-active={String(activeTab === s.id)}
              aria-current={activeTab === s.id ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                activeTab === s.id
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-[hsl(var(--sidebar-accent))] hover:text-foreground",
              )}
            >
              <s.icon className="h-4 w-4 shrink-0" />
              {s.label}
            </Link>
          ))}
          <div className="my-2 h-px bg-[hsl(var(--sidebar-border))]" />
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={close}
              className={({ isActive }) =>
                cn(
                  "flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-[hsl(var(--sidebar-accent))] hover:text-foreground",
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
              {item.label === "Libraries" && (
                <Plus aria-hidden className="ml-auto h-3.5 w-3.5 opacity-40" />
              )}
            </NavLink>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
