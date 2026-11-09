/**
 * Every feature, in one place. The docs home page lists them all (components/feature-list.tsx) and the landing
 * page's "What else can it do?" line links to the ones that have a `landing` phrase. `check-coverage` fails if a
 * user-facing docs page is missing from here, so a new page cannot ship without an entry.
 *
 * Wording rule: say what it does for you, in a few plain words. How it works belongs on the page itself.
 */
export type Feature = {
  /** Docs path, e.g. "/docs/features/compress". */
  href: string;
  title: string;
  /** What it does for you. One short sentence. */
  summary: string;
  /** A phrase for the landing page's "Parallax will ..." sentence. Left out for features the landing page does not name. */
  landing?: string;
};

export type FeatureGroup = { id: string; title: string; features: Feature[] };

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: "your-collection",
    title: "Your collection",
    features: [
      {
        href: "/docs/general-concepts/libraries",
        title: "Libraries",
        summary:
          "Point Parallax at your folders of videos, photos and music, and it keeps up as files come and go.",
      },
      {
        href: "/docs/features/files",
        title: "Files",
        summary:
          "Browse everything in one place, search and sort it, and play it right in the browser.",
      },
      {
        href: "/docs/general-concepts/player",
        title: "Video and audio player",
        summary:
          "Play videos and music in the browser, with subtitles and sound that always works.",
        landing: "play anything in the browser",
      },
      {
        href: "/docs/general-concepts/home",
        title: "Home and statistics",
        summary: "See how much space Parallax has saved you, and what it is working on right now.",
        landing: "show how much space you have saved",
      },
    ],
  },
  {
    id: "free-up-space",
    title: "Free up space",
    features: [
      {
        href: "/docs/features/compress",
        title: "Compress",
        summary: "Make videos and music much smaller, with no quality loss you would notice.",
        landing: "shrink music too",
      },
      {
        href: "/docs/features/duplicates",
        title: "Duplicates",
        summary:
          "Find copies of the same video, photo or song, even under different names, and keep the best one.",
        landing: "match duplicate photos and songs",
      },
      {
        href: "/docs/features/cleanup",
        title: "Cleanup",
        summary:
          "Find the files that match rules you set, like very short, tiny or old, and clear them out together.",
      },
      {
        href: "/docs/features/originals",
        title: "Originals",
        summary:
          "Every change keeps a backup first. Put one back with a click, or delete the backups when you are sure.",
        landing: "restore your originals",
      },
    ],
  },
  {
    id: "fix-and-tidy",
    title: "Fix and tidy",
    features: [
      {
        href: "/docs/tools/identify",
        title: "Identify",
        summary:
          "Turn badly named files into a tidy library that Plex, Jellyfin and Kodi recognise.",
      },
      {
        href: "/docs/tools/organize",
        title: "Organize",
        summary:
          "Look inside any folder, group the files, then move, rename or delete them in a few clicks.",
      },
      {
        href: "/docs/features/toolbox",
        title: "Toolbox",
        summary:
          "Quick fixes for problem files: trim the ends, even out the volume, fix one-sided sound, turn a sideways clip upright.",
        landing: "trim clips and fix the sound",
      },
      {
        href: "/docs/features/splice",
        title: "Splice",
        summary: "Join several videos into one file, in the order you choose.",
        landing: "splice videos together",
      },
      {
        href: "/docs/general-concepts/filters",
        title: "Filters",
        summary:
          "One filter builder shared by Cleanup, Content Review and Organize, so you only learn it once.",
      },
    ],
  },
  {
    id: "pictures-and-subtitles",
    title: "Pictures and subtitles",
    features: [
      {
        href: "/docs/features/image-upscale",
        title: "Upscale",
        summary: "Make a bigger, sharper copy of a picture.",
        landing: "upscale images",
      },
      {
        href: "/docs/features/content-review",
        title: "Content Review",
        summary: "Find pictures that may be inappropriate and set them aside together.",
        landing: "filter inappropriate images",
      },
      {
        href: "/docs/tools/subtitles",
        title: "Subtitles",
        summary:
          "Find the videos that have none, download them in bulk, and fix the ones that are out of time.",
        landing: "find subtitles",
      },
    ],
  },
  {
    id: "bring-things-in",
    title: "Bring things in",
    features: [
      {
        href: "/docs/tools/downloads",
        title: "Downloads",
        summary: "Save videos and audio from links you paste in.",
      },
      {
        href: "/docs/tools/galleries",
        title: "Galleries",
        summary:
          "Fetch whole galleries and albums of pictures and clips, and keep them up to date.",
      },
    ],
  },
  {
    id: "make-it-yours",
    title: "Make it yours",
    features: [
      {
        href: "/docs/general-concepts/jobs",
        title: "Jobs",
        summary:
          "Watch what Parallax is doing in the background, read its logs, and cancel things.",
      },
      {
        href: "/docs/general-concepts/command-palette",
        title: "Command palette",
        summary: "Jump to any page, or switch theme, from the keyboard.",
        landing: "jump anywhere from the keyboard",
      },
      {
        href: "/docs/general-concepts/themes",
        title: "Themes",
        summary: "Change the colours to suit you.",
      },
      {
        href: "/docs/general-concepts/account",
        title: "Account and sign-in",
        summary: "One private account, so only you can open Parallax.",
      },
      {
        href: "/docs/general-concepts/settings",
        title: "Settings",
        summary: "Every setting in one place, tab by tab.",
      },
    ],
  },
];

/** Advanced pages the landing page also names. They are not in the feature list above (the Advanced section is for the technical side). */
const LANDING_EXTRAS: { phrase: string; href: string }[] = [
  {
    phrase: "use your graphics card",
    href: "/docs/advanced/hardware-acceleration",
  },
  {
    phrase: "keep up with your folders on its own",
    href: "/docs/advanced/scanning-and-watcher",
  },
];

// The order the phrases read in on the landing page, most useful first. Not the docs order.
const LANDING_ORDER = [
  "/docs/tools/subtitles",
  "/docs/features/image-upscale",
  "/docs/features/toolbox",
  "/docs/features/splice",
  "/docs/features/originals",
  "/docs/features/compress",
  "/docs/features/duplicates",
  "/docs/features/content-review",
  "/docs/general-concepts/player",
  "/docs/general-concepts/home",
  "/docs/general-concepts/command-palette",
  "/docs/advanced/hardware-acceleration",
  "/docs/advanced/scanning-and-watcher",
];

const landingPhrases: [string, string][] = [
  ...FEATURE_GROUPS.flatMap((g) => g.features)
    .filter((f) => f.landing)
    .map((f): [string, string] => [f.landing!, f.href]),
  ...LANDING_EXTRAS.map((e): [string, string] => [e.phrase, e.href]),
];

/** The phrases for the landing page's "Parallax will ..." sentence, each with the page it links to. */
export const LANDING_MORE: [string, string][] = LANDING_ORDER.map((href) => {
  const hit = landingPhrases.find(([, h]) => h === href);
  if (!hit) throw new Error(`LANDING_ORDER lists ${href}, which has no landing phrase`);
  return hit;
});
if (LANDING_ORDER.length !== landingPhrases.length)
  throw new Error("A landing phrase is missing from LANDING_ORDER in lib/features.ts");
