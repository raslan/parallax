import { useState } from "react";
import { ArrowLeft, Copy, Loader2, TriangleAlert, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/Tip";
import type { TagEdits } from "@/hooks/useOrganizeTagEdits";
import { formatSize } from "@/lib/format";
import { REDACTED_FILE, REDACTED_FOLDER } from "@/lib/organizeRedact";
import { fieldLabel, toApplyItems } from "@/lib/organizeTagEdits";
import { baseName, parentPath } from "@/lib/path";

/** Longer values are cut to a few lines until asked for in full. */
const LONG = 200;

function Value({
  text,
  testId,
  struck,
  redact,
}: {
  text: string | undefined;
  testId?: string;
  struck?: boolean;
  redact: boolean;
}) {
  const [all, setAll] = useState(false);
  if (text === undefined)
    return <span className="text-xs italic text-muted-foreground">not set</span>;
  const long = text.length > LONG;
  return (
    <div className="min-w-0">
      <p
        data-testid={testId}
        className={`whitespace-pre-wrap break-words text-sm ${struck ? "text-muted-foreground line-through" : ""} ${
          long && !all ? "line-clamp-3" : ""
        }`}
      >
        {redact ? "Redacted" : text}
      </p>
      {long && !redact && (
        <Button variant="ghost" size="sm" className="h-6 px-1 text-xs" onClick={() => setAll(!all)}>
          {all ? "Show less" : "Show full"}
        </Button>
      )}
    </div>
  );
}

/**
 * The second step of every edit, one file or many: each change as before → after, how
 * each file is written, the space rewrites need, and `Apply`. Nothing is written until
 * Apply is pressed, and there is no undo.
 */
export function TagReview({ edits, redact }: { edits: TagEdits; redact: boolean }) {
  const { review, results, applying, progress } = edits;
  const sendable = toApplyItems(review.rows);
  const changeCount = sendable.reduce((n, item) => n + Object.keys(item.set).length, 0);
  const tooTight = review.freeBytes !== null && review.freeBytes < review.neededBytes;
  const canApply = !redact && !applying && !review.loading && changeCount > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" disabled={applying} onClick={edits.closeReview}>
          <ArrowLeft className="mr-1 h-3.5 w-3.5" />
          Back to editing
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={applying}
          onClick={edits.clearAll}
          className="text-muted-foreground"
        >
          Discard all edits
        </Button>
      </div>

      {review.loading && (
        <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Reading the files again before you apply…
        </p>
      )}
      {review.skippedCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {review.skippedCount} {review.skippedCount === 1 ? "file" : "files"} with nothing to
          change {review.skippedCount === 1 ? "is" : "are"} skipped.
        </p>
      )}

      <ul className="space-y-3">
        {review.rows.map((r) => {
          const result = results[r.path];
          const skipped = r.stale !== null || r.reason !== null;
          return (
            <li
              key={r.path}
              className={`space-y-2 rounded-md border border-border p-3 ${skipped ? "opacity-70" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {redact ? REDACTED_FILE : baseName(r.path)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {redact ? REDACTED_FOLDER : baseName(parentPath(r.path))}
                  </p>
                </div>
                {r.how === "in_place" && (
                  <Tip label="Edited in place: no copy is made">
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <Zap className="h-3 w-3" />
                      In place
                    </span>
                  </Tip>
                )}
                {r.how === "rewrite" && (
                  <Tip label="A copy is made and swapped in, so it needs free space about the file's size">
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <Copy className="h-3 w-3" />
                      Rewrites a copy
                    </span>
                  </Tip>
                )}
              </div>

              {r.note && <p className="text-xs text-amber-400">{r.note}</p>}
              {r.reason && <p className="text-xs text-destructive">{r.reason}</p>}
              {r.stale === "changed" && (
                <p className="text-xs text-destructive">
                  This file changed since you staged it. It is left out: discard its edits and stage
                  them again.
                </p>
              )}
              {r.stale === "gone" && (
                <p className="text-xs text-destructive">
                  This file can no longer be read. It is left out; you can discard its edits.
                </p>
              )}
              {r.blocked.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  This format can't hold: {r.blocked.map(fieldLabel).join(", ")}. Not written.
                </p>
              )}

              <dl className="space-y-2">
                {r.changes.map((c) => (
                  <div key={c.field} className="space-y-0.5">
                    <dt className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                      {fieldLabel(c.field)}
                    </dt>
                    <dd className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
                      <Value
                        text={c.before}
                        testId={`review-before-${c.field}`}
                        struck={c.after === null}
                        redact={redact}
                      />
                      <span aria-hidden className="pt-0.5 text-xs text-muted-foreground">
                        →
                      </span>
                      {c.after === null ? (
                        <span className="text-sm italic text-amber-400">removed</span>
                      ) : (
                        <Value text={c.after} redact={redact} />
                      )}
                    </dd>
                  </div>
                ))}
              </dl>

              {result?.status === "failed" && (
                <p role="alert" className="text-xs text-destructive">
                  {result.message}
                </p>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground"
                disabled={applying}
                aria-label={`Discard edits for this file${redact ? "" : `: ${baseName(r.path)}`}`}
                onClick={() => edits.drop([r.path])}
              >
                Discard this file's edits
              </Button>
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-0 space-y-2 bg-background pb-2 pt-2">
        {review.neededBytes > 0 && (
          <p className="text-xs text-muted-foreground">
            The biggest rewrite needs about {formatSize(review.neededBytes)} of free space
            {review.freeBytes !== null ? ` (${formatSize(review.freeBytes)} free)` : ""}.
          </p>
        )}
        {tooTight && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <TriangleAlert className="h-3.5 w-3.5" />
            Not enough free space for the rewrites.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Applying changes the files for good. There is no undo.
        </p>
        <Button className="w-full" disabled={!canApply} onClick={() => void edits.apply()}>
          {applying ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Writing {progress?.done ?? 0} / {progress?.total ?? 0}…
            </>
          ) : (
            `Apply ${changeCount} ${changeCount === 1 ? "change" : "changes"}`
          )}
        </Button>
      </div>
    </div>
  );
}
