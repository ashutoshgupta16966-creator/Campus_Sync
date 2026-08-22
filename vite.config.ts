// @lovable.dev/vite-tanstack-config already includes default configurations
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts
    server: { entry: "server" },
  },
  vite: {
    build: {
      rolldownOptions: {
        external: ["is-electron"],
      },
    },
  },
});
