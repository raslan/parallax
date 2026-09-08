# Parallax — Code Conventions

Architecture and style rules for this repo. **Part 1 (React frontend)** is a
firm ruleset — the frontend is built this way and stays this way. **Part 2
(Python / FastAPI backend)** applies the same principles to this stack.
Parallax runs as one container, one process, one user.

Rules marked **(bug)** are inverses of defects found in real code review — the
ones most worth enforcing.

This file holds *principles*. `frontend/CLAUDE.md` and `backend/CLAUDE.md`
hold concrete specifics and exceptions; where they give a more specific
instruction than a rule here, the CLAUDE.md wins for that detail.

---

# Part 1 — Frontend (React)

## 1. Server state lives in one place, not in components

- **No component owns its own `loading` / `error` / `data` state for a plain
  fetch.** If you're writing `useState` + a `useEffect` that fetches on mount,
  stop — that's what a dedicated data layer (cache, store, or fetching hook)
  is for. Ad-hoc fetch-in-effect code duplicates race-condition handling,
  cancellation, and error handling in every component that does it.
- **One canonical cache key (or store slice) per resource, built through a
  single factory or naming convention.** Never invent a key inline in more
  than one place. If two screens fetch "the same" data with different
  parameters (a list capped at 50 vs. 100 rows, say), they'll silently stomp
  each other's cached copy. Pick one canonical shape per key. **(bug)**
- **Configure fetching defaults once, centrally** (staleness window, retry
  count, refetch-on-focus behavior). Override per-call only when a specific
  case genuinely differs — not as a habit.
- **Derive "is this still loading" from an explicit loading/pending flag,
  never from `data === undefined`.** A check like `data === undefined` never
  flips to false if the fetch *errors* — the UI is stuck on a loading state
  forever. Use whatever explicit status your data layer exposes. **(bug)**
- **An infinite or very long cache lifetime means "only a mutation can ever
  refresh this."** Don't apply it to data driven by a user action ("Search",
  "Run", "Filter") that must hit the network every time it's invoked. Reserve
  long-lived caching for data that only changes via a write you control and
  explicitly invalidate. **(bug)**
- **A screen that resumes in-progress work on mount should force a fresh
  read, not trust a cache entry** written moments ago by a different screen —
  otherwise it silently reattaches to stale state.
- **Route write (create/update/delete) errors through one shared handler**
  (e.g. a toast/notification on failure), with a per-call opt-out for flows
  that render their own inline error. Any write that bypasses the shared
  layer needs its own explicit try/catch and error state — don't half-adopt
  the pattern.

> **Tooling suggestion:** if the app makes more than a handful of server
> reads/writes, a dedicated server-state library (e.g. **TanStack Query**,
> or SWR / RTK Query) gets you most of §1 for free — caching, staleness,
> retries, and invalidation. Below that scale, a hand-rolled thin wrapper is
> fine as long as it still follows the rules above.

## 2. Polling & long-running jobs

- **Model "poll until done" as a recurring read with a computed interval, not
  a hand-rolled `setInterval` + manual state.** The interval function should
  return the delay while the job is running, and a falsy/stop value once the
  job reaches a terminal state.
- **Stop polling on a fetch error, not only on a terminal status in the
  payload.** If the loop only checks the payload's `status` field, a backend
  restart or a deleted record (e.g. a 404) means the payload never reaches a
  terminal value and the poll — and any "still running" UI — runs forever.
  Check for fetch-level failure as its own stop condition. **(bug)**
- **Fire a "job finished" callback exactly once**, guarded by a ref or
  similar (`firedFor.current !== id`) — the terminal value will typically
  re-render several times before polling actually stops.
- **One reusable polling hook**, used by every screen that starts a job. A
  second, slightly different polling implementation is a second thing that
  can be wrong.

> **Tooling suggestion:** if you're already on a server-state library (see
> §1), lean on its built-in recurring-refetch support (e.g. TanStack
> Query's `refetchInterval`) rather than writing polling from scratch — it
> already handles cancellation, backgrounding, and cache updates for you.

## 3. Effects & derived state

- **Prefer deriving over syncing.** A value that's computable from
  props/state/fetched data belongs in render (or a memoized computation),
  not in its own state variable kept "in sync" by an effect. Most
  `useEffect(() => setSomething(...))` patterns are a bug waiting to happen —
  they create a second source of truth that can drift from the first.
- **Seed-once effects need a guard when the input's identity is unstable.**
  Seeding a form (or any local state) from fetched data:

  - Track whether you've already seeded (a ref flag), not just whether the
    data exists.
  - Without that guard, any background refetch that produces a new object
    (even with identical values) re-runs the effect and silently discards
    whatever the user has since typed or changed. **(bug)**
- **Only use an effect to reset state in response to a prop/route change**
  (e.g. a route param changes → clear the current selection). Every other
  "set state in an effect" is worth a second look; flag legitimate ones with
  a comment so the exceptions stay visible and countable.
- **Clear transient error state on retry, not only on unmount or navigation.**
  An error set by a failed action and only cleared by, say, switching tabs
  will sit on screen through every successful retry in between — and if it's
  checked ahead of a live error, it can mask a real new failure too. Clear it
  at the start of the retryable action itself. **(bug)**

## 4. Error handling & display

- **One shared error-message extractor**, used everywhere something needs to
  show an error to a person. Never render a raw error object directly (e.g.
  `String(err)`) — you'll leak `"Error: ..."` prefixes into the UI, and
  non-`Error` throws render as `[object Object]`. **(bug)**
- **Don't let a stale error outrank a fresh one.** If a component shows
  "manual error, falling back to the live one," a lingering manual error will
  mask a genuinely new one. Clear the manual error aggressively (see §3).
- **Errors carry a plain-English message from the layer that knows the
  context** (the API call, the validation step); the UI's job is just to
  display it. Avoid building an elaborate error-class hierarchy the UI has
  to interpret.

## 5. Component & module boundaries

- **Pages/screens own state, effects, and data-fetching. Components are
  props-in / callbacks-out.** Nothing under a shared `components/` directory
  holds business `useState` / `useEffect` — only genuinely local UI state (a
  dropdown's open flag, a hover state, an uncontrolled input's focus). If a
  component needs server data, lift the fetch to the page/screen that owns
  it and pass the result down as props.
- **One hook per file**, named for what it does (`hooks/useThing.ts`), not
  grouped into a catch-all `hooks/index.ts` or `utils.ts`.
- **Types live in `types/<domain>.ts`** — one file per domain. Don't colocate
  domain types inside components, and don't mix them into the data-fetching
  layer's files.
- **The data-access layer gets one file per backend resource**, ideally
  mirroring the backend's own route/module names, re-exported from a single
  barrel file so callers don't need to know which file a given call lives
  in. Centralize the low-level request mechanics (headers, error throwing,
  empty-response handling) in one shared helper rather than repeating them
  per resource file.
- **When a file grows past ~300–400 lines, it's usually doing too much.**
  Split it by extracting props-in/callbacks-out subcomponents and pushing
  their local state into a hook. Smaller, single-purpose files are also
  easier to review and easier to hand to a tool (or a teammate) for a
  focused edit.
- **Two features that need the same mechanism share a neutral module — they
  neither copy it nor import from each other.** When a second consumer needs
  logic that already lives in a first (a subprocess runner, a binary
  installer, a resizable semaphore, a modal), extract the portable core to a
  domain-neutral `*-common` module both import, parametrizing the parts that
  differ. Feature B importing from feature A couples their lifecycles —
  deleting A breaks B. Copy-pasting drifts — a fix to one never reaches the
  other. Extract only the genuinely identical, stable-surface parts; leave
  divergent bodies (different parsing, different timeouts) separate rather
  than forcing a leaky abstraction.

## 6. Performance & network hygiene

- **Gate any recurring refetch on "is there actually something to watch."**
  Polling a resource every few seconds for the whole lifetime of a mounted
  page — regardless of whether anything relevant is happening — wastes
  bandwidth and battery. Stop the interval when nothing is in flight; resume
  it when an action kicks off new work. **(bug)**
- **Bulk actions are one request, not N client-side loop calls.** "Delete
  all," "retry failed," "clear completed" should hit one endpoint that
  performs the whole batch server-side in a single round trip. Looping an
  HTTP call per row is slow, non-atomic, and multiplies whatever cost the
  endpoint has per item.
- **Don't hold an expensive or scarce resource open across a slow,
  independent operation.** (Classic backend version: a pooled DB connection
  kept open through a slow external API call exhausts the pool and stalls
  unrelated requests.) The general rule: acquire late, release early, never
  straddle a slow await with a scarce resource checked out.
- **Long-lived streaming or subscription connections should acquire a fresh,
  short-lived resource per unit of work** and release it before the next
  wait — not hold one handle pinned for the entire, possibly unbounded,
  connection lifetime.

## 7. Forms

- **Validation schemas live in one place, one file per domain** (e.g.
  `lib/schemas/<domain>.ts`), alongside the type they produce. Components
  import the inferred type from there rather than redefining it. Use a
  schema-based validator rather than hand-rolling field-by-field checks.
- **Seed form state from fetched data through the form library's own
  reset/set-values mechanism, inside an effect keyed on the fetched data** —
  with the seed-once guard from §3 if a background refetch could re-fire it.
- **After a successful save, reset the form to the just-submitted values**
  so the "dirty" flag returns to false. If a save also triggers a refetch of
  the underlying data, make sure the re-seed logic can't clobber edits the
  user makes during the refetch window.
- **Validation logic lives only in the schema** — avoid ad-hoc
  `if (!x) setError(...)` checks scattered through the submit handler.
- **Note any friction points between your tooling and your form library**
  (e.g. a compiler or linter that misidentifies a `watch`/subscribe API as
  unmemoizable) once, in a comment or doc — treat it as a known false
  positive rather than rediscovering it in every PR.

> **Tooling suggestion:** for anything beyond a couple of trivial fields, a
> form library (e.g. **react-hook-form** or Formik) plus a schema validator
> (e.g. **zod**, valibot, or yup) covers most of §7 — controlled inputs,
> validation wiring, and reset/dirty-tracking — without hand-rolling it.

## 8. Styling — tokens over hardcoded values

- **All theme-sensitive values (colors, and ideally spacing/radii too) come
  from named design tokens** (CSS custom properties, a theme object,
  whatever your system uses) — never a hardcoded hex value or magic number
  buried in a component. The one defensible exception is UI that previews a
  theme *other than the active one* (a theme-picker swatch), which genuinely
  can't read the active theme's token — mark it with a comment next to the
  source-of-truth values.
- **Use the shared primitive/component library** for common elements
  (buttons, cards, dialogs, badges) rather than reimplementing what it
  already provides, and don't hand-edit vendored primitives.
- **Factor repeated UI states into shared components**: empty state, loading
  spinner, section header, stat strip. If two screens hand-roll the same
  "nothing here yet" card, that's a component waiting to be extracted.
- **Responsive by default**: relative units, flexible layout, media that
  never overflows its container, wide content (tables, code blocks)
  scrolling within its own box — the page body itself never scrolls
  sideways.

> **Tooling suggestion:** a utility-CSS framework (e.g. **Tailwind**) plus a
> pre-built, unstyled-primitive component set (e.g. **shadcn/ui**, Radix)
> is a solid default for getting tokens, primitives, and accessibility
> right without building a design system from scratch. Any equivalent
> combo (CSS Modules + a component kit, vanilla-extract, etc.) satisfies
> the same rules.

### Animation

- **One vocabulary for motion**, defined in one place (a config, a set of
  utility classes, a shared constants file) rather than invented ad hoc per
  component. If a component needs a new kind of motion, add it to the shared
  vocabulary so it's named, reusable, and reviewable.
- **No one-off, inline animation definitions in component code.** That's a
  smell whether it's a literal keyframe, an inline style, or a magic
  duration constant — framework/library built-ins are the exception.
- **Animate transform and opacity, not layout box properties**
  (`width`/`height`/`top`/`left`). Use a list-diff/animation helper for
  layout moves (reordering, insertion, removal) rather than animating layout
  properties directly.
- **Pick a small, consistent timing scale** (e.g. fast for micro-interactions,
  slightly slower for enter/exit, slower still for continuous loops) and one
  easing curve each for entering and exiting, applied consistently rather
  than tuned per component.
- **Respect reduced-motion preferences globally**, in one place (a single
  base-level rule that zeroes out animation/transition durations), not
  reimplemented per component.

## 9. TypeScript strictness

- **Strict mode on**, plus the "indexed access may be undefined" flag if your
  compiler offers one — array and record indexing becomes `T | undefined`.
  Handle it explicitly: force-unwrap only when provably in bounds (you just
  checked `.length`, or it's a literal index into a known-shaped tuple);
  otherwise fall back to a default.
- **Also enable unused-locals and unused-parameters checks.** Dead bindings
  should fail the typecheck, not linger.
- **One canonical formatting style, enforced by the formatter** (Prettier)
  — not re-litigated in review.
- **Typecheck (`tsc -b`) runs in the production build and in CI.** It is
  deliberately *not* in the pre-commit hook (kept fast — lint/format + knip +
  vitest only). Run it locally before pushing; don't let a branch grow
  un-typechecked.

## 10. Tooling gate — every commit is green

What actually runs (husky + lint-staged, `lint-staged.config.mjs`):

| Gate | When | Fails on |
|---|---|---|
| ESLint + Prettier `--fix` | staged `frontend/**/*.{ts,tsx}` | style / lint violations |
| Ruff check + format | staged `backend/**/*.py` | style / lint violations |
| knip (dead code) | any `frontend/src/**/*.tsx?` staged | unused files, exports, deps |
| vitest | any `frontend/src/**/*.tsx?` staged | a red test |
| `tsc -b` + `vite build` | production build / CI | any type or build error |
| pytest | run manually / CI | a red backend test |
| commit-msg hook | every commit | non-Conventional subject; also strips the body |

- **The frontend dead-code gate (knip, `frontend/knip.json`) is not
  optional.** It catches the export nobody imports and the dependency nobody
  uses. There is no backend equivalent at commit time — keep modules tidy by
  hand; `ruff` flags unused imports.
- **Typecheck and backend tests are not in the pre-commit hook** (kept
  fast). Run `tsc -b` / `pytest` locally before pushing; CI is the backstop,
  not the discovery point.
- **Tests live next to the source they cover.** Frontend: `*.test.ts(x)` via
  vitest, non-DOM environment by default, opt into DOM per-file. Backend:
  `backend/tests/test_<area>.py` via pytest. Cover pure logic (formatters,
  predicates, resolvers, matching functions) plus a render smoke test for
  each non-trivial page.
- **Smoke-test an uncommitted UI change against a live dev server** (Vite
  dev, API proxied to the real backend), not a container serving a stale
  build. Full-stack check: `docker compose up --build -d` on port 7899.

## 11. Commits

- **[Conventional Commits](https://www.conventionalcommits.org/)**:
  `type(scope): description`. Allowed types: `feat` `fix` `refactor` `perf`
  `style` `docs` `chore` `test` `build` `ci` `revert`.
- **Subject line only — the `commit-msg` hook strips any body or footer**
  before the commit is written. Don't author a body; put detailed reasoning
  in the PR description. release-please builds the changelog from subjects
  alone.
- Imperative mood, no capital, no full stop, ≤72 chars. Scope optional,
  encouraged for large changes (`feat(queue): ...`).
- A `!` after the type marks a breaking change (`feat!:`) — a
  `BREAKING CHANGE:` footer won't survive the hook.
- **Every commit builds and passes the gate on its own** — no "fix lint in
  the next commit."

---

# Part 2 — Backend (Python / FastAPI / SQLAlchemy)

These mirror Part 1's principles for the backend.

## B1. Routers are thin; logic lives in services

- **A router function (`app/api/<resource>.py`) parses/validates input,
  calls one service function (`app/services/<domain>.py`), shapes the
  response.** No `ffmpeg`/`ffprobe` calls, no multi-step DB orchestration,
  no business rules inside the endpoint itself.
- **Services take plain data (and a `Session`) in, return plain data or
  raise a typed error out.** They don't touch `Request`/`Response`, status
  codes, or headers — that mapping stays in the router, so the same service
  is callable from a queue job, the filesystem watcher, or a test.
- **One file per resource under `app/api/`**, mirroring the route prefix:
  `/files` → `app/api/files.py`, `/downloads` → `app/api/downloads.py`.
- **Shared service logic goes in a neutral `*_common.py`** — not copied
  between services, not imported service-to-service. Same rule as the
  frontend boundary above: parametrize the difference (a signal number, a
  URL), share the mechanism, keep divergent loop bodies separate.

## B2. Validate at the boundary with Pydantic, trust the types after

- **Non-trivial request bodies and query-param sets get a Pydantic model
  (`app/schemas.py`).** Path params and simple scalars can lean on
  FastAPI's own coercion.
- **External non-HTTP input is untyped until parsed** — `ffprobe` JSON,
  subprocess stdout, `yt-dlp` progress, env vars, watchdog events. Parse
  and guard these where they enter: `json.loads(ffprobe_out)` is
  `dict[str, Any]`, not the shape you're hoping for. **(bug)**
- **Once a Pydantic model has validated it, don't re-check the same fields
  three services deep.** Repeated validation means the boundary isn't where
  you think it is.
- **Let FastAPI's default 422 (field + message list) surface** — don't
  catch validation errors and flatten them into a generic 500. **(bug)**

> `app/schemas.py` is currently one file, not per-domain. Fine at this size;
> split to `app/schemas/<domain>.py` if it outgrows a screen or two per
> domain.

## B3. Errors are typed, raised once, handled once

- **Service code raises specific exceptions** (`FileNotFoundError`, a small
  set of custom classes) — not bare `Exception` or strings the caller has
  to match on message text.
- **Routers translate to `HTTPException` at the edge**, or a shared
  exception handler maps known types → status + `{"detail": ...}`. Don't
  hand-roll try/except → status-code mapping in every endpoint. **(bug)**
- **Never swallow silently** (`except Exception: pass`). Log with context,
  then re-raise or convert to a typed error the caller can act on.
- **Separate expected failures** (file already gone, unsupported codec →
  clean 4xx with a message) **from bugs** (a `None` deref → log loudly,
  generic 500, no internals in the response).

## B4. Data access through SQLAlchemy sessions, scoped tight

- **Reused query logic lives in a service function**, not copy-pasted
  across routers. Request-scoped work uses the `get_db` dependency.
- **Never hold a `Session` across blocking I/O** — a subprocess call, an
  external fetch, `asyncio.sleep`. Acquire late, commit/close early. This is
  a real past outage in this repo (SSE streams, `downloads/{id}/thumbnail`
  exhausting the QueuePool — see root `CLAUDE.md`). SSE generators open a
  fresh `SessionLocal()` per tick and close it before the sleep; a per-row
  endpoint that does network I/O reads what it needs from a short session,
  closes it, *then* does the network call. **(bug)**
- **Transactions are the implicit per-request one, or an explicit
  `with db.begin()` around exactly the rows that need atomicity** — never
  wrapped around an ffmpeg run or an external download.
- **No migration tool.** Schema changes are `ALTER TABLE` guards in
  `app/database.init_db()` — SQLite silently no-ops if the column exists.
  Forward-only: add columns, don't rewrite them. Never hand-edit a deployed
  `.db` out of band.

## B5. Config: env in one module, runtime settings in the DB

- **Process config (paths, `DATA_DIR`) is read once in `app/config.py`.**
  Don't scatter `os.environ` reads through services.
- **User-tunable settings** (job concurrency, batch size, sync toggles)
  **live in the `settings` table**, read through the settings service — not
  env vars — so the UI can change them without a container restart.
- **A required env var that's missing should fail at startup** with a clear
  message, not on the first request that touches it. **(bug)**
- **No secrets in the repo** — no keys in fixtures or `docker-compose.yml`.
  Parallax needs none by default; keep it that way.

## B6. Logging: stdlib `logging`, one line per failure

- **Module-level `logger = logging.getLogger(__name__)`.** No bare `print`
  in app code.
- **Log a failure once, at the boundary where it's handled**, with the
  context needed to debug it (file path, job id) — not re-logged at every
  frame as it propagates. **(bug)**
- **Keep logs plain-text.** One process, one user — `docker compose logs -f`
  is the whole observability story; don't reach for JSON logging or
  per-request correlation IDs at this scale.
- **Never log a pasted cookie or token.** The Downloads feature accepts
  ephemeral Netscape-format cookies; keep them (and full subprocess command
  lines that embed them) out of the logs.

## B7. Background jobs: the asyncio queue, with persisted state

- **Anything slow** (transcode, scan, extract, download, bulk subtitle
  sync) **goes through `app/queue.py`** — `enqueue` with a `job_id`, never a
  fire-and-forget `asyncio.create_task` from a request handler. The `jobs`
  table row is the persisted record. **(bug)**
  The **Downloads (yt-dlp)** and **Galleries (gallery-dl)** features are the
  deliberate exception: each keeps its own persisted table
  (`downloads` / `gallery_downloads`), its own live-resizable semaphore, and
  dispatches with `asyncio.create_task` rather than `enqueue`. They need
  per-row live speed/progress the `jobs` model doesn't carry, user-managed
  history as first-class row actions, and independent concurrency. §B7's
  substance still holds for them — terminal state is persisted on the row,
  orphaned `running` rows are swept at startup, cancellation is cooperative.
- **Terminal state is written to the `jobs` table**
  (PENDING / RUNNING / CANCELLED / done), so "did it finish" is a query,
  not a log grep.
- **Orphan recovery on startup:** a row left RUNNING after a crash/restart
  is reconciled to failed/cancelled at boot (Downloads already does this).
  New job types must do the same.
- **Cancellation is cooperative** — long loops check the cancel flag
  between items; `cancel_pending(job_id)` handles the not-yet-started case.
- **The queue is in-memory and single-process** — no delivery guarantees to
  design around. Retries against a flaky *external* service (yt-dlp, subf2m)
  are bounded with a small backoff, then surfaced on the job — not retried
  forever.

## B8. Testing (backend)

- **`pytest`, tests in `backend/tests/test_<area>.py`.**
- **Unit-test pure logic** (funnel scoping, bigram similarity, Hamming
  distance, renamer, `guessit` parsing) with no server and no DB.
- **Service and data-access tests run against a real SQLite test DB** —
  `conftest.py` builds one per session and rolls back per test — not mocked
  query results, which drift from what SQLAlchemy actually returns.
- **Route tests go through FastAPI `TestClient`** with `get_db` overridden
  to the test session, so routing + validation + serialization are
  exercised, not bypassed.
- **Each test seeds its own rows;** the per-test transaction rollback keeps
  runs independent.

---

## The short version

### Frontend
1. No component-owned fetch state — one data layer owns reads, one key/naming
   scheme owns cache identity.
2. Poll with a recurring, interval-computing read, not `setInterval`; stop on
   terminal state **and** on error; fire "done" callbacks exactly once.
3. Derive, don't sync. Guard seed-once effects. Clear errors on retry, not
   just on unmount.
4. One error-message extractor; never render a raw error object.
5. Pages/screens own logic; components are props-in / callbacks-out.
6. Don't poll idle resources; batch bulk actions server-side.
7. Schemas in one place; seed forms without clobbering in-progress edits.
8. Colors and motion are named tokens, never hardcoded values.
9. Strict mode + "no unchecked indexed access" on; handle the `undefined`.
10. Lint/format + dead-code + vitest green on every commit (hook); typecheck
    + build green in CI.

### Backend (Python / FastAPI)
1. Routers in `app/api/` parse + delegate; logic lives in `app/services/`,
   transport-free.
2. Pydantic-validate request bodies at the boundary; guard
   ffprobe/subprocess/env output as `Any` until parsed.
3. Typed exceptions, raised once, mapped to responses at the router edge or
   one handler.
4. Queries through SQLAlchemy sessions scoped tight — never held across a
   subprocess or fetch. Schema via `ALTER TABLE` guards in `init_db()`, no
   migration tool.
5. Env config in `app/config.py` once; user settings in the `settings`
   table; fail fast on missing env.
6. stdlib `logging`, one line per failure at its boundary; no
   JSON/correlation-id ceremony at this scale; never log pasted cookies.
7. Slow work goes through `app/queue.py` with a `jobs` row; terminal state
   persisted; orphans reconciled on startup; cancellation cooperative.
8. `pytest` against a real SQLite test DB; routes through `TestClient`; each
   test seeds and rolls back its own data.
