import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        exclude: ['test/scripts/fixtures/**', 'node_modules/**'],
        testTimeout: 10_000,
    },
});
