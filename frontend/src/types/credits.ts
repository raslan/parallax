/** How Parallax relates to a credited thing. */
export type CreditHow =
  "shipped" | "installed" | "downloaded" | "adapted" | "service" | "media" | "site" | "inspiration";

interface CreditGroup {
  id: string;
  title: string;
  /** A sentence shown under the heading. */
  note?: string;
}

export interface CreditEntry {
  id: string;
  group: string;
  name: string;
  description: string;
  /** Absent for "inspiration" entries: no code was taken, so there is no author or licence to credit. */
  author?: string;
  licence?: string;
  licence_url?: string;
  url: string;
  how: CreditHow;
  note?: string;
  /** Full licence text, for licences that ask for it to be reproduced. */
  text?: string;
  copyright?: string;
  /** Where the matching source code can be obtained, for GPL components that ship in the image. */
  source_url?: string;
  /** A sentence the owner of a service asks to be shown (TMDB). */
  notice?: string;
  /** A logo to show next to the entry. Loaded from its own site and hidden if it does not load. */
  logo?: string;
}

export interface CreditsResponse {
  groups: CreditGroup[];
  entries: CreditEntry[];
}
