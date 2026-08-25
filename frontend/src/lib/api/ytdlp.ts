import { req } from "./client";

export const ytdlpApi = {
  ytdlpInfo: () =>
    req<{ installed: boolean; version: string | null; path: string | null }>(
      "/downloads/ytdlp/info",
    ),
  ytdlpUpdate: () => req<{ message: string }>("/downloads/ytdlp/update", { method: "POST" }),
  ytdlpImpersonateTargets: () => req<{ targets: string[] }>("/downloads/ytdlp/impersonate-targets"),
};
