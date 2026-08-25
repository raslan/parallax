import { req } from "./client";
import type { Settings, UpdateSettingsBody } from "@/types/settings";

export const settingsApi = {
  getSettings: () => req<Settings>("/settings"),
  updateSettings: (body: UpdateSettingsBody) =>
    req<Settings>("/settings", { method: "PATCH", body: JSON.stringify(body) }),
  purgeLibraryData: () => req<void>("/settings/purge-library-data", { method: "POST" }),
};
