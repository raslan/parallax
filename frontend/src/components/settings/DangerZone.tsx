import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, OctagonAlert, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function DangerZone() {
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);

  const handlePurge = async () => {
    setPurging(true);
    setPurgeError(null);
    try {
      await api.purgeLibraryData();
      setConfirmOpen(false);
      navigate("/libraries");
    } catch {
      setPurgeError("Purge failed — check backend logs.");
    } finally {
      setPurging(false);
    }
  };

  return (
    <>
      <div className="border border-destructive/30 rounded-lg p-5 space-y-3">
        <div className="flex items-center gap-2 text-destructive">
          <OctagonAlert className="h-4 w-4 shrink-0" />
          <p className="text-sm font-semibold">Danger Zone</p>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Purge all library data</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Removes all libraries, file records, thumbnails, and keyframes from Parallax. Settings
              and downloaded AI models are kept. Files on disk are not touched.
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="shrink-0"
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Purge
          </Button>
        </div>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border rounded-lg shadow-xl p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center gap-2 text-destructive">
              <OctagonAlert className="h-5 w-5" />
              <h2 className="font-semibold text-base">Purge all library data?</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              This will permanently delete all library records, file metadata, thumbnails, and
              keyframes from Parallax's database. Your actual media files on disk will not be
              touched. This cannot be undone.
            </p>
            {purgeError && <p className="text-sm text-destructive">{purgeError}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={purging}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handlePurge} disabled={purging}>
                {purging ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Yes, purge everything
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
