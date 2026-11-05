import { createOpenAPI } from "fumadocs-openapi/server";

// Server-side only. The schema is committed (see scripts/gen-openapi.py), so the site build needs no backend.
export const openapi = createOpenAPI({
  input: ["./openapi/parallax.json"],
});
