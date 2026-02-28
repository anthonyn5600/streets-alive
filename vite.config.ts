import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'

function runtimeTestResultsPlugin(): Plugin {
  return {
    name: 'runtime-test-results',
    configureServer(server) {
      server.middlewares.use('/__test-results', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            fs.writeFileSync(path.resolve(__dirname, 'runtime-test-results.json'), body, 'utf-8');
            res.statusCode = 200;
            res.end('OK');
          } catch {
            res.statusCode = 500;
            res.end('Write failed');
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), runtimeTestResultsPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
