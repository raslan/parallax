import { BASE, req } from "./client";
import type {
  SearchResult,
  Episode,
  FileMapping,
  RenameOp,
  PreviewResponse,
  ApplyResponse,
} from "@/types/identify";

export const identifyApi = {
  identifyThumbnailUrl: (path: string) =>
    `${BASE}/identify/thumbnail?path=${encodeURIComponent(path)}`,
  identifyFiles: (path: string) =>
    req<{
      path: string;
      files: string[];
      guess: { title: string; year: number | null; type: "movie" | "tv" };
      file_guesses: { file_path: string; season: number | null; episode: number | null }[];
    }>(`/identify/files?path=${encodeURIComponent(path)}`),
  identifySearch: (body: { query: string; type: "movie" | "tv" }) =>
    req<SearchResult[]>("/identify/search", { method: "POST", body: JSON.stringify(body) }),
  identifyGetAllEpisodes: (tmdb_id: number) => req<Episode[]>(`/identify/tv/${tmdb_id}/episodes`),
  identifyGetSeason: (tmdb_id: number, season_number: number) =>
    req<Episode[]>(`/identify/tv/${tmdb_id}/season/${season_number}`),
  identifyPreview: (body: {
    folder_path: string;
    type: "movie" | "tv";
    title: string;
    year: number | null;
    tmdb_id: number;
    mappings: FileMapping[];
  }) => req<PreviewResponse>("/identify/preview", { method: "POST", body: JSON.stringify(body) }),
  identifyApply: (body: { file_ops: RenameOp[]; folder_ops: RenameOp[] }) =>
    req<ApplyResponse>("/identify/apply", { method: "POST", body: JSON.stringify(body) }),
};
