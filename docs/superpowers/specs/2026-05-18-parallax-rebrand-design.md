# Parallax Rebrand Design Spec

## Overview

Rebrand the application from "Refract" to "Parallax" and establish a mission control / space instrument visual identity. This covers brand identity, a three-theme system, a reusable design language component set, and a retrofit of all existing pages — with the design language becoming the canonical pattern for all future pages.

Work is done on the `feature/parallax-rebrand` branch. The safe rollback point is the `v0.5.0` tag on `main`.

---

## 1. Brand Identity

**Name:** Parallax  
**Icon:** Monospaced "P" lettermark with a small four-pointed star accent at top-right. Implemented as an inline SVG — used as the HTML favicon, the `<title>` element, and the nav sidebar logo mark. No external image files needed.

**Tagline:** None. The name stands alone.

---

## 2. Theme System

### Three palettes

| Theme ID | Name | Background | Accent | Secondary accent | Feel |
|---|---|---|---|---|---|
| `violet` | Deep Space | `#07050f` | `#a78bfa` | `#7c3aed` | Nebula / cinematic |
| `cyan` | Modern HUD | `#030b14` | `#22d3ee` | `#0891b2` | Fighter jet / near-future |
| `amber` | Mission Control | `#08080f` | `#f59e0b` | `#d97706` | Apollo / NASA radar |

`violet` is the default.

### Implementation approach

Themes are applied via a `data-theme` attribute on `<html>`. Each theme is a block of CSS custom properties in `index.css`:

```css
:root, [data-theme="violet"] {
  --accent:          #a78bfa;
  --accent-secondary:#7c3aed;
  --accent-dim:      rgba(167, 139, 250, 0.12);
  --accent-border:   rgba(167, 139, 250, 0.25);
  --bg-base:         #07050f;
  --bg-surface:      #0e0a1e;
  --bg-elevated:     #1a1430;
  --text-primary:    #ede9fe;
  --text-muted:      #554d7a;
  --border-subtle:   rgba(255,255,255,0.05);
  --border-accent:   rgba(167,139,250,0.30);
}

[data-theme="cyan"] {
  --accent:          #22d3ee;
  --accent-secondary:#0891b2;
  --accent-dim:      rgba(34, 211, 238, 0.12);
  --accent-border:   rgba(34, 211, 238, 0.25);
  --bg-base:         #030b14;
  --bg-surface:      #071220;
  --bg-elevated:     #0d1f2d;
  --text-primary:    #e0f7fa;
  --text-muted:      #4a6a80;
  --border-subtle:   rgba(255,255,255,0.04);
  --border-accent:   rgba(34,211,238,0.30);
}

[data-theme="amber"] {
  --accent:          #f59e0b;
  --accent-secondary:#d97706;
  --accent-dim:      rgba(245, 158, 11, 0.12);
  --accent-border:   rgba(245, 158, 11, 0.25);
  --bg-base:         #08080f;
  --bg-surface:      #0d0d18;
  --bg-elevated:     #1a1a28;
  --text-primary:    #fef3c7;
  --text-muted:      #888;
  --border-subtle:   rgba(255,255,255,0.04);
  --border-accent:   rgba(245,158,11,0.30);
}
```

All Tailwind classes that reference colors are replaced with these CSS var references via `@layer utilities` or `style` props. No hardcoded `violet-*` / `slate-*` classes remain in page or component files.

### Storage and initialisation

- Active theme stored in `localStorage` under key `parallax-theme`
- `ThemeProvider` reads `localStorage` on mount and writes `data-theme` to `document.documentElement`
- Falls back to `"violet"` if no stored value
- `useTheme()` hook exposes `{ theme, setTheme }` to consumers

### Picker UI

Settings page → **Appearance** section. Three clickable swatches — a small coloured circle + label (`Deep Space`, `Modern HUD`, `Mission Control`). Active swatch has an accent ring. Clicking calls `setTheme(id)`.

---

## 3. Design Language

These patterns apply to every page — existing pages are retrofitted, new pages adopt them from the start.

### 3.1 Section headers

Uppercase monospace label for any named block of content.

```tsx
// Usage
<SectionHeader>Library Status</SectionHeader>

// Renders as
<p className="text-[10px] font-mono font-bold uppercase tracking-[0.12em]"
   style={{ color: 'var(--accent)' }}>
  LIBRARY STATUS
</p>
```

### 3.2 Stat panels

Accented border + tinted background for key metric areas.

```tsx
// Usage
<StatPanel>
  <SectionHeader>Total Files</SectionHeader>
  <span className="text-2xl font-mono font-bold">4,218</span>
</StatPanel>

// Renders as
<div className="rounded-md p-4"
     style={{
       border: '1px solid var(--accent-border)',
       background: 'var(--accent-dim)',
     }}>
  {children}
</div>
```

### 3.3 Status dots

Animated dot + uppercase state label. Replaces plain text badges for live job states.

```tsx
// Usage
<StatusDot status="scanning" />
<StatusDot status="idle" />
<StatusDot status="error" />

// States: "scanning" | "idle" | "error" | "done"
// Dot pulses (animate-pulse) for "scanning", static for others
// Colours: accent for scanning/done, muted for idle, red for error
```

### 3.4 Data values

Technical numbers (bitrate, codec, fps, resolution, file size) are rendered in `font-mono`. This makes them feel like instrument readouts. No extra component needed — apply `font-mono` directly on the value element.

### 3.5 Progress bars

Accent gradient fill. Replace shadcn `<Progress>` default where a progress bar appears with:

```tsx
<div className="h-2 rounded-full overflow-hidden"
     style={{ background: 'var(--bg-elevated)' }}>
  <div className="h-full rounded-full"
       style={{
         width: `${pct}%`,
         background: 'linear-gradient(90deg, var(--accent), var(--accent-secondary))',
       }} />
</div>
```

### 3.6 Card and panel borders

Cards at rest: `border-subtle` (`rgba(255,255,255,0.05)`).  
Cards on hover: `border-accent` (`rgba(accent,0.30)`).  
Transition: `transition-colors duration-150`.

---

## 4. Files Changed

### New files

| File | Purpose |
|---|---|
| `frontend/src/components/ThemeProvider.tsx` | Context + `useTheme` hook + `localStorage` persistence |
| `frontend/src/components/SectionHeader.tsx` | Uppercase monospace label component |
| `frontend/src/components/StatPanel.tsx` | Accent-bordered metric panel component |
| `frontend/src/components/StatusDot.tsx` | Animated state indicator component |

### Modified files

| File | Change |
|---|---|
| `index.html` | `<title>Parallax</title>`, inline SVG favicon |
| `frontend/src/index.css` | CSS custom property blocks for all three themes |
| `frontend/src/main.tsx` | Wrap app in `<ThemeProvider>` |
| `frontend/src/App.tsx` | "Refract" → "Parallax" in nav; P lettermark logo; apply design language to sidebar |
| `frontend/src/pages/Settings.tsx` | Add Appearance section with theme picker |
| `frontend/src/pages/Dashboard.tsx` | Retrofit stat panels + section headers |
| `frontend/src/pages/Libraries.tsx` | Retrofit section headers + card borders |
| `frontend/src/pages/Files.tsx` | Retrofit section headers, monospace data values, card borders |
| `frontend/src/pages/Duplicates.tsx` | Retrofit section headers, card borders |
| `frontend/src/pages/Cleanup.tsx` | Retrofit section headers, progress bars, card borders |
| `frontend/src/pages/Jobs.tsx` | Retrofit section headers, status dots, progress bars |
| `frontend/src/pages/Originals.tsx` | Retrofit section headers, card borders |
| `CLAUDE.md` | Update project name |
| `CHANGELOG.md` | Add v0.6.0 entry |

### Unchanged

All backend files, routing, API contracts, business logic. Zero functional changes.

---

## 5. Non-Goals

- No new pages or features beyond Appearance settings
- No typography font changes (system font stack is fine)
- No animation overhaul beyond the status dot pulse and existing transitions
- No backend changes of any kind

---

## 6. Success Criteria

- The word "Refract" does not appear anywhere in the running UI
- Switching theme in Settings immediately repaints the entire app with no reload
- Theme persists across page reloads and new sessions
- All existing features (scanning, cleanup, duplicates, playback, originals) work identically after the rebrand
- `SectionHeader`, `StatPanel`, and `StatusDot` are used consistently across all pages
- A new page built after this rebrand can achieve the correct visual style purely by using these three components + the CSS var tokens
