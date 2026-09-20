import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { jevPlugin } from './jev-server';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), jevPlugin()],
  server: { host: '127.0.0.1', port: 4178, strictPort: true, fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
  build: { outDir: '../../dist/palette-prototype', emptyOutDir: true },
});
