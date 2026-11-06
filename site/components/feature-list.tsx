import Link from "next/link";
import { FEATURE_GROUPS } from "@/lib/features";

/**
 * One group of features from lib/features.ts: one plain line each, linking to the page. The group's heading is
 * written in the page itself (so it shows up in the table of contents); `check-coverage` makes sure the page
 * has a heading and a list for every group.
 */
export function FeatureGroup({ id }: { id: string }) {
  const group = FEATURE_GROUPS.find((g) => g.id === id);
  if (!group) throw new Error(`FeatureGroup: no group "${id}" in lib/features.ts`);
  return (
    <ul className="not-prose mb-8 space-y-1">
      {group.features.map((f) => (
        <li key={f.href}>
          <Link
            href={f.href}
            className="group -mx-3 block rounded-lg px-3 py-2.5 transition-colors hover:bg-fd-accent/50"
          >
            <span className="font-medium text-fd-primary underline-offset-4 group-hover:underline">
              {f.title}
            </span>
            <span className="mt-0.5 block text-fd-muted-foreground">{f.summary}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
