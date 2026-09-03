import { MutationCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/api/client";

export const queryClient = new QueryClient({
  // Any mutation that doesn't set its own `onError` surfaces failures as a
  // toast — replaces the per-page `try/catch -> setError` boilerplate. A
  // mutation can still pass `onError` to handle the error inline instead;
  // both run, so opt out of the toast there with `meta: { skipErrorToast: true }`.
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) => {
      if (mutation.meta?.skipErrorToast) return;
      toast.error(getErrorMessage(err));
    },
  }),
  defaultOptions: {
    queries: {
      // Self-hosted single-user app on localhost — refetch churn buys nothing.
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
