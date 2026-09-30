import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: '127.0.0.1',
  },
  base: './',
  build: {
    rolldownOptions: {
      output: {
        // Keep the large vendor libraries in their own, separately cached chunks
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            // Only needed for local playback, and loaded along with snapstream
            { name: 'flac', test: /node_modules[\\/]libflacjs[\\/]/ },
            {
              name: 'audio',
              test: /node_modules[\\/](standardized-audio-context|automation-events|opus-decoder|@wasm-audio-decoders|@eshaz)[\\/]/,
            },
            {
              name: 'mui',
              test: /node_modules[\\/](@mui|@emotion|@babel[\\/]runtime|stylis|react-is|react-transition-group|prop-types|clsx)[\\/]/,
            },
          ],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'logo.svg'],
      manifest: {
        name: 'Snapweb - Snapcast web client',
        short_name: 'Snapweb',
        theme_color: '#607d8b',
        icons: [
          {
            src: 'pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png',
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
});
