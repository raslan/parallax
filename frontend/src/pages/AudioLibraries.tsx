import { AudioLines, ScanLine } from "lucide-react";
import { audioLibrariesApi, qk } from "@/lib/api";
import type { AudioLibrary } from "@/types/audio";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { LibraryManagerPage } from "@/components/libraries/LibraryManagerPage";
import { AddLibraryDialog } from "@/components/libraries/AddLibraryDialog";
import type { AddDialogProps, LibraryKind, ScanControlProps } from "@/components/libraries/types";

const AUDIO_ADD_EXTRA = { split: false };

function AudioScanControl({ libraryId, scanning, onScanned }: ScanControlProps) {
  const scan = async () => {
    try {
      await audioLibrariesApi.scanLibrary(libraryId);
    } catch (e: unknown) {
      if (!String(e).includes("409")) throw e;
    }
    onScanned();
  };

  return (
    <Button
      size="icon"
      variant="ghost"
      className="h-7 w-7"
      disabled={scanning}
      title="Scan for audio"
      onClick={scan}
    >
      <ScanLine className={`h-3.5 w-3.5 ${scanning ? "text-primary animate-pulse" : ""}`} />
    </Button>
  );
}

function AudioAddDialog({ open, onOpenChange, onCreated }: AddDialogProps) {
  return (
    <AddLibraryDialog<{ split: boolean }>
      open={open}
      onOpenChange={onOpenChange}
      onCreated={onCreated}
      title="Add Audio Library"
      placeholder="/media/audio"
      autoScanHint="Automatically index audio as soon as the library is created."
      extraDefault={AUDIO_ADD_EXTRA}
      submitLabel={(e) => (e.split ? "Add Libraries" : "Add Library")}
      renderExtra={(extra, setExtra) => (
        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <Checkbox
            checked={extra.split}
            onCheckedChange={(c) => setExtra({ split: c === true })}
            className="mt-0.5 shrink-0"
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
        const created = await audioLibrariesApi.createLibrary({
          name: derivedName,
          path,
          split_into_sublibraries: extra.split,
        });
        if (autoScan) {
          await Promise.all(
            created.map((lib) => audioLibrariesApi.scanLibrary(lib.id).catch(() => {})),
          );
        }
      }}
    />
  );
}

const audioKind: LibraryKind<AudioLibrary> = {
  title: "Audio Libraries",
  subtitle: (libs) => {
    const total = libs.reduce((s, l) => s + l.file_count, 0);
    return total > 0
      ? `${libs.length} ${libs.length === 1 ? "library" : "libraries"} · ${total.toLocaleString()} files`
      : "Add folders to scan for audio.";
  },
  emptyIcon: AudioLines,
  emptyTitle: "No audio libraries",
  emptyBody: "Add a folder to start scanning your audio.",
  countNoun: "files",
  getCount: (l) => l.file_count,
  isScanned: (l) => !!l.last_scanned_at,
  notScannedHint: "Not yet scanned — click the scan icon to index audio",
  jobType: "audio_scan",
  entityLabel: "audio library",
  entityPlural: "audio libraries",
  recordNoun: "audio file records",
  leftoverDir: "_originals/",
  leftoverFoundNoun: "original backups",
  leftoverReviewRoute: "/audio-originals",
  leftoverButtons: {
    reviewFirst: "Review originals first",
    keepOnDisk: "Keep original backups on disk",
    deleteWith: "Delete library and original backups",
    deleteAllWith: "Delete all libraries and original backups",
  },
  listKey: qk.audioLibraries,
  leftoversKey: qk.audioLibraryLeftovers,
  list: () => audioLibrariesApi.listLibraries(),
  leftovers: (id) => audioLibrariesApi.libraryLeftovers(id),
  remove: (id, del) => audioLibrariesApi.deleteLibrary(id, del),
  ScanControl: AudioScanControl,
  AddDialog: AudioAddDialog,
};

export function AudioLibraries() {
  return <LibraryManagerPage kind={audioKind} />;
}
