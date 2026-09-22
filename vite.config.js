import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [react()],
  root: fileURLToPath(new URL("./src", import.meta.url)),
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    cors: false,
    headers: { "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff" },
    fs: {
      strict: true,
      allow: ["./src", "./node_modules"].map((p) =>
        fileURLToPath(new URL(p, import.meta.url)),
      ),
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem,key,p12,pfx,cer,der}",
        ".npmrc",
        ".yarnrc.yml",
        "**/.git/**",
        "**/.private/**",
        "**/*.sqlite",
        "**/*.sqlite-*",
      ],
    },
  },
});
