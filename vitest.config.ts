import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        // test/interop needs the Aeron C build: it has its own config and script (`npm run test:interop`)
        exclude: ['test/scripts/fixtures/**', 'test/interop/**', 'node_modules/**'],
        testTimeout: 10_000,
    },
});
