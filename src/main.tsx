import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Routes, Route } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { ProjectDetail } from "./pages/ProjectDetail";
import { ProjectsProvider } from "./context/ProjectsContext";
import { TablePreferencesProvider } from "./context/TablePreferencesContext";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ProjectsProvider>
      <TablePreferencesProvider>
        <HashRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/project" element={<ProjectDetail />} />
          </Routes>
        </HashRouter>
      </TablePreferencesProvider>
    </ProjectsProvider>
  </React.StrictMode>,
);
