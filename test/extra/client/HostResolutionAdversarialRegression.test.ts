// Review attack tests (PR #75, issue #12): the driver-side look-up and failPendingLookups, through the public API.
import dns from 'node:dns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Aeron } from '../../../src/client/Aeron.js';
import { MemoryLogBuffersFactory } from '../../../src/client/MemoryLogBuffersFactory.js';
import { DefaultNameResolver } from '../../../src/driver/DefaultNameResolver.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import { ThreadingMode } from '../../../src/driver/ThreadingMode.js';
import { freeUdpPort } from '../../support/Udp.js';

type LookupCallback = (err: Error | null, address?: string, family?: number) => void;

describe('Host resolution adversarial', () => {
    let lookups: { host: string; callback: LookupCallback }[];
    const closeables: { close(): void }[] = [];

    beforeEach(() => {
        lookups = [];
        DefaultNameResolver.clearCache();
        vi.spyOn(dns, 'lookup').mockImplementation(((host: string, _o: unknown, callback: LookupCallback) => {
            lookups.push({ host, callback });
        }) as never);
    });

    afterEach(() => {
        for (const c of closeables.splice(0).reverse()) {
            c.close();
        }
        vi.restoreAllMocks();
        DefaultNameResolver.clearCache();
    });

    it('syncAddWithDriverInvokerButNoMediaDriverInContextFailsFastAdversarialRegression', () => {
        // a client wired to an in-process INVOKER driver through its CnC, logs and invoker, without mediaDriver(...)
        const driver = MediaDriver.launch(new MediaDriver.Context().threadingMode(ThreadingMode.INVOKER));
        closeables.push(driver);
        const aeron = Aeron.connect(
            new Aeron.Context()
                .cncByteBuffer(driver.context().cncByteBuffer())
                .logBuffersFactory(new MemoryLogBuffersFactory(driver.context().logFactory() as never))
                .driverAgentInvoker(driver.sharedAgentInvoker())
                .useConductorAgentInvoker(true)
                .driverTimeoutMs(1000),
        );
        closeables.push(aeron);

        const started = Date.now();
        let error: unknown = null;
        try {
            aeron.addExclusivePublication('aeron:udp?endpoint=unresolved.example:' + freeUdpPort(), 1001);
        } catch (ex) {
            error = ex;
        }
        // before #12 this was the unknown host error at once; it must not become a driver timeout
        expect(String(error)).toMatch(/unresolved\.example/);
        expect(Date.now() - started).toBeLessThan(500);
    });
});
