"use client";

import { useState } from "react";

/**
 * A logo loaded straight from its owner's site. Nothing is copied into this site, and if
 * it fails to load it simply isn't shown.
 */
export function RemoteLogo({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-4 w-auto max-w-40"
    />
  );
}
