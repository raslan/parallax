import { z } from "zod";

/**
 * Name for the folder "Move to subfolder" creates inside the open folder. Mirrors
 * the backend's `_validate_name` (a single visible path component); the
 * server stays the authority and answers 400 for anything this lets through.
 */
export const subfolderNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Folder name is required")
    .max(255, "Folder name is too long")
    .refine((n) => !/[/\\\0]/.test(n), "Folder name can't contain slashes")
    .refine((n) => n !== "." && n !== "..", "Invalid folder name")
    .refine((n) => !n.startsWith("."), "Folder name can't start with a dot"),
});

export type SubfolderNameForm = z.infer<typeof subfolderNameSchema>;
