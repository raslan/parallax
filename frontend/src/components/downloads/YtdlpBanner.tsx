import { Link as RouterLink } from "react-router-dom";
import { AlertTriangle, X } from "lucide-react";

export function YtdlpBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/8 px-4 py-3">
      <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
      <p className="text-sm text-amber-200/80 flex-1">
        <span className="font-semibold text-amber-300">yt-dlp is not installed.</span> Go to{" "}
        <RouterLink
          to="/settings?tab=downloads"
          className="underline underline-offset-2 font-medium hover:text-amber-300 transition-colors"
        >
          Settings → Downloads
        </RouterLink>{" "}
        to install it.
      </p>
      <button
        onClick={onDismiss}
        className="text-amber-400/60 hover:text-amber-400 transition-colors shrink-0"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
