import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useConfirm } from "@/components/ConfirmProvider";
import { qk, statsApi } from "@/lib/api";
import { formatSize } from "@/lib/format";

/**
 * Usage statistics live in their own store, separate from libraries, so removing a
 * library or purging library data never touches them. This is the only place they're cleared.
 */
export function StatsCard() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data } = useQuery({ queryKey: qk.statsSummary(0), queryFn: () => statsApi.summary(0) });

  const clear = useMutation({
    mutationFn: () => statsApi.clear(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.stats() });
      toast.success("Statistics cleared");
    },
  });

  const handleClear = async () => {
    const ok = await confirm({
      title: "Clear statistics?",
      description:
        "This erases your lifetime activity history (space saved, jobs run, and so on). Libraries, files and settings are not affected. This cannot be undone.",
      confirmText: "Clear statistics",
      destructive: true,
    });
    if (ok) clear.mutate();
  };

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-medium">Statistics</p>
        </div>
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Parallax keeps a private, file-agnostic record of what it has done — jobs run, space
            saved — with no filenames, paths or URLs. It survives removing libraries and
            &ldquo;Purge all library data&rdquo;.
            {data && data.jobs > 0 && (
              <>
                {" "}
                Currently {data.jobs.toLocaleString()} job{data.jobs === 1 ? "" : "s"} recorded,{" "}
                {formatSize(Math.max(0, data.bytes_saved))} saved.
              </>
            )}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={clear.isPending || !data || data.jobs === 0}
            onClick={handleClear}
          >
            {clear.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Clear statistics
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
