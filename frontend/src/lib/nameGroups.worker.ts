import { detectNameGroups } from "./nameGroups";
import type { NameGroupsRequest, NameGroupsResponse } from "./nameGroups";

const ctx = self as unknown as Worker;

ctx.onmessage = (event: MessageEvent<NameGroupsRequest>) => {
  const { requestId, names } = event.data;
  const response: NameGroupsResponse = { requestId, groups: detectNameGroups(names) };
  ctx.postMessage(response);
};
