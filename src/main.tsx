import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Routes, Route } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { ProjectDetail } from "./pages/ProjectDetail";
import { AudioPoolPage } from "./pages/AudioPoolPage";
import { ProjectsProvider } from "./context/ProjectsContext";
import { TablePreferencesProvider } from "./context/TablePreferencesContext";
import "./design-system/tokens/index.css";
import '@fortawesome/fontawesome-free/css/all.min.css';

// The browser's own history-based scroll restoration fights HomePage's manual
// save/restore (sessionStorage-keyed, see HomePage.tsx) on route changes -
// most noticeably in the Tauri webview (WebKit), which is more eager than
// Chromium about auto-resetting scroll on SPA navigation. Manual mode makes
// our own restore the sole authority.
if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

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
