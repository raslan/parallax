import { req } from "./client";

export type AudioChannelOp = "mono" | "downmix_stereo" | "left_to_both" | "right_to_both";

export interface AudioToolboxStartBody {
  file_ids: number[];
  trim_start: number;
  trim_end: number;
  channel_op: AudioChannelOp | null;
  normalize: boolean;
  keep_original: boolean;
}

export const audioToolboxApi = {
  start: (body: AudioToolboxStartBody) =>
    req<{ job_id: number }>("/audio-toolbox/start", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
