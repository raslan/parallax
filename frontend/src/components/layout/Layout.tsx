import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { BottomBar } from "./BottomBar";
import { SectionSheet } from "./SectionSheet";
import type { SectionId } from "./nav-config";

export function Layout() {
  const [sheetSection, setSheetSection] = useState<SectionId | null>(null);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar className="hidden md:flex" />
        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
          <Outlet />
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
