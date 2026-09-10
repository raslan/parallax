export interface AudioDuplicateCriteria {
  use_size: boolean;
  use_duration: boolean;
  duration_tolerance: number;
  use_content_date: boolean;
  content_date_tolerance: number;
  use_audio: boolean;
  audio_threshold: number;
}

export const DEFAULT_AUDIO_CRITERIA: AudioDuplicateCriteria = {
  use_size: false,
  use_duration: true,
  duration_tolerance: 2,
  use_content_date: false,
  content_date_tolerance: 60,
  use_audio: true,
  audio_threshold: 0.85,
};

export function anyAudioCriteriaEnabled(c: AudioDuplicateCriteria): boolean {
  return c.use_size || c.use_duration || c.use_content_date || c.use_audio;
}
