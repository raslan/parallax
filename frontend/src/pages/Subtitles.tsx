import { Captions } from "lucide-react";

export function Subtitles() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <Captions className="h-10 w-10 text-muted-foreground/40" />
      <h2 className="text-lg font-semibold">Subtitles</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        Automatically download and match subtitle files for your video libraries.
        Coming soon.
      </p>
    </div>
  );
}
