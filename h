warning: in the working copy of 'Campus Sync/src/routeTree.gen.ts', LF will be replaced by CRLF the next time Git touches it
[1mdiff --git a/Campus Sync/package.json b/Campus Sync/package.json[m
[1mindex 797eeab..b4c9d44 100644[m
[1m--- a/Campus Sync/package.json[m	
[1m+++ b/Campus Sync/package.json[m	
[36m@@ -5,7 +5,8 @@[m
   "type": "module",[m
   "scripts": {[m
     "dev": "vite dev",[m
[31m-    "build": "vite build",[m
[32m+[m[32m    "build": "vite build && node scripts/build-dist.js",[m
[32m+[m[32m    "postbuild": "node scripts/build-dist.js",[m
     "build:dev": "vite build --mode development",[m
     "preview": "vite preview",[m
     "lint": "eslint .",[m
[1mdiff --git a/Campus Sync/vite.config.ts b/Campus Sync/vite.config.ts[m
[1mindex 174e074..5396f91 100644[m
[1m--- a/Campus Sync/vite.config.ts[m	
[1m+++ b/Campus Sync/vite.config.ts[m	
[36m@@ -12,4 +12,12 @@[m [mexport default defineConfig({[m
     // nitro/vite builds from this[m
     server: { entry: "server" },[m
   },[m
[32m+[m[32m  vite: {[m
[32m+[m[32m    base: "/",[m
[32m+[m[32m    build: {[m
[32m+[m[32m      rolldownOptions: {[m
[32m+[m[32m        external: ["is-electron"],[m
[32m+[m[32m      },[m
[32m+[m[32m    },[m
[32m+[m[32m  },[m
 });[m
