import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SaveButton, type SaveState } from "./SaveButton";

export function TranscodingTab({
  loading,
  maxConcurrent,
  encoderFamily,
  onConcurrentChange,
  save,
}: {
  loading: boolean;
  maxConcurrent: number;
  encoderFamily: string;
  onConcurrentChange: (n: number) => void;
  save: SaveState;
}) {
  return (
    <Card>
      <CardContent className="pt-6 space-y-6">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">Concurrent transcodes</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  How many files to encode in parallel within a compress job. Each session shares
                  the GPU's fixed encode hardware — setting this above the number of encode engines
                  on your card makes each file take proportionally longer with no improvement in
                  total time.
                  {encoderFamily === "nvenc"
                    ? " NVIDIA: RTX 3050/3060 = 1 engine · RTX 3080/3090 = 2 · RTX 4090 = 3."
                    : encoderFamily === "qsv"
                      ? " Intel: UHD 630/730 = 1 engine · UHD 770 / Iris Xe / Arc = 2."
                      : encoderFamily === "amf" || encoderFamily === "vaapi"
                        ? " AMD: RX 6000 series = 1 engine · RX 7000 high-end = 2."
                        : " No hardware encoder detected — using CPU software encoding."}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={maxConcurrent}
                  onChange={(e) => onConcurrentChange(Number(e.target.value))}
                  className="w-48 accent-primary"
                />
                <span className="text-sm font-mono w-4 text-center">{maxConcurrent}</span>
              </div>
              <div className="flex gap-1 flex-wrap">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => onConcurrentChange(n)}
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
            <SaveButton {...save} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
