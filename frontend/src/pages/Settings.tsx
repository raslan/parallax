import { Settings as SettingsIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function Settings() {
  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure encoder preferences, presets, and schedules.
        </p>
      </div>

      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <SettingsIcon className="h-10 w-10 text-muted-foreground mb-4" />
          <h3 className="font-semibold text-lg mb-1">Settings</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Coming in Phase 4 — encoder selection, quality presets, backup folder, and scheduling.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
