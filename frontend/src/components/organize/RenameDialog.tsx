import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getErrorMessage } from "@/lib/api/client";
import {
  planBulkRename,
  planSingleRename,
  splitExtension,
  type RenameItem,
  type RenameRow,
} from "@/lib/organizeRename";
import { cn } from "@/lib/utils";

interface RenameFormValues {
  name: string;
  find: string;
  replace: string;
  regex: boolean;
}

const PREVIEW_LIMIT = 100;

const STATUS_NOTE: Record<RenameRow["status"], string> = {
  ok: "",
  unchanged: "",
  invalid: "invalid name, skipped",
  taken: "name taken, skipped",
};

/**
 * Rename popup. One item: a name field (the whole name, extension included, with the
 * stem preselected). Several files: find/replace over each name's stem (literal, or a
 * regular expression) with a live old → new preview. Names that are invalid or already
 * taken are flagged and skipped; the server never overwrites either. `onSubmit` does
 * the call and throws on failure; the message shows in the dialog, which stays open.
 */
export function RenameDialog({
  open,
  onOpenChange,
  noun,
  items,
  taken,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noun: "file" | "folder";
  /** What is being renamed (old names). */
  items: readonly RenameItem[];
  /** Every name already in the open folder (files and folders). */
  taken: ReadonlySet<string>;
  onSubmit: (items: RenameItem[]) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" onClose={() => onOpenChange(false)}>
        {/* The form lives inside the content, so it starts fresh on every open. */}
        <RenameForm
          noun={noun}
          items={items}
          taken={taken}
          onSubmit={onSubmit}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  noun,
  items,
  taken,
  onSubmit,
  onClose,
}: {
  noun: "file" | "folder";
  items: readonly RenameItem[];
  taken: ReadonlySet<string>;
  onSubmit: (items: RenameItem[]) => Promise<void>;
  onClose: () => void;
}) {
  const single = items.length === 1 ? items[0] : undefined;
  const { register, handleSubmit, control, setValue, formState } = useForm<RenameFormValues>({
    defaultValues: { name: single?.name ?? "", find: "", replace: "", regex: false },
  });
  const [submitError, setSubmitError] = useState("");
  const [name, find, replace, regex] = useWatch({
    control,
    name: ["name", "find", "replace", "regex"],
  });

  const plan = single
    ? { rows: [planSingleRename(single, name, taken)], regexError: null }
    : planBulkRename(items, { find, replace, regex }, taken);
  const ready = plan.rows.filter((r) => r.status === "ok");
  const changed = plan.rows.filter((r) => r.status !== "unchanged");

  const submit = handleSubmit(async () => {
    setSubmitError("");
    try {
      await onSubmit(ready.map((r) => ({ path: r.path, name: r.newName })));
      onClose();
    } catch (e) {
      setSubmitError(getErrorMessage(e, `Could not rename the ${noun}s`));
    }
  });

  const { isSubmitting } = formState;
  const singleRow = plan.rows[0];

  return (
    <>
      <DialogHeader>
        <DialogTitle>{single ? `Rename ${noun}` : `Rename ${items.length} ${noun}s`}</DialogTitle>
        <p className="text-sm text-muted-foreground">
          {single
            ? "Nothing is overwritten: a name that is already taken is refused."
            : "Find and replace in each name (the extension is left alone). Nothing is overwritten: names that are taken are skipped."}
        </p>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        {single ? (
          <div className="space-y-1.5">
            <Label htmlFor="rename-name">New name</Label>
            <Input
              id="rename-name"
              autoFocus
              autoComplete="off"
              onFocus={(e) => {
                // Select the stem only, so typing keeps the extension.
                const stemLength =
                  noun === "file" ? splitExtension(e.currentTarget.value)[0].length : undefined;
                e.currentTarget.setSelectionRange(0, stemLength ?? e.currentTarget.value.length);
              }}
              {...register("name")}
            />
            {singleRow && singleRow.status !== "ok" && singleRow.status !== "unchanged" && (
              <p className="text-xs text-destructive">
                {singleRow.status === "taken"
                  ? "That name is already taken"
                  : "Invalid name (no slashes, can't start with a dot)"}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rename-find">Find</Label>
                <Input
                  id="rename-find"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  {...register("find")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rename-replace">Replace with</Label>
                <Input
                  id="rename-replace"
                  autoComplete="off"
                  spellCheck={false}
                  {...register("replace")}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={regex} onCheckedChange={(v) => setValue("regex", v === true)} />
              Use a regular expression
            </label>
            {plan.regexError && <p className="text-xs text-destructive">{plan.regexError}</p>}
            <RenamePreview rows={changed} />
          </div>
        )}
        {submitError && <p className="text-xs text-destructive">{submitError}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting || ready.length === 0}>
            {isSubmitting ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Pencil className="mr-2 h-3.5 w-3.5" />
            )}
            {single ? "Rename" : `Rename ${ready.length}`}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function RenamePreview({ rows }: { rows: RenameRow[] }) {
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">Nothing would change yet.</p>;
  }
  const shown = rows.slice(0, PREVIEW_LIMIT);
  return (
    <ul
      aria-label="Rename preview"
      className="max-h-56 space-y-1 overflow-y-auto rounded-md border bg-px-elevated p-2 text-xs"
    >
      {shown.map((r) => (
        <li key={r.path} className="min-w-0">
          <span className="block truncate text-muted-foreground">{r.oldName}</span>
          <span
            className={cn(
              "block truncate",
              r.status === "ok" ? "text-foreground" : "text-destructive",
            )}
          >
            → {r.newName || "(empty)"}
            {STATUS_NOTE[r.status] && ` · ${STATUS_NOTE[r.status]}`}
          </span>
        </li>
      ))}
      {rows.length > shown.length && (
        <li className="text-muted-foreground">and {rows.length - shown.length} more</li>
      )}
    </ul>
  );
}
