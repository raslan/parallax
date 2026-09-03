import { librariesApi } from "./libraries";
import { filesApi } from "./files";
import { jobsApi } from "./jobs";
import { duplicatesApi } from "./duplicates";
import { cleanupApi } from "./cleanup";
import { originalsApi } from "./originals";
import { filesystemApi } from "./filesystem";
import { settingsApi } from "./settings";
import { ytdlpApi } from "./ytdlp";
import { identifyApi } from "./identify";
import { downloadsApi } from "./downloads";

export const api = {
  ...librariesApi,
  ...filesApi,
  ...jobsApi,
  ...duplicatesApi,
  ...cleanupApi,
  ...originalsApi,
  ...filesystemApi,
  ...settingsApi,
  ...ytdlpApi,
  ...identifyApi,
  ...downloadsApi,
};

export { qk } from "./queryKeys";
export { imageApi } from "./images";
export { modelsApi } from "./models";
export { subtitlesApi } from "./subtitles";
export { streamApi } from "./stream";
export { compressApi } from "./compress";
export { toolboxApi } from "./toolbox";
