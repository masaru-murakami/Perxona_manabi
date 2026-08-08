import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import App from "./App.tsx";
import { ToastViewport } from "./components/custom/toast-viewport.tsx";
import { getAppEnvironment } from "./lib/env.ts";
import { queryClient } from "./lib/query-client.ts";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Application root element was not found");
}

try {
  getAppEnvironment();
} catch (error) {
  const message =
    error instanceof Error ? error.message : "Invalid app configuration";
  rootElement.textContent = `${message}. Copy .env.example to .env and restart the dev server.`;
  throw error;
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <ToastViewport />
    </QueryClientProvider>
  </StrictMode>,
);
