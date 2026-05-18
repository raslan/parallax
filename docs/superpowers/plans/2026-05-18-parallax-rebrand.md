# Parallax Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the app from Refract to Parallax, introduce a three-theme CSS system (Violet/Cyan/Amber), and apply a mission-control design language (SectionHeader, StatPanel, StatusDot) across all existing pages and as the canonical pattern for new ones.

**Architecture:** A `data-theme` attribute on `<html>` drives CSS custom property blocks in `index.css`. Shadcn's existing HSL vars are updated per theme; new `--px-*` hex vars feed the design language components. `ThemeProvider` reads/writes `localStorage` and applies `data-theme` on mount.

**Tech Stack:** React 18, TypeScript, Tailwind CSS v3, shadcn/ui, lucide-react. All changes are frontend-only.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `frontend/index.html` | Modify | Title → Parallax; favicon → P lettermark SVG |
| `frontend/src/index.css` | Modify | Add three theme CSS var blocks; add `--px-*` tokens |
| `frontend/src/main.tsx` | Modify | Wrap `<App>` in `<ThemeProvider>` |
| `frontend/src/components/ThemeProvider.tsx` | Create | Theme context + `useTheme` hook + localStorage |
| `frontend/src/components/ParallaxLogo.tsx` | Create | Shared P lettermark SVG used in Sidebar + Dashboard |
| `frontend/src/components/SectionHeader.tsx` | Create | Uppercase monospace label component |
| `frontend/src/components/StatPanel.tsx` | Create | Accent-bordered metric panel wrapper |
| `frontend/src/components/StatusDot.tsx` | Create | Animated pulsing state indicator |
| `frontend/src/components/layout/Sidebar.tsx` | Modify | Swap logo; rename "Refract" → "Parallax" |
| `frontend/src/pages/Dashboard.tsx` | Modify | Swap logo; CSS var gradient; SectionHeader; StatPanel; StatusDot |
| `frontend/src/pages/Settings.tsx` | Modify | Add Appearance card with theme picker |
| `frontend/src/pages/Libraries.tsx` | Modify | SectionHeader on panel labels |
| `frontend/src/pages/Files.tsx` | Modify | SectionHeader; monospace on data values |
| `frontend/src/pages/Duplicates.tsx` | Modify | SectionHeader |
| `frontend/src/pages/Cleanup.tsx` | Modify | SectionHeader; StatPanel on results header |
| `frontend/src/pages/Jobs.tsx` | Modify | StatusDot; SectionHeader; CSS-var progress bar |
| `frontend/src/pages/Originals.tsx` | Modify | SectionHeader |
| `CLAUDE.md` | Modify | Update project name and description |
| `CHANGELOG.md` | Modify | Add v0.6.0 section |

---

## Task 1: CSS theme foundation

**Files:**
- Modify: `frontend/src/index.css`

The existing `:root` block already contains shadcn HSL vars. We update it to match the Violet theme values and add `--px-*` hex tokens. Then add `[data-theme="cyan"]` and `[data-theme="amber"]` override blocks.

**Important:** Tailwind maps `bg-primary`, `text-primary`, etc. to `hsl(var(--primary))`. Changing `--primary` here automatically repaints every component that uses those classes. The `--px-*` vars are used only in inline styles of our new design language components.

- [ ] **Step 1: Replace index.css with the three-theme version**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  /* ── Violet / Deep Space (default) ─────────────────────────── */
  :root,
  [data-theme="violet"] {
    --background:          258 62% 5%;
    --foreground:          263 60% 93%;
    --card:                258 52% 8%;
    --card-foreground:     263 60% 93%;
    --popover:             258 52% 8%;
    --popover-foreground:  263 60% 93%;
    --primary:             263 87% 76%;
    --primary-foreground:  0 0% 100%;
    --secondary:           258 45% 12%;
    --secondary-foreground: 263 40% 80%;
    --muted:               258 45% 10%;
    --muted-foreground:    258 22% 46%;
    --accent:              258 45% 12%;
    --accent-foreground:   263 60% 93%;
    --destructive:         0 72% 51%;
    --destructive-foreground: 0 0% 98%;
    --border:              258 40% 14%;
    --input:               258 45% 12%;
    --ring:                263 87% 76%;
    --radius:              0.4rem;
    --sidebar:             258 70% 4%;
    --sidebar-foreground:  263 60% 93%;
    --sidebar-border:      258 45% 10%;
    --sidebar-accent:      258 45% 11%;

    /* Parallax design language tokens */
    --px-accent:           #a78bfa;
    --px-accent-secondary: #7c3aed;
    --px-accent-dim:       rgba(167, 139, 250, 0.12);
    --px-accent-border:    rgba(167, 139, 250, 0.25);
    --px-bg-surface:       #0e0a1e;
    --px-bg-elevated:      #1a1430;
    --px-text-muted:       #554d7a;
  }

  /* ── Cyan / Modern HUD ──────────────────────────────────────── */
  [data-theme="cyan"] {
    --background:          210 78% 5%;
    --foreground:          188 80% 94%;
    --card:                210 73% 8%;
    --card-foreground:     188 80% 94%;
    --popover:             210 73% 8%;
    --popover-foreground:  188 80% 94%;
    --primary:             188 83% 53%;
    --primary-foreground:  210 78% 5%;
    --secondary:           210 65% 11%;
    --secondary-foreground: 188 40% 80%;
    --muted:               210 65% 11%;
    --muted-foreground:    210 27% 40%;
    --accent:              210 65% 11%;
    --accent-foreground:   188 80% 94%;
    --destructive:         0 72% 51%;
    --destructive-foreground: 0 0% 98%;
    --border:              210 55% 12%;
    --input:               210 65% 11%;
    --ring:                188 83% 53%;
    --radius:              0.4rem;
    --sidebar:             210 80% 4%;
    --sidebar-foreground:  188 80% 94%;
    --sidebar-border:      210 60% 10%;
    --sidebar-accent:      210 65% 9%;

    --px-accent:           #22d3ee;
    --px-accent-secondary: #0891b2;
    --px-accent-dim:       rgba(34, 211, 238, 0.12);
    --px-accent-border:    rgba(34, 211, 238, 0.25);
    --px-bg-surface:       #071220;
    --px-bg-elevated:      #0d1f2d;
    --px-text-muted:       #4a6a80;
  }

  /* ── Amber / Mission Control ────────────────────────────────── */
  [data-theme="amber"] {
    --background:          240 50% 5%;
    --foreground:          38 90% 94%;
    --card:                240 44% 8%;
    --card-foreground:     38 90% 94%;
    --popover:             240 44% 8%;
    --popover-foreground:  38 90% 94%;
    --primary:             38 92% 50%;
    --primary-foreground:  240 50% 5%;
    --secondary:           240 38% 12%;
    --secondary-foreground: 38 50% 80%;
    --muted:               240 38% 12%;
    --muted-foreground:    0 0% 53%;
    --accent:              240 38% 12%;
    --accent-foreground:   38 90% 94%;
    --destructive:         0 72% 51%;
    --destructive-foreground: 0 0% 98%;
    --border:              240 35% 14%;
    --input:               240 38% 12%;
    --ring:                38 92% 50%;
    --radius:              0.4rem;
    --sidebar:             240 55% 4%;
    --sidebar-foreground:  38 90% 94%;
    --sidebar-border:      240 40% 11%;
    --sidebar-accent:      240 38% 10%;

    --px-accent:           #f59e0b;
    --px-accent-secondary: #d97706;
    --px-accent-dim:       rgba(245, 158, 11, 0.12);
    --px-accent-border:    rgba(245, 158, 11, 0.25);
    --px-bg-surface:       #0d0d18;
    --px-bg-elevated:      #1a1a28;
    --px-text-muted:       #888888;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground antialiased;
  }
}
```

- [ ] **Step 2: Verify dev server starts without errors**

```bash
cd /home/raslan/transcoder/frontend && npm run dev 2>&1 | head -20
```

Expected: Vite dev server starts, no CSS errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat: add three-theme CSS custom property system (violet/cyan/amber)"
```

---

## Task 2: ThemeProvider and useTheme hook

**Files:**
- Create: `frontend/src/components/ThemeProvider.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { createContext, useContext, useEffect, useState } from "react";

type Theme = "violet" | "cyan" | "amber";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "violet",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function getStoredTheme(): Theme {
  const stored = localStorage.getItem("parallax-theme");
  if (stored === "violet" || stored === "cyan" || stored === "amber") return stored;
  return "violet";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("parallax-theme", theme);
  }, [theme]);

  function setTheme(t: Theme) {
    setThemeState(t);
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ThemeProvider.tsx
git commit -m "feat: add ThemeProvider with localStorage persistence"
```

---

## Task 3: Wire ThemeProvider and update index.html

**Files:**
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/index.html`

- [ ] **Step 1: Wrap App in ThemeProvider in main.tsx**

Replace the entire `frontend/src/main.tsx` with:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { ThemeProvider } from "@/components/ThemeProvider";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>
);
```

- [ ] **Step 2: Update index.html — title and favicon**

Replace the entire `frontend/index.html` with:

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Parallax</title>
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Crect width='20' height='20' rx='3' fill='%2307050f'/%3E%3Ctext x='2' y='16' font-family='monospace' font-size='15' font-weight='700' fill='%23a78bfa'%3EP%3C/text%3E%3Ccircle cx='17' cy='3.5' r='1.2' fill='%23a78bfa'/%3E%3Cline x1='17' y1='1' x2='17' y2='6' stroke='%23a78bfa' stroke-width='0.7' opacity='0.6'/%3E%3Cline x1='14.5' y1='3.5' x2='19.5' y2='3.5' stroke='%23a78bfa' stroke-width='0.7' opacity='0.6'/%3E%3C/svg%3E" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Open http://localhost:5173 (or the Vite port) in a browser and confirm:**
  - Browser tab shows "Parallax"
  - Browser tab favicon is the P lettermark (dark square with purple P + star)
  - App renders with the violet theme (same as before — no visual regression yet)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/main.tsx frontend/index.html
git commit -m "feat: wire ThemeProvider and update title/favicon to Parallax"
```

---

## Task 4: Design language components

**Files:**
- Create: `frontend/src/components/ParallaxLogo.tsx`
- Create: `frontend/src/components/SectionHeader.tsx`
- Create: `frontend/src/components/StatPanel.tsx`
- Create: `frontend/src/components/StatusDot.tsx`

- [ ] **Step 1: Create ParallaxLogo.tsx**

This is the shared logo mark used in Sidebar and Dashboard. It uses `var(--px-accent)` so it repaints with the theme.

```tsx
export function ParallaxLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <text
        x="1"
        y="16"
        fontFamily="monospace"
        fontSize="15"
        fontWeight="700"
        fill="var(--px-accent)"
      >
        P
      </text>
      {/* Four-pointed star accent */}
      <circle cx="17" cy="4" r="1.2" fill="var(--px-accent)" />
      <line x1="17" y1="1.3" x2="17" y2="6.7" stroke="var(--px-accent)" strokeWidth="0.7" opacity="0.55" />
      <line x1="14.3" y1="4" x2="19.7" y2="4" stroke="var(--px-accent)" strokeWidth="0.7" opacity="0.55" />
    </svg>
  );
}
```

- [ ] **Step 2: Create SectionHeader.tsx**

```tsx
export function SectionHeader({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`text-[10px] font-mono font-bold uppercase tracking-[0.12em] ${className}`}
      style={{ color: "var(--px-accent)" }}
    >
      {children}
    </p>
  );
}
```

- [ ] **Step 3: Create StatPanel.tsx**

```tsx
export function StatPanel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[0.4rem] p-4 ${className}`}
      style={{
        border: "1px solid var(--px-accent-border)",
        background: "var(--px-accent-dim)",
      }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Create StatusDot.tsx**

```tsx
type DotStatus = "scanning" | "running" | "idle" | "error" | "done";

const DOT_LABEL: Record<DotStatus, string> = {
  scanning: "Scanning",
  running:  "Running",
  idle:     "Idle",
  error:    "Error",
  done:     "Done",
};

export function StatusDot({ status }: { status: DotStatus }) {
  const isPulsing = status === "scanning" || status === "running";
  const isError   = status === "error";

  return (
    <div className="flex items-center gap-1.5">
      <span className="relative flex h-2 w-2 shrink-0">
        {isPulsing && (
          <span
            className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
            style={{ background: isError ? "#f87171" : "var(--px-accent)" }}
          />
        )}
        <span
          className="relative inline-flex h-2 w-2 rounded-full"
          style={{
            background: isError
              ? "#f87171"
              : status === "idle"
              ? "var(--px-text-muted)"
              : "var(--px-accent)",
          }}
        />
      </span>
      <span
        className="text-[10px] font-mono font-bold uppercase tracking-[0.1em]"
        style={{
          color: isError
            ? "#f87171"
            : status === "idle"
            ? "var(--px-text-muted)"
            : "var(--px-accent)",
        }}
      >
        {DOT_LABEL[status]}
      </span>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ParallaxLogo.tsx \
        frontend/src/components/SectionHeader.tsx \
        frontend/src/components/StatPanel.tsx \
        frontend/src/components/StatusDot.tsx
git commit -m "feat: add ParallaxLogo, SectionHeader, StatPanel, StatusDot components"
```

---

## Task 5: Rebrand Sidebar

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Replace Sidebar.tsx**

```tsx
import { NavLink } from "react-router-dom";
import { LayoutDashboard, Library, Film, Activity, Settings, Archive, Copy, Scissors } from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { ParallaxLogo } from "@/components/ParallaxLogo";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/libraries", icon: Library, label: "Libraries" },
  { to: "/files", icon: Film, label: "Files" },
  { to: "/jobs", icon: Activity, label: "Jobs" },
  { to: "/originals", icon: Archive, label: "Originals" },
  { to: "/duplicates", icon: Copy, label: "Duplicates" },
  { to: "/cleanup", icon: Scissors, label: "Cleanup" },
];

function navClass(isActive: boolean) {
  return cn(
    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
    isActive
      ? "bg-primary/10 text-primary font-medium"
      : "text-muted-foreground hover:bg-[hsl(var(--sidebar-accent))] hover:text-foreground"
  );
}

export function Sidebar() {
  return (
    <aside className="flex h-screen w-56 flex-col border-r bg-[hsl(var(--sidebar))] border-[hsl(var(--sidebar-border))]">
      {/* Wordmark */}
      <div className="flex items-center gap-2.5 px-4 py-5">
        <ParallaxLogo className="h-5 w-5 shrink-0" />
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Parallax
        </span>
      </div>

      <Separator className="bg-[hsl(var(--sidebar-border))]" />

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => navClass(isActive)}>
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <Separator className="bg-[hsl(var(--sidebar-border))]" />

      {/* Settings at bottom */}
      <div className="px-2 py-3">
        <NavLink to="/settings" className={({ isActive }) => navClass(isActive)}>
          <Settings className="h-4 w-4 shrink-0" />
          Settings
        </NavLink>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Verify in browser — sidebar shows "Parallax" and the P lettermark logo**

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/Sidebar.tsx
git commit -m "feat: rebrand sidebar — Parallax wordmark and P lettermark logo"
```

---

## Task 6: Dashboard retrofit

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx`

Changes: remove `PrismMark`, import `ParallaxLogo`; replace hardcoded hex gradient with CSS vars; replace section header `<p>` patterns with `<SectionHeader>`; wrap the scanning indicator with `<StatusDot>`; wrap stat panels with `<StatPanel>`.

- [ ] **Step 1: Replace Dashboard.tsx**

```tsx
import { useEffect, useState } from "react";
import { Library, Film, AlertTriangle, CheckCircle2, HardDrive, Loader2, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { api, Stats } from "@/lib/api";
import { formatSize } from "@/lib/format";
import { ParallaxLogo } from "@/components/ParallaxLogo";
import { SectionHeader } from "@/components/SectionHeader";
import { StatPanel } from "@/components/StatPanel";
import { StatusDot } from "@/components/StatusDot";

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = () =>
      api.getStats()
        .then((s) => { setStats(s); setLoaded(true); })
        .catch(() => setError(true));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const hasCorrupt = (stats?.corrupt_files ?? 0) > 0;
  const healthPct  = stats && stats.total_files > 0
    ? Math.round(((stats.total_files - stats.corrupt_files) / stats.total_files) * 100)
    : 100;

  if (!loaded && !error) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loaded && stats?.total_libraries === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
        <ParallaxLogo className="h-14 w-14 mb-1" />
        <h2 className="text-lg font-semibold tracking-tight">No libraries yet</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          Add a library to start scanning your media folders for corrupt video files.
        </p>
        <Link
          to="/libraries"
          className="mt-2 inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
        >
          Add your first library <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Top accent bar — pulses while scanning */}
      <div
        className={`h-px w-full shrink-0 ${stats?.scanning ? "animate-pulse" : ""}`}
        style={{ background: "linear-gradient(90deg, var(--px-accent), var(--px-accent) 40%, transparent 85%)" }}
      />

      <div className="flex-1 p-10 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <SectionHeader className="mb-1.5">System status</SectionHeader>
            <h1 className="text-2xl font-semibold tracking-tight">
              {hasCorrupt
                ? <><span className="text-red-400">{stats!.corrupt_files} {stats!.corrupt_files === 1 ? "file" : "files"}</span> need repair</>
                : "All files healthy"}
            </h1>
          </div>

          {stats?.scanning && (
            <div className="pt-0.5">
              <StatusDot status="scanning" />
            </div>
          )}
        </div>

        {/* Stat grid */}
        <div className="grid grid-cols-4 border border-border rounded-[0.4rem] overflow-hidden divide-x divide-border">
          {[
            { label: "Libraries",   value: stats?.total_libraries  ?? 0, icon: Library,      fmt: (n: number) => String(n),          },
            { label: "Total files", value: stats?.total_files      ?? 0, icon: Film,          fmt: (n: number) => n.toLocaleString(), },
            { label: "Corrupt",     value: stats?.corrupt_files    ?? 0, icon: AlertTriangle, fmt: (n: number) => String(n), corrupt: true },
            { label: "Repaired",    value: stats?.transcoded_files ?? 0, icon: CheckCircle2,  fmt: (n: number) => String(n), good: true    },
          ].map(({ label, value, icon: Icon, fmt, corrupt, good }) => {
            const isRed   = corrupt && value > 0;
            const isGreen = good    && value > 0;
            return (
              <div key={label} className={`px-7 py-6 ${isRed ? "bg-red-950/20" : ""}`}>
                <SectionHeader className="mb-4">{label}</SectionHeader>
                <div className={`text-4xl font-bold tabular-nums tracking-tight font-mono ${
                  isRed ? "text-red-400" : isGreen ? "text-primary" : "text-foreground"
                }`}>
                  {fmt(value)}
                </div>
                <Icon className={`h-3.5 w-3.5 mt-3 ${
                  isRed ? "text-red-400/40" : isGreen ? "text-primary/40" : "text-muted-foreground/30"
                }`} />
              </div>
            );
          })}
        </div>

        {/* Health + storage row */}
        <div className="grid grid-cols-3 gap-4">
          {/* Health bar — 2 cols */}
          <StatPanel className="col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <SectionHeader>Library health</SectionHeader>
              <span className={`text-sm font-semibold tabular-nums font-mono ${hasCorrupt ? "text-red-400" : "text-primary"}`}>
                {stats?.total_files === 0 ? "—" : `${healthPct}%`}
              </span>
            </div>

            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--px-bg-elevated)" }}>
              <div
                className={`h-full rounded-l-full transition-all duration-700 ${hasCorrupt ? "" : ""}`}
                style={{
                  width: `${healthPct}%`,
                  background: hasCorrupt
                    ? "rgba(248,113,113,0.7)"
                    : "linear-gradient(90deg, var(--px-accent), var(--px-accent-secondary))",
                }}
              />
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{stats ? (stats.total_files - stats.corrupt_files).toLocaleString() : 0} clean</span>
              {hasCorrupt && <span className="text-red-400/80">{stats?.corrupt_files} corrupt</span>}
            </div>
          </StatPanel>

          {/* Storage */}
          <StatPanel className="flex flex-col justify-between">
            <SectionHeader className="mb-4">Storage tracked</SectionHeader>
            <div className="text-2xl font-bold tabular-nums tracking-tight font-mono">
              {stats && stats.total_size_bytes > 0 ? formatSize(stats.total_size_bytes) : "—"}
            </div>
            <HardDrive className="h-3.5 w-3.5 mt-3 text-muted-foreground/30" />
          </StatPanel>
        </div>

        {/* Corruption CTA */}
        {hasCorrupt && (
          <div className="border border-red-900/50 bg-red-950/10 rounded-[0.4rem] px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
              <p className="text-sm">
                <span className="font-medium text-red-400">
                  {stats!.corrupt_files} {stats!.corrupt_files === 1 ? "file" : "files"}
                </span>
                <span className="text-muted-foreground ml-1.5">detected as corrupt — ready to transcode</span>
              </p>
            </div>
            <Link
              to="/libraries"
              className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300 transition-colors shrink-0 ml-6"
            >
              Fix now <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}

        {error && <p className="text-sm text-destructive">Could not reach the API.</p>}

      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**
  - Dashboard loads correctly
  - Stat numbers are monospace
  - Health bar and storage panel have the accent border treatment
  - "SYSTEM STATUS" and other labels are in the monospace uppercase style with accent color
  - Scanning dot (if scanning) shows the StatusDot component

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Dashboard.tsx
git commit -m "feat: retrofit Dashboard with Parallax design language"
```

---

## Task 7: Settings — Appearance theme picker

**Files:**
- Modify: `frontend/src/pages/Settings.tsx`

Add an Appearance card above the Transcoder card with three theme swatches.

- [ ] **Step 1: Replace Settings.tsx**

```tsx
import { useEffect, useState } from "react";
import { Settings as SettingsIcon, Loader2, Check, Palette } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useTheme } from "@/components/ThemeProvider";

const THEMES = [
  { id: "violet" as const, label: "Deep Space",      accent: "#a78bfa", bg: "#07050f" },
  { id: "cyan"   as const, label: "Modern HUD",      accent: "#22d3ee", bg: "#030b14" },
  { id: "amber"  as const, label: "Mission Control", accent: "#f59e0b", bg: "#08080f" },
];

export function Settings() {
  const { theme, setTheme } = useTheme();

  const [maxConcurrent, setMaxConcurrent] = useState(1);
  const [loading, setLoading]             = useState(true);
  const [saving, setSaving]               = useState(false);
  const [saved, setSaved]                 = useState(false);
  const [dirty, setDirty]                 = useState(false);

  useEffect(() => {
    api.getSettings()
      .then((s) => setMaxConcurrent(s.max_concurrent_transcodes))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (n: number) => {
    setMaxConcurrent(n);
    setDirty(true);
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateSettings({ max_concurrent_transcodes: maxConcurrent });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure Parallax behaviour.</p>
      </div>

      {/* ── Appearance ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Palette className="h-4 w-4" />
            Appearance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-4">
            Choose a colour theme. Takes effect immediately.
          </p>
          <div className="flex gap-3">
            {THEMES.map((t) => {
              const isActive = theme === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className={`flex flex-col items-center gap-2 p-3 rounded-[0.4rem] border transition-colors ${
                    isActive ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                  }`}
                >
                  {/* Mini swatch */}
                  <div
                    className="h-8 w-8 rounded-full ring-2 ring-offset-2 ring-offset-background"
                    style={{
                      background: t.accent,
                      ringColor: isActive ? t.accent : "transparent",
                    }}
                  />
                  <span className="text-xs font-medium whitespace-nowrap">{t.label}</span>
                  {isActive && <Check className="h-3 w-3 text-primary" />}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Transcoder ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <SettingsIcon className="h-4 w-4" />
            Transcoder
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Concurrent transcodes</label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    How many files to transcode in parallel. Higher values use more CPU/GPU but finish queues faster.
                    Changes apply to jobs that haven't started yet.
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min={1}
                    max={8}
                    value={maxConcurrent}
                    onChange={(e) => handleChange(Number(e.target.value))}
                    className="w-48 accent-primary"
                  />
                  <span className="text-sm font-mono w-4 text-center">{maxConcurrent}</span>
                </div>
                <div className="flex gap-1 flex-wrap">
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      onClick={() => handleChange(n)}
                      className={`px-3 py-1 rounded text-xs border transition-colors ${
                        maxConcurrent === n
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border hover:bg-accent"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <Button onClick={handleSave} disabled={saving || !dirty} size="sm">
                {saving && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
                {saved  && <Check   className="h-3.5 w-3.5 mr-2 text-green-400" />}
                {saved ? "Saved" : "Save"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**
  - Navigate to Settings
  - Three theme swatches appear (Deep Space, Modern HUD, Mission Control)
  - Clicking a swatch immediately repaints the entire app (sidebar accent, buttons, etc.)
  - The active swatch has a check mark and a primary-colored border
  - Reload the page — the selected theme persists

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Settings.tsx
git commit -m "feat: add Appearance theme picker to Settings"
```

---

## Task 8: Retrofit Libraries, Files, Duplicates, Cleanup

**Files:**
- Modify: `frontend/src/pages/Libraries.tsx`
- Modify: `frontend/src/pages/Files.tsx`
- Modify: `frontend/src/pages/Duplicates.tsx`
- Modify: `frontend/src/pages/Cleanup.tsx`

These pages need `SectionHeader` added to their section labels and technical data values marked `font-mono`. No structural changes.

- [ ] **Step 1: Update Libraries.tsx**

Add the import at the top of the file (after existing imports):
```tsx
import { SectionHeader } from "@/components/SectionHeader";
```

Find the file count display (around the line `{lib.file_count.toLocaleString()} files`) and add `font-mono` to make it render as a readout:

Old:
```tsx
{lib.file_count.toLocaleString()} files
```
New:
```tsx
<span className="font-mono">{lib.file_count.toLocaleString()}</span> files
```

Find where `lib.corrupt_count` is displayed (the `· {lib.corrupt_count} corrupt` span) and add `font-mono` to the count:
```tsx
· <span className="font-mono">{lib.corrupt_count}</span> corrupt
```

- [ ] **Step 2: Update Files.tsx**

Add the import at the top of the file (after existing imports):
```tsx
import { SectionHeader } from "@/components/SectionHeader";
```

In `FileListRow`, locate the three data cells for codec, duration, and bitrate (around lines 275–285). Add `font-mono` to each value:

Old:
```tsx
{file.codec_name ? file.codec_name.toUpperCase() : "—"}
```
New:
```tsx
<span className="font-mono">{file.codec_name ? file.codec_name.toUpperCase() : "—"}</span>
```

Do the same for `formatDuration(file.duration)` and `formatBitrate(file.video_bitrate)` cells.

Find the corruption detail section header (around line 452):
```tsx
<p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider font-medium">
```
Replace with:
```tsx
<SectionHeader className="mb-3">
```
(and close with `</SectionHeader>` instead of `</p>`)

- [ ] **Step 3: Update Duplicates.tsx**

Add the import at the top of the file:
```tsx
import { SectionHeader } from "@/components/SectionHeader";
```

Find the duplicate groups count display (around line 251):
```tsx
<span className="font-semibold tabular-nums">{groups.length}</span>
```
Add `font-mono`:
```tsx
<span className="font-semibold tabular-nums font-mono">{groups.length}</span>
```

In `FilePanel`, find the file stats block (around line 87, the `flex flex-wrap gap-x-3` div with size/duration/codec). Each value already uses `tabular-nums` — add `font-mono` to the individual value spans:
```tsx
<span className="tabular-nums font-mono">{formatSize(file.size)}</span>
<span className="tabular-nums font-mono">{formatDuration(file.duration)}</span>
```

- [ ] **Step 4: Update Cleanup.tsx**

Add imports at the top of the file:
```tsx
import { SectionHeader } from "@/components/SectionHeader";
import { StatPanel } from "@/components/StatPanel";
```

Find the results count display (around line 396):
```tsx
<span className="font-semibold text-foreground tabular-nums">{results.length}</span>
```
Add `font-mono`:
```tsx
<span className="font-semibold text-foreground tabular-nums font-mono">{results.length}</span>
```

In the results table, find the data cells with `tabular-nums text-muted-foreground` (around lines 493–505 — fps, resolution, size, date columns). Add `font-mono` to each:
```tsx
<td className="px-3 py-2 text-right tabular-nums text-muted-foreground font-mono">
```
(apply to all four data cells in each row)

In `CleanupCard`, find where fps, resolution, size are rendered in the grid card and add `font-mono` to those spans as well.

- [ ] **Step 5: Verify all four pages in browser**
  - Technical values (codec, bitrate, size, fps, resolution) render in monospace
  - Switching theme in Settings repaints correctly on each page

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Libraries.tsx \
        frontend/src/pages/Files.tsx \
        frontend/src/pages/Duplicates.tsx \
        frontend/src/pages/Cleanup.tsx
git commit -m "feat: apply Parallax design language to Libraries, Files, Duplicates, Cleanup"
```

---

## Task 9: Retrofit Jobs and Originals

**Files:**
- Modify: `frontend/src/pages/Jobs.tsx`
- Modify: `frontend/src/pages/Originals.tsx`

Jobs is the most interesting page: the `running` status indicator and the progress bar both get the full design language treatment.

- [ ] **Step 1: Update Jobs.tsx**

Add imports:
```tsx
import { SectionHeader } from "@/components/SectionHeader";
import { StatusDot } from "@/components/StatusDot";
```

**Replace `ProgressBar` component** (currently at the top of the file):

Old:
```tsx
function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-24 shrink-0">
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-300"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
```

New:
```tsx
function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-24 shrink-0">
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--px-bg-elevated)" }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${value}%`,
            background: "linear-gradient(90deg, var(--px-accent), var(--px-accent-secondary))",
          }}
        />
      </div>
    </div>
  );
}
```

**Replace the `STATUS_ICON` for `running`** — the `text-blue-400` is fine (blue = active is conventional), but add `StatusDot` to the running row's inline status text area. Find where `status === "running"` renders job progress text and prepend a `<StatusDot status="running" />`.

In `JobRow`, locate the section that shows `{job.processed_files} / {job.total_files} files · {Math.round(job.progress)}%` and wrap the whole job row info block — add `<StatusDot status="running" />` inline next to the progress text when `job.status === "running"`.

Add the page section header. The Jobs page currently starts with an `<h1>` — add `<SectionHeader className="mb-1.5">Active & recent jobs</SectionHeader>` above it.

- [ ] **Step 2: Update Originals.tsx**

Add `SectionHeader` import:
```tsx
import { SectionHeader } from "@/components/SectionHeader";
```

Find the existing `<p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">{label}</p>` pattern (around line 248) and replace with:
```tsx
<SectionHeader className="mb-2">{label}</SectionHeader>
```

Add `font-mono` to size values in the savings badge and storage totals.

- [ ] **Step 3: Verify in browser**
  - Jobs page: running jobs show the StatusDot pulsing indicator; progress bars use the accent gradient
  - Originals page: stat labels use the monospace uppercase style

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Jobs.tsx frontend/src/pages/Originals.tsx
git commit -m "feat: apply Parallax design language to Jobs and Originals"
```

---

## Task 10: CLAUDE.md, CHANGELOG, and final tag

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update CLAUDE.md**

Replace the first 20 lines (the project name, description, and design system section) with:

```markdown
# Parallax — CLAUDE.md

## What this project is

**Parallax** is a self-hosted personal media ops tool — like DevOps for a video library. It scans media libraries for corrupt video files, repairs them by re-encoding with ffmpeg, tracks originals, detects duplicates, and provides filtering/cleanup tools. It runs as a single Docker container and is managed through a browser UI.

Key capabilities:
- Library management: watch folders, periodic scan scheduling
- Corruption detection: ffprobe-based per-file integrity checks
- Smart transcoding: source-aware codec selection (HEVC/AV1/VP9 → HEVC out; H.264/older → H.264), constrained CRF so output never exceeds source bitrate
- Job queue: configurable concurrency, PENDING/RUNNING/CANCELLED states, live SSE progress
- Originals management: browse, restore, and bulk-delete `_originals/` backups
- File browser: thumbnail grid + list view, per-file corruption details, sort by name/size/duration/bitrate
- Duplicate detection: group and compare duplicate files side by side
- Cleanup: filter and bulk-delete files by fps, resolution, duration, date

## Tech stack

| Layer | Tech |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2.0, SQLite, ffmpeg/ffprobe |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS v3, shadcn/ui |
| Container | Single Docker image (multi-stage: Node build → Python runtime) |

The app is served at port **7899**. The React SPA is built into `frontend/dist/` and served as static files by FastAPI. All API routes are prefixed `/api`.

## Design system

- **Name**: Parallax
- **Theme**: dark-only, three switchable palettes (Violet default, Cyan, Amber) via `data-theme` on `<html>`
- **Border radius**: `0.4rem` (tight/sharp)
- **Icon set**: lucide-react
- **Design language components** (use on every page):
  - `SectionHeader` — uppercase monospace accent-coloured label
  - `StatPanel` — accent-bordered metric panel
  - `StatusDot` — animated pulsing state indicator
- **CSS tokens**: shadcn HSL vars (`--primary`, `--background`, etc.) for Tailwind classes; `--px-accent`, `--px-accent-dim`, `--px-accent-border`, `--px-bg-surface`, `--px-bg-elevated`, `--px-text-muted` for design language components (inline styles)
- **Theme storage**: `localStorage` key `parallax-theme`
```

- [ ] **Step 2: Add v0.6.0 to CHANGELOG.md**

At the top of the changelog (below the header, above the v0.5.0 section), add:

```markdown
## [0.6.0] - 2026-05-18

### Features

- Rebrand: Refract → Parallax across all UI surfaces
- Three-theme system: Violet (default), Cyan, Modern HUD, Amber / Mission Control
- Theme picker in Settings → Appearance; persists across sessions
- P lettermark favicon and sidebar logo (replaces prism icon)
- Design language: SectionHeader, StatPanel, StatusDot components
- Retrofit all pages with mission-control visual style
- Monospace rendering for all technical data values

---
```

- [ ] **Step 3: Verify no "Refract" remains in the running UI**

```bash
grep -r "Refract" /home/raslan/transcoder/frontend/src/ --include="*.tsx" --include="*.ts"
```

Expected: no output (zero occurrences).

- [ ] **Step 4: Commit and tag**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: update CLAUDE.md and CHANGELOG for Parallax v0.6.0"
git tag v0.6.0
```

---

## Verification Checklist

After all tasks are complete, confirm these in the browser before merging to main:

- [ ] Tab title shows "Parallax"
- [ ] Favicon is the P lettermark
- [ ] Sidebar shows "Parallax" wordmark + P logo that changes color with theme
- [ ] Settings → Appearance: three swatches, clicking repaints entire app immediately
- [ ] Theme survives page reload (localStorage persistence)
- [ ] All three themes: Violet, Cyan, Amber look correct (no grey/unstyled areas)
- [ ] Dashboard stat numbers are monospace; health bar uses accent gradient
- [ ] Jobs page: running job shows StatusDot pulse; progress bar uses accent gradient
- [ ] Originals page: stat labels are in accent monospace style
- [ ] No functional regressions: scanning, transcoding, cleanup, duplicates, playback all work
- [ ] `grep -r "Refract" frontend/src/` returns no results
