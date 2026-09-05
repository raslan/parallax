export interface SubtitleFile {
  path: string;
  filename: string;
  relative_dir: string;
  has_subtitle: boolean;
  has_any_subtitle: boolean;
  languages: Record<string, boolean>;
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

export interface SubtitleTrack {
  label: string;
  lang: string;
  url: string;
}
