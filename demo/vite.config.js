import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        broadcast: resolve(__dirname, 'broadcast.html'),
        try: resolve(__dirname, 'try.html'),
        results: resolve(__dirname, 'results.html'),
      },
    },
  },
  server: {
    port: 4000,
    open: true,
  },
});
