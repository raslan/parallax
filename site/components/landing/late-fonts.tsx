"use client";

import { useEffect } from "react";

// The italic cut of the display face (about 125 KB) is only used for the one accent phrase in the headline.
// Until it arrives the browser shows that phrase slanted from the upright cut, then swaps. Loading it after
// the page has finished keeps it from competing with the first screen's image, fonts and scripts.
const ITALIC = `@font-face{font-family:"Playfair Variable";font-style:italic;font-display:swap;font-weight:300 900;src:url(/fonts/playfair-latin-opsz-italic.woff2) format("woff2-variations");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}`;

export function LateFonts() {
  useEffect(() => {
    let timer = 0;
    const add = () => {
      if (document.getElementById("late-fonts")) return;
      const style = document.createElement("style");
      style.id = "late-fonts";
      style.textContent = ITALIC;
      document.head.appendChild(style);
    };
    const later = () => {
      timer = window.setTimeout(add, 150);
    };
    if (document.readyState === "complete") later();
    else window.addEventListener("load", later, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("load", later);
    };
  }, []);
  return null;
}
