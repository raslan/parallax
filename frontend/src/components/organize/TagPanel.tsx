import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PanelSheetContent } from "@/components/PanelSheetContent";
import { AddFieldMenu } from "@/components/organize/AddFieldMenu";
import { TagFieldEditor } from "@/components/organize/TagFieldEditor";
import { TagReview } from "@/components/organize/TagReview";
import type { TagEdits } from "@/hooks/useOrganizeTagEdits";
import { REDACTED_FILE } from "@/lib/organizeRedact";
import {
  currentValue,
  effectiveValue,
  fieldLabel,
  planOffers,
  standardFieldFor,
} from "@/lib/organizeTagEdits";
import type { OrganizeFile, OrganizeTagInfo } from "@/types/organize";

type Infos = Record<string, OrganizeTagInfo | null | undefined>;

/** Fields in the order they are shown; the first two always, the rest once they hold a value. */
const ORDER = [
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
  "copyright",
  "keywords",
];
const ALWAYS = ["title", "description"];
const MULTILINE = new Set(["description", "synopsis", "comment"]);
const RAW = "raw:";

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

/** The tag names a field list may add or already stage, without repeats (case-insensitive). */
function unique(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((n) => {
    const key = n.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Non-modal right panel with the embedded tags of the selected files, where they are
 * edited. One file shows everything (the title and description in full, every tag as
 * stored, the streams); several show each field's shared value or Mixed. Typing in a
 * field, Clear and the text tools only *stage* an edit: it is written from the review
 * step, which replaces the fields in this panel. Stays open while the page is used;
 * closes on Escape or its own close button. Redacting hides every tag value and the file
 * name and turns editing off.
 */
export function TagPanel({
  open,
  onOpenChange,
  files,
  infos,
  loading,
  redact,
  edits,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: OrganizeFile[];
  /** Per path: the tags, null when the file has none, undefined until they arrive. */
  infos: Infos;
  loading: boolean;
  redact: boolean;
  edits: TagEdits;
}) {
  const single = files.length === 1 ? files[0]! : null;
  const reviewing = edits.review.open;
  // Fields and custom tags the user asked for with "Add field…", shown empty until typed in.
  const [added, setAdded] = useState<string[]>([]);
  const [addedRaw, setAddedRaw] = useState<string[]>([]);

  const stagedFields = new Set(files.flatMap((f) => Object.keys(edits.staged[f.path] ?? {})));
  const valueOf = (field: string) =>
    files.map((f) => effectiveValue(infos[f.path], edits.staged[f.path], field));
  const visible = ORDER.filter(
    (f) =>
      ALWAYS.includes(f) ||
      added.includes(f) ||
      stagedFields.has(f) ||
      valueOf(f).some((v) => v !== undefined),
  );
  const showGps =
    stagedFields.has("gps") || files.some((f) => currentValue(infos[f.path], "gps") !== undefined);

  const info = single ? infos[single.path] : undefined;
  const rawEntries = info ? Object.entries(info.raw) : [];
  const plan = single ? edits.plans[single.path] : undefined;
  const editableRaw = (name: string) =>
    !standardFieldFor(name) &&
    !!plan?.fields.some(
      (f) => f.startsWith(RAW) && f.slice(RAW.length).toLowerCase() === name.toLowerCase(),
    );
  const stagedRaw = [...stagedFields]
    .filter((f) => f.startsWith(RAW))
    .map((f) => f.slice(RAW.length));
  const inList = new Set(rawEntries.map(([name]) => name.toLowerCase()));
  const extraRaw = unique([...addedRaw, ...stagedRaw]).filter((n) => !inList.has(n.toLowerCase()));

  const offered = ORDER.filter(
    (f) => !visible.includes(f) && files.some((file) => planOffers(edits.plans[file.path], f)),
  );
  const canAddRaw =
    files.length > 0 && files.some((f) => !edits.plans[f.path] || edits.plans[f.path]!.can_add_raw);
  const editor = (field: string, label: string) => (
    <TagFieldEditor
      key={field}
      field={field}
      label={label}
      multiline={MULTILINE.has(field)}
      files={files}
      infos={infos}
      edits={edits}
      redact={redact}
    />
  );

  const title =
    files.length === 0
      ? "Review staged edits"
      : single
        ? redact
          ? REDACTED_FILE
          : single.name
        : `${files.length} files`;
  const description = reviewing
    ? "Check every change before it is written."
    : redact
      ? "Embedded tags. Editing is off while names are redacted."
      : "Embedded tags.";

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <PanelSheetContent
        overlay={false}
        className="w-full overflow-y-auto sm:w-96"
        onInteractOutside={(e) => e.preventDefault()}
        // A panel that follows the selection must not take focus from the page when it opens.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle className="truncate">{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        {reviewing ? (
          <TagReview edits={edits} redact={redact} />
        ) : (
          <>
            {loading && (
              <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading tags…
              </p>
            )}
            {edits.reading && (
              <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Reading full values {edits.reading.done} / {edits.reading.total}…
              </p>
            )}

            {visible.map((field) => editor(field, fieldLabel(field)))}
            {showGps && editor("gps", fieldLabel("gps"))}

            {single && (
              <Section label="All tags">
                {!info || rawEntries.length === 0 ? (
                  DASH
                ) : (
                  <div className="space-y-2 text-sm">
                    {rawEntries.map(([name, value]) =>
                      editableRaw(name) ? (
                        editor(`${RAW}${name}`, name)
                      ) : (
                        <div key={name} className="grid grid-cols-[6.5rem_1fr] gap-2">
                          <span className="truncate text-muted-foreground">{name}</span>
                          <span className="line-clamp-3 break-words">
                            {redact ? "Redacted" : value}
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                )}
              </Section>
            )}
            {extraRaw.map((name) => editor(`${RAW}${name}`, name))}

            {single && info && info.streams.length > 0 && (
              <Section label="Streams">
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {info.streams.map((s, i) => (
                    <li key={`${i}-${s}`}>{s}</li>
                  ))}
                </ul>
              </Section>
            )}

            {!redact && files.length > 0 && (offered.length > 0 || canAddRaw) && (
              <AddFieldMenu
                offered={offered}
                canAddRaw={canAddRaw}
                onAdd={(field) => setAdded((a) => (a.includes(field) ? a : [...a, field]))}
                onAddRaw={(name) => setAddedRaw((a) => unique([...a, name]))}
              />
            )}
          </>
        )}

        {!reviewing && !redact && edits.stagedCount > 0 && (
          <div className="sticky bottom-0 bg-background pb-2 pt-2">
            <Button className="w-full" onClick={() => void edits.openReview()}>
              Review changes ({edits.stagedCount} {edits.stagedCount === 1 ? "file" : "files"})
            </Button>
          </div>
        )}
      </PanelSheetContent>
    </Sheet>
  );
}
