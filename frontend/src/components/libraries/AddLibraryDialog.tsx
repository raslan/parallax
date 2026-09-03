import { useState } from "react";
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

/**
 * Shared "Add library" dialog shell. The path input, dir picker, "scan after
 * creation" toggle, error line and footer are identical between video and image
 * libraries; the middle section (`renderExtra`) and the create/scan call
 * (`onSubmit`) are passed in. `E` is the extra per-kind form state (video: the
 * split toggle, image: the scan-options object).
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
  const [path, setPath] = useState("");
  const [extra, setExtra] = useState<E>(extraDefault);
  const [autoScan, setAutoScan] = useState(true);
  const [picking, setPicking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setPath("");
    setExtra(extraDefault);
    setAutoScan(true);
    setPicking(false);
    setError("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!path.trim()) return;
    setLoading(true);
    setError("");
    try {
      await onSubmit({ path: path.trim(), extra, autoScan });
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create library");
    } finally {
      setLoading(false);
    }
  };

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
              setPath(p);
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
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  className="font-mono text-sm"
                  required
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
            </div>
            {renderExtra?.(extra, setExtra)}
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoScan}
                onChange={(e) => setAutoScan(e.target.checked)}
                className="accent-primary h-4 w-4 mt-0.5 shrink-0"
              />
              <div>
                <p className="text-sm font-medium">Scan after creation</p>
                <p className="text-xs text-muted-foreground mt-0.5">{autoScanHint}</p>
              </div>
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading || !path.trim()}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {submitLabel(extra)}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
