import { req } from "./client";
import type {
  UpscaleStartRequest,
  UpscaleStartResponse,
  UpscaleTiersResponse,
} from "@/types/upscale";

export const upscaleApi = {
  tiers: () => req<UpscaleTiersResponse>("/image-upscale/tiers"),

  start: (body: UpscaleStartRequest) =>
    req<UpscaleStartResponse>("/image-upscale/start", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
