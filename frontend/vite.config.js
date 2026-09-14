// defineConfig: just a helper that gives you autocomplete/type-checking for the config
// object below — purely a developer-experience nicety, has no effect on the build itself.
import { defineConfig } from "vite";
// The official Vite plugin that teaches Vite how to handle React's JSX syntax and enables
// React's "fast refresh" (instant component updates in the browser without a full page
// reload while you're developing) — the Vite equivalent of what react-scripts did for you
// automatically under the hood.
import react from "@vitejs/plugin-react";
// transformWithEsbuild: Vite's own re-export of esbuild's code-transform function — this is
// what actually turns JSX syntax into plain JavaScript the browser can run. Used below to
// build a small custom plugin, since Vite's built-in settings alone don't cover every part
// of the build pipeline for this specific situation (explained in the plugin below).
import { transformWithEsbuild } from "vite";

export default defineConfig({
    plugins: [
        // ── Custom plugin: treat .js files under src/ as if they were .jsx ──
        // Vite's hard rule is: JSX syntax (the `<Login />`-style tags mixed into JS) is
        // only allowed in files ending in `.jsx` or `.tsx`. This project's existing files
        // all use plain `.js`, even the ones full of JSX — perfectly normal under Create
        // React App's older tooling, but Vite's production build (which uses Rollup, a
        // different tool than the dev server) refuses to even READ such a file, failing
        // with "Failed to parse source for import analysis" before it gets anywhere near
        // actually transforming the JSX.
        //
        // RENAMING all 18+ affected files to `.jsx` would fix this too, but means editing
        // every import statement across the whole codebase that references them by their
        // old `.js` name — a much bigger, riskier change for zero real benefit. Instead,
        // this plugin intercepts every `.js` file under src/ BEFORE Rollup's own analysis
        // sees it, and runs it through esbuild with `loader: "jsx"` manually — same result,
        // zero files renamed, zero imports touched.
        {
            name: "load-js-files-as-jsx",
            async transform(code, id) {
                if (!id.match(/\/src\/.*\.js$/)) return null; // only touch our own .js source files, not library code in node_modules
                // jsx: "automatic" is the fix for a real bug this project hit: without it,
                // esbuild defaults to the OLDER "classic" JSX transform, which compiles
                // `<Login />` into `React.createElement(...)` calls and requires every
                // single file to explicitly `import React from "react"` at the top. This
                // codebase (correctly, under modern conventions) mostly doesn't do that —
                // e.g. a file might only `import { useState } from "react"` — which is
                // perfectly fine under the "automatic" runtime (the modern default since
                // React 17, and what @vitejs/plugin-react's own transform already uses for
                // .jsx files), but caused "Uncaught ReferenceError: React is not defined"
                // in the browser under the classic runtime. This one option keeps this
                // custom .js-handling plugin consistent with how @vitejs/plugin-react
                // already treats .jsx files, instead of silently using an older, stricter
                // convention just for this one code path.
                return transformWithEsbuild(code, id, { loader: "jsx", jsx: "automatic" });
            }
        },
        react()
    ],

    // This section covers a SEPARATE part of Vite (its dependency pre-bundling step, used
    // by `npm run dev` while warming up its cache) that the plugin above doesn't reach —
    // without this, `npm run dev` specifically could still trip over the same issue even
    // though `npm run build` (covered by the plugin above) now works correctly.
    optimizeDeps: {
        esbuildOptions: {
            loader: { ".js": "jsx" }
        }
    }
});
