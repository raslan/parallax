import { req } from "./client";
import { compressApi } from "./compress";
import type { ToolboxStartRequest } from "@/types/toolbox";

export const toolboxApi = {
  libraryFiles: compressApi.libraryFiles,

  start: (body: ToolboxStartRequest) =>
    req<{ job_id: number }>("/toolbox/start", { method: "POST", body: JSON.stringify(body) }),
};
