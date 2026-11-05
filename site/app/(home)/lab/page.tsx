import "./landing.css";
import type { Metadata } from "next";
import Link from "next/link";
import { LoopVideo } from "@/components/landing/loop-video";
import { Motion, Stars } from "@/components/landing/motion";
import { ZoomImage } from "@/components/landing/zoom-image";
import type { CameraKey } from "@/components/landing/loop-video";
import manifest from "@/lib/media-manifest.json";

type Clip = { id: string; alt: string; width: number; height: number; camera: CameraKey[] };
const clip = (name: string) =>
  manifest[`landing/beats/${name}` as keyof typeof manifest] as unknown as Clip;

// The five features, in the order they appear. Each beat is a real clip of the app with the camera moves the
// capture tool wrote down while filming it. The wording is a placeholder for the copy pass.
const BEATS = [
  {
    id: "organize",
    toc: "Organize your media",
    name: "Organize",
    title: "See what is in a folder before you touch it.",
    text: "Parallax spots the names your files have in common, so one click picks every holiday photo or every voice memo. Then move, rename or delete them in one go.",
    docs: "/docs/tools/organize",
  },
  {
    id: "identify",
    toc: "Identify movies and shows",
    name: "Identify",
    title: "Turn messy file names into ones your media server understands.",
    text: "Pick the folder and the show, and every episode drops into its place. Check the new names, then apply.",
    docs: "/docs/tools/identify",
  },
  {
    id: "cleanup",
    toc: "Search and delete content",
    name: "Cleanup",
    title: "Stack filters until only the files you mean are left.",
    text: "Duration, size, resolution, name, date. Join them with AND or OR, and watch the list narrow as you go.",
    docs: "/docs/features/cleanup",
  },
  {
    id: "duplicates",
    toc: "Find duplicates",
    name: "Duplicates",
    title: "Find the copies and keep the best one.",
    text: "Match on size, length, how it looks or how it sounds. Take a rule away and the groups reshape straight away.",
    docs: "/docs/features/duplicates",
  },
  {
    id: "compress",
    toc: "Compress your media",
    name: "Compress",
    title: "See what you would save before you save it.",
    text: "Slide the quality and the estimated size moves with it, for the whole library or just what you have picked.",
    docs: "/docs/features/compress",
  },
].map((b) => ({ ...b, clip: clip(b.id) }));

// A working prototype of the landing page, not linked from anywhere and kept out of search results.
export const metadata: Metadata = {
  title: "Landing prototype",
  robots: { index: false, follow: false },
};

export default function LandingPrototype() {
  return (
    <div id="lp" className="lp" data-motion="on">
      <a href="#main" className="lp-skip">
        Skip to content
      </a>
      <Stars />
      <Motion rootId="lp" />

      <main id="main" tabIndex={-1}>
        <section className="lp-section lp-hero" aria-labelledby="hero-title">
          <div className="lp-hero-intro">
            <h1 id="hero-title" className="lp-display">
              The Swiss Army knife for <em>your media library.</em>
            </h1>
            <p className="lp-lead">
              Rename it, tidy it, shrink it, weed out the duplicates. Parallax is a free, open
              source toolkit that sits alongside your media player and looks after the files behind
              it.
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
              mobile={{ id: "landing/hero/files-grid-mobile", width: 430, height: 900 }}
              priority
            />
          </div>

          <nav className="lp-toc" aria-labelledby="toc-title">
            <p id="toc-title" className="lp-toc-title">
              Parallax can
            </p>
            <ol>
              {BEATS.map((f) => (
                <li key={f.id}>
                  <a href={`#${f.id}`}>{f.toc}</a>
                </li>
              ))}
            </ol>
          </nav>
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
                id={b.clip.id}
                alt={b.clip.alt}
                width={b.clip.width}
                height={b.clip.height}
                webm
                camera={b.clip.camera}
              />
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
