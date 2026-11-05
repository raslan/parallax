import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions, SidebarFooter } from "@/lib/layout.shared";
import { source } from "@/lib/source";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      {...baseOptions()}
      tree={source.getPageTree()}
      sidebar={{ footer: <SidebarFooter /> }}
    >
      {children}
    </DocsLayout>
  );
}
