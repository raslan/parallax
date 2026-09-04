import { clusterDuplicates } from "./clusterDuplicates";
import type { ClusterRequest, ClusterResponse } from "./clusterDuplicates";

const ctx = self as unknown as Worker;

ctx.onmessage = (event: MessageEvent<ClusterRequest>) => {
  const { requestId, files, criteria } = event.data;
  const groups = clusterDuplicates(files, criteria);
  const response: ClusterResponse = { requestId, groups };
  ctx.postMessage(response);
};
