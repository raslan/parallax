import { req } from "./client";
import type { CreditsResponse } from "@/types/credits";

export const creditsApi = {
  /** Credits and licences for everything Parallax uses, ships or adapts. */
  get: () => req<CreditsResponse>("/credits"),
};
