import { AudioLines, ScanLine } from "lucide-react";
import { audioLibrariesApi, qk } from "@/lib/api";
import type { AudioLibrary } from "@/types/audio";
import { Button } from "@/components/ui/button";
import { LibraryManagerPage } from "@/components/libraries/LibraryManagerPage";
import { AddLibraryDialog } from "@/components/libraries/AddLibraryDialog";
import type { AddDialogProps, LibraryKind, ScanControlProps } from "@/components/libraries/types";

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
    <AddLibraryDialog<Record<string, never>>
      open={open}
      onOpenChange={onOpenChange}
      onCreated={onCreated}
      title="Add Audio Library"
      placeholder="/media/audio"
      autoScanHint="Automatically index audio as soon as the library is created."
      extraDefault={{}}
      submitLabel={() => "Add Library"}
      onSubmit={async ({ path, autoScan }) => {
        const lib = await audioLibrariesApi.createLibrary({ path });
        if (autoScan) await audioLibrariesApi.scanLibrary(lib.id).catch(() => {});
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
