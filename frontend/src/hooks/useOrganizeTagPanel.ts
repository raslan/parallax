import { useQuery } from "@tanstack/react-query";
import { api, qk } from "@/lib/api";
import type { OrganizeFile, OrganizeTagInfo } from "@/types/organize";

/**
 * The tags the info panel shows for the selected files. One file: its full, uncapped
 * tags (read when the panel opens; the capped batch value shows meanwhile). Several:
 * the capped tags already streamed for the list.
 */
export function useOrganizeTagPanel({
  files,
  tags,
  enabled,
}: {
  files: OrganizeFile[];
  /** The capped tags streamed so far, by path. */
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
  const infos: Record<string, OrganizeTagInfo | null | undefined> = {};
  for (const f of files) infos[f.path] = tags[f.path];
  if (single && full.data !== undefined) infos[single.path] = full.data;
  const loading = files.some((f) => infos[f.path] === undefined);
  return { infos, loading };
}
