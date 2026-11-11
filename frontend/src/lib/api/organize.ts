import { BASE, req } from "./client";
import type {
  FileDetails,
  OrganizeDeleteResult,
  OrganizeMoveResult,
  OrganizeRenameResult,
  OrganizeFile,
  OrganizeFolder,
  OrganizeTagInfo,
  ScanState,
  TagApplyItem,
  TagApplyResult,
  TagPlansResult,
} from "@/types/organize";
import type { StreamPrepareStatus } from "@/types/stream";

const q = (path: string) => `path=${encodeURIComponent(path)}`;

export const organizeApi = {
  getOrganizeRoot: () => req<{ root: string | null }>("/organize/root"),
  putOrganizeRoot: (path: string) =>
    req<{ root: string | null }>("/organize/root", {
      method: "PUT",
      body: JSON.stringify({ path }),
    }),
  /** Without `force` the backend reuses a finished scan of the same root. */
  startOrganizeScan: (force = false) =>
    req<ScanState>(`/organize/scan${force ? "?force=true" : ""}`, { method: "POST" }),
  getOrganizeScan: () => req<ScanState>("/organize/scan"),
  getOrganizeFolder: (path: string) => req<OrganizeFolder>(`/organize/folder?${q(path)}`),
  getOrganizeFiles: (path: string) => req<OrganizeFile[]>(`/organize/files?${q(path)}`),
  getOrganizeDetails: (paths: string[]) =>
    req<{ details: Record<string, FileDetails | null> }>("/organize/details", {
      method: "POST",
      body: JSON.stringify({ paths }),
    }),
  getOrganizeTags: (paths: string[], full = false) =>
    req<{ tags: Record<string, OrganizeTagInfo | null> }>("/organize/tags", {
      method: "POST",
      body: JSON.stringify({ paths, full }),
    }),
  /** Whether and how each file's tags can be written, and the space a rewrite needs. */
  planOrganizeTags: (paths: string[]) =>
    req<TagPlansResult>("/organize/tags/plan", {
      method: "POST",
      body: JSON.stringify({ paths }),
    }),
  /** Writes the reviewed tag edits (at most 20 files); one result per file. No undo. */
  applyOrganizeTags: (items: TagApplyItem[]) =>
    req<TagApplyResult>("/organize/tags/apply", {
      method: "POST",
      body: JSON.stringify({ items }),
    }),
  organizeDelete: (paths: string[]) =>
    req<OrganizeDeleteResult>("/organize/delete", {
      method: "POST",
      body: JSON.stringify({ paths }),
    }),
  /** Moves direct files of `folder` into `folder/name` (created or reused; never overwrites). */
  organizeMoveToSubfolder: (folder: string, paths: string[], name: string) =>
    req<OrganizeMoveResult>("/organize/move-to-subfolder", {
      method: "POST",
      body: JSON.stringify({ folder, paths, name }),
    }),
  /** Moves direct files of `folder` into the existing folder `destination` (never overwrites). */
  organizeMoveToFolder: (folder: string, paths: string[], destination: string) =>
    req<OrganizeMoveResult>("/organize/move-to-folder", {
      method: "POST",
      body: JSON.stringify({ folder, paths, destination }),
    }),
  /** Renames direct files of `folder`; a taken name fails just that item. */
  organizeRename: (folder: string, items: { path: string; name: string }[]) =>
    req<OrganizeRenameResult>("/organize/rename", {
      method: "POST",
      body: JSON.stringify({ folder, items }),
    }),
  organizeRenameFolder: (path: string, name: string) =>
    req<{ path: string }>("/organize/rename-folder", {
      method: "POST",
      body: JSON.stringify({ path, name }),
    }),
  /** `onlyIfEmpty` deletes only a still-empty folder (409 if it gained entries). */
  organizeDeleteFolder: (path: string, onlyIfEmpty = false) =>
    req<void>("/organize/delete-folder", {
      method: "POST",
      body: JSON.stringify({ path, only_if_empty: onlyIfEmpty }),
    }),
  /** Sandboxed twins of `streamApi.prepare/status`: the path is checked against the chosen folder. */
  organizeStreamPrepare: (path: string) =>
    req<StreamPrepareStatus>("/organize/stream/prepare", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  organizeStreamPrepareStatus: (path: string) =>
    req<StreamPrepareStatus>(`/organize/stream/prepare-status?${q(path)}`),
  organizeThumbnailUrl: (path: string) => `${BASE}/organize/thumbnail?${q(path)}`,
  organizeFileUrl: (path: string) => `${BASE}/organize/file?${q(path)}`,
  organizeAudioUrl: (path: string) => `${BASE}/organize/audio?${q(path)}`,
};
