import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Palette, KeyRound, Cpu, Clapperboard, Download } from "lucide-react";
import { GeneralTab } from "@/components/settings/GeneralTab";
import { TranscodingTab } from "@/components/settings/TranscodingTab";
import { CredentialsTab } from "@/components/settings/CredentialsTab";
import { ModelsTab } from "@/components/settings/ModelsTab";
import { DownloadsTab } from "@/components/settings/DownloadsTab";

const TABS = [
  { id: "general", label: "General", icon: Palette },
  { id: "transcoder", label: "Transcoder", icon: Clapperboard },
  { id: "credentials", label: "Keys & Accounts", icon: KeyRound },
  { id: "ai", label: "AI Models", icon: Cpu },
  { id: "downloads", label: "Downloads", icon: Download },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * Thin tab router. Each tab owns its own `qk.settings()` read, `useForm` +
 * zod schema, and a per-tab Save that PATCHes only its slice of the settings
 * body (see `components/settings/useSettingsForm.ts`).
 */
export function Settings() {
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as TabId | null) ?? "general";
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure Parallax behaviour.</p>
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "general" && <GeneralTab />}
      {activeTab === "transcoder" && <TranscodingTab />}
      {activeTab === "credentials" && <CredentialsTab />}
      {activeTab === "ai" && <ModelsTab />}
      {activeTab === "downloads" && <DownloadsTab />}
    </div>
  );
}
