import Link from "next/link";

// Placeholder only. The real landing page is designed and built last, together with the owner.
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-3xl font-bold">Parallax</h1>
      <p className="text-fd-muted-foreground">Site under construction.</p>
      <Link href="/docs" className="text-fd-primary underline underline-offset-4">
        Read the docs
      </Link>
    </main>
  );
}
