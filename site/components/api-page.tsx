"use client";

import { createOpenAPIPage } from "fumadocs-openapi/ui";

// The playground (live requests) is off: the reference documents the API of a server the reader runs themselves.
export const OpenAPIPage = createOpenAPIPage({
  playground: { enabled: false },
});
