import { useEffect, useState } from "react";
import { X } from "lucide-react";

export function CookiesModal({
  open,
  value,
  onApply,
  onClear,
  onClose,
}: {
  open: boolean;
  value: string;
  onApply: (text: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setDraft(value);
  }, [open, value]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-xl p-5 w-full max-w-lg mx-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Paste cookies</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Paste cookies in Netscape format (exported via a browser extension like "Get
          cookies.txt"). Active for this session only — navigating away clears them.
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={"# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t..."}
          rows={8}
          className="w-full rounded border border-input bg-muted/30 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring resize-none placeholder:text-muted-foreground/30"
        />
        <div className="flex gap-2 justify-end">
          {value && (
            <button
              onClick={() => {
                onClear();
                setDraft("");
                onClose();
              }}
              className="px-3 py-1.5 text-xs text-destructive border border-destructive/30 rounded hover:bg-destructive/10 transition-colors"
            >
              Clear cookies
            </button>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs border border-border rounded hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onApply(draft.trim());
              onClose();
            }}
            className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
