import { Suspense, useState } from "react";
import { Outlet } from "react-router-dom";
import { PageSkeleton } from "@/components/Skeletons";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { BottomBar } from "./BottomBar";
import { SectionSheet } from "./SectionSheet";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import type { SectionId } from "./nav-config";

export function Layout() {
  const [sheetSection, setSheetSection] = useState<SectionId | null>(null);
  useDocumentTitle();

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar className="hidden md:flex" />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-y-auto pb-16 outline-none md:pb-0"
        >
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <BottomBar onOpenSection={setSheetSection} />
      <SectionSheet
        sectionId={sheetSection}
        open={sheetSection !== null}
        onOpenChange={(v) => {
          if (!v) setSheetSection(null);
        }}
      />
    </div>
  );
}
