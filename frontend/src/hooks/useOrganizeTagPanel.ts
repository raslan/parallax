import { useQuery } from "@tanstack/react-query";
import { api, qk } from "@/lib/api";
import { useOrganizeTags } from "@/hooks/useOrganizeTags";
import type { OrganizeFile, OrganizeTagInfo } from "@/types/organize";

/**
 * The tags the info panel shows for the selected files, read only for those files (the
 * panel switch being on never reads the rest of the folder). One file: its full,
 * uncapped tags (the capped value from the list shows meanwhile). Several: their capped
 * tags, taken from the list's columns when already loaded and read otherwise.
 * `files` must be referentially stable (the selection's memoised list).
 */
export function useOrganizeTagPanel({
  folderPath,
  files,
  tags,
  enabled,
}: {
  folderPath: string;
  files: OrganizeFile[];
  /** The capped tags the list has streamed so far, by path. */
  tags: Record<string, OrganizeTagInfo | null>;
  enabled: boolean;
}) {
  const single = files.length === 1 ? files[0]! : null;
  const full = useQuery({
    queryKey: qk.organizeTags(single?.path ?? ""),
    queryFn: async () =>
      (await api.getOrganizeTags([single!.path], true)).tags[single!.path] ?? null,
    enabled: enabled && single !== null,
    retry: false,
  });
  const own = useOrganizeTags(folderPath, files, enabled && files.length > 1);

  const infos: Record<string, OrganizeTagInfo | null | undefined> = {};
  for (const f of files) infos[f.path] = f.path in tags ? tags[f.path] : own.tags[f.path];
  if (single && full.data !== undefined) infos[single.path] = full.data;
  const loading = files.some((f) => infos[f.path] === undefined);
  return { infos, loading };
}
