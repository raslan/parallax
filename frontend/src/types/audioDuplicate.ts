export interface AudioDuplicateCriteria {
  use_size: boolean;
  use_duration: boolean;
  duration_tolerance: number;
  use_content_date: boolean;
  content_date_tolerance: number;
  use_audio: boolean;
  /** Shared audio, "Min shared": share (0-1) of the shorter file that must be found in the other. */
  audio_threshold: number;
  /** Shared audio, "Sounds alike" (0.65-0.95): server-side, changing it needs a new run. */
  audio_similarity: number;
  /** Shared audio, "Shared for at least" (seconds): server-side, changing it needs a new run. */
  audio_min_stretch: number;
}

export const DEFAULT_AUDIO_CRITERIA: AudioDuplicateCriteria = {
  use_size: false,
  use_duration: true,
  duration_tolerance: 2,
  use_content_date: false,
  content_date_tolerance: 60,
  use_audio: true,
  audio_threshold: 0.85,
  audio_similarity: 0.75,
  audio_min_stretch: 10,
};

export function anyAudioCriteriaEnabled(c: AudioDuplicateCriteria): boolean {
  return c.use_size || c.use_duration || c.use_content_date || c.use_audio;
}
