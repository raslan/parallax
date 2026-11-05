import "./landing.css";
import type { Metadata } from "next";
import Link from "next/link";
import { LoopVideo } from "@/components/landing/loop-video";
import { Motion, Stars } from "@/components/landing/motion";
import { ZoomImage } from "@/components/landing/zoom-image";

// A working prototype of the landing page, not linked from anywhere and kept out of search results.
export const metadata: Metadata = {
  title: "Landing prototype",
  robots: { index: false, follow: false },
};

const FEATURES = [
  { id: "organize", name: "Organize" },
  { id: "identify", name: "Identify" },
  { id: "cleanup", name: "Cleanup" },
  { id: "duplicates", name: "Duplicates" },
  { id: "compress", name: "Compress" },
];

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
          <div className="lp-hero-copy">
            <h1 id="hero-title" className="lp-display">
              Your whole media library, <em>in one place.</em>
            </h1>
            <p className="lp-lead">
              Parallax is a free, open source manager for the videos, pictures and music on your own
              machine.
            </p>
            <div className="lp-actions">
              <Link href="/docs" className="lp-button lp-button--primary">
                Get started
              </Link>
              <a href="https://github.com/raslan/parallax" className="lp-button">
                GitHub
              </a>
            </div>

            <nav className="lp-toc" aria-labelledby="toc-title">
              <p id="toc-title" className="lp-toc-title">
                Parallax can
              </p>
              <ol>
                {FEATURES.map((f) => (
                  <li key={f.id}>
                    <a href={`#${f.id}`}>{f.name}</a>
                  </li>
                ))}
              </ol>
            </nav>
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
        </section>

        {/* Placeholder beat: the real Cleanup clip stands in until each feature has its own capture. */}
        <section
          id="cleanup"
          tabIndex={-1}
          className="lp-section lp-beat"
          aria-labelledby="cleanup-title"
        >
          <div className="lp-beat-copy" data-reveal>
            <p className="lp-beat-no" aria-hidden="true">
              03
            </p>
            <h2 id="cleanup-title" className="lp-display">
              Stack filters until only the files you mean are left.
            </h2>
            <p>
              Duration, size, resolution, name, date. Add as many as you like and the list narrows
              as you go.
            </p>
            <Link href="/docs/features/cleanup" className="lp-more">
              Read about Cleanup
              <span className="sr-only"> in the documentation</span>
            </Link>
          </div>
          <div data-reveal="late" data-parallax="0.04">
            <LoopVideo
              id="features/cleanup/duration-filter"
              alt="Adding a duration filter on the Cleanup page narrows thirteen files down to the short ones."
              width={960}
              height={510}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
