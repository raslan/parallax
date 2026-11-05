import { req } from "./client";
import type {
  UpscaleCredits,
  UpscaleStartRequest,
  UpscaleStartResponse,
  UpscaleTiersResponse,
} from "@/types/upscale";

export const upscaleApi = {
  tiers: () => req<UpscaleTiersResponse>("/image-upscale/tiers"),

  credits: () => req<UpscaleCredits>("/image-upscale/credits"),

  start: (body: UpscaleStartRequest) =>
    req<UpscaleStartResponse>("/image-upscale/start", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
