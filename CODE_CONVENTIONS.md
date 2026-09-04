# React + TypeScript Code Conventions

Portable conventions for React apps written in TypeScript.

**The only hard assumption is TypeScript in strict mode.** Everything else —
data-fetching library, form library, schema validator, test runner, bundler,
styling approach — is *named as a reference implementation, not required*. Where a
section shows concrete API (e.g. TanStack Query's `refetchInterval`), the rule it
illustrates holds for any equivalent tool; translate the names.

Reference implementations these examples are written against:

> React 18 · Vite · Tailwind v3 · shadcn/ui · Vitest
> Data: TanStack Query v5 (rules also hold for SWR, RTK Query)
> Forms: react-hook-form + zod (rules also hold for Formik, valibot, yup)

Rules marked **(bug)** are inverses of defects found in real code review — the ones
most worth enforcing.

---

## 1. Data fetching — a server-state library owns every server read

- **Every plain GET goes through a query hook.** No component holds its own
  `loading` / `error` / `data` `useState` for a fetch. If you're writing
  `const [data, setData] = useState()` + a `useEffect` that fetches, stop —
  that's the server-state library's job.
- **One central query-key factory.** An object with one namespace per
  resource (`qk.users()`, `qk.user(id)`, `qk.jobs()`). Build *every* cache
  key through it and invalidate through it, so a key and its invalidation
  can never drift apart. Never inline a raw `["users", id]` array except as
  a one-off prefix for a bulk invalidation.
- **Configure the client once.** Central defaults for staleness window,
  retry count, and refetch-on-focus. Don't re-specify per query unless a
  query genuinely differs.
- **A shared cache key has exactly one canonical fetcher and params.** If
  page A fetches key `jobs` with `limit=50` and page B fetches the same key
  with `limit=100`, they stomp each other's cache and each sees the other's
  row limit. Pick one signature per key. **(bug)**
- **Derive gate flags from the library's "still loading" flag, never from
  `data === undefined`.** `const initializing = data === undefined` never
  becomes false if the query *errors* — the page is stuck on its loading
  screen forever. Use the explicit loading/pending flag. **(bug)**
- **"Cache forever / never auto-refetch" is not "cache this" — it's "an
  explicit refetch is the only way to ever see new data".** If a user
  action ("Search", "Find", "Run") must hit the network every time, don't
  set an infinite staleness window on that query. Reserve it for data that
  only changes via a mutation you control and invalidate. **(bug)**
- **"Resume in-progress work on mount" reads should force a refetch on
  mount.** A page that reads a job list to reattach to a running job must
  not trust a cache entry written seconds ago by another screen.
- **Mutations:** route errors through one global mutation-error handler →
  toast. Give it a per-mutation opt-out for the cases that render their own
  inline error. Plain `async` calls that bypass the mutation layer need
  their own `try/catch` + inline error state — don't half-adopt.

## 2. Polling & long-running jobs

- **Model "poll until done" as a normal query with a refetch interval,
  never `setInterval` + manual `setState`.** The interval resolves to the
  delay while running and to "stop" once done. Sketch (TanStack Query v5
  API shown — adapt to your library):

  ```ts
  refetchInterval: (query) => {
    if (query.state.status === "error") return false;          // ← don't omit this (bug)
    const s = query.state.data?.status;
    return s && TERMINAL.includes(s) ? false : 1500;
  }
  ```

- **Stop on error, not just on a terminal *status*.** If the poll only
  stops when the payload's `status` is terminal, a backend restart or a
  deleted row (404) means the payload never reaches terminal and the poll —
  plus any "still running" UI — runs forever. **(bug)**
- **Fire the completion callback exactly once.** Guard with a ref
  (`firedFor.current !== id`), because the terminal value re-renders
  several times before the poll clears.
- **One reusable hook** (`useJobPoll(id, { onTerminal })`) — every page
  that starts a job uses it. A second polling implementation is a second
  thing to keep correct.

## 3. Effects & derived state

- **Prefer deriving over syncing.** A value computable from props/state/
  fetched data goes in render (or `useMemo`), not into `useState` kept in
  sync by a `useEffect`. Most `useEffect(() => setX(...))` is a bug waiting
  to happen.
- **Seed-once effects need a ref guard when the dependency identity is
  unstable.** Seeding form defaults from fetched data:

  ```ts
  const seeded = useRef(false);
  useEffect(() => {
    if (!data || seeded.current) return;
    seeded.current = true;
    resetForm(toDefaults(data));
  }, [data]);
  ```

  Without the guard, any background refetch (new object identity) re-runs
  the effect and silently discards whatever the user has since typed or
  selected. **(bug)**
- **`setState` in an effect is only legitimate for prop-sync resets**
  (route param changed → clear selection). Flag each one with a comment or
  lint-disable so the exceptions stay visible and countable.
- **Clear transient error state on *retry*, not only on unmount / route
  change.** An error set in a failed handler and cleared only in a
  library-switch handler stays on screen through every successful retry in
  between — and, if it's checked before the live query error, hides that
  one too. Clear it at the top of the retryable action. **(bug)**

## 4. Error handling & display

- **One error-message extractor** (`getErrorMessage(e, fallback)`), used
  everywhere. Never render `String(err)` — you get `"Error: ..."` leaking
  into the UI, and non-`Error` throws render as `[object Object]`. **(bug)**
- **Don't let a stale error outrank a fresh one.** If you show
  `manualError ?? queryError`, a lingering `manualError` masks a real new
  `queryError`. Clear the manual one aggressively (see §3).
- **HTTP/domain errors carry plain-English messages** from the layer that
  knows the context; the UI just displays them. No error-class hierarchy.

## 5. Component & module boundaries

- **Pages own state, effects, and data-fetching. Components are
  props-in / callbacks-out.** Nothing under `components/` holds business
  `useState` / `useEffect` — only genuinely-local UI state (a dropdown's
  open flag, a hover state). If a component needs server data, lift the
  fetch to the page and pass the result down.
- **One hook per file**, `hooks/useThing.ts`.
- **Types live in `types/<domain>.ts`** — one file per domain, not
  colocated in components, not mixed into the API layer.
- **API layer: one file per backend resource**, mirroring the backend's
  own route-file names, re-exported from a single `api/index.ts` barrel so
  imports don't care which file a call lives in. A single `req<T>()`
  helper handles headers, error throwing, and empty (204) responses.
- **When a file grows past ~300–400 lines it's usually doing too much** —
  split by extracting props-in/callbacks-out subcomponents and pushing
  their local state into a hook. Smaller files also make AI edits more
  reliable.

## 6. Performance & network hygiene

- **Gate any recurring refetch on "is there actually something to watch".**
  Polling a resource every few seconds for the lifetime of a mounted page —
  regardless of whether any job is active — is wasted I/O. Stop the
  interval when nothing is in flight; resume when a mutation kicks off
  work. **(bug)**
- **Bulk actions are one request, not N client-side loop calls.** "Delete
  all", "retry failed", "clear completed" → one endpoint that does the
  batch in one round trip. Looping an HTTP call per row is slow,
  non-atomic, and hammers anything the endpoint does per item.
- **Don't hold an expensive handle across blocking I/O.** (Backend origin:
  a pooled DB connection kept open through a slow external fetch exhausts
  the pool and stalls every unrelated route.) Generalizes: acquire late,
  release early, never straddle a slow call with a scarce resource checked
  out.
- **Long-lived streaming connections open a fresh short-lived resource per
  tick** and close it before the next `await`/sleep — never one handle
  pinned for the whole (possibly infinite) connection.

## 7. Forms

- **Schemas in `lib/schemas/<domain>.ts`**, one file per domain: the
  validation schema plus its inferred type. Components import the type from
  there. Use a schema validator (zod, valibot, yup) — don't hand-roll
  field checks.
- **Seed from fetched data via the form library's reset / set-values API,
  in a `useEffect` keyed on the fetched data** — with the seed-once guard
  from §3 if a refetch could re-fire it.
- **After a successful save, reset the form to the submitted values** so
  the "dirty" flag goes back to false. If you also invalidate the query,
  make sure the re-seed effect can't clobber edits the user made during
  the refetch window.
- **Validation lives only in the schema.** No ad-hoc `if (!x) setError` in
  the submit handler.
- **Document your lib/compiler friction points once** (e.g. the React
  Compiler flags some form libraries' subscribe/`watch` APIs as
  unmemoizable — a warning, not an error).

## 8. Styling — utility classes + design tokens

- **All theme-sensitive colours come from CSS custom properties**
  (`--app-accent`, `--app-bg-elevated`, …) surfaced through your utility
  classes. **Never hardcode a hex value** in a component. The one
  defensible exception: UI that previews a theme *other than the active
  one* (a theme-picker swatch) and so genuinely cannot read the active
  theme's variable — mark it with a comment and keep it next to the
  source-of-truth values.
- **Use the primitive library** (`Button`, `Card`, `Dialog`, `Badge`…) —
  don't reimplement what it already gives you, and don't edit the vendored
  primitives.
- **Factor the repeated states into shared components**: empty state,
  loading spinner, section header, stat strip. If two pages hand-roll the
  same dashed-border empty card, that's a component.
- **Responsive by default**: relative units, flex/grid, `max-width: 100%`
  on media, wide content (tables, code) scrolls inside its own container —
  the page body never scrolls sideways.

### Animation

- **Two tools, one vocabulary.** A `data-state`-driven utility layer for overlay
  enter/exit (e.g. `tailwindcss-animate` on Radix `data-[state]`), and a list-diff
  hook for add/remove/reorder (e.g. `@formkit/auto-animate`). Everything else is a
  small set of **named** keyframe utilities defined once in the Tailwind config.
- **No ad-hoc keyframes in components.** If a component needs a new motion, add it to
  the config vocabulary so it is named, reused, and reviewable. Arbitrary
  `animate-[...]` values in JSX are a smell (framework built-ins excepted).
- **Transform and opacity only.** Never animate layout box properties
  (`width`/`height`/`top`/`left`); use the list-diff hook for layout moves.
- **Timing scale:** enter 150–200ms, exit 100–150ms, micro-interactions ~100ms,
  continuous loops 1.4–1.6s. One enter easing, one exit easing, applied consistently.
- **Respect `prefers-reduced-motion` globally** — one media query in the base
  stylesheet that zeroes animation/transition durations. Components never re-implement it.

## 9. TypeScript strictness

- **`strict: true`**, plus **`noUncheckedIndexedAccess`** — `arr[i]` and
  `record[key]` become `T | undefined`. Handle it: `arr[i]!` *only* when
  provably in bounds (you just checked `.length`, or it's a literal index
  into a known-shaped tuple), otherwise `arr[i] ?? fallback`.
- **Also on:** `noUnusedLocals`, `noUnusedParameters`. Dead bindings fail
  the typecheck.
- **One canonical style, enforced by the formatter** — not debated in
  review.
- **`tsc --noEmit` is part of the commit gate**, not a thing CI discovers
  later.

## 10. Tooling gate — every commit is green

Run on every commit (ideally a pre-commit hook on staged files, plus CI):

| Gate | Example tool | Fails on |
|---|---|---|
| Lint + format | ESLint + Prettier (or Biome) | style / lint violations in staged files |
| Typecheck | `tsc --noEmit` | any type error |
| Dead code | knip | unused files, exports, or dependencies |
| Build | the bundler's production build | anything the above missed |
| Unit tests | Vitest / Jest | a red test |

- **Dead-code gate is not optional.** An unused-export detector catches the
  export nobody imports and the dependency nobody uses. Configure it to
  ignore only vendored code (e.g. a `components/ui/**` primitive dir).
- **Tests colocated** as `*.test.ts(x)` next to their source. Default env
  `node`; a test needing the DOM opts in per-file. Cover pure logic
  (formatters, predicates, resolvers, matching) and a render smoke test
  per complex page.
- **Smoke an uncommitted UI change against the dev server** (with API
  requests proxied to the running backend) — *not* a container serving a
  stale build.

## 11. Commits

- **[Conventional Commits](https://www.conventionalcommits.org/):**
  `type(scope): description`. Types: `feat` `fix` `refactor` `perf`
  `style` `docs` `chore` `test` `build` `ci` `revert`.
- **Subject line only** — imperative mood, no capital, no full stop,
  ≤72 chars. Body/footer optional; put the reasoning in the PR, not the
  commit.
- **Every commit builds and passes the gate on its own.** No "fix lint in
  next commit".
- `!` after the type marks a breaking change (`feat!:`).

---

## The short version

1. No component-owned fetch state — a server-state library owns reads, one
   key factory owns keys.
2. Poll with a recurring refetch, not `setInterval`; stop on terminal
   **and** on error; fire done-callbacks once.
3. Derive, don't sync. Guard seed-once effects. Clear errors on retry.
4. One `getErrorMessage`; never render `String(err)`.
5. Pages own logic; components are props-in/callbacks-out.
6. Don't poll idle resources; batch bulk actions server-side.
7. Schemas in one place; seed forms without clobbering edits.
8. Colours are tokens, never hex.
9. `strict` + `noUncheckedIndexedAccess` on; handle the `undefined`.
10. Lint + typecheck + dead-code + build + test green on every commit.
