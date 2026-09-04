import { Library as LibIcon, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, qk } from "@/lib/api";
import type { Library } from "@/types/library";
import { LibraryManagerPage } from "@/components/libraries/LibraryManagerPage";
import { AddLibraryDialog } from "@/components/libraries/AddLibraryDialog";
import type { AddDialogProps, LibraryKind, ScanControlProps } from "@/components/libraries/types";

const VIDEO_ADD_EXTRA = { split: false };

function VideoScanControl({ libraryId, scanning, onScanned }: ScanControlProps) {
  const scan = async () => {
    try {
      await api.scanLibrary(libraryId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (!msg.includes("409")) throw e;
    }
    onScanned();
  };

  return (
    <Button
      size="icon"
      variant="ghost"
      className="h-7 w-7"
      onClick={scan}
      disabled={scanning}
      title="Scan for new / removed files"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${scanning ? "animate-spin" : ""}`} />
    </Button>
  );
}

function VideoAddDialog({ open, onOpenChange, onCreated }: AddDialogProps) {
  return (
    <AddLibraryDialog<{ split: boolean }>
      open={open}
      onOpenChange={onOpenChange}
      onCreated={onCreated}
      title="Add Library"
      placeholder="/media/movies"
      autoScanHint="Automatically index files as soon as the library is created."
      extraDefault={VIDEO_ADD_EXTRA}
      submitLabel={(e) => (e.split ? "Add Libraries" : "Add Library")}
      renderExtra={(extra, setExtra) => (
        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={extra.split}
            onChange={(e) => setExtra({ split: e.target.checked })}
            className="accent-primary h-4 w-4 mt-0.5 shrink-0"
          />
          <div>
            <p className="text-sm font-medium">Split into sub-libraries</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Create one library per immediate subdirectory, named after each folder. Files belong
              only to their parent folder's library.
            </p>
          </div>
        </label>
      )}
      onSubmit={async ({ path, extra, autoScan }) => {
        const parts = path.split("/").filter(Boolean);
        const derivedName = parts.length > 0 ? parts[parts.length - 1]! : "";
        const created = await api.createLibrary({
          name: derivedName,
          path,
          split_into_sublibraries: extra.split,
        });
        if (autoScan) {
          await Promise.all(created.map((lib) => api.scanLibrary(lib.id).catch(() => {})));
        }
      }}
    />
  );
}

const videoKind: LibraryKind<Library> = {
  title: "Libraries",
  subtitle: () => "Manage the folders you want to scan.",
  emptyIcon: LibIcon,
  emptyTitle: "No libraries",
  emptyBody: "Add a folder from your mounted volumes to start scanning.",
  countNoun: "files",
  getCount: (l) => l.file_count,
  isScanned: (l) => l.file_count > 0,
  notScannedHint: "Not yet scanned — click the refresh icon to index files",
  jobType: "scan",
  entityLabel: "library",
  entityPlural: "libraries",
  recordNoun: "file records",
  leftoverDir: "_originals/",
  leftoverFoundNoun: "original backups",
  leftoverReviewRoute: "/originals",
  leftoverButtons: {
    reviewFirst: "Review originals first",
    keepOnDisk: "Keep originals on disk",
    deleteWith: "Delete library and originals",
    deleteAllWith: "Delete all libraries and originals",
  },
  listKey: qk.libraries,
  leftoversKey: qk.libraryLeftovers,
  list: () => api.getLibraries(),
  leftovers: (id) => api.libraryLeftovers(id),
  remove: (id, del) => api.deleteLibrary(id, del),
  ScanControl: VideoScanControl,
  AddDialog: VideoAddDialog,
};

export function Libraries() {
  return <LibraryManagerPage kind={videoKind} />;
}
