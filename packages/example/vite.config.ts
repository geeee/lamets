import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        mic: resolve(__dirname, 'mic.html'),
        convert: resolve(__dirname, 'convert.html'),
      },
    },
  },
});
