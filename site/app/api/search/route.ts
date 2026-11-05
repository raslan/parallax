import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";

// Static export: the search index is built once and fetched by the client.
export const revalidate = false;
export const { staticGET: GET } = createFromSource(source);
