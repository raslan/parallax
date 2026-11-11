import { useId, useState } from "react";
import { Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tip } from "@/components/Tip";
import { TagFieldTools } from "@/components/organize/TagFieldTools";
import type { TagEdits } from "@/hooks/useOrganizeTagEdits";
import { cn } from "@/lib/utils";
import { describeText, mixedValue } from "@/lib/organizeTags";
import { currentValue, effectiveValue, planOffers } from "@/lib/organizeTagEdits";
import { toastStageResult } from "@/lib/organizeToast";
import type { OrganizeFile, OrganizeTagInfo } from "@/types/organize";

type Infos = Record<string, OrganizeTagInfo | null | undefined>;

/** A long text shows a few lines until "Show all". */
const LONG = 200;
const SHORT_ROWS = 4;

const labelClass = "text-xs font-medium uppercase tracking-widest text-muted-foreground";
const fieldClass =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors " +
  "placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 " +
  "focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** A batch read cuts a long value to 500 characters and appends an ellipsis. */
const isCut = (v: string) => v.length === 501 && v.endsWith("…");

/**
 * One field for the selected files: its shared value (or `Mixed`), an input that stages a
 * new value for all of them when it loses focus, Clear, Undo, and the text tools. Nothing
 * is written from here; staged edits are applied from the review step.
 */
export function TagFieldEditor({
  field,
  label,
  multiline = false,
  files,
  infos,
  edits,
  redact,
}: {
  field: string;
  label: string;
  multiline?: boolean;
  files: OrganizeFile[];
  infos: Infos;
  edits: TagEdits;
  redact: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  const values = files.map((f) => effectiveValue(infos[f.path], edits.staged[f.path], field));
  const mv = mixedValue(values);
  const stagedHere = files.filter((f) => edits.staged[f.path] && field in edits.staged[f.path]!);
  const loading = files.some((f) => infos[f.path] === undefined);
  const hasValue = mv.kind !== "empty";

  const unwritable = files
    .map((f) => edits.plans[f.path])
    .find((p) => p !== undefined && !p.writable);
  const canEdit = files.some((f) => planOffers(edits.plans[f.path], field));
  const disabledWhy = canEdit ? null : (unwritable?.reason ?? "This format can't hold this field.");

  const shown = mv.kind === "same" && !isCut(mv.value) ? mv.value : "";
  const text = draft ?? shown;
  const run = (op: Parameters<TagEdits["stage"]>[1]) =>
    void edits.stage(field, op).then(toastStageResult);

  if (redact) {
    return (
      <div className="space-y-1">
        <h4 className={labelClass}>{label}</h4>
        {mv.kind === "mixed" ? (
          <p className="text-sm italic text-amber-400">{mixedText(mv)}</p>
        ) : (
          <p className="text-sm">{hasValue ? "Redacted" : "—"}</p>
        )}
      </div>
    );
  }

  if (field === "gps") {
    // A location can only be removed, never typed.
    const has = files.some((f) => currentValue(infos[f.path], "gps") !== undefined);
    return (
      <div className="flex items-center justify-between gap-2">
        <h4 className={labelClass}>{label}</h4>
        <div className="flex items-center gap-2 text-sm">
          <span
            className={stagedHere.length > 0 ? "italic text-amber-400" : "text-muted-foreground"}
          >
            {stagedHere.length > 0 ? "Will be removed" : has ? "Has a location" : "—"}
          </span>
          {stagedHere.length > 0 ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-label={`Undo ${label}`}
              onClick={() => edits.unstage(field)}
            >
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
          ) : (
            has &&
            canEdit && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label={`Clear ${label}`}
                onClick={() => run({ op: "clear" })}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )
          )}
        </div>
      </div>
    );
  }

  const commit = () => {
    if (draft === null) return;
    const typed = draft;
    setDraft(null);
    if (typed === shown) return; // nothing new (also: a mixed field left empty)
    void edits.stage(field, { op: "set", value: typed }).then(toastStageResult);
  };
  const { chars, hashtags } = describeText(text);
  const rows = all
    ? Math.min(30, Math.max(SHORT_ROWS, text.split("\n").length + Math.ceil(chars / 45)))
    : SHORT_ROWS;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Label htmlFor={id} className={cn(labelClass, "truncate")}>
            {label}
          </Label>
          {stagedHere.length > 0 && (
            <span className="shrink-0 text-2xs font-medium text-amber-400">
              {files.length === 1 ? "Edited" : `Edited (${stagedHere.length} of ${files.length})`}
            </span>
          )}
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-0.5">
            <TagFieldTools field={field} label={label} files={files} infos={infos} edits={edits} />
            {hasValue && (
              <Tip
                label={`Clear ${label} for ${files.length === 1 ? "this file" : "all selected files"}`}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label={`Clear ${label}`}
                  onClick={() => run({ op: "clear" })}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </Tip>
            )}
            {stagedHere.length > 0 && (
              <Tip label="Undo this edit">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label={`Undo ${label}`}
                  onClick={() => edits.unstage(field)}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </Button>
              </Tip>
            )}
          </div>
        )}
      </div>

      {mv.kind === "mixed" && <p className="text-sm italic text-amber-400">{mixedText(mv)}</p>}
      {mv.kind === "same" && isCut(mv.value) && (
        <p className="text-sm italic text-muted-foreground">
          Same start (long text: only the first 500 characters are compared)
        </p>
      )}

      {multiline ? (
        <textarea
          id={id}
          className={fieldClass}
          rows={rows}
          value={text}
          disabled={!canEdit || loading}
          placeholder={mv.kind === "mixed" ? "Type to set the same text for all" : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      ) : (
        <Input
          id={id}
          value={text}
          disabled={!canEdit || loading}
          placeholder={mv.kind === "mixed" ? "Type to set the same value for all" : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        />
      )}

      {disabledWhy && <p className="text-xs text-muted-foreground">{disabledWhy}</p>}
      {multiline && mv.kind === "same" && !isCut(mv.value) && text !== "" && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {chars.toLocaleString()} characters · {hashtags.toLocaleString()}{" "}
            {hashtags === 1 ? "hashtag" : "hashtags"}
          </span>
          {chars > LONG && (
            <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setAll(!all)}>
              {all ? "Show less" : "Show all"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function mixedText(mv: { distinct: number; empties: number }) {
  return `Mixed (${mv.distinct} ${mv.distinct === 1 ? "value" : "values"}${
    mv.empties > 0 ? `, ${mv.empties} empty` : ""
  })`;
}
