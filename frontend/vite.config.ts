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
    allowedHosts: ["df8e-87-71-162-43.ngrok-free.app"],
  },
});
