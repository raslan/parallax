import { Loader2, Wand2, Check, AlertCircle } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { RenameOp, NfoOp } from "@/types/identify";

interface ApplyResult {
  successes: string[];
  failures: { path: string; error: string }[];
}

interface PreviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loadingPreview: boolean;
  fileOps: RenameOp[];
  folderOps: RenameOp[];
  nfoOps: NfoOp[];
  imagePaths: string[];
  loadingApply: boolean;
  onApply: () => void;
  result: ApplyResult | null;
  onReset: () => void;
  error: string;
}

function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

export function PreviewSheet({
  open,
  onOpenChange,
  loadingPreview,
  fileOps,
  folderOps,
  nfoOps,
  imagePaths,
  loadingApply,
  onApply,
  result,
  onReset,
  error,
}: PreviewSheetProps) {
  const nothingToDo = fileOps.length === 0 && folderOps.length === 0 && nfoOps.length === 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{result ? "Renames applied" : "Preview renames"}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {loadingPreview ? (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">Working out the renames…</p>
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          ) : result ? (
            <div className="space-y-4">
              {(() => {
                const nfoWritten = result.successes.filter((p) => p.endsWith(".nfo")).length;
                const artWritten = result.successes.filter((p) => /\.(jpe?g|png)$/i.test(p)).length;
                const renamed = result.successes.length - nfoWritten - artWritten;
                return (
                  <p className="flex items-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-green-400" />
                    <span>
                      <span className="font-medium text-foreground">{renamed}</span> renamed
                      {nfoWritten > 0 && (
                        <>
                          {" · "}
                          <span className="font-medium text-foreground">{nfoWritten}</span> .nfo
                        </>
                      )}
                      {artWritten > 0 && (
                        <>
                          {" · "}
                          <span className="font-medium text-foreground">{artWritten}</span> artwork
                        </>
                      )}
                    </span>
                  </p>
                );
              })()}
              {result.failures.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-destructive">
                    {result.failures.length} failed
                  </p>
                  {result.failures.map((f) => (
                    <div
                      key={f.path}
                      className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 font-mono text-xs"
                    >
                      <p className="truncate text-muted-foreground">{f.path}</p>
                      <p className="text-destructive">{f.error}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : nothingToDo ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Everything is already named correctly — nothing to rename.
            </p>
          ) : (
            <div className="space-y-5">
              {folderOps.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    Folder
                  </p>
                  {folderOps.map((op) => (
                    <div
                      key={op.old_path}
                      className="space-y-0.5 rounded bg-muted/30 px-3 py-2 font-mono text-xs"
                    >
                      <p className="truncate text-muted-foreground line-through">{op.old_path}</p>
                      <p className="truncate text-primary">{op.new_path}</p>
                    </div>
                  ))}
                </div>
              )}

              {fileOps.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    Files ({fileOps.length})
                  </p>
                  <div className="overflow-hidden rounded-md border border-border">
                    {fileOps.map((op) => (
                      <div
                        key={op.old_path}
                        className="space-y-0.5 border-b border-border px-3 py-2 font-mono text-xs last:border-0"
                      >
                        <p className="truncate text-muted-foreground line-through">
                          {basename(op.old_path)}
                        </p>
                        <p className="truncate text-primary">{basename(op.new_path)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {nfoOps.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    NFO files ({nfoOps.length})
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Metadata sidecars for Plex/Jellyfin —{" "}
                    <span className="font-mono">tvshow.nfo</span> plus one per episode.
                  </p>
                  <div className="overflow-hidden rounded-md border border-border">
                    {nfoOps.map((op) => (
                      <p
                        key={op.path}
                        className="truncate border-b border-border px-3 py-2 font-mono text-xs text-muted-foreground last:border-0"
                        title={op.path}
                      >
                        {basename(op.path)}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {imagePaths.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    Artwork ({imagePaths.length})
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Generated poster + backdrop from the first episode's frame, with the show name
                    set in Inter.
                  </p>
                  <div className="overflow-hidden rounded-md border border-border">
                    {imagePaths.map((p) => (
                      <p
                        key={p}
                        className="truncate border-b border-border px-3 py-2 font-mono text-xs text-muted-foreground last:border-0"
                        title={p}
                      >
                        {basename(p)}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          {result ? (
            <Button type="button" onClick={onReset}>
              Identify another folder
            </Button>
          ) : (
            <>
              <SheetClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </SheetClose>
              <Button
                type="button"
                onClick={onApply}
                disabled={loadingApply || loadingPreview || nothingToDo}
                className="gap-2"
              >
                {loadingApply ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                Apply renames
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
