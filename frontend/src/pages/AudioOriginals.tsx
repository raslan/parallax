import { audioOriginalsApi, qk } from "@/lib/api";
import { OriginalsPage, type OriginalsKind } from "@/components/originals/OriginalsPage";

const audioOriginalsKind: OriginalsKind = {
  title: "Audio Originals",
  subtitle: "Browse and restore compressed-audio backups.",
  listKey: qk.audioOriginals,
  list: (libraryId) => audioOriginalsApi.list(libraryId),
  restore: (path) => audioOriginalsApi.restore(path),
  restoreBatch: (paths) => audioOriginalsApi.restoreBatch(paths),
  deleteFile: (path) => audioOriginalsApi.deleteFile(path),
  deleteLibraryOriginals: (libraryId) => audioOriginalsApi.deleteLibraryOriginals(libraryId),
};

export function AudioOriginals() {
  return <OriginalsPage kind={audioOriginalsKind} />;
}
