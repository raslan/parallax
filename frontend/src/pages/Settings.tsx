import { useEffect, useState } from "react";
import { Settings as SettingsIcon, Loader2, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export function Settings() {
  const [maxConcurrent, setMaxConcurrent] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.getSettings()
      .then((s) => setMaxConcurrent(s.max_concurrent_transcodes))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (n: number) => {
    setMaxConcurrent(n);
    setDirty(true);
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateSettings({ max_concurrent_transcodes: maxConcurrent });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure transcoder behaviour.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <SettingsIcon className="h-4 w-4" />
            Transcoder
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Concurrent transcodes</label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    How many files to transcode in parallel. Higher values use more CPU/GPU but finish queues faster.
                    Changes apply to jobs that haven't started yet.
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min={1}
                    max={8}
                    value={maxConcurrent}
                    onChange={(e) => handleChange(Number(e.target.value))}
                    className="w-48 accent-primary"
                  />
                  <span className="text-sm font-mono w-4 text-center">{maxConcurrent}</span>
                </div>
                <div className="flex gap-1 flex-wrap">
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      onClick={() => handleChange(n)}
                      className={`px-3 py-1 rounded text-xs border transition-colors ${
                        maxConcurrent === n
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border hover:bg-accent"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <Button onClick={handleSave} disabled={saving || !dirty} size="sm">
                {saving && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
                {saved && <Check className="h-3.5 w-3.5 mr-2 text-green-400" />}
                {saved ? "Saved" : "Save"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
