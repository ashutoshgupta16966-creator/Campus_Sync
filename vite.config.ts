// @lovable.dev/vite-tanstack-config already includes default configurations
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts
    server: { entry: "server" },
  },
  vite: {
    // base must be '/' (absolute) for TanStack Start SSR.
    // The Nitro manifest injects /assets/... paths into every SSR-rendered page.
    // Using './' (relative) would break script/stylesheet loading in the browser.
    base: "/",
    build: {
      rolldownOptions: {
        external: ["is-electron"],
      },
    },
  },
});
