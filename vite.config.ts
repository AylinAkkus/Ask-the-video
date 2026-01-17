import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

import manifest from './src/manifest'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  return {
    build: {
      emptyOutDir: true,
      outDir: 'build',
      rollupOptions: {
        input: {
          welcome: resolve(__dirname, 'welcome.html'),
        },
        output: {
          chunkFileNames: 'assets/chunk-[hash].js',
        },
      },
    },

    plugins: [crx({ manifest }), react()],
    
    // Define process.env for browser compatibility
    define: {
      'process.env': {},
      'process.version': '"v16.0.0"',
      'process.versions': '{}',
    },

    server: {
      cors: {
        origin: [/chrome-extension:\/\//],
      },
    },
  }
})
