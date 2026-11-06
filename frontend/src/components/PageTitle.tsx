import type { ReactNode } from "react";
import { DocsLink } from "./DocsLink";

/** The page's `<h1>` with a "Documentation" link beside it for the current route (nothing when it has none). */
export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
      <DocsLink />
    </div>
  );
}
