import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import { Palette, KeyRound, Cpu, Clapperboard, Download, Heart } from "lucide-react";
import { GeneralTab } from "@/components/settings/GeneralTab";
import { TranscodingTab } from "@/components/settings/TranscodingTab";
import { CredentialsTab } from "@/components/settings/CredentialsTab";
import { ModelsTab } from "@/components/settings/ModelsTab";
import { DownloadsTab } from "@/components/settings/DownloadsTab";
import { CreditsTab } from "@/components/settings/CreditsTab";
import { PageTitle } from "@/components/PageTitle";

const TABS = [
  { id: "general", label: "General", icon: Palette },
  { id: "transcoder", label: "Transcoder", icon: Clapperboard },
  { id: "credentials", label: "Keys & Accounts", icon: KeyRound },
  { id: "ai", label: "AI Models", icon: Cpu },
  { id: "downloads", label: "Downloads", icon: Download },
  { id: "credits", label: "Credits", icon: Heart },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** `/settings#account`, linked from the header's user menu. */
const ACCOUNT_HASH = "#account";

/**
 * Thin tab router. Each tab owns its own `qk.settings()` read, `useForm` +
 * zod schema, and a per-tab Save that PATCHes only its slice of the settings
 * body (see `components/settings/useSettingsForm.ts`).
 */
export function Settings() {
  const [searchParams] = useSearchParams();
  const { hash } = useLocation();
  const initialTab =
    hash === ACCOUNT_HASH ? "general" : ((searchParams.get("tab") as TabId | null) ?? "general");
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  // The header menu's "Account settings" links to /settings#account: show General and bring the
  // Account card into view. The card appears once the sign-in status has rendered, so look for
  // it for a few frames instead of assuming it is there.
  useEffect(() => {
    if (hash !== ACCOUNT_HASH) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveTab("general");
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let tries = 0;
    let frame = 0;
    const reveal = () => {
      const card = document.getElementById("account");
      if (card) card.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
      else if (++tries < 30) frame = requestAnimationFrame(reveal);
    };
    frame = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(frame);
  }, [hash]);

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <PageTitle>Settings</PageTitle>
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
      {activeTab === "credits" && <CreditsTab />}
    </div>
  );
}
