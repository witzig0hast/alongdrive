import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    // Dev: Login/Admin/API laufen über den Node-Server (npm run server, Port 8080)
    proxy: { '/auth': 'http://localhost:8080', '/api': 'http://localhost:8080', '/admin': 'http://localhost:8080', '/login': 'http://localhost:8080' },
  },
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
});
