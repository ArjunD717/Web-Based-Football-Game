// packages/client/vite.config.ts
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, "../..");
const certPath = path.join(repoRoot, "certs", "dev-cert.pem");
const keyPath = path.join(repoRoot, "certs", "dev-key.pem");
const serverPort = process.env.FB_PORT ?? "8443";
const devPort = Number(process.env.FB_CLIENT_PORT ?? "5173");

/**
 * Dev serves the app over HTTPS and proxies WSS to the Node host, so both
 * devices share one trusted origin. Production serves the built client from
 * the Node host itself.
 */
export default defineConfig(({ command, isPreview = false }) => {
  const isServe = command === "serve";
  const needsTls = isServe && !isPreview;
  if (needsTls && (!existsSync(certPath) || !existsSync(keyPath))) {
    throw new Error(
      `Missing mkcert files at ${path.dirname(certPath)}. Run "pnpm certs" first.`,
    );
  }

  const https = needsTls
    ? {
        key: readFileSync(keyPath),
        cert: readFileSync(certPath),
      }
    : null;

  const proxy = needsTls
    ? {
        "/ws": {
          target: `https://127.0.0.1:${serverPort}`,
          ws: true,
          secure: false,
        },
        "/healthz": {
          target: `https://127.0.0.1:${serverPort}`,
          secure: false,
        },
      }
    : undefined;

  return {
    server: {
      host: true,
      port: devPort,
      strictPort: true,
      ...(https === null ? {} : { https }),
      ...(proxy === undefined ? {} : { proxy }),
    },
    preview: {
      host: true,
      port: 4173,
      strictPort: true,
    },
    optimizeDeps: {
      exclude: ["@fb/shared", "@fb/sim"],
    },
    build: {
      target: "es2022",
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: {
          match: path.resolve(packageDir, "index.html"),
          link: path.resolve(packageDir, "link.html"),
          practice: path.resolve(packageDir, "practice.html"),
          controller: path.resolve(packageDir, "controller.html"),
        },
      },
    },
  };
});
