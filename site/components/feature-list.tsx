import Link from "next/link";
import { FEATURE_GROUPS } from "@/lib/features";

/** Every feature, grouped, one plain line each, linking to its page. The data is shared with the landing page (lib/features.ts). */
export function FeatureList() {
  return (
    <div className="not-prose">
      {FEATURE_GROUPS.map((group) => (
        <section key={group.id} className="mt-8">
          <h2
            id={group.id}
            className="mb-3 scroll-mt-24 border-b border-fd-border pb-2 text-xl font-semibold tracking-tight"
          >
            {group.title}
          </h2>
          <ul className="space-y-1">
            {group.features.map((f) => (
              <li key={f.href}>
                <Link
                  href={f.href}
                  className="group block rounded-lg px-3 py-2.5 -mx-3 transition-colors hover:bg-fd-accent/50"
                >
                  <span className="font-medium text-fd-primary group-hover:underline underline-offset-4">
                    {f.title}
                  </span>
                  <span className="mt-0.5 block text-fd-muted-foreground">{f.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
