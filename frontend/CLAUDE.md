# Frontend — CLAUDE.md

See the root `CLAUDE.md` for project overview, commit conventions, and release workflow.

## Structure

```
frontend/src/
  components/
    layout/     # Sidebar, Layout (shell around every page)
    ui/         # shadcn/ui primitives (Button, Card, Badge, etc.) — do not edit
  lib/
    api.ts      # All fetch calls and TypeScript types for API responses
    format.ts   # Formatting helpers: formatSize, formatDuration, formatBitrate, formatDate
    presets.ts  # Shared transcode quality presets (High/Medium/Low)
    utils.ts    # shadcn cn() helper
  pages/        # One file per route
  index.css     # CSS variables for the design system (theme lives here)
  App.tsx       # Routes
  main.tsx      # Entry point
```

## Design system rules

- **Dark only** — no light mode variants, no `dark:` prefix classes.
- **Accent colour**: violet (`#8b5cf6` / `hsl(263 90% 65%)`). Use `text-primary`, `bg-primary`, `border-primary` — never hardcode the hex.
- **Border radius**: `0.4rem` everywhere (set as `--radius` in `index.css`).
- **Icons**: lucide-react only. Keep icon sizes consistent: `h-4 w-4` for inline, `h-3.5 w-3.5` for buttons, `h-10 w-10` for empty states.
- **Typography**: no custom fonts. Tailwind defaults with `tracking-tight` for headings and `tabular-nums` for numbers that update.
- **Emojis**: none.

## Component conventions

- **shadcn primitives** (`Card`, `Button`, `Badge`, `Dialog`, etc.) come from `@/components/ui/` — use them, don't reimplement.
- **Empty states**: dashed border card with a centred icon (`h-10 w-10 text-muted-foreground`), bold heading, muted description. See any existing page for the pattern.
- **Loading**: single `<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />` centred with `py-16`.
- **Section labels**: `text-xs font-medium uppercase tracking-widest text-muted-foreground` — used above stats and grouped content.
- **Stat numbers**: `text-4xl font-bold tabular-nums tracking-tight`.

## API layer

All server communication goes through `src/lib/api.ts`. The `api` object is the single export — add new endpoints there, not inline in components. The `req<T>()` helper handles JSON headers, error throwing, and 204 responses.

Types for API responses live alongside the fetch calls in `api.ts`. Keep them up to date when the backend schema changes.

## Adding a new page

1. Create `src/pages/MyPage.tsx` and export a named function component.
2. Add the route in `App.tsx`.
3. Add a nav item in `Sidebar.tsx` using the same `navClass()` helper as existing items.
4. Use an `Archive`-style lucide icon that isn't already taken.
