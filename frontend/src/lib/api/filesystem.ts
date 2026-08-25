import { req } from "./client";

export const filesystemApi = {
  fsBrowse: (path: string) =>
    req<{ path: string; parent: string | null; dirs: string[] }>(
      `/fs/browse?path=${encodeURIComponent(path)}`,
    ),
};
