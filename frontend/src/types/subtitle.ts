export interface SubtitleFile {
  path: string;
  filename: string;
  relative_dir: string;
  has_subtitle: boolean;
  has_any_subtitle: boolean;
  languages: Record<string, boolean>;
  /** Wanted languages for which only a machine-made (offline translation / speech-to-text) file exists. */
  machine_languages: Record<string, boolean>;
  title: string;
  season: number | null;
  episode: number | null;
  year: number | null;
  media_type: string;
}

export interface SubtitleCandidate {
  subtitle_id: string;
  provider: string;
  language: string;
  release: string;
  score: number;
  hearing_impaired: boolean;
}

/** An English subtitle file the user can pick to translate. */
export interface TranslateSource {
  path: string;
  filename: string;
  machine_made: boolean;
  hearing_impaired: boolean;
}

export interface SubtitleTrack {
  label: string;
  lang: string;
  hearing_impaired?: boolean;
  machine_made?: boolean;
  url: string;
}
