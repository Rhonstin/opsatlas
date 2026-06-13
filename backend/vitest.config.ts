import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests share one Postgres and each file resets tables in
    // beforeAll — run files sequentially so they don't stomp each other.
    fileParallelism: false,
    // Register ts-node so Knex can require() .ts migration files
    setupFiles: ['./test/setup.ts'],
  },
});
