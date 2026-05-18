export function StatPanel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[0.4rem] p-4 ${className}`}
      style={{
        border: "1px solid var(--px-accent-border)",
        background: "var(--px-accent-dim)",
      }}
    >
      {children}
    </div>
  );
}
