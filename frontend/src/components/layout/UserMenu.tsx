import { Link } from "react-router";
import { LogOut, UserRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthStatus } from "@/hooks/useAuthStatus";
import { useSignOut } from "@/hooks/useSignOut";

/** Who is signed in, and Sign out. Not shown when the server runs with authentication off. */
export function UserMenu() {
  const { data } = useAuthStatus();
  const signOut = useSignOut();
  if (!data?.enabled || !data.authenticated) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[hsl(var(--sidebar-accent))] hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
      >
        <UserRound className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <div className="px-2 py-1.5 text-sm">
          <p className="text-xs text-muted-foreground">Signed in as</p>
          <p className="truncate font-medium" title={data.username ?? undefined}>
            {data.username}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings">Account settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => signOut.mutate()}>
          <LogOut className="mr-2 h-3.5 w-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
