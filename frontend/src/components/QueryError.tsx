import { AlertCircle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/api/client";

/**
 * Shown when a `useQuery` fails: the server's message plus a Retry that calls the
 * query's `refetch`. Render it where the data would have appeared.
 */
export function QueryError({
  error,
  onRetry,
  title = "Couldn't load this",
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="break-words">{getErrorMessage(error)}</AlertDescription>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry} className="mt-3">
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Retry
        </Button>
      )}
    </Alert>
  );
}
