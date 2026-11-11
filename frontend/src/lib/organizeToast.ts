import { toast } from "sonner";
import { describeSelection } from "@/lib/format";
import { REDACTED_FILE } from "@/lib/organizeRedact";
import { baseName } from "@/lib/path";

/** What staging a tag edit left out, or why it staged nothing (a bad regular expression). */
export function toastStageResult(result: { skipped: string[]; error: string | null }): void {
  if (result.error) {
    toast.error(result.error);
    return;
  }
  const n = result.skipped.length;
  if (n === 0) return;
  toast.message(`${n} ${n === 1 ? "file was" : "files were"} left out`, {
    description:
      "A file is left out when its format can't hold the field, its tags have not loaded, or its value is too long to edit safely.",
  });
}

/** Toast for the per-file refusals of a bulk call; they stay selected for a retry. */
export function toastFailures(
  failed: { path: string; error: string }[],
  verb: string,
  redact: boolean,
): void {
  if (failed.length === 0) return;
  const shown = failed
    .slice(0, 3)
    .map((f) => `${redact ? REDACTED_FILE : baseName(f.path)}: ${f.error}`)
    .join("\n");
  const more = failed.length - 3;
  toast.error(`${describeSelection(failed.length, "file")} could not be ${verb}`, {
    description: `${shown}${more > 0 ? `\nand ${more} more` : ""}\nThey are still selected.`,
  });
}
