import { useState } from "react";
import { useForm } from "react-hook-form";
import { FolderInput, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { zodResolver } from "@/lib/zodResolver";
import { subfolderNameSchema, type SubfolderNameForm } from "@/lib/schemas/organize";
import { getErrorMessage } from "@/lib/api/client";

/**
 * Small "name the new folder" popup for Organize's Move to subfolder. `onSubmit` does the
 * call and throws on failure; the message shows under the field and the dialog stays
 * open so the name can be fixed. On success the dialog closes itself.
 */
export function MoveToSubfolderDialog({
  open,
  onOpenChange,
  summary,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What is being moved, e.g. "12 files (4.8 MB)". */
  summary: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SubfolderNameForm>({
    resolver: zodResolver(subfolderNameSchema),
    defaultValues: { name: "" },
  });
  const [submitError, setSubmitError] = useState("");

  const close = () => {
    reset({ name: "" });
    setSubmitError("");
    onOpenChange(false);
  };

  const submit = handleSubmit(async ({ name }) => {
    setSubmitError("");
    try {
      await onSubmit(name);
      close();
    } catch (e) {
      setSubmitError(getErrorMessage(e, "Could not move the files"));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-sm" onClose={close}>
        <DialogHeader>
          <DialogTitle>Move to subfolder</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Move {summary} into a folder inside this one. An existing folder with that name is
            reused.
          </p>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="subfolder-name">Folder name</Label>
            <Input id="subfolder-name" autoFocus autoComplete="off" {...register("name")} />
            {(errors.name || submitError) && (
              <p className="text-xs text-destructive">{errors.name?.message ?? submitError}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <FolderInput className="mr-2 h-3.5 w-3.5" />
              )}
              Move
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
