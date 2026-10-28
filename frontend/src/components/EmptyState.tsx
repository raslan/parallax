import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { Library } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The app's one empty state: dashed card, centred icon, heading, muted
 * description and an optional primary action. `size="sm"` is the compact
 * variant for a nested panel (e.g. an empty folder inside a browser).
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = "default",
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  size?: "default" | "sm";
}) {
  const sm = size === "sm";
  return (
    <Card className="border-dashed">
      <CardContent
        className={cn(
          "flex flex-col items-center justify-center text-center",
          sm ? "py-12" : "py-16",
        )}
      >
        <Icon className={cn("text-muted-foreground", sm ? "mb-3 h-8 w-8" : "mb-4 h-10 w-10")} />
        <h3 className={cn("font-semibold", sm ? "text-base" : "mb-1 text-lg")}>{title}</h3>
        {description && (
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
        )}
        {action && <div className="mt-4">{action}</div>}
      </CardContent>
    </Card>
  );
}

const LIBRARY_ROUTE = {
  video: "/libraries",
  image: "/image-libraries",
  audio: "/audio-libraries",
} as const;

/** "No libraries yet" with a button straight to the matching Libraries page. */
export function NoLibrariesState({ kind }: { kind: keyof typeof LIBRARY_ROUTE }) {
  return (
    <EmptyState
      icon={Library}
      title={`No ${kind} libraries yet`}
      description={`Add a ${kind} library to get started.`}
      action={
        <Button asChild size="sm">
          <Link to={LIBRARY_ROUTE[kind]}>Add a library</Link>
        </Button>
      }
    />
  );
}
