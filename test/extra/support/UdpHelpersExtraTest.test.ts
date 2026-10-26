import dgram from 'node:dgram';
import { describe, expect, it } from 'vitest';
import { freeUdpPort, syncLookup } from '../../support/Udp.js';

describe('UdpHelpersExtraTest', () => {
    it('freeUdpPortNeverRepeatsAndIsOutsideTheEphemeralRangeRegression', () => {
        const ports = new Set<number>();
        for (let i = 0; i < 250; i++) {
            const port = freeUdpPort();
            expect(ports.has(port)).toBe(false);
            expect(port).toBeGreaterThan(1023);
            expect(port).toBeLessThan(32768);
            ports.add(port);
        }
    });

    it('freeUdpPortSkipsAPortThatIsBoundNow', () => {
        const first = freeUdpPort();
        const holder = dgram.createSocket({ type: 'udp4', lookup: syncLookup });
        try {
            // the next port the worker would hand out is first + 1 (or the slice start after a wrap)
            holder.bind(first + 1, '127.0.0.1');
            const next = freeUdpPort();
            expect(next).not.toBe(first + 1);
            expect(next).not.toBe(first);
        } finally {
            holder.close();
        }
    });
});
