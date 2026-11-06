import credits from "@/lib/credits.generated.json";
import { RemoteLogo } from "@/components/remote-logo";

type Entry = {
  id: string;
  group: string;
  name: string;
  description: string;
  author?: string;
  licence?: string;
  licence_url?: string;
  url: string;
  how: string;
  note?: string;
  text?: string;
  source_url?: string;
  notice?: string;
  logo?: string;
};

const entries = credits.entries as Entry[];
const groups = credits.groups as { id: string; title: string; note?: string }[];

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-block py-1 text-fd-primary underline underline-offset-4"
    >
      {children}
    </a>
  );
}

/** Every credit for the site, built from the app's single credits file (see scripts/sync-credits.mjs). */
export function CreditsList() {
  return (
    <div className="not-prose">
      {groups.map((group) => (
        <section key={group.id} className="mt-10">
          <h2
            id={group.id}
            className="border-b border-fd-border pb-2 text-xl font-semibold tracking-tight"
          >
            {group.title}
          </h2>
          {group.note && <p className="mt-3 text-sm text-fd-muted-foreground">{group.note}</p>}
          <ul className="mt-4 space-y-6">
            {entries
              .filter((e) => e.group === group.id)
              .map((e) => (
                <li key={e.id} id={e.id}>
                  <p className="font-medium">
                    <Ext href={e.url}>{e.name}</Ext>
                  </p>
                  <p className="text-sm text-fd-muted-foreground">{e.description}</p>
                  <p className="mt-1 flex flex-wrap gap-x-4 text-sm text-fd-muted-foreground">
                    {e.author && <span>by {e.author}</span>}
                    {e.licence && e.licence_url && <Ext href={e.licence_url}>{e.licence}</Ext>}
                    {e.source_url && <Ext href={e.source_url}>Source code</Ext>}
                  </p>
                  {e.note && <p className="mt-1 text-sm text-fd-muted-foreground">{e.note}</p>}
                  {e.notice && (
                    <div className="mt-2 space-y-2">
                      {e.logo && <RemoteLogo src={e.logo} />}
                      <p className="text-sm text-fd-muted-foreground">{e.notice}</p>
                    </div>
                  )}
                  {e.text && (
                    <details className="mt-2 text-sm">
                      <summary className="cursor-pointer text-fd-muted-foreground">
                        Licence text
                      </summary>
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-fd-secondary/50 p-3 text-xs">
                        {e.text}
                      </pre>
                    </details>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
