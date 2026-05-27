import { useEffect } from "react";
import { X } from "lucide-react";
import { imageApi, ImageFile } from "@/lib/api";
import { formatSize } from "@/lib/format";

export function ImageViewerModal({ img, onClose }: { img: ImageFile; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/80" />
      <div
        className="relative z-10 max-w-5xl w-full px-4 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-white text-sm font-medium truncate pr-4" title={img.path}>
            {img.filename}
          </p>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white transition-colors shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <img
          src={imageApi.fullUrl(img.id)}
          alt={img.filename}
          className="max-h-[80vh] w-auto mx-auto rounded-lg object-contain"
        />
        <p className="text-white/50 text-xs text-center">
          {img.width && img.height ? `${img.width}×${img.height} · ` : ""}
          {formatSize(img.size)} · {img.path}
        </p>
      </div>
    </div>
  );
}
