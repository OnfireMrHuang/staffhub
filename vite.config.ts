import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], build:{rollupOptions:{output:{manualChunks:{spreadsheet:['xlsx'],radix:['@radix-ui/react-dialog','@radix-ui/react-tabs','@radix-ui/react-dropdown-menu']}}}} });
