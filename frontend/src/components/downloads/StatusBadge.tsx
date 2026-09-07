import { DownloadStatusBadge } from "@/components/downloads-common/DownloadStatusBadge";
import type { DownloadItem } from "@/types/download";

export function StatusBadge({ status }: { status: DownloadItem["status"] }) {
  return <DownloadStatusBadge status={status} />;
}
