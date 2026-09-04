import { useState } from "react";
import { useForm } from "react-hook-form";
import { FolderOpen, Loader2 } from "lucide-react";
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
import { DirPicker } from "@/components/DirPicker";
import { zodResolver } from "@/lib/zodResolver";
import { addLibrarySchema, type AddLibraryForm } from "@/lib/schemas/library";

/**
 * Shared "Add library" dialog shell. The path input, dir picker, "scan after
 * creation" toggle, error line and footer are identical between video and image
 * libraries; the middle section (`renderExtra`) and the create/scan call
 * (`onSubmit`) are passed in. `E` is the extra per-kind form state (video: the
 * split toggle, image: the scan-options object).
 *
 * `path` + `autoScan` are a react-hook-form form validated by `addLibrarySchema`
 * (zod); `extra` stays plain state since it's generic per kind.
 */
export function AddLibraryDialog<E>({
  open,
  onOpenChange,
  onCreated,
  title,
  placeholder,
  autoScanHint,
  extraDefault,
  renderExtra,
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
  title: string;
  placeholder: string;
  autoScanHint: string;
  extraDefault: E;
  renderExtra?: (extra: E, setExtra: (e: E) => void) => React.ReactNode;
  submitLabel: (extra: E) => string;
  onSubmit: (args: { path: string; extra: E; autoScan: boolean }) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    reset: resetForm,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<AddLibraryForm>({
    resolver: zodResolver(addLibrarySchema),
    defaultValues: { path: "", autoScan: true },
  });
  const [extra, setExtra] = useState<E>(extraDefault);
  const [picking, setPicking] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const reset = () => {
    resetForm({ path: "", autoScan: true });
    setExtra(extraDefault);
    setPicking(false);
    setSubmitError("");
  };

  const submit = handleSubmit(async ({ path, autoScan }) => {
    setSubmitError("");
    try {
      await onSubmit({ path: path.trim(), extra, autoScan });
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create library");
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {picking ? (
          <DirPicker
            onSelect={(p) => {
              setValue("path", p, { shouldValidate: true });
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Path</Label>
              <div className="flex gap-2">
                <Input
                  placeholder={placeholder}
                  {...register("path")}
                  className="font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setPicking(true)}
                  title="Browse"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
              {errors.path && <p className="text-sm text-destructive">{errors.path.message}</p>}
            </div>
            {renderExtra?.(extra, setExtra)}
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                {...register("autoScan")}
                className="accent-primary h-4 w-4 mt-0.5 shrink-0"
              />
              <div>
                <p className="text-sm font-medium">Scan after creation</p>
                <p className="text-xs text-muted-foreground mt-0.5">{autoScanHint}</p>
              </div>
            </label>
            {submitError && <p className="text-sm text-destructive">{submitError}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {submitLabel(extra)}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
