import { api } from "@/lib/api";
import { useStreamedByFile } from "@/hooks/useStreamedByFile";
import type { FileDetails, OrganizeFile } from "@/types/organize";

const fetchDetails = async (paths: string[]) => (await api.getOrganizeDetails(paths)).details;

/**
 * Streams ffprobe details for a folder's files in the background (see
 * `useStreamedByFile` for batching, caching and failure behaviour). `files` must be
 * referentially stable (query data).
 */
export function useOrganizeDetails(folderPath: string, files: OrganizeFile[]) {
  const { byPath, loaded, total, done } = useStreamedByFile<FileDetails>({
    resetKey: folderPath,
    files,
    enabled: true,
    fetchBatch: fetchDetails,
  });
  return { details: byPath, loaded, total, done };
}
