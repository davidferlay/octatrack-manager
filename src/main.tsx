import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Routes, Route } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { ProjectDetail } from "./pages/ProjectDetail";
import { AudioPoolPage } from "./pages/AudioPoolPage";
import { ProjectsProvider } from "./context/ProjectsContext";
import { TablePreferencesProvider } from "./context/TablePreferencesContext";
import '@fortawesome/fontawesome-free/css/all.min.css';

// Esc closes the topmost modal by clicking its close button, so each modal's own
// close logic runs. Modals without a close button (e.g. mid-conversion) are unaffected.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const overlays = document.querySelectorAll('.modal-overlay');
  const top = overlays[overlays.length - 1];
  top?.querySelector<HTMLElement>('.modal-close')?.click();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ProjectsProvider>
      <TablePreferencesProvider>
        <HashRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/project" element={<ProjectDetail />} />
            <Route path="/audio-pool" element={<AudioPoolPage />} />
          </Routes>
        </HashRouter>
      </TablePreferencesProvider>
    </ProjectsProvider>
  </React.StrictMode>,
);
