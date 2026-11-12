export interface SubtitlePack {
  lang: string;
  name: string;
  source_lang: string;
  model: string;
  size_bytes: number;
  installed: boolean;
  installed_bytes: number;
  licence: string;
  licence_url: string;
  upstream_url: string;
  installing_job_id: number | null;
}
