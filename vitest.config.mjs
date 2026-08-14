import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    // The sandbox blocks child_process pipe IPC (EPERM), which the default
    // 'forks' pool uses for worker communication; worker_threads does not.
    pool: 'threads',
  },
})
