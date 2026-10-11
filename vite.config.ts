import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-ignore Build helper is a plain Node module to avoid adding runtime dependencies.
import pwaWorker from './scripts/pwa-plugin.mjs';

export default defineConfig({plugins:[react(),pwaWorker()],server:{proxy:{'/api':{target:'http://127.0.0.1:8787',changeOrigin:false}}}});
