import { useEffect, useRef, useState } from "react";
import { Images, ScanLine } from "lucide-react";
import { imageApi, qk } from "@/lib/api";
import type { ImageLibrary, ImageScanRequest } from "@/types/image";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { LibraryManagerPage } from "@/components/libraries/LibraryManagerPage";
import { AddLibraryDialog } from "@/components/libraries/AddLibraryDialog";
import type { AddDialogProps, LibraryKind, ScanControlProps } from "@/components/libraries/types";

const DEFAULT_SCAN_OPTS: ImageScanRequest = {
  run_phash: true,
  run_nudenet: true,
  reset: false,
};

const SCAN_TOGGLES = [
  ["run_phash", "Duplicates (pHash)"],
  ["run_nudenet", "Content review (NudeNet)"],
] as const;

function ImageScanControl({ libraryId, scanning, onScanned }: ScanControlProps) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ImageScanRequest>(DEFAULT_SCAN_OPTS);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const scan = async (reset = false) => {
    setOpen(false);
    try {
      await imageApi.scanLibrary(libraryId, { ...opts, reset });
    } catch (e: unknown) {
      if (!(e instanceof Error && e.message?.includes("409"))) throw e;
    }
    onScanned();
  };

  return (
    <div className="relative" ref={ref}>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        disabled={scanning}
        title="Scan for images"
        onClick={() => setOpen((v) => !v)}
      >
        <ScanLine className={`h-3.5 w-3.5 ${scanning ? "text-primary animate-pulse" : ""}`} />
      </Button>
      {open && (
        <div className="absolute right-0 top-8 z-10 bg-card border border-border rounded-lg shadow-lg p-3 flex flex-col gap-2 min-w-[210px]">
          {SCAN_TOGGLES.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={opts[key]}
                onChange={(e) => setOpts((o) => ({ ...o, [key]: e.target.checked }))}
                className="h-3.5 w-3.5 accent-primary"
              />
              <span className="text-xs">{label}</span>
            </label>
          ))}
          <div className="border-t border-border pt-2 mt-1 flex flex-col gap-1.5">
            <Button size="sm" onClick={() => scan()}>
              Scan new images
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (
                  confirm(
                    "Delete all existing image records for this library and rescan from scratch? Thumbnails will be removed.",
                  )
                ) {
                  scan(true);
                }
              }}
            >
              Reset &amp; rescan all
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ImageAddDialog({ open, onOpenChange, onCreated }: AddDialogProps) {
  return (
    <AddLibraryDialog<ImageScanRequest>
      open={open}
      onOpenChange={onOpenChange}
      onCreated={onCreated}
      title="Add Image Library"
      placeholder="/media/photos"
      autoScanHint="Automatically index and analyse images as soon as the library is created."
      extraDefault={DEFAULT_SCAN_OPTS}
      submitLabel={() => "Add Library"}
      renderExtra={(opts, setOpts) => (
        <div className="space-y-2">
          <Label>Scan options</Label>
          {SCAN_TOGGLES.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={opts[key]}
                onChange={(e) => setOpts({ ...opts, [key]: e.target.checked })}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>
      )}
      onSubmit={async ({ path, extra, autoScan }) => {
        const lib = await imageApi.createLibrary({ path });
        if (autoScan) {
          await imageApi.scanLibrary(lib.id, extra).catch(() => {});
        }
      }}
    />
  );
}

const imageKind: LibraryKind<ImageLibrary> = {
  title: "Image Libraries",
  subtitle: (libs) => {
    const total = libs.reduce((s, l) => s + l.image_count, 0);
    return total > 0
      ? `${libs.length} ${libs.length === 1 ? "library" : "libraries"} · ${total.toLocaleString()} images`
      : "Add folders to scan for images.";
  },
  emptyIcon: Images,
  emptyTitle: "No image libraries",
  emptyBody: "Add a folder to start scanning and analysing your images.",
  countNoun: "images",
  getCount: (l) => l.image_count,
  isScanned: (l) => !!l.last_scanned_at,
  notScannedHint: "Not yet scanned — click the scan icon to index images",
  jobType: "image_scan",
  entityLabel: "image library",
  entityPlural: "image libraries",
  recordNoun: "image records",
  leftoverDir: "_quarantine/",
  leftoverFoundNoun: "quarantined images",
  leftoverReviewRoute: "/image-quarantined",
  leftoverButtons: {
    reviewFirst: "Review quarantine first",
    keepOnDisk: "Keep quarantined files on disk",
    deleteWith: "Delete library and quarantined files",
    deleteAllWith: "Delete all libraries and quarantined files",
  },
  listKey: qk.imageLibraries,
  leftoversKey: qk.imageLibraryLeftovers,
  list: () => imageApi.listLibraries(),
  leftovers: (id) => imageApi.libraryLeftovers(id),
  remove: (id, del) => imageApi.deleteLibrary(id, del),
  ScanControl: ImageScanControl,
  AddDialog: ImageAddDialog,
};

export function ImageLibraries() {
  return <LibraryManagerPage kind={imageKind} />;
}
