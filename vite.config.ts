import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = `http://localhost:${process.env.API_PORT ?? 8787}`;

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': api, '/mcp': api } },
});
