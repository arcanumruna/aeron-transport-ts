import { defineConfig } from 'vitest/config';

// The interop suite against the Aeron C 1.53.3 media driver (T23, spec 8.3): `npm run test:interop`. The default
// `vitest.config.ts` leaves test/interop out, so `npm test` needs no C build and does not start C processes.
export default defineConfig({
    test: {
        include: ['test/interop/**/*.test.ts'],
        testTimeout: 120_000,
        hookTimeout: 60_000,
        // each test starts C drivers and binds loopback ports: one file at a time keeps the timing steady
        fileParallelism: false,
    },
});
