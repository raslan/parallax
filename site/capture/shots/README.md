# Shot list schema

Each `shots/*.mjs` default-exports an array of shot objects. `node run.mjs --list` prints them.

| field                  | required | meaning                                                                                                                         |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | yes      | `<section>/<page>/<what>` — output file stem and the `<Shot id>` the docs use                                                   |
| `kind`                 | yes      | `still` (WebP) or `clip` (muted looping MP4 + poster)                                                                           |
| `route`                | yes      | app route on the demo instance, e.g. `/cleanup?...`                                                                             |
| `alt`                  | yes      | alt text (no engine/tool names for the downloaders; no real paths)                                                              |
| `crop`                 | yes      | `{ rect: {x,y,width,height} }` in viewport px (1440×900) **or** `{ selectors: [css-or-RegExp...], pad }` (union of their boxes) |
| `waitFor`              | no       | selectors / RegExps (text) that must be visible before capture                                                                  |
| `setup(page)`          | no       | runs after load, before capture (stills) / before recording starts (clips; recording is trimmed to start after it)              |
| `steps(page, {sleep})` | clips    | the recorded interaction; keep it ≤ ~6 s                                                                                        |
| `tailMs`               | no       | hold on the final frame (default 900 ms)                                                                                        |
| `settleMs`             | no       | extra wait after load for animations/thumbnails (default 600)                                                                   |
| `blur`                 | no       | CSS selectors to blur (use for Content Review thumbnails)                                                                       |
| `themes`               | no       | `true` films the shot once per landing theme: `<id>` stays the default look, the others are `<id>.<theme>` (landing page only)  |
| `budgetKB`             | no       | asset size cap; the runner steps quality/CRF down to fit and **fails** if it can't (defaults 150 stills / 600 clips)            |

Rules: brief and to the point — the written docs carry the detail. Downloads/Galleries: option-panel stills only, never URLs, results or clips. Never show the Settings credentials field with a value. Keep tool names out of `alt`.
