import { lazy, Suspense, type ComponentType } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { Layout } from "@/components/layout/Layout";

// Pages are named exports, so adapt each to the `default` shape React.lazy wants.
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(async () => ({ default: (await load())[name] }));
}

const Libraries = page(() => import("@/pages/Libraries"), "Libraries");
const Files = page(() => import("@/pages/Files"), "Files");
const Jobs = page(() => import("@/pages/Jobs"), "Jobs");
const Settings = page(() => import("@/pages/Settings"), "Settings");
const Originals = page(() => import("@/pages/Originals"), "Originals");
const Duplicates = page(() => import("@/pages/Duplicates"), "Duplicates");
const Cleanup = page(() => import("@/pages/Cleanup"), "Cleanup");
const Identify = page(() => import("@/pages/Identify"), "Identify");
const Subtitles = page(() => import("@/pages/Subtitles"), "Subtitles");
const Downloads = page(() => import("@/pages/Downloads"), "Downloads");
const Galleries = page(() => import("@/pages/Galleries"), "Galleries");
const Compress = page(() => import("@/pages/Compress"), "Compress");
const Toolbox = page(() => import("@/pages/Toolbox"), "Toolbox");
const Splice = page(() => import("@/pages/Splice"), "Splice");
const ImageLibraries = page(() => import("@/pages/ImageLibraries"), "ImageLibraries");
const Images = page(() => import("@/pages/Images"), "Images");
const ImageDuplicates = page(() => import("@/pages/ImageDuplicates"), "ImageDuplicates");
const ContentReview = page(() => import("@/pages/ContentReview"), "ContentReview");
const ImageQuarantined = page(() => import("@/pages/ImageQuarantined"), "ImageQuarantined");
const AudioLibraries = page(() => import("@/pages/AudioLibraries"), "AudioLibraries");
const AudioFiles = page(() => import("@/pages/AudioFiles"), "AudioFiles");
const AudioDuplicates = page(() => import("@/pages/AudioDuplicates"), "AudioDuplicates");
const AudioCleanup = page(() => import("@/pages/AudioCleanup"), "AudioCleanup");
const AudioCompress = page(() => import("@/pages/AudioCompress"), "AudioCompress");
const AudioToolbox = page(() => import("@/pages/AudioToolbox"), "AudioToolbox");
const AudioOriginals = page(() => import("@/pages/AudioOriginals"), "AudioOriginals");

// Dev-only: keeps the devtools bundle out of the production build entirely.
const Devtools = import.meta.env.DEV
  ? lazy(async () => ({
      default: (await import("@tanstack/react-query-devtools")).ReactQueryDevtools,
    }))
  : null;

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ConfirmProvider>
          <Toaster />
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Navigate to="/libraries" replace />} />
              {/* Video routes */}
              <Route path="/libraries" element={<Libraries />} />
              <Route path="/files" element={<Files />} />
              <Route path="/originals" element={<Originals />} />
              <Route path="/duplicates" element={<Duplicates />} />
              <Route path="/cleanup" element={<Cleanup />} />
              {/* Tools */}
              <Route path="/identify" element={<Identify />} />
              <Route path="/subtitles" element={<Subtitles />} />
              <Route path="/downloads" element={<Downloads />} />
              <Route path="/galleries" element={<Galleries />} />
              <Route path="/compress" element={<Compress />} />
              <Route path="/toolbox" element={<Toolbox />} />
              <Route path="/splice" element={<Splice />} />
              {/* Image routes */}
              <Route path="/image-libraries" element={<ImageLibraries />} />
              <Route path="/images" element={<Images />} />
              <Route path="/image-duplicates" element={<ImageDuplicates />} />
              <Route path="/content-review" element={<ContentReview />} />
              <Route path="/image-quarantined" element={<ImageQuarantined />} />
              {/* Audio routes */}
              <Route path="/audio-libraries" element={<AudioLibraries />} />
              <Route path="/audio-files" element={<AudioFiles />} />
              <Route path="/audio-duplicates" element={<AudioDuplicates />} />
              <Route path="/audio-compress" element={<AudioCompress />} />
              <Route path="/audio-cleanup" element={<AudioCleanup />} />
              <Route path="/audio-toolbox" element={<AudioToolbox />} />
              <Route path="/audio-originals" element={<AudioOriginals />} />
              {/* Shared */}
              <Route path="/jobs" element={<Jobs />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Routes>
        </ConfirmProvider>
      </BrowserRouter>
      {Devtools && (
        <Suspense fallback={null}>
          <Devtools initialIsOpen={false} />
        </Suspense>
      )}
    </QueryClientProvider>
  );
}
