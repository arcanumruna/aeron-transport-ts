// Review attack tests (PR #75, issue #12): pending driver-side look-ups at every state.
import dns from 'node:dns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultNameResolver } from '../../../src/driver/DefaultNameResolver.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import type { UdpChannel } from '../../../src/driver/media/UdpChannel.js';
import { NativeResourceAgent } from '../../../src/driver/NativeResourceAgent.js';
import type { NativeResourceAgentProxy } from '../../../src/driver/NativeResourceAgentProxy.js';
import { ThreadingMode } from '../../../src/driver/ThreadingMode.js';

type LookupCallback = (err: Error | null, address?: string, family?: number) => void;

describe('NativeResourceAgent adversarial', () => {
    let ctx: MediaDriver.Context;
    let agent: NativeResourceAgent;
    let proxy: NativeResourceAgentProxy;
    let lookups: { host: string; callback: LookupCallback }[];
    let throwOn: string | null;
    let closed: boolean;

    beforeEach(() => {
        lookups = [];
        throwOn = null;
        closed = false;
        DefaultNameResolver.clearCache();
        ctx = new MediaDriver.Context().threadingMode(ThreadingMode.INVOKER).conclude();
        agent = new NativeResourceAgent(ctx);
        proxy = ctx.nativeResourceAgentProxy() as NativeResourceAgentProxy;
        proxy.nativeResourceAgent(agent);
        vi.spyOn(dns, 'lookup').mockImplementation(((host: string, _o: unknown, callback: LookupCallback) => {
            if (host === throwOn) {
                throw new Error('refused ' + host);
            }
            lookups.push({ host, callback });
        }) as never);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        DefaultNameResolver.clearCache();
        if (!closed) {
            agent.onClose();
        }
        ctx.close();
    });

    it('secondLookUpThrowsAfterFirstStartedAnswersErrorOnceAdversarialRegression', () => {
        throwOn = 'b-ctl.example';
        let woken = 0;
        agent.setWakeUp(() => woken++);
        const result = proxy.parseChannel(
            'aeron:udp?endpoint=a-peer.example:4000|control=b-ctl.example:4001|control-mode=dynamic',
            false,
        );
        agent.doWork();
        expect(() => result.get()).toThrowError('refused b-ctl.example');
        expect(proxy.failPendingLookups()).toBe(0);

        lookups[0]!.callback(null, '10.0.0.1', 4);
        expect(() => result.get()).toThrowError('refused b-ctl.example');
        expect(woken).toBe(0);
    });

    it('cachedFirstHostThenUncachedSecondWaitsForTheSecondAdversarialRegression', () => {
        DefaultNameResolver.cache('a-peer.example', DefaultNameResolver.INSTANCE.resolve('127.0.0.3', 'x', false)!);
        const result = proxy.parseChannel(
            'aeron:udp?endpoint=a-peer.example:4000|control=b-ctl.example:4001|control-mode=dynamic',
            false,
        );
        agent.doWork();
        expect(lookups.map((l) => l.host)).toEqual(['b-ctl.example']);
        expect(result.get()).toBeNull();
        lookups[0]!.callback(null, '10.0.0.2', 4);
        expect((result.get() as UdpChannel).remoteData().getAddress()?.getHostAddress()).toBe('127.0.0.3');
    });

    it('lateCallbackAfterCloseDoesNotThrowAdversarialRegression', () => {
        let woken = 0;
        agent.setWakeUp(() => woken++);
        const result = proxy.parseChannel('aeron:udp?endpoint=late.example:4000', false);
        agent.doWork();
        agent.onClose();
        closed = true;

        expect(() => lookups[0]!.callback(null, '10.9.9.9', 4)).not.toThrow();
        // nothing reads the result after close; it must not be left half-done either
        expect(result.get()).not.toBeNull();
    });

    it('manyPendingLookupsAreAllAnsweredAndTheSetDrainsAdversarialRegression', () => {
        const results: ReturnType<typeof proxy.parseChannel>[] = [];
        for (let i = 0; i < 1000; i++) {
            results.push(proxy.parseChannel('aeron:udp?endpoint=h' + i + '.example:4000', false));
        }
        for (let i = 0; i < 1000; i++) {
            agent.doWork();
        }
        expect(lookups.length).toBe(1000);
        // half are answered by the callback, half by failPendingLookups
        for (let i = 0; i < 1000; i += 2) {
            lookups[i]!.callback(null, '10.0.0.' + (i % 250), 4);
        }
        expect(proxy.failPendingLookups()).toBe(500);
        expect(proxy.failPendingLookups()).toBe(0);
        for (let i = 0; i < 1000; i++) {
            if (0 === i % 2) {
                expect(results[i]!.get()).not.toBeNull();
            } else {
                expect(() => results[i]!.get()).toThrowError(new RegExp('h' + i + '\\.example'));
            }
        }
        for (let i = 1; i < 1000; i += 2) {
            lookups[i]!.callback(null, '10.0.1.1', 4);
        }
        expect(proxy.failPendingLookups()).toBe(0);
    });
});
