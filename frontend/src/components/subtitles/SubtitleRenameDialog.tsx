import { useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/api/client";
import { planSingleRename, splitExtension } from "@/lib/organizeRename";
import { RENAME_WARNING, startsWithVideoName } from "@/lib/subtitleManage";

/**
 * Rename one subtitle file in its own folder. The stem is selected so typing keeps the
 * extension; a name that is already taken (`taken` = every name in the folder) is refused
 * here and, as the last word, by the server, which never overwrites. A name that no longer
 * starts with the video's name is allowed but warned about: this page would stop listing
 * it. `onSubmit` makes the call and rejects on a refusal; its message shows here and the
 * dialog stays open.
 */
export function SubtitleRenameDialog({
  open,
  file,
  videoName,
  taken,
  onSubmit,
  onOpenChange,
}: {
  open: boolean;
  file: { path: string; name: string } | null;
  /** The video the file belongs to; null for a subtitle found beside no video (nothing to warn about). */
  videoName: string | null;
  taken: ReadonlySet<string>;
  onSubmit: (newName: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open && file !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" onClose={() => onOpenChange(false)}>
        {/* The form lives inside the content, so it starts fresh on every open. */}
        {file && (
          <RenameForm
            file={file}
            videoName={videoName}
            taken={taken}
            onSubmit={onSubmit}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  file,
  videoName,
  taken,
  onSubmit,
  onClose,
}: {
  file: { path: string; name: string };
  videoName: string | null;
  taken: ReadonlySet<string>;
  onSubmit: (newName: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(file.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const row = planSingleRename(file, name, taken);
  const ext = splitExtension(file.name)[1];
  const typed = name.trim();
  const extChanged =
    typed !== file.name && splitExtension(typed)[1].toLowerCase() !== ext.toLowerCase();
  const reason = extChanged
    ? `Keep the file extension (${ext})`
    : row.status === "taken"
      ? "That name is already taken"
      : row.status === "invalid"
        ? "Invalid name (no slashes, can't start with a dot)"
        : "";
  const canRename = row.status === "ok" && !extChanged && !busy;
  const outsideView =
    videoName !== null &&
    row.status === "ok" &&
    !extChanged &&
    !startsWithVideoName(videoName, typed);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canRename) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(row.newName);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Could not rename the file"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename subtitle</DialogTitle>
        <p className="text-sm text-muted-foreground">
          The file stays in its folder and keeps its extension. No other file is overwritten.
        </p>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="subtitle-rename-name">New name</Label>
          <Input
            id="subtitle-rename-name"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) =>
              // Select the stem only, so typing keeps the extension.
              e.currentTarget.setSelectionRange(0, splitExtension(e.currentTarget.value)[0].length)
            }
          />
          {reason && <p className="text-xs text-destructive">{reason}</p>}
          {outsideView && <p className="text-xs text-amber-500">{RENAME_WARNING}</p>}
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canRename}>
            {busy ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Pencil className="mr-2 h-3.5 w-3.5" />
            )}
            Rename
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
