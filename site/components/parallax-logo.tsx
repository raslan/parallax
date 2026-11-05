/** The Parallax mark, same drawing as the app's header, coloured by the active theme's accent. */
export function ParallaxLogo({ className }: { className?: string }) {
  const accent = "var(--color-fd-primary)";
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <text x="1" y="16" fontFamily="monospace" fontSize="15" fontWeight="700" fill={accent}>
        P
      </text>
      <circle cx="17" cy="4" r="1.2" fill={accent} />
      <line x1="17" y1="1.3" x2="17" y2="6.7" stroke={accent} strokeWidth="0.7" opacity="0.55" />
      <line x1="14.3" y1="4" x2="19.7" y2="4" stroke={accent} strokeWidth="0.7" opacity="0.55" />
    </svg>
  );
}
