import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

export interface QuickStartItem {
  to: string;
  icon: LucideIcon;
  title: string;
  hint: string;
}

/**
 * Jump-offs for the "add a folder, do one thing, remove it" workflow. Each links to
 * the tool's page, which explains how to add a library if none exists yet.
 */
export function QuickStart({ items }: { items: readonly QuickStartItem[] }) {
  return (
    <ul className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
      {items.map(({ to, icon: Icon, title, hint }) => (
        <li key={to} className="bg-px-surface">
          <Link
            to={to}
            className="group flex h-full items-start gap-3 p-4 transition-colors hover:bg-px-elevated focus-visible:bg-px-elevated focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="block text-sm font-medium">{title}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
