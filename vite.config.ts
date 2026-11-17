import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, type ViteDevServer} from 'vite';
import {VitePWA, type ManifestOptions} from 'vite-plugin-pwa';

const PWA_MANIFEST: Partial<ManifestOptions> = {
  id: '/',
  name: 'LedgerPulse Personal Finance Tracker',
  short_name: 'LedgerPulse',
  description:
    'Local-first Windows personal AI finance and spending tracker with local disk storage and automated notification & receipt ingestion.',
  theme_color: '#0f172a',
  background_color: '#020617',
  display: 'standalone',
  display_override: ['window-controls-overlay', 'standalone'],
  orientation: 'any',
  start_url: '/',
  scope: '/',
  icons: [
    {
      src: '/pwa-192x192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/pwa-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/pwa-maskable-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
};

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        useCredentials: true,
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: PWA_MANIFEST,
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /\/api\/merchant-logo\?.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'merchant-logos-cache',
                expiration: {
                  maxEntries: 200,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          // Disabled in dev because vite-plugin-pwa's dev SW relies on HMR WebSocket
          // (import.meta.hot.send), which is disabled in AI Studio preview.
          // Manifest is served directly in dev via the serve plugin below.
          enabled: false,
        },
      }),
      // Serves /manifest.webmanifest in dev without requiring HMR WebSockets, and
      // prevents Vite 8's @vite/client from attempting a failing WebSocket connection
      // ("WebSocket closed without opened." at @vite/client:234:39) when HMR is disabled.
      (() => {
        let hmrDisabled = false;
        return {
          name: 'dev-pwa-manifest-and-hmr-guard',
          apply: 'serve' as const,
          enforce: 'post' as const,
          configResolved(resolvedConfig: {server: {hmr: unknown; ws: unknown}}) {
            hmrDisabled =
              resolvedConfig.server.hmr === false ||
              resolvedConfig.server.ws === false ||
              process.env.DISABLE_HMR === 'true';
          },
          configureServer(server: ViteDevServer) {
            server.middlewares.use('/manifest.webmanifest', (_req, res) => {
              res.setHeader('Content-Type', 'application/manifest+json');
              res.setHeader('Cache-Control', 'no-cache');
              res.end(JSON.stringify(PWA_MANIFEST));
            });
          },
          transformIndexHtml() {
            return [
              {
                tag: 'link',
                attrs: {
                  rel: 'manifest',
                  href: '/manifest.webmanifest',
                  crossorigin: 'use-credentials',
                },
                injectTo: 'head' as const,
              },
            ];
          },
          transform(code: string, id: string) {
            if (hmrDisabled && id.includes('vite/dist/client/client.mjs')) {
              return {
                code: code
                  .replace('console.debug("[vite] connecting...");', '')
                  .replace(
                    'transport.connect(createHMRHandler(handleMessage));',
                    '/* HMR WebSocket disabled in middleware mode */'
                  ),
                map: null,
              };
            }
            return null;
          },
        };
      })(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
