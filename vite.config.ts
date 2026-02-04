import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1000, // 경고 기준을 500kB에서 1000kB로 높여줍니다.
    rollupOptions: {
      output: {
        // 대형 라이브러리들을 별도의 파일로 분리하여 효율을 높입니다.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        }
      }
    }
  }
})
