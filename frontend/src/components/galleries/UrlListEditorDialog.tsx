import type { KeyboardEvent } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** URLs in a list's text: one per line, blank lines and `#` comments skipped (as the backend). */
function countUrls(text: string): number {
  return text.split("\n").filter((l) => {
    const t = l.trim();
    return t !== "" && !t.startsWith("#");
  }).length;
}

/**
 * Large editor for one file-mode URL list: name + a roomy monospace textarea.
 * Props-in/callbacks-out — the page owns the draft, dirty tracking and the save/delete calls.
 */
export function UrlListEditorDialog({
  open,
  isNew,
  name,
  onNameChange,
  text,
  onTextChange,
  saving,
  error,
  onSave,
  onDelete,
  onClose,
}: {
  open: boolean;
  isNew: boolean;
  name: string;
  onNameChange: (v: string) => void;
  text: string;
  onTextChange: (v: string) => void;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const canSave = !saving && name.trim() !== "";
  const saveOnCtrlEnter = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canSave) {
      e.preventDefault();
      onSave();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="mx-4 flex max-h-[90vh] max-w-3xl flex-col" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{isNew ? "New URL list" : "Edit URL list"}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="space-y-1">
            <label className="text-3xs font-medium uppercase tracking-wider text-muted-foreground/60">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="e.g. artists, weekly-channels"
              maxLength={64}
              autoFocus={isNew}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col space-y-1">
            <label className="text-3xs font-medium uppercase tracking-wider text-muted-foreground/60">
              URLs — one per line, <span className="font-mono"># comment</span> lines are skipped
            </label>
            <textarea
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              onKeyDown={saveOnCtrlEnter}
              spellCheck={false}
              wrap="off"
              autoFocus={!isNew}
              placeholder={"https://…\nhttps://youtube.com/@channel\n# a comment"}
              className="h-[55vh] min-h-48 w-full resize-none overflow-auto rounded-md border border-input bg-background px-3 py-2.5 font-mono text-sm focus:outline-hidden focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/30"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <DialogFooter className="items-center">
          {!isNew && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDelete}
              disabled={saving}
              className="mr-auto gap-1.5 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete list
            </Button>
          )}
          <span className="mr-2 text-xs tabular-nums text-muted-foreground/60">
            {countUrls(text)} URL{countUrls(text) === 1 ? "" : "s"}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={onSave} disabled={!canSave} className="gap-1.5">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
