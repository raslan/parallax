import { ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { qk, upscaleApi } from "@/lib/api";
import { QueryError } from "@/components/QueryError";
import { Card, CardContent } from "@/components/ui/card";

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

/**
 * Attribution for third-party work bundled with Parallax. Self-contained like the other tabs
 * (own query, no form, no Save): the text comes from the backend, so it can't drift from the
 * files actually shipped.
 */
export function CreditsTab() {
  const { data, error, refetch } = useQuery({
    queryKey: qk.upscaleCredits(),
    queryFn: () => upscaleApi.credits(),
    staleTime: Infinity,
  });

  if (error) return <QueryError error={error} onRetry={() => void refetch()} />;
  if (!data) return null;

  return (
    <div className="max-w-3xl space-y-6">
      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Image upscaling models
        </h2>
        {data.models.map((m) => (
          <Card key={m.name}>
            <CardContent className="space-y-1 p-4 text-sm">
              <p className="font-mono font-medium">{m.name}</p>
              <p className="text-muted-foreground">
                by {m.author} · {m.note}
              </p>
              <p className="flex flex-wrap gap-x-4 text-muted-foreground">
                <ExtLink href={m.licence_url}>{m.licence}</ExtLink>
                <ExtLink href={m.release_url}>Release page</ExtLink>
              </p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Inference runtime
        </h2>
        <Card>
          <CardContent className="space-y-2 p-4 text-sm">
            <p className="font-medium">
              <ExtLink href={data.ncnn.url}>ncnn</ExtLink>{" "}
              <span className="font-normal text-muted-foreground">· {data.ncnn.licence_name}</span>
            </p>
            <p className="text-muted-foreground">{data.ncnn.copyright}</p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-2xs text-muted-foreground">
              {data.ncnn.text}
            </pre>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
