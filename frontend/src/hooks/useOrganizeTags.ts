import { api } from "@/lib/api";
import { useStreamedByFile } from "@/hooks/useStreamedByFile";
import type { OrganizeFile, OrganizeTagInfo } from "@/types/organize";

const fetchTags = async (paths: string[]) => (await api.getOrganizeTags(paths)).tags;

/**
 * Streams embedded tags (values capped at 500 characters) for a folder's files, but only
 * while `enabled`: a tag column, a tag filter or the info panel needs them. Users of
 * none of those make no request. See `useStreamedByFile` for batching and caching.
 */
export function useOrganizeTags(folderPath: string, files: OrganizeFile[], enabled: boolean) {
  const { byPath, loaded, total, done } = useStreamedByFile<OrganizeTagInfo>({
    resetKey: folderPath,
    files,
    enabled,
    fetchBatch: fetchTags,
  });
  return { tags: byPath, loaded, total, done };
}
