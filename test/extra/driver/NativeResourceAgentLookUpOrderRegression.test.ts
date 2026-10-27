// Issue #86: two channel parses for DIFFERENT hosts whose look-ups complete in the reverse order are each answered
// with their own address. Issue #84: a waiter that throws in the look-up's callback is counted, and the other
// waiters of that look-up still complete. `dns.lookup` is a fake completed by hand.
import dns from 'node:dns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultNameResolver } from '../../../src/driver/DefaultNameResolver.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import type { UdpChannel } from '../../../src/driver/media/UdpChannel.js';
import { NativeResourceAgent } from '../../../src/driver/NativeResourceAgent.js';
import type { NativeResourceAgentProxy } from '../../../src/driver/NativeResourceAgentProxy.js';
import { ThreadingMode } from '../../../src/driver/ThreadingMode.js';

type LookupCallback = (err: Error | null, address?: string, family?: number) => void;

describe('NativeResourceAgent look-up order', () => {
    let ctx: MediaDriver.Context;
    let agent: NativeResourceAgent;
    let proxy: NativeResourceAgentProxy;
    let lookups: { host: string; callback: LookupCallback }[];

    beforeEach(() => {
        lookups = [];
        DefaultNameResolver.clearCache();
        ctx = new MediaDriver.Context().threadingMode(ThreadingMode.INVOKER).conclude();
        agent = new NativeResourceAgent(ctx);
        proxy = ctx.nativeResourceAgentProxy() as NativeResourceAgentProxy;
        proxy.nativeResourceAgent(agent);
        vi.spyOn(dns, 'lookup').mockImplementation(((host: string, _o: unknown, callback: LookupCallback) => {
            lookups.push({ host, callback });
        }) as never);
    });

    afterEach(() => {
        for (const lookup of lookups.splice(0)) {
            try {
                lookup.callback(new Error('test over'));
            } catch (ex) {
                void ex;
            }
        }
        vi.restoreAllMocks();
        DefaultNameResolver.clearCache();
        agent.onClose();
        ctx.close();
    });

    it('twoParsesForDifferentHostsCompletingInReverseOrderEachGetTheirOwnAddressRegression', () => {
        const resultA = proxy.parseChannel('aeron:udp?endpoint=host-a.example:4000', false);
        const resultB = proxy.parseChannel('aeron:udp?endpoint=host-b.example:4001', false);
        for (let i = 0; i < 10; i++) {
            agent.doWork();
        }
        // both look-ups are out (the agent does not serialize parses of different hosts)
        expect(lookups.map((l) => l.host).sort()).toEqual(['host-a.example', 'host-b.example']);
        const lookupOf = (host: string) => lookups.find((l) => l.host === host) as { callback: LookupCallback };

        lookupOf('host-b.example').callback(null, '127.0.0.3', 4);
        for (let i = 0; i < 10; i++) {
            agent.doWork();
        }
        expect(resultA.get()).toBeNull();
        const channelB = resultB.get() as UdpChannel;
        expect(channelB.remoteData().getAddress()?.getHostAddress()).toBe('127.0.0.3');
        expect(channelB.remoteData().getPort()).toBe(4001);

        lookupOf('host-a.example').callback(null, '127.0.0.2', 4);
        for (let i = 0; i < 10; i++) {
            agent.doWork();
        }
        const channelA = resultA.get() as UdpChannel;
        expect(channelA.remoteData().getAddress()?.getHostAddress()).toBe('127.0.0.2');
        expect(channelA.remoteData().getPort()).toBe(4000);
        expect(channelB.remoteData().getAddress()?.getHostAddress()).toBe('127.0.0.3');
    });

    it('aWakeUpThatThrowsIsCountedAndTheOtherParsesOfTheHostStillCompleteRegression', () => {
        const onError = vi.spyOn(ctx.countedErrorHandler()!, 'onError');
        agent.setWakeUp(() => {
            throw new Error('wake up');
        });
        const resultA = proxy.parseChannel('aeron:udp?endpoint=host-c.example:4000', false);
        const resultB = proxy.parseChannel('aeron:udp?endpoint=host-c.example:4001', false);
        for (let i = 0; i < 10; i++) {
            agent.doWork();
        }
        expect(lookups.map((l) => l.host)).toEqual(['host-c.example']);

        expect(() => lookups[0]!.callback(null, '127.0.0.4', 4)).not.toThrow();
        for (let i = 0; i < 10; i++) {
            agent.doWork();
        }
        expect(onError.mock.calls.map(([ex]) => ex.message)).toEqual(['wake up', 'wake up']);
        expect((resultA.get() as UdpChannel).remoteData().getPort()).toBe(4000);
        expect((resultB.get() as UdpChannel).remoteData().getPort()).toBe(4001);
    });
});
