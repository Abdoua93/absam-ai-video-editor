import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Kept separate from the vanilla editor UI served from /public.
  base: "./",
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: "public/studio",
    emptyOutDir: true
  }
});
