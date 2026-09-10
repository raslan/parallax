import { clusterAudioDuplicates } from "./clusterAudioDuplicates";
import type { ClusterRequest, ClusterResponse } from "./clusterAudioDuplicates";

const ctx = self as unknown as Worker;

ctx.onmessage = (event: MessageEvent<ClusterRequest>) => {
  const { requestId, files, criteria } = event.data;
  const groups = clusterAudioDuplicates(files, criteria);
  const response: ClusterResponse = { requestId, groups };
  ctx.postMessage(response);
};
