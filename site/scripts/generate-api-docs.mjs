// Turns openapi/parallax.json into one docs page per tag under content/docs/api/.
// The generated pages are gitignored (rebuilt on every dev/build); only index.mdx and meta.json there are hand-written.
import { generateFiles } from "fumadocs-openapi";
import { createOpenAPI } from "fumadocs-openapi/server";

const openapi = createOpenAPI({ input: ["./openapi/parallax.json"] });

await generateFiles({
  input: openapi,
  output: "./content/docs/api",
  per: "tag",
  meta: false,
});

console.log("generate-api-docs: done");
