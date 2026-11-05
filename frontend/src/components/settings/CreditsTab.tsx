import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { creditsApi, qk } from "@/lib/api";
import { QueryError } from "@/components/QueryError";
import { Card, CardContent } from "@/components/ui/card";
import type { CreditEntry, CreditHow } from "@/types/credits";

const HOW_LABEL: Record<CreditHow, string> = {
  shipped: "Included with Parallax",
  installed: "Installed with Parallax",
  downloaded: "Downloaded on first use",
  adapted: "Adapted code",
  service: "Online service",
  media: "Demo media",
  site: "Website",
  inspiration: "Inspiration",
};

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
    >
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

/** A logo loaded straight from its owner's site. Nothing is stored; if it fails to load it simply isn't shown. */
function RemoteLogo({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-4 w-auto max-w-40"
    />
  );
}

function Entry({ entry }: { entry: CreditEntry }) {
  return (
    <Card>
      <CardContent className="space-y-1.5 p-4 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="font-medium">
            <ExtLink href={entry.url}>{entry.name}</ExtLink>
          </p>
          <span className="text-2xs text-muted-foreground">{HOW_LABEL[entry.how]}</span>
        </div>
        <p className="text-muted-foreground">{entry.description}</p>
        <p className="flex flex-wrap gap-x-4 text-muted-foreground">
          {entry.author && <span>by {entry.author}</span>}
          {entry.licence && entry.licence_url && (
            <ExtLink href={entry.licence_url}>{entry.licence}</ExtLink>
          )}
          {entry.source_url && <ExtLink href={entry.source_url}>Source code</ExtLink>}
        </p>
        {entry.note && <p className="text-xs text-muted-foreground">{entry.note}</p>}
        {entry.notice && (
          <div className="space-y-2 pt-1">
            {entry.logo && <RemoteLogo src={entry.logo} />}
            <p className="text-xs text-muted-foreground">{entry.notice}</p>
          </div>
        )}
        {entry.text && (
          <details className="pt-1">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Licence text
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-2xs text-muted-foreground">
              {entry.text}
            </pre>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Credits for everything Parallax uses, ships or adapts. Self-contained like the other tabs
 * (own query, no form, no Save). The list comes from the backend's `credits.json`, which is
 * also what the public documentation's Acknowledgements page is built from, so there is one
 * place to maintain it.
 */
export function CreditsTab() {
  const { data, error, refetch } = useQuery({
    queryKey: qk.credits(),
    queryFn: () => creditsApi.get(),
    staleTime: Infinity,
  });

  if (error) return <QueryError error={error} onRetry={() => void refetch()} />;
  if (!data) return null;

  return (
    <div className="max-w-4xl space-y-8">
      <p className="text-sm text-muted-foreground">
        Parallax is free and open source (GPL-3.0). It is built on the work of these projects.
      </p>
      {data.groups.map((group) => (
        <section key={group.id} className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {group.title}
          </h2>
          {group.note && <p className="text-sm text-muted-foreground">{group.note}</p>}
          <div className="grid gap-3 md:grid-cols-2">
            {data.entries
              .filter((e) => e.group === group.id)
              .map((e) => (
                <Entry key={e.id} entry={e} />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
