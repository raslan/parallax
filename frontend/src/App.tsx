import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { Dashboard } from "@/pages/Dashboard";
import { Libraries } from "@/pages/Libraries";
import { Files } from "@/pages/Files";
import { Jobs } from "@/pages/Jobs";
import { Settings } from "@/pages/Settings";
import { Originals } from "@/pages/Originals";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/libraries" element={<Libraries />} />
          <Route path="/files" element={<Files />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/originals" element={<Originals />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
