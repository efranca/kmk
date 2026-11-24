import "@fontsource/inter/latin-400.css";
import "@fontsource/montserrat/latin-600.css";
import "@fontsource/montserrat/latin-700.css";
import "./index.css";
import "./ui/ui.css";
import "./app/layout.css";
import "./schedule/schedule.css";
import "./dashboard/dashboard.css";
import "./tasks/tasks.css";
import "./i18n";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
