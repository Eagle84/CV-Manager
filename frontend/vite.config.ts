import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  resolve: {
    alias: {
      shared: path.resolve(__dirname, "../shared/src"),
    },
  },
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ["cvmanager.hopto.org"],
  },
});
