import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Unable to find the web application root element.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);

