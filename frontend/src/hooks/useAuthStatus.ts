import { useQuery } from "@tanstack/react-query";
import { authApi } from "@/lib/api/auth";
import { qk } from "@/lib/api/queryKeys";

/**
 * Who is signed in, from the public `/auth/status`. Always re-read on mount and when the tab
 * regains focus, so a session revoked elsewhere is noticed without a request failing first.
 */
export function useAuthStatus() {
  return useQuery({
    queryKey: qk.auth(),
    queryFn: authApi.status,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
  });
}
