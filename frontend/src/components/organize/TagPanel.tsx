import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PanelSheetContent } from "@/components/PanelSheetContent";
import { REDACTED_FILE } from "@/lib/organizeRedact";
import { describeText, mixedValue } from "@/lib/organizeTags";
import type { OrganizeFile, OrganizeTagInfo } from "@/types/organize";

type Infos = Record<string, OrganizeTagInfo | null | undefined>;

/** Fields shown for several files; the rest only when at least one file has a value. */
const ALWAYS = ["title", "description"];
const FIELD_ORDER = [
  "title",
  "description",
  "synopsis",
  "comment",
  "artist",
  "album",
  "album_artist",
  "genre",
  "date",
  "track",
];
const LABEL = (field: string) => field.replace("_", " ");

/** A text with a "Show all" control: a few lines, or all of it. */
function Expandable({ text, testId }: { text: string; testId: string }) {
  const [all, setAll] = useState(false);
  const { chars, hashtags } = describeText(text);
  return (
    <div className="space-y-1">
      <p
        data-testid={testId}
        className={`whitespace-pre-wrap break-words text-sm ${all ? "" : "line-clamp-4"}`}
      >
        {text}
      </p>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {chars.toLocaleString()} characters · {hashtags.toLocaleString()}{" "}
          {hashtags === 1 ? "hashtag" : "hashtags"}
        </span>
        {chars > 200 && (
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setAll(!all)}>
            {all ? "Show less" : "Show all"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </h4>
      {children}
    </div>
  );
}

const DASH = <span className="text-sm text-muted-foreground/60">—</span>;

/** One file: the full title and description, every tag as stored, the streams. */
function OneFile({ info, redact }: { info: OrganizeTagInfo | null | undefined; redact: boolean }) {
  if (!info) return <Section label="Tags">{DASH}</Section>;
  const title = info.fields.title;
  const description = info.fields.description;
  const rawEntries = Object.entries(info.raw);
  return (
    <>
      <Section label="Title">
        {title ? <p className="break-words text-sm">{redact ? "Redacted" : title}</p> : DASH}
      </Section>
      <Section label="Description">
        {description ? (
          redact ? (
            <p className="text-sm">Redacted</p>
          ) : (
            <Expandable text={description} testId="tag-panel-description" />
          )
        ) : (
          DASH
        )}
      </Section>
      <Section label="All tags">
        {rawEntries.length === 0 ? (
          DASH
        ) : (
          <dl className="space-y-1 text-sm">
            {rawEntries.map(([name, value]) => (
              <div key={name} className="grid grid-cols-[6.5rem_1fr] gap-2">
                <dt className="truncate text-muted-foreground">{name}</dt>
                <dd className="line-clamp-3 break-words">{redact ? "Redacted" : value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Section>
      {info.streams.length > 0 && (
        <Section label="Streams">
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {info.streams.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

/** Several files: each field's shared value, or Mixed where the files differ. */
function ManyFiles({
  files,
  infos,
  redact,
}: {
  files: OrganizeFile[];
  infos: Infos;
  redact: boolean;
}) {
  const rows = FIELD_ORDER.map((field) => ({
    field,
    value: mixedValue(files.map((f) => infos[f.path]?.fields[field])),
  })).filter((r) => ALWAYS.includes(r.field) || r.value.kind !== "empty");
  return (
    <>
      {rows.map(({ field, value }) => (
        <Section key={field} label={LABEL(field)}>
          {value.kind === "empty" ? (
            DASH
          ) : value.kind === "same" ? (
            <p className="line-clamp-4 break-words text-sm">{redact ? "Redacted" : value.value}</p>
          ) : (
            <p className="text-sm italic text-amber-400">
              Mixed ({value.distinct} {value.distinct === 1 ? "value" : "values"}
              {value.empties > 0 ? `, ${value.empties} empty` : ""})
            </p>
          )}
        </Section>
      ))}
    </>
  );
}

/**
 * Non-modal right panel with the embedded tags of the selected files (read-only):
 * one file shows everything, several show each field's shared value or Mixed. Stays
 * open while the page is used; closes on Escape or its own close button. Redacting
 * hides every tag value and the file name.
 */
export function TagPanel({
  open,
  onOpenChange,
  files,
  infos,
  loading,
  redact,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: OrganizeFile[];
  /** Per path: the tags, null when the file has none, undefined until they arrive. */
  infos: Infos;
  loading: boolean;
  redact: boolean;
}) {
  const single = files.length === 1 ? files[0]! : null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <PanelSheetContent
        overlay={false}
        className="w-full overflow-y-auto sm:w-96"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle className="truncate">
            {single ? (redact ? REDACTED_FILE : single.name) : `${files.length} files`}
          </SheetTitle>
          <SheetDescription>Embedded tags, read-only.</SheetDescription>
        </SheetHeader>
        {loading && (
          <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading tags…
          </p>
        )}
        {single ? (
          <OneFile info={infos[single.path]} redact={redact} />
        ) : (
          <ManyFiles files={files} infos={infos} redact={redact} />
        )}
      </PanelSheetContent>
    </Sheet>
  );
}
