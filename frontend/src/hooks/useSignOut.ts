import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi, type AuthStatus } from "@/lib/api/auth";
import { qk } from "@/lib/api/queryKeys";

/**
 * Sign this browser out (`everywhere: false`) or every browser (`true`). Either way, whatever
 * this session had loaded is dropped from the cache and the auth status is set to "signed
 * out" at once, so `AuthGate` shows the login page without waiting for a round trip.
 */
export function useSignOut(everywhere = false) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: everywhere ? authApi.logoutAll : authApi.logout,
    onSuccess: () => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== qk.auth()[0] });
      qc.setQueryData<AuthStatus>(qk.auth(), (s) =>
        s ? { ...s, authenticated: false, username: null } : s,
      );
    },
  });
}
