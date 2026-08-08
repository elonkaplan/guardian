import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `host: true` binds 0.0.0.0. Vite binds loopback by default, and a container
// binding loopback is unreachable from the host — the most common way the
// compose setup ships broken.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
});
