import { api, qk } from "@/lib/api";
import { OriginalsPage, type OriginalsKind } from "@/components/originals/OriginalsPage";

const videoOriginalsKind: OriginalsKind = {
  title: "Originals",
  subtitle:
    "Backup files kept from before modifications. Delete once you're happy, or restore to undo.",
  listKey: qk.originals,
  list: (libraryId) => api.getOriginals(libraryId),
  restore: (path) => api.restoreOriginal(path),
  restoreBatch: (paths) => api.restoreOriginalsBatch(paths),
  deleteFile: (path) => api.deleteOriginal(path),
  deleteLibraryOriginals: (libraryId) => api.deleteLibraryOriginals(libraryId),
};

export function Originals() {
  return <OriginalsPage kind={videoOriginalsKind} />;
}
