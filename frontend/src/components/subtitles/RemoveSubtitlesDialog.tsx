import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ConfirmProvider";
import { QueryError } from "@/components/QueryError";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { qk, subtitlesApi } from "@/lib/api";
import { languageName } from "@/lib/subtitle-langs";
import type { RemoveCounts, SubtitleKind } from "@/types/subtitle";

const KINDS: { kind: SubtitleKind; label: string }[] = [
  { kind: "real", label: "Real" },
  { kind: "hearing_impaired", label: "Hearing impaired" },
  { kind: "generated", label: "Generated" },
  { kind: "translated", label: "Translated" },
  { kind: "original", label: "Sync backups" },
];

const files = (n: number) => `${n} subtitle ${n === 1 ? "file" : "files"}`;
const keyOf = (language: string, kind: SubtitleKind) => `${language}\u0000${kind}`;

/**
 * Remove subtitles: a table of language by kind with how many files the selected videos have;
 * the user ticks what to remove (nothing is ticked at first), then confirms with the count. A
 * permanent delete, like Manage's Delete. The body mounts only while the dialog is open, so it
 * reads fresh counts and starts with nothing ticked every time. `onRemoved` gets how many
 * files went.
 */
export function RemoveSubtitlesDialog({
  open,
  folder,
  videoPaths,
  onClose,
  onRemoved,
}: {
  open: boolean;
  folder: string | null;
  videoPaths: string[];
  onClose: () => void;
  onRemoved: (removed: number) => void;
}) {
  // Portalled above the page's side sheets, like the rename dialog.
  return createPortal(
    <div className="relative z-[60]">
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-2xl" onClose={onClose}>
          {open && (
            <RemoveBody
              folder={folder}
              videoPaths={videoPaths}
              onClose={onClose}
              onRemoved={onRemoved}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>,
    document.body,
  );
}

function RemoveBody({
  folder,
  videoPaths,
  onClose,
  onRemoved,
}: {
  folder: string | null;
  videoPaths: string[];
  onClose: () => void;
  onRemoved: (removed: number) => void;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const countsQ = useQuery({
    queryKey: qk.subtitleRemoveCounts(videoPaths),
    queryFn: () => subtitlesApi.removeCounts(videoPaths),
    // What is on disk now, not what the last open saw.
    staleTime: 0,
    gcTime: 0,
  });
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());

  const counts: RemoveCounts = countsQ.data ?? {};
  const languages = Object.keys(counts).sort((a, b) =>
    languageName(a).localeCompare(languageName(b)),
  );
  // The chosen cells in table order, and how many files they cover.
  const chosen = languages.flatMap((language) =>
    KINDS.filter(
      ({ kind }) => ticked.has(keyOf(language, kind)) && (counts[language]?.[kind] ?? 0) > 0,
    ).map(({ kind }) => ({ language, kind })),
  );
  const total = chosen.reduce((n, c) => n + (counts[c.language]?.[c.kind] ?? 0), 0);

  const remove = useMutation({
    mutationFn: () => subtitlesApi.removeByKind(videoPaths, chosen),
    onSuccess: ({ removed }) => {
      void qc.invalidateQueries({ queryKey: ["subtitles", "files"] });
      void qc.invalidateQueries({ queryKey: ["subtitles", "tracks"] });
      if (folder !== null) {
        void qc.invalidateQueries({ queryKey: qk.subtitleScan(folder) });
        void qc.invalidateQueries({ queryKey: qk.subtitleUnmatched(folder) });
      }
      onRemoved(removed);
    },
  });

  const toggle = (key: string) =>
    setTicked((t) => {
      const next = new Set(t);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const submit = async () => {
    const ok = await confirm({
      title: "Delete subtitle files?",
      description: `This deletes ${files(total)} from ${videoPaths.length} ${
        videoPaths.length === 1 ? "video" : "videos"
      }. It cannot be undone.`,
      confirmText: "Delete files",
      destructive: true,
    });
    if (ok) remove.mutate();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Remove subtitles</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        {countsQ.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" />
            Counting the subtitle files…
          </p>
        ) : countsQ.isError ? (
          <QueryError error={countsQ.error} onRetry={() => void countsQ.refetch()} />
        ) : languages.length === 0 ? (
          <p className="text-sm text-muted-foreground">These videos have no subtitle files.</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 text-left text-3xs font-medium uppercase tracking-widest text-muted-foreground">
                    <th scope="col" className="px-3 py-1.5">
                      Language
                    </th>
                    {KINDS.map((k) => (
                      <th key={k.kind} scope="col" className="px-3 py-1.5">
                        {k.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {languages.map((language) => (
                    <tr key={language} className="border-t border-border/60">
                      <th scope="row" className="px-3 py-2 text-left font-medium">
                        {languageName(language)}
                      </th>
                      {KINDS.map(({ kind, label }) => {
                        const n = counts[language]?.[kind] ?? 0;
                        return (
                          <td key={kind} className="px-3 py-2">
                            {n > 0 ? (
                              <label className="flex items-center gap-2 tabular-nums">
                                <Checkbox
                                  checked={ticked.has(keyOf(language, kind))}
                                  onCheckedChange={() => toggle(keyOf(language, kind))}
                                  aria-label={`${languageName(language)} ${label.toLowerCase()}`}
                                />
                                {n}
                              </label>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Real does not include hearing impaired files: they have their own column. Removing
              deletes the files for good.
            </p>
          </>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button
          variant="destructive"
          disabled={total === 0 || remove.isPending}
          onClick={() => void submit()}
        >
          {remove.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          )}
          {total > 0 ? `Remove ${total} ${total === 1 ? "file" : "files"}` : "Remove"}
        </Button>
      </DialogFooter>
    </>
  );
}
