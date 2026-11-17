import { useState } from "react";
import { ArrowLeft, Clapperboard, SlidersHorizontal } from "lucide-react";
import { api } from "@/lib/api";
import { Tip } from "@/components/Tip";
import { FileGridCard, FileListRow } from "@/components/FileSelectGrid";
import { ToolbarSearch, type ViewMode } from "@/components/DataToolbar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SubtitleBadges } from "@/components/subtitles/SubtitleBadges";
import { cn } from "@/lib/utils";
import type { TitleWithFiles } from "@/lib/subtitleGroups";
import type { LengthInfo, ScanFile } from "@/types/subtitle";

/**
 * Chrome of a card under its thumbnail. Taller than Organize's 48: the footer holds the badge
 * row and the Manage button, and a row height shorter than the card leaves no gap between rows.
 */
const CARD_CHROME = 56;
const ROW_HEIGHT = 50;

export type AttentionFilter = "all" | "missing" | "machineOnly" | "looksShort" | "hasBackup";

const FILTER_LABELS: Record<AttentionFilter, string> = {
  all: "All files",
  missing: "Missing a wanted language",
  machineOnly: "Only generated or translated",
  looksShort: "Looks short",
  hasBackup: "Has a sync backup",
};

const episodeLabel = (f: ScanFile) =>
  f.season != null && f.episode != null
    ? `S${String(f.season).padStart(2, "0")}E${String(f.episode).padStart(2, "0")}`
    : "";

/** A video's first frame, loaded lazily; a film-strip icon until (or unless) it arrives. */
function Thumb({ path }: { path: string }) {
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");
  return (
    <>
      {state !== "ok" && <Clapperboard className="h-8 w-8 text-muted-foreground/40" />}
      {state !== "failed" && (
        <img
          src={api.identifyThumbnailUrl(path)}
          alt=""
          loading="lazy"
          onLoad={() => setState("ok")}
          onError={() => setState("failed")}
          className={cn(
            "absolute inset-0 h-full w-full object-cover",
            state !== "ok" && "opacity-0",
          )}
        />
      )}
    </>
  );
}

/**
 * One title opened from the Home view: its files as an Organize-style grid or list (the
 * shared card and row), each with its subtitle badges. A rail of the folder's titles on
 * the left (a `Select` on a phone) switches title; search and the "Show" filter narrow
 * the files by name or by what is on disk (missing, only generated or translated, looks
 * short, has a backup). The page owns the selection, sort and view; props-in/callbacks-out.
 */
export function TitleFiles({
  titles,
  openKey,
  onOpenTitle,
  files,
  totalFiles,
  wanted,
  lengths,
  search,
  onSearch,
  show,
  onShow,
  seasons,
  season,
  onSeason,
  onSelectAll,
  onSelectNone,
  counts,
  selected,
  onToggleSelect,
  onPlay,
  onManage,
  viewMode,
  cardSize,
  scrollElement,
  marquee,
}: {
  titles: TitleWithFiles[];
  openKey: string;
  onOpenTitle: (key: string | null) => void;
  /** The open title's files after search and filter, in display order. */
  files: ScanFile[];
  totalFiles: number;
  wanted: string[];
  lengths: Record<string, LengthInfo | null>;
  search: string;
  onSearch: (v: string) => void;
  show: AttentionFilter;
  onShow: (v: AttentionFilter) => void;
  /** The seasons the open title has (the filter shows from two up). */
  seasons: number[];
  season: number | "all";
  onSeason: (v: number | "all") => void;
  /** Selects every file shown now (after search and filters). */
  onSelectAll: () => void;
  onSelectNone: () => void;
  counts: Record<AttentionFilter, number>;
  selected: ReadonlySet<string>;
  onToggleSelect: (path: string) => void;
  onPlay: (file: ScanFile) => void;
  /** Opens the Manage panel for this video's subtitle files. */
  onManage: (file: ScanFile) => void;
  viewMode: ViewMode;
  cardSize: number;
  scrollElement: HTMLElement | null;
  marquee: {
    onMarqueeStart: (additive: boolean) => void;
    onMarquee: (keys: readonly (string | number)[]) => void;
  };
}) {
  const open = titles.find((t) => t.group.key === openKey);
  const name = (t: TitleWithFiles) =>
    t.group.year ? `${t.group.title} (${t.group.year})` : t.group.title;
  const card = (f: ScanFile) => ({ id: 0, path: f.path, filename: f.filename, size: 0 });
  const badges = (f: ScanFile) => (
    <span className="flex min-w-0 items-center gap-1">
      <SubtitleBadges file={f} wanted={wanted} length={lengths[f.path]} />
      <Tip label="Manage subtitles">
        <button
          type="button"
          aria-label={`Manage subtitles for ${f.filename}`}
          onClick={(e) => {
            e.stopPropagation();
            onManage(f);
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </button>
      </Tip>
    </span>
  );

  // A lone title is the whole folder: no rail, and nothing to go back to.
  const lone = titles.length === 1;

  return (
    <div className="flex gap-6">
      <nav
        aria-label="Titles"
        className={cn("hidden w-52 shrink-0 space-y-0.5", !lone && "md:block")}
        hidden={lone}
      >
        <button
          type="button"
          onClick={() => onOpenTitle(null)}
          className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All titles
        </button>
        {titles.map((t) => (
          <button
            key={t.group.key}
            type="button"
            aria-current={t.group.key === openKey ? "page" : undefined}
            onClick={() => onOpenTitle(t.group.key)}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
              t.group.key === openKey
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
            )}
          >
            <span className="truncate">{name(t)}</span>
            <span className="shrink-0 font-mono text-3xs tabular-nums">{t.files.length}</span>
          </button>
        ))}
      </nav>

      <div className="min-w-0 flex-1 space-y-3">
        <div className={cn("flex items-center gap-2 md:hidden", lone && "hidden")} hidden={lone}>
          <button
            type="button"
            onClick={() => onOpenTitle(null)}
            aria-label="All titles"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <Select value={openKey} onValueChange={(v) => onOpenTitle(v)}>
            <SelectTrigger aria-label="Title" className="h-8 min-w-0 flex-1 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {titles.map((t) => (
                <SelectItem key={t.group.key} value={t.group.key}>
                  {name(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto hidden truncate text-lg font-semibold tracking-tight md:block">
            {open ? name(open) : ""}
          </h2>
          <ToolbarSearch value={search} onChange={onSearch} />
          {seasons.length > 1 && (
            <Select
              value={String(season)}
              onValueChange={(v) => onSeason(v === "all" ? "all" : Number(v))}
            >
              <SelectTrigger aria-label="Season" className="h-8 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All seasons</SelectItem>
                {seasons.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    Season {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={show} onValueChange={(v) => onShow(v as AttentionFilter)}>
            <SelectTrigger aria-label="Show" className="h-8 w-56 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(FILTER_LABELS) as AttentionFilter[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {FILTER_LABELS[k]} ({counts[k]})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {files.length > 0 && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onSelectAll}>
              Select all{files.length !== totalFiles ? ` shown (${files.length})` : ""}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={onSelectNone}
              disabled={!files.some((f) => selected.has(f.path))}
            >
              Select none
            </Button>
          </div>
        )}

        {files.length === 0 ? (
          <EmptyState
            icon={Clapperboard}
            size="sm"
            title={totalFiles === 0 ? "No videos in this title" : "No files match"}
            description={totalFiles === 0 ? undefined : "Clear the search or show all files."}
          />
        ) : viewMode === "grid" ? (
          <VirtualizedGrid
            items={files}
            getKey={(f) => f.path}
            mode="grid"
            itemHeight={CARD_CHROME + cardSize * 0.75}
            itemAspectRatio={4 / 3}
            itemChromeHeight={CARD_CHROME}
            minColumnWidth={cardSize}
            scrollElement={scrollElement}
            {...marquee}
            renderItem={(f) => (
              <FileGridCard
                file={card(f)}
                selected={selected.has(f.path)}
                onToggle={() => onToggleSelect(f.path)}
                onPlay={() => onPlay(f)}
                thumbnail={<Thumb path={f.path} />}
                badge={
                  episodeLabel(f) && (
                    <span className="rounded bg-black/60 px-1.5 py-0.5 font-mono text-3xs text-white">
                      {episodeLabel(f)}
                    </span>
                  )
                }
                footer={badges(f)}
              />
            )}
          />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-px-elevated">
            <VirtualizedGrid
              items={files}
              getKey={(f) => f.path}
              mode="list"
              itemHeight={ROW_HEIGHT}
              scrollElement={scrollElement}
              {...marquee}
              renderItem={(f) => (
                <FileListRow
                  file={card(f)}
                  selected={selected.has(f.path)}
                  onToggle={() => onToggleSelect(f.path)}
                  onPlay={() => onPlay(f)}
                  thumbnail={
                    <span className="relative flex h-8 w-14 items-center justify-center overflow-hidden rounded bg-muted">
                      <Thumb path={f.path} />
                    </span>
                  }
                  columns={
                    <>
                      <span className="hidden w-16 shrink-0 font-mono text-xs text-muted-foreground sm:block">
                        {episodeLabel(f)}
                      </span>
                      <span className="flex w-40 shrink-0 justify-end sm:w-56">{badges(f)}</span>
                    </>
                  }
                />
              )}
            />
          </div>
        )}
      </div>
    </div>
  );
}
