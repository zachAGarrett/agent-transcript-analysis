import { createRoot } from "react-dom/client";
import "./adapters/labeler";
import { TooltipProvider } from "./components/ui/tooltip";
import { Explorer } from "./pages/Explorer";
import "./styles/globals.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root");
createRoot(container).render(
  <TooltipProvider delay={300}>
    <Explorer />
  </TooltipProvider>,
);
