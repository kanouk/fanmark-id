import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { jevPlugin } from '../emoji-palette/jev-server';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), jevPlugin(4179)],
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  publicDir: fileURLToPath(new URL('../../public', import.meta.url)),
  server: { host: '127.0.0.1', port: 4179, strictPort: true, fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
  build: { outDir: '../../dist/hero-world', emptyOutDir: true },
});
