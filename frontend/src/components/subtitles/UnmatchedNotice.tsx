import { Link } from "react-router";
import { FileQuestion } from "lucide-react";
import { languageName } from "@/lib/subtitle-langs";
import type { UnmatchedSubtitle } from "@/types/subtitle";

const SHOWN = 8;

/**
 * Subtitle files in the folder that are named for no video (often a `Subs/` folder of
 * `2_English.srt` files). Read-only: this page cannot tell which video each belongs to,
 * and Identify can place them. Renders nothing when there are none. Props-in.
 */
export function UnmatchedNotice({ files }: { files: UnmatchedSubtitle[] }) {
  if (files.length === 0) return null;
  return (
    <details className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 text-muted-foreground">
        <FileQuestion className="h-4 w-4 shrink-0" />
        Found in subfolders, not named for this video · {files.length}{" "}
        {files.length === 1 ? "file" : "files"}
      </summary>
      <ul className="mt-2 space-y-0.5 font-mono text-xs text-muted-foreground">
        {files.slice(0, SHOWN).map((f) => (
          <li key={f.path} className="flex gap-2">
            <span className="truncate" title={f.path}>
              {f.directory ? `${f.directory}/` : ""}
              {f.name}
            </span>
            {f.language && <span className="shrink-0 font-sans">{languageName(f.language)}</span>}
          </li>
        ))}
        {files.length > SHOWN && <li>and {files.length - SHOWN} more</li>}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Parallax can't tell which video these belong to.{" "}
        <Link to="/identify" className="underline hover:text-foreground">
          Identify
        </Link>{" "}
        can place them next to their videos.
      </p>
    </details>
  );
}
