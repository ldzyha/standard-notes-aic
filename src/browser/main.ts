import "../styles.css";
import "../core/icons.css";
import "../core/mermaid-viewport.css";
import "../core/slash-snippets.css";
import "../core/preview-layout.css";
import "../core/diagram-builder.css";
import "../core/diagram-palette.css";
import "../core/diagram-session.css";
import "../core/security-block.css";
import "../core/security-import-extension.css";
import "./panel.css";
import { getBrowserApi } from "./api";
import { BrowserPanel } from "./panel";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("AIC browser panel root is missing.");
try {
  new BrowserPanel(root, getBrowserApi());
} catch {
  root.textContent =
    "Open AIC from the browser extension toolbar. This browser must support secure session storage and a side panel.";
}
