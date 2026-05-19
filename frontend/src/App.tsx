import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { Libraries } from "@/pages/Libraries";
import { Files } from "@/pages/Files";
import { Jobs } from "@/pages/Jobs";
import { Settings } from "@/pages/Settings";
import { Originals } from "@/pages/Originals";
import { Duplicates } from "@/pages/Duplicates";
import { Cleanup } from "@/pages/Cleanup";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/libraries" replace />} />
          <Route path="/libraries" element={<Libraries />} />
          <Route path="/files" element={<Files />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/originals" element={<Originals />} />
          <Route path="/duplicates" element={<Duplicates />} />
          <Route path="/cleanup" element={<Cleanup />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
