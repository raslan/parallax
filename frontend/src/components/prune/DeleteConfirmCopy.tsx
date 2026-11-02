import { describeSelection } from "@/lib/format";

const MAX_NAMES = 8;

/**
 * The bodies of Prune's delete confirmations, passed as `description` to the shared
 * `useConfirm()` (`hooks/usePruneDelete`). Presentational only.
 */
export function FilesDeleteCopy({
  names,
  bytes,
}: {
  /** File names in the order they are shown. */
  names: string[];
  bytes: number;
}) {
  const count = names.length;
  return (
    <div className="space-y-3">
      <p>
        <span className="font-mono tabular-nums text-foreground">
          {describeSelection(count, "file", bytes)}
        </span>{" "}
        will be removed from disk. This cannot be undone.
      </p>
      <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border bg-px-surface px-3 py-2 text-foreground">
        {names.slice(0, MAX_NAMES).map((n, i) => (
          <li key={`${i}-${n}`} className="truncate text-xs">
            {n}
          </li>
        ))}
      </ul>
      {count > MAX_NAMES && <p className="text-xs">and {count - MAX_NAMES} more</p>}
    </div>
  );
}

export function FolderDeleteCopy({
  name,
  files,
  bytes,
}: {
  name: string;
  files: number;
  bytes: number;
}) {
  return (
    <div className="space-y-3">
      <p className="break-words font-medium text-foreground">{name}</p>
      <p>
        This removes{" "}
        <span className="font-mono tabular-nums text-foreground">
          {describeSelection(files, "file", bytes)}
        </span>{" "}
        and everything inside it. Hidden entries and symlinks in the folder are removed too, even
        though Prune does not list them. This cannot be undone.
      </p>
    </div>
  );
}

export function EmptyFolderCopy({ name }: { name: string }) {
  return (
    <div className="space-y-1">
      <p>Folder is now empty. Delete it?</p>
      <p className="break-words font-medium text-foreground">{name}</p>
    </div>
  );
}
