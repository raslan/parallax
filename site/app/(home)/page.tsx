import "./landing.css";
import type { Metadata } from "next";
import Link from "next/link";
import { LateFonts } from "@/components/landing/late-fonts";
import { LoopVideo } from "@/components/landing/loop-video";
import { Motion, Stars } from "@/components/landing/motion";
import { ThemeDots } from "@/components/landing/theme-dots";
import { ZoomImage } from "@/components/landing/zoom-image";
import type { CameraKey, ClipTake } from "@/components/landing/loop-video";
import { LANDING_MORE } from "@/lib/features";
import { pageMetadata } from "@/lib/seo";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site-url";
import { themedId } from "@/lib/theme-assets";
import { DEFAULT_THEME, THEMES } from "@/lib/themes.generated";
import manifest from "@/lib/media-manifest.json";

type Take = {
  id: string;
  alt: string;
  width: number;
  height: number;
  camera: CameraKey[];
};
const take = (id: string) => manifest[id as keyof typeof manifest] as unknown as Take | undefined;

// A clip is filmed once per theme (see the capture tool's `themes`); a theme without its own take falls back
// to the default look.
function clip(name: string) {
  const base = take(themedId(`landing/beats/${name}`, DEFAULT_THEME))!;
  const takes: Record<string, ClipTake> = {};
  for (const t of THEMES) {
    const m = take(themedId(`landing/beats/${name}`, t.id));
    if (m) takes[t.id] = { id: m.id, camera: m.camera };
  }
  return { alt: base.alt, width: base.width, height: base.height, takes };
}

// Everything else, as short phrases that each link to their page in the docs. They come from the same list as
// the docs home page (lib/features.ts), so the two cannot drift apart.
const MORE = LANDING_MORE;

// The five features, in the order they appear. Each beat is a real clip of the app with the camera moves the
// capture tool wrote down while filming it. The wording is a placeholder for the copy pass.
const BEATS = [
  {
    id: "organize",
    name: "Organize",
    title: "See what is in a folder before you touch it.",
    text: "Parallax spots the names your files have in common, so one click selects every holiday photo or voice memo. Then move, rename or delete them together.",
    docs: "/docs/tools/organize",
  },
  {
    id: "identify",
    name: "Identify",
    title: "Turn messy file names into ones your media server understands.",
    text: "Pick the folder and the show, and every episode drops into its place. Check the new names, then apply.",
    docs: "/docs/tools/identify",
  },
  {
    id: "cleanup",
    name: "Cleanup",
    title: "Stack filters until only the files you mean are left.",
    text: "Duration, size, resolution, name, date. Join them with AND or OR, and watch the list narrow as you go.",
    docs: "/docs/features/cleanup",
  },
  {
    id: "duplicates",
    name: "Duplicates",
    title: "Find the copies and keep the best one.",
    text: "Match on size, length, how it looks or how it sounds. Take a rule away and the groups reshape straight away.",
    docs: "/docs/features/duplicates",
  },
  {
    id: "compress",
    name: "Compress",
    title: "See what you would save before you save it.",
    text: "Slide the quality and the estimated size moves with it, for the whole library or just what you have picked. Files get much smaller with no quality loss you would notice.",
    docs: "/docs/features/compress",
  },
].map((b) => ({ ...b, clip: clip(b.id) }));

export const metadata: Metadata = pageMetadata({
  title: { absolute: "Parallax: free, open source tools for your media library" },
  description: SITE_DESCRIPTION,
  path: "/",
});

// Tells search engines what this is: a free, open source app. (Plain data, no tracking.)
const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  description: SITE_DESCRIPTION,
  url: SITE_URL,
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Docker (Linux, macOS, Windows)",
  isAccessibleForFree: true,
  license: "https://www.gnu.org/licenses/gpl-3.0.html",
  codeRepository: "https://github.com/raslan/parallax",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

export default function LandingPage() {
  return (
    <div id="lp" className="lp" data-motion="on">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <a href="#main" className="lp-skip">
        Skip to content
      </a>
      <Stars />
      <LateFonts />
      <Motion rootId="lp" />

      {/* The site's layout already supplies the <main> landmark around the page. */}
      <div id="main" tabIndex={-1}>
        <section className="lp-section lp-hero" aria-labelledby="hero-title">
          <div className="lp-hero-intro">
            <h1 id="hero-title" className="lp-display">
              The Swiss Army knife for <em>your media library.</em>
            </h1>
            <p className="lp-verbs">
              <a href="#organize" className="lp-inline">
                Organize it
                <sup aria-hidden="true">01</sup>
              </a>
              ,{" "}
              <a href="#identify" className="lp-inline">
                identify it
                <sup aria-hidden="true">02</sup>
              </a>
              ,{" "}
              <a href="#cleanup" className="lp-inline">
                filter it
                <sup aria-hidden="true">03</sup>
              </a>
              ,{" "}
              <a href="#duplicates" className="lp-inline">
                weed out the duplicates
                <sup aria-hidden="true">04</sup>
              </a>
              ,{" "}
              <a href="#compress" className="lp-inline">
                compress it
                <sup aria-hidden="true">05</sup>
              </a>
              .
            </p>
            <p className="lp-lead">
              Parallax is a free, open source toolkit that sits alongside your media player and
              looks after the files behind it.
            </p>
            <div className="lp-actions">
              <Link href="/docs" className="lp-cta">
                <span className="lp-cta-label">Get started</span>
                <svg className="lp-cta-arrow" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 12h15M13 5.5 19.5 12 13 18.5" />
                </svg>
              </Link>
              <a href="https://github.com/raslan/parallax" className="lp-link">
                GitHub
                <svg className="lp-link-arrow" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 17 17 7M8.5 7H17v8.5" />
                </svg>
              </a>
            </div>
          </div>

          <div className="lp-hero-shot">
            <ZoomImage
              id="landing/hero/files-grid"
              alt="The Parallax Files page: a grid of video thumbnails with codec, size and duration under each."
              width={1440}
              height={690}
              variants={[720, 1080]}
              sizes="(min-width: 1024px) 60vw, 100vw"
              mobile={{
                id: "landing/hero/files-grid-mobile",
                width: 430,
                height: 900,
              }}
              priority
            />
          </div>
        </section>

        <section className="lp-pick" aria-labelledby="pick-title">
          <h2 id="pick-title" className="lp-pick-title" data-reveal>
            Pick your look
          </h2>
          <p className="lp-pick-note" data-reveal="late">
            Choose a colour and this page changes with it, including the previews of the app below.
          </p>
          <div data-reveal="late">
            <ThemeDots />
          </div>
        </section>

        {BEATS.map((b, i) => (
          <section
            key={b.id}
            id={b.id}
            tabIndex={-1}
            className={`lp-section lp-beat${i % 2 ? " lp-beat--flip" : ""}`}
            aria-labelledby={`${b.id}-title`}
          >
            <div className="lp-beat-copy" data-reveal>
              <p className="lp-beat-no" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </p>
              <h2 id={`${b.id}-title`} className="lp-display">
                {b.title}
              </h2>
              <p>{b.text}</p>
              <Link href={b.docs} className="lp-link lp-more">
                Read about {b.name}
                <span className="sr-only"> in the documentation</span>
                <svg className="lp-link-arrow" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 12h15M13 5.5 19.5 12 13 18.5" />
                </svg>
              </Link>
            </div>
            <div data-reveal="late" data-parallax="0.04">
              <LoopVideo
                alt={b.clip.alt}
                width={b.clip.width}
                height={b.clip.height}
                takes={b.clip.takes}
              />
            </div>
          </section>
        ))}

        <section className="lp-section lp-more-section" aria-labelledby="more-title">
          <h2 id="more-title" className="lp-display" data-reveal>
            What else can it do?
          </h2>
          <p className="lp-verbs lp-more-links" data-reveal="late">
            Parallax will{" "}
            {MORE.map(([text, href], i) => (
              <span key={href}>
                {i === MORE.length - 1 ? "and " : ""}
                <Link href={href} className="lp-inline">
                  {text}
                </Link>
                {i === MORE.length - 1 ? "." : ", "}
              </span>
            ))}
          </p>
          <div className="lp-actions" data-reveal="late">
            <Link href="/docs" className="lp-cta">
              <span className="lp-cta-label">And more...</span>
              <svg className="lp-cta-arrow" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 12h15M13 5.5 19.5 12 13 18.5" />
              </svg>
            </Link>
          </div>
        </section>
      </div>

      <footer className="lp-footer">
        <nav aria-label="Footer">
          <Link href="/docs" className="lp-footer-link">
            Documentation
          </Link>
          <Link href="/docs/api" className="lp-footer-link">
            API reference
          </Link>
          <Link href="/docs/getting-started/changelog" className="lp-footer-link">
            Changelog
          </Link>
          <Link href="/docs/acknowledgements" className="lp-footer-link">
            Acknowledgements
          </Link>
          <a href="https://github.com/raslan/parallax" className="lp-footer-link">
            GitHub
          </a>
          <a href="https://raslan.dev" className="lp-footer-link">
            Built with love by raslan
          </a>
        </nav>
        <p>Parallax is free and open source, released under the GPL-3.0.</p>
      </footer>
    </div>
  );
}
