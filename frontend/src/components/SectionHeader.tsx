export function SectionHeader({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`text-[10px] font-mono font-bold uppercase tracking-[0.12em] ${className}`}
      style={{ color: "var(--px-accent)" }}
    >
      {children}
    </p>
  );
}
