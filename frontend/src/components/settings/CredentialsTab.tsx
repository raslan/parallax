import { Loader2 } from "lucide-react";
import { COMMON_LANGS } from "@/lib/subtitle-langs";
import { Card, CardContent } from "@/components/ui/card";
import { SaveButton, type SaveState } from "./SaveButton";

export function CredentialsTab({
  loading,
  tmdbKey,
  onTmdbKeyChange,
  subtitleLangs,
  onToggleLang,
  save,
}: {
  loading: boolean;
  tmdbKey: string;
  onTmdbKeyChange: (v: string) => void;
  subtitleLangs: string[];
  onToggleLang: (code: string) => void;
  save: SaveState;
}) {
  return (
    <div className="space-y-4">
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div>
                <p className="text-sm font-medium">TMDB API key</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Required for Identify & Rename. Free key at{" "}
                  <a
                    href="https://www.themoviedb.org/settings/api"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    themoviedb.org
                  </a>
                  .
                </p>
              </div>
              <input
                type="password"
                value={tmdbKey}
                onChange={(e) => onTmdbKeyChange(e.target.value)}
                placeholder="Paste your TMDB API key…"
                className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Default subtitle languages
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {COMMON_LANGS.map(({ code, label }) => {
                    const active = subtitleLangs.includes(code);
                    return (
                      <button
                        key={code}
                        onClick={() => onToggleLang(code)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors border ${
                          active
                            ? "bg-primary/15 border-primary/40 text-primary"
                            : "bg-transparent border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          <SaveButton {...save} />
        </>
      )}
    </div>
  );
}
