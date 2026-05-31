import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { Libraries } from "@/pages/Libraries";
import { Files } from "@/pages/Files";
import { Jobs } from "@/pages/Jobs";
import { Settings } from "@/pages/Settings";
import { Originals } from "@/pages/Originals";
import { Duplicates } from "@/pages/Duplicates";
import { Cleanup } from "@/pages/Cleanup";
import { Identify } from "@/pages/Identify";
import { Subtitles } from "@/pages/Subtitles";
import { Compress } from "@/pages/Compress";
import { ImageLibraries } from "@/pages/ImageLibraries";
import { Images } from "@/pages/Images";
import { ImageDuplicates } from "@/pages/ImageDuplicates";
import { ContentReview } from "@/pages/ContentReview";
import { ImageQuarantined } from "@/pages/ImageQuarantined";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/libraries" replace />} />
          {/* Video routes */}
          <Route path="/libraries" element={<Libraries />} />
          <Route path="/files" element={<Files />} />
          <Route path="/originals" element={<Originals />} />
          <Route path="/duplicates" element={<Duplicates />} />
          <Route path="/cleanup" element={<Cleanup />} />
          <Route path="/identify" element={<Identify />} />
          <Route path="/subtitles" element={<Subtitles />} />
          <Route path="/compress" element={<Compress />} />
          {/* Image routes */}
          <Route path="/image-libraries" element={<ImageLibraries />} />
          <Route path="/images" element={<Images />} />
          <Route path="/image-duplicates" element={<ImageDuplicates />} />
          <Route path="/content-review" element={<ContentReview />} />
          <Route path="/image-quarantined" element={<ImageQuarantined />} />
          {/* Shared */}
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
