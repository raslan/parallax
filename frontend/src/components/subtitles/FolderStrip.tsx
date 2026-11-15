import { useState } from "react";
import { FolderOpen, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DirPicker } from "@/components/DirPicker";
import { Tip } from "@/components/Tip";
import { COMMON_LANGS, languageName } from "@/lib/subtitle-langs";
import { cn } from "@/lib/utils";
import type { SubtitleProvider } from "@/types/subtitle";

const SOURCES: { id: SubtitleProvider; label: string }[] = [
  { id: "subf2m", label: "Subf2m" },
  { id: "yts", label: "YTS" },
];

const chip = (on: boolean) =>
  cn(
    "flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
    on
      ? "border-primary/40 bg-primary/15 text-primary"
      : "border-border text-muted-foreground hover:text-foreground",
  );

/**
 * The top strip of the Subtitles page: the folder (typed, or picked with Browse), Rescan,
 * the Wanted languages and the Sources. Wanted starts from Settings → Subtitles each
 * visit and is never saved; Sources are both on, with YTS greyed and the reason shown
 * when it cannot apply (films only). The typed path is local until Enter or Open; the
 * page passes `key={folder}` so a new folder re-seeds it. Props-in/callbacks-out.
 */
export function FolderStrip({
  folder,
  scanning,
  onOpen,
  onRescan,
  wanted,
  onWantedChange,
  sources,
  onSourcesChange,
  ytsReason,
}: {
  folder: string | null;
  scanning: boolean;
  onOpen: (path: string) => void;
  onRescan: () => void;
  wanted: string[];
  onWantedChange: (next: string[]) => void;
  sources: SubtitleProvider[];
  onSourcesChange: (next: SubtitleProvider[]) => void;
  /** Why YTS cannot be used for this folder, else null. */
  ytsReason: string | null;
}) {
  const [draft, setDraft] = useState(folder ?? "");
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);
  const addable = COMMON_LANGS.filter((l) => !wanted.includes(l.code));

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Folder</span>
        <Input
          aria-label="Folder"
          placeholder="/media/Shows"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && draft.trim() && onOpen(draft)}
          className="min-w-0 flex-1 basis-56 font-mono text-sm"
        />
        <Button variant="outline" size="sm" onClick={() => setPicking(true)}>
          <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
          Browse
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => (draft.trim() && draft.trim() !== folder ? onOpen(draft) : onRescan())}
          disabled={scanning || !draft.trim()}
        >
          {scanning ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          {draft.trim() && draft.trim() !== folder ? "Open" : "Rescan"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Wanted</span>
        {wanted.map((code) => (
          <span key={code} className={chip(true)}>
            {languageName(code)}
            {wanted.length > 1 && (
              <button
                type="button"
                aria-label={`Stop showing ${languageName(code)}`}
                onClick={() => onWantedChange(wanted.filter((c) => c !== code))}
                className="rounded hover:bg-primary/20"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        <Popover open={adding} onOpenChange={setAdding}>
          <PopoverTrigger asChild>
            <button type="button" aria-label="Add a wanted language" className={chip(false)}>
              <Plus className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="flex w-64 flex-wrap gap-1.5 p-2">
            {addable.map((l) => (
              <button
                key={l.code}
                type="button"
                className={chip(false)}
                onClick={() => {
                  onWantedChange([...wanted, l.code]);
                  setAdding(false);
                }}
              >
                {l.label}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Sources</span>
        {SOURCES.map((s) => {
          const reason = s.id === "yts" ? ytsReason : null;
          const on = sources.includes(s.id) && !reason;
          const button = (
            <button
              type="button"
              aria-pressed={on}
              disabled={!!reason}
              onClick={() =>
                onSourcesChange(on ? sources.filter((x) => x !== s.id) : [...sources, s.id])
              }
              className={cn(chip(on), reason && "cursor-not-allowed opacity-50")}
            >
              {s.label}
              {s.id === "yts" && <span className="text-3xs font-normal">films</span>}
            </button>
          );
          return reason ? (
            <Tip key={s.id} label={reason}>
              <span>{button}</span>
            </Tip>
          ) : (
            <span key={s.id}>{button}</span>
          );
        })}
        {ytsReason && <span className="text-3xs text-muted-foreground">{ytsReason}</span>}
      </div>

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent onClose={() => setPicking(false)}>
          <DialogHeader>
            <DialogTitle>Choose a folder of videos</DialogTitle>
          </DialogHeader>
          <DirPicker
            onSelect={(path) => {
              setPicking(false);
              onOpen(path);
            }}
            onClose={() => setPicking(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
