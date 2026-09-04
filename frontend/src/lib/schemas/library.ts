import { z } from "zod";

/** Add-library form: the path + auto-scan toggle shared by both library kinds. */
export const addLibrarySchema = z.object({
  path: z
    .string()
    .trim()
    .min(1, "Path is required")
    .startsWith("/", "Path must be absolute (start with /)"),
  autoScan: z.boolean(),
});

export type AddLibraryForm = z.infer<typeof addLibrarySchema>;
