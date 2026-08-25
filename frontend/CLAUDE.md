# Frontend — CLAUDE.md

See the root `CLAUDE.md` for project overview, commit conventions, and release workflow.

**Keep this file up to date** when adding pages, components, or changing design system conventions.

## Structure

```
frontend/src/
  components/
    layout/                  # Sidebar, Layout (shell around every page)
    ui/                      # shadcn/ui primitives — do not edit
    DirPicker.tsx            # Filesystem directory picker dialog
    FileMatcher.tsx           # Identify's episode-slot drag UI — every episode in the detected season(s) is a drop target, files are a draggable pool; season detection comes from per-file guessit parsing, not folder position
    ImageViewerModal.tsx     # Lightbox for image library files
    ParallaxLogo.tsx         # P lettermark SVG logo
    SectionHeader.tsx        # Titled section divider with optional action
    StatPanel.tsx            # Stat card (label + big number + optional icon)
    StatusDot.tsx            # Coloured dot for job/file status
    SubtitleSearchDialog.tsx # Per-file Plex-style subtitle search; Source tab (Subf2m / YTS-Subs) — YTS-Subs needs a TMDB key (resolves IMDB ID) and is disabled with a Settings link when none is configured
    ThemeProvider.tsx        # Reads theme setting, applies data-theme to <html>
    VideoPlayerModal.tsx     # Plyr-based video player modal with subtitle tracks; calls POST /api/stream/prepare before opening and polls GET /api/stream/prepare-status, showing a progress overlay while the backend remuxes non-web-safe audio (see backend/CLAUDE.md "Stream playback audio compatibility") — every caller (Files, Duplicates, Cleanup, Compress, Subtitles) gets this for free
  lib/
    api.ts           # All fetch calls and TypeScript types for API responses
    format.ts        # formatSize, formatDuration, formatBitrate, formatDate
    presets.ts       # Shared transcode quality presets (High/Medium/Low)
    useLiveFiles.ts   # Shared hook — subscribes to GET /files or /images stream, calls back on any DB-side change to that library's files
    subtitle-langs.ts# ISO language list for subtitle language picker
    utils.ts         # shadcn cn() helper
  pages/             # One file per route (see Pages section below)
  index.css          # CSS variables — theme tokens live here
  App.tsx            # Routes
  main.tsx           # Entry point
```

## Pages

| File | Route | Purpose |
|---|---|---|
| `Libraries.tsx` | `/` | Video library list |
| `Files.tsx` | `/libraries/:id` | File browser with thumbnail grid |
| `Compress.tsx` | `/libraries/:id/compress` | Re-encode files, CRF slider, bulk job |
| `Duplicates.tsx` | `/libraries/:id/duplicates` | Duplicate detection — criteria card (exact size / duration ± / visual pHash with similarity slider, compare mode, frame count); single "Find Duplicates" button runs pHash extraction then comparison in one job |
| `Cleanup.tsx` | `/libraries/:id/cleanup` | Bulk delete by filter |
| `Originals.tsx` | `/libraries/:id/originals` | Browse/restore `_originals/` backups |
| `Subtitles.tsx` | `/libraries/:id/subtitles` | Subtitle scan + Whisper transcription |
| `Identify.tsx` | `/libraries/:id/identify` | TMDB metadata matching; per-file guessit detects which season(s) are present so only those are fetched and matched via drag-to-slot, not positional order |
| `ImageLibraries.tsx` | `/images` | Image library list |
| `Images.tsx` | `/images/:id` | Image browser |
| `ImageDuplicates.tsx` | `/images/:id/duplicates` | Image duplicate detection |
| `ImageQuarantined.tsx` | `/images/:id/quarantine` | Quarantined image review |
| `ContentReview.tsx` | `/images/:id/content` | Inappropriate content review |
| `Downloads.tsx` | `/downloads` | yt-dlp download queue |
| `Jobs.tsx` | `/jobs` | All jobs across all libraries |
| `Settings.tsx` | `/settings` | App settings, model download, danger zone |

## Design system

### Themes

Seven built-in themes, selected in Settings and persisted to the DB. `ThemeProvider` reads the setting on mount and sets `data-theme` on `<html>`. Theme CSS lives in `index.css` under `[data-theme="..."]` selectors.

| Key | Name |
|---|---|
| `violet` | Deep Space (default) |
| `cyan` | Modern HUD |
| `amber` | Mission Control |
| `oled` | OLED |
| `emerald` | Neon Grid |

### CSS tokens

Use `--px-*` tokens for all theme-sensitive colours. Never hardcode hex values.

| Token | Purpose |
|---|---|
| `--px-accent` | Primary accent colour |
| `--px-accent-secondary` | Darker accent for hover/active |
| `--px-accent-dim` | Low-opacity accent for backgrounds |
| `--px-accent-border` | Low-opacity accent for borders |
| `--px-bg-surface` | Slightly elevated surface colour |
| `--px-bg-elevated` | More elevated surface (cards, modals) |
| `--px-text-muted` | Muted text tuned per theme |

In Tailwind use `text-primary`, `bg-primary`, `border-primary` for the accent — these are mapped to `--px-accent` via `index.css`. For surfaces use the `--px-*` tokens directly via inline styles or `[--px-...]` Tailwind arbitrary values.

### Rules

- **Dark only** — no light mode, no `dark:` prefix classes.
- **Border radius**: `0.4rem` everywhere (`--radius` in `index.css`).
- **Icons**: lucide-react only. `h-4 w-4` inline, `h-3.5 w-3.5` in buttons, `h-10 w-10` empty states.
- **Typography**: no custom fonts. `tracking-tight` for headings, `tabular-nums` for updating numbers.
- **Emojis**: none.

## Component conventions

- **shadcn primitives** (`Card`, `Button`, `Badge`, `Dialog`, etc.) from `@/components/ui/` — use them, don't reimplement.
- **`SectionHeader`** — use for any titled section with an optional trailing action button.
- **`StatPanel`** — use for summary stats at the top of pages.
- **`StatusDot`** — use for job status indicators, not custom coloured dots.
- **`VideoPlayerModal`** — use for all in-app video playback. Opens Plyr with subtitle track support. Pass `fileId` or `path`; it fetches subtitle tracks automatically.
- **Empty states**: dashed border card, centred icon (`h-10 w-10 text-muted-foreground`), bold heading, muted description.
- **Loading**: `<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />` centred with `py-16`.
- **Section labels**: `text-xs font-medium uppercase tracking-widest text-muted-foreground`.
- **Stat numbers**: `text-4xl font-bold tabular-nums tracking-tight`.

## Code organization

- **State ownership**: pages (`src/pages/*`) own state, effects, and data-fetching — either directly or by delegating to a custom hook in `src/hooks/`. Everything under `src/components/*` is props-in/callbacks-out: no `useState`/`useEffect` there except purely local, non-business UI state (e.g. a dropdown's open/closed, a hover flag). This is the target for the refactor phase that follows tooling setup — not every existing component meets it yet.
- **Hooks**: `src/hooks/`, one file per hook, named `useX.ts`.
- **Types**: `src/types/`, one file per domain (`types/job.ts`, `types/subtitle.ts`, etc.), not colocated in component files or in the API layer.
- **API calls**: `src/lib/api/`, one file per backend resource, matching `backend/app/api/*.py` naming (`api/subtitles.ts` ↔ `backend/app/api/subtitles.py`). `src/lib/api/index.ts` re-exports everything so `import { api, subtitlesApi } from "@/lib/api"` keeps working regardless of which domain file a method actually lives in.
- **Linting/formatting**: ESLint (`npm run lint`) + Prettier (`npm run format`) at the frontend root; both run automatically on staged files via the repo-root pre-commit hook (husky + lint-staged, see root `package.json`).

## Live file refresh

Pages showing a live file grid (Files, Images, Compress, Toolbox, ImageDuplicates) call `useLiveFiles(kind, libraryId, onChange)` right after defining their own fetch function, passing that fetch function as `onChange` — this auto-refetches whenever anything anywhere in the app changes that library's files (a scan, Compress, Toolbox, restore, delete, quarantine). Pages showing manually-triggered search/scan results the user reviews before a bulk action (Cleanup, Duplicates) use the same hook but set a `resultsStale` flag instead of auto-refetching, rendering a dismissible "results may be out of date — Refresh" banner instead — auto-refetching there would silently discard the user's in-progress selection.

## API layer

All server communication goes through `src/lib/api.ts`. The `api` object is the single export — add new endpoints there, not inline in components. The `req<T>()` helper handles JSON headers, error throwing, and 204 responses.

Types for API responses live alongside the fetch calls in `api.ts`. Keep them up to date when the backend schema changes.

## Adding a new page

1. Create `src/pages/MyPage.tsx` and export a named function component.
2. Add the route in `App.tsx`.
3. Add a nav item in `Sidebar.tsx` using the same `navClass()` helper as existing items.
4. Use a lucide icon not already taken in the sidebar.
5. Add the page to the Pages table in this file.
