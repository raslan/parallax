import { useState } from "react";
import { Link } from "react-router";
import {
  Eraser,
  FileQuestion,
  Languages,
  Mic,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { PanelSheetContent } from "@/components/PanelSheetContent";
import { Button } from "@/components/ui/button";
import { Sheet, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatSize } from "@/lib/format";
import { languageName } from "@/lib/subtitle-langs";
import { blockedReasons } from "@/lib/subtitleCoverage";
import {
  canMakeMain,
  mainPathOfOriginal,
  tidyTargets,
  type ManageAction,
} from "@/lib/subtitleManage";
import type { SyncEngine } from "@/lib/subtitleRunDock";
import { cn } from "@/lib/utils";
import type { SubtitleFileInfo, TidyMode } from "@/types/subtitle";

const SETTINGS_LINK = "/settings?tab=subtitles";
const ENGINES: SyncEngine[] = ["alass", "ffsubsync"];

const TIDY: { what: TidyMode; label: string }[] = [
  { what: "generated_translated", label: "Delete generated and translated" },
  { what: "extra_versions", label: "Delete extra versions" },
  { what: "originals", label: "Delete sync backups" },
];

const KIND_BADGE: Partial<Record<SubtitleFileInfo["kind"], string>> = {
  generated: "Generated",
  translated: "Translated",
  original: "Original",
  hearing_impaired: "Hearing impaired",
};

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </h3>
      {children}
    </section>
  );
}

function FileRow({
  file,
  files,
  engine,
  onAct,
}: {
  file: SubtitleFileInfo;
  files: SubtitleFileInfo[];
  engine: SyncEngine;
  onAct: (a: ManageAction) => void;
}) {
  const isOriginal = file.kind === "original";
  const main = isOriginal ? mainPathOfOriginal(file.path) : null;
  const mainThere = main !== null && files.some((f) => f.path === main);
  const machine = file.kind === "generated" || file.kind === "translated";
  const act = "h-7 px-2 text-xs";
  return (
    <li
      aria-label={file.name}
      className="space-y-1.5 rounded-md border border-border bg-card px-3 py-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 font-mono text-3xs font-medium uppercase leading-none",
            machine || isOriginal ? "bg-amber-500/15 text-amber-500" : "bg-primary/15 text-primary",
          )}
          title={languageName(file.language)}
        >
          {file.language}
        </span>
        {KIND_BADGE[file.kind] && (
          <span className="shrink-0 text-3xs text-amber-500">{KIND_BADGE[file.kind]}</span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file.path}>
          {file.name}
        </span>
        <span className="shrink-0 text-3xs tabular-nums text-muted-foreground">
          {formatSize(file.size)}
        </span>
      </div>
      {file.label && !KIND_BADGE[file.kind] && (
        <p className="text-3xs text-muted-foreground">Source: {file.label}</p>
      )}
      <div className="flex flex-wrap gap-1">
        {isOriginal ? (
          <Button
            size="sm"
            variant="outline"
            className={act}
            disabled={!mainThere}
            title={mainThere ? undefined : "The subtitle this backup belongs to is not there"}
            onClick={() => main && onAct({ type: "restore", path: main })}
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            Restore
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              className={act}
              onClick={() => onAct({ type: "compare", file })}
            >
              <Play className="mr-1 h-3 w-3" />
              Play and check
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={act}
              onClick={() => onAct({ type: "sync", path: file.path, engine })}
            >
              <RefreshCw className="mr-1 h-3 w-3" />
              Sync
            </Button>
            {canMakeMain(file) && (
              <Button
                size="sm"
                variant="outline"
                className={act}
                onClick={() => onAct({ type: "make_main", path: file.path })}
              >
                <Star className="mr-1 h-3 w-3" />
                Make main
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className={act}
              onClick={() => onAct({ type: "rename", file })}
            >
              <Pencil className="mr-1 h-3 w-3" />
              Rename
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          className={cn(act, "text-destructive hover:text-destructive")}
          onClick={() => onAct({ type: "delete", paths: [file.path] })}
        >
          <Trash2 className="mr-1 h-3 w-3" />
          Delete
        </Button>
      </div>
    </li>
  );
}

/**
 * Manage: every subtitle file one video has, read from disk, in a non-modal right sheet (a
 * bottom sheet on a phone) that follows the selected video. Per file: Play and check, Sync
 * (engine chips start on Settings' choice), Make main (a labelled real file), Rename and
 * Delete; a `.original` backup shows only Restore and Delete. Add (Find subtitles,
 * Translate, Generate), Tidy up (with counts) and, read-only, the subtitle files found in
 * subfolders that no video claims. State suggests, never gates: an action is greyed only
 * when it cannot work at all (no pack, no speech model, no English source), and then says
 * why. `null` for the speech model or the packs means not known yet, which blocks nothing.
 * Props-in/callbacks-out; confirming and writing are the caller's.
 */
export function ManagePanel({
  video,
  files,
  unmatched,
  speechModelReady,
  installedPacks,
  defaultEngine,
  onAct,
  onClose,
}: {
  video: { path: string; name: string };
  files: SubtitleFileInfo[];
  unmatched: { path: string; name: string; directory: string; language: string | null }[];
  speechModelReady: boolean | null;
  installedPacks: string[] | null;
  defaultEngine: SyncEngine;
  onAct: (action: ManageAction) => void;
  onClose: () => void;
}) {
  const [engine, setEngine] = useState<SyncEngine>(defaultEngine);
  const blocked = blockedReasons({
    speechModelReady,
    packsInstalled: installedPacks === null ? null : installedPacks.length,
  });
  const hasEnglish = files.some((f) => f.language.toLowerCase() === "en" && f.kind !== "original");
  const translateReason =
    blocked.translate ?? (hasEnglish ? null : "No English subtitle to translate from");

  return (
    <Sheet open modal={false} onOpenChange={(o) => !o && onClose()}>
      <PanelSheetContent
        overlay={false}
        aria-describedby={undefined}
        onInteractOutside={(e) => e.preventDefault()}
        className="w-[26rem] max-w-full space-y-5 overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>Manage subtitles</SheetTitle>
          <SheetDescription className="truncate" title={video.name}>
            {video.name}
          </SheetDescription>
        </SheetHeader>

        <Section label={`Files · ${files.length}`}>
          <div role="radiogroup" aria-label="Sync with" className="flex items-center gap-1.5">
            <span className="text-3xs text-muted-foreground">Sync with</span>
            {ENGINES.map((e) => (
              <button
                key={e}
                type="button"
                role="radio"
                aria-checked={engine === e}
                onClick={() => setEngine(e)}
                className={cn(
                  "rounded border px-1.5 py-0.5 text-3xs",
                  engine === e ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted/50",
                )}
              >
                {e}
              </button>
            ))}
          </div>
          {files.length === 0 ? (
            <p className="text-xs text-muted-foreground">This video has no subtitle files.</p>
          ) : (
            <ul className="space-y-1.5">
              {files.map((f) => (
                <FileRow key={f.path} file={f} files={files} engine={engine} onAct={onAct} />
              ))}
            </ul>
          )}
        </Section>

        <Section label="Add">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onAct({ type: "find" })}>
              <Search className="mr-1.5 h-3.5 w-3.5" />
              Find subtitles…
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!translateReason}
              onClick={() => onAct({ type: "translate" })}
            >
              <Languages className="mr-1.5 h-3.5 w-3.5" />
              Translate…
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!blocked.generate}
              onClick={() => onAct({ type: "generate" })}
            >
              <Mic className="mr-1.5 h-3.5 w-3.5" />
              Generate…
            </Button>
          </div>
          {(translateReason || blocked.generate) && (
            <ul className="space-y-0.5 text-3xs text-muted-foreground">
              {[translateReason, blocked.generate].map(
                (r) =>
                  r && (
                    <li key={r}>
                      {r.includes("Settings") ? (
                        <Link to={SETTINGS_LINK} className="underline hover:text-foreground">
                          {r}
                        </Link>
                      ) : (
                        r
                      )}
                    </li>
                  ),
              )}
            </ul>
          )}
        </Section>

        <Section label="Tidy up">
          <div className="flex flex-col items-start gap-1.5">
            {TIDY.map(({ what, label }) => {
              const count = tidyTargets(files, what).length;
              return (
                <Button
                  key={what}
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={count === 0}
                  title={count === 0 ? "This video has none" : undefined}
                  onClick={() => onAct({ type: "tidy", what, count })}
                >
                  <Eraser className="mr-1.5 h-3 w-3" />
                  {label} · {count}
                </Button>
              );
            })}
          </div>
        </Section>

        {unmatched.length > 0 && (
          <Section label={`Subtitle files not named for any video here ·${unmatched.length}`}>
            <ul className="space-y-1.5">
              {unmatched.map((u) => (
                <li
                  key={u.path}
                  aria-label={u.name}
                  className="space-y-1.5 rounded-md border border-border bg-card px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2 font-mono text-xs text-muted-foreground">
                    <FileQuestion className="h-3 w-3 shrink-0" />
                    <span className="truncate" title={u.path}>
                      {u.directory ? `${u.directory}/` : ""}
                      {u.name}
                    </span>
                    {u.language && (
                      <span className="shrink-0 font-sans">{languageName(u.language)}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => onAct({ type: "stray_compare", file: u })}
                    >
                      <Play className="mr-1 h-3 w-3" />
                      Play and check
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => onAct({ type: "stray_rename", file: u })}
                    >
                      <Pencil className="mr-1 h-3 w-3" />
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                      onClick={() => onAct({ type: "stray_delete", paths: [u.path] })}
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Parallax can't tell which video these belong to, so they are not adopted here.{" "}
              <Link to="/identify" className="underline hover:text-foreground">
                Identify
              </Link>{" "}
              can place them next to their videos.
            </p>
          </Section>
        )}
      </PanelSheetContent>
    </Sheet>
  );
}
