// Extra tests of T18 (port-only, spec D7, plan decision 6, issue #12): the commands of the `NativeResourceAgent`, and
// the re-resolution of a DNS name: `dns.lookup` is started, the `DefaultNameResolver` cache is refreshed and the
// `CommandResult` is completed in the callback; an IP literal, `localhost` and a name that cannot be a host name are
// resolved at once.
import dns from 'node:dns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommonContext } from '../../../src/client/CommonContext.js';
import { ChannelUri } from '../../../src/client/ChannelUri.js';
import { CommandResult } from '../../../src/driver/CommandResult.js';
import { DefaultNameResolver } from '../../../src/driver/DefaultNameResolver.js';
import { InetAddress, InetSocketAddress } from '../../../src/driver/jdkNet.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import type { RawLog } from '../../../src/driver/buffer/RawLog.js';
import { UdpChannel } from '../../../src/driver/media/UdpChannel.js';
import { NativeResourceAgent } from '../../../src/driver/NativeResourceAgent.js';
import type { NativeResourceAgentProxy } from '../../../src/driver/NativeResourceAgentProxy.js';
import { ThreadingMode } from '../../../src/driver/ThreadingMode.js';

const { ENDPOINT_PARAM_NAME, MDC_CONTROL_PARAM_NAME } = CommonContext;

describe('NativeResourceAgent extra', () => {
    let ctx: MediaDriver.Context;
    let agent: NativeResourceAgent;
    let proxy: NativeResourceAgentProxy;
    let errors: Error[];
    let lookups: { host: string; callback: (err: Error | null, address?: string, family?: number) => void }[];

    beforeEach(() => {
        errors = [];
        lookups = [];
        DefaultNameResolver.clearCache();
        ctx = new MediaDriver.Context()
            .threadingMode(ThreadingMode.INVOKER)
            .errorHandler({ onError: (e) => errors.push(e) })
            .conclude();
        agent = new NativeResourceAgent(ctx);
        proxy = ctx.nativeResourceAgentProxy() as NativeResourceAgentProxy;
        proxy.nativeResourceAgent(agent);
        vi.spyOn(dns, 'lookup').mockImplementation(((
            host: string,
            _options: unknown,
            callback: (err: Error | null, address?: string, family?: number) => void,
        ) => {
            lookups.push({ host, callback });
        }) as never);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        DefaultNameResolver.clearCache();
        agent.onClose();
        ctx.close();
    });

    it('resolves an IP literal at once, without a lookup', () => {
        const result = proxy.reResolveAddress('127.0.0.1:5050', ENDPOINT_PARAM_NAME);
        expect(result.get()).toBeNull();

        agent.doWork();

        const address = result.get() as InetSocketAddress;
        expect(address.getPort()).toBe(5050);
        expect(address.isUnresolved()).toBe(false);
        expect(lookups).toEqual([]);
    });

    it('resolves localhost at once, without a lookup', () => {
        const result = proxy.reResolveAddress('localhost:5050', ENDPOINT_PARAM_NAME);

        agent.doWork();

        expect((result.get() as InetSocketAddress).getAddress()?.getHostAddress()).toBe('127.0.0.1');
        expect(lookups).toEqual([]);
    });

    it('completes the result in the callback of dns.lookup, after the cache was refreshed', () => {
        let woken = 0;
        agent.setWakeUp(() => woken++);
        const result = proxy.reResolveAddress('some-host.example:5050', MDC_CONTROL_PARAM_NAME);

        agent.doWork();

        expect(lookups.map((l) => l.host)).toEqual(['some-host.example']);
        expect(result.get()).toBeNull();
        expect(woken).toBe(0);

        lookups[0]!.callback(null, '10.1.2.3', 4);

        const address = result.get() as InetSocketAddress;
        expect(address.isUnresolved()).toBe(false);
        expect(address.getAddress()?.getHostAddress()).toBe('10.1.2.3');
        expect(address.getPort()).toBe(5050);
        expect(woken).toBe(1);
        // the cache serves the next synchronous resolution
        expect(DefaultNameResolver.INSTANCE.resolve('some-host.example', ENDPOINT_PARAM_NAME, false)).not.toBeNull();
    });

    it('a name that dns.lookup cannot resolve is an unresolved address, which the conductor reports', () => {
        const result = proxy.reResolveAddress('no-such-host.example:5050', ENDPOINT_PARAM_NAME);

        agent.doWork();
        lookups[0]!.callback(new Error('ENOTFOUND'));

        const address = result.get() as InetSocketAddress;
        expect(address.isUnresolved()).toBe(true);
        expect(address.getPort()).toBe(5050);
    });

    it('a new address replaces the cached one', () => {
        DefaultNameResolver.cache('moving.example', DefaultNameResolver.INSTANCE.resolve('127.0.0.2', 'x', false)!);
        const result = proxy.reResolveAddress('moving.example:1', ENDPOINT_PARAM_NAME);

        agent.doWork();
        lookups[0]!.callback(null, '10.9.8.7', 4);

        expect((result.get() as InetSocketAddress).getAddress()?.getHostAddress()).toBe('10.9.8.7');
    });

    it('a value that is not a host name fails at once with the parse error, not through dns', () => {
        const result = proxy.reResolveAddress('$#^%*#(', ENDPOINT_PARAM_NAME);

        agent.doWork();

        expect(() => result.get()).toThrowError(/\$#\^%\*#\(/);
        expect(lookups).toEqual([]);
    });

    it('a failure of dns.lookup itself completes the result with the error', () => {
        vi.mocked(dns.lookup).mockImplementation((() => {
            throw new Error('lookup failed to start');
        }) as never);
        const result = proxy.reResolveAddress('some-host.example:5050', ENDPOINT_PARAM_NAME);

        agent.doWork();

        expect(() => result.get()).toThrowError('lookup failed to start');
    });

    it('parses a channel and answers the error of one that does not parse', () => {
        const ok = proxy.parseChannel('aeron:udp?endpoint=127.0.0.1:4000', false);
        const bad = proxy.parseChannel('aeron:udp://', false);

        agent.doWork();
        agent.doWork();

        expect((ok.get() as UdpChannel).canonicalForm()).toContain('127.0.0.1:4000');
        expect(() => bad.get()).toThrowError();
    });

    describe('parse fills the name cache on the driver side (issue #12, spec D7)', () => {
        it('Regression: a channel whose host is not cached is looked up by the driver, with no client-side fill', () => {
            let woken = 0;
            agent.setWakeUp(() => woken++);
            expect(InetAddress.nameCache.size).toBe(0);

            const result = proxy.parseChannel('aeron:udp?endpoint=driver-side.example:4000', false);
            agent.doWork();

            expect(lookups.map((l) => l.host)).toEqual(['driver-side.example']);
            expect(result.get()).toBeNull();

            lookups[0]!.callback(null, '10.1.2.3', 4);

            const channel = result.get() as UdpChannel;
            expect(channel.remoteData().getAddress()?.getHostAddress()).toBe('10.1.2.3');
            expect(channel.remoteData().getPort()).toBe(4000);
            expect(woken).toBe(1);
        });

        it('Regression: every name of the channel is looked up and the result waits for the last', () => {
            const result = proxy.parseChannel(
                'aeron:udp?endpoint=a-peer.example:4000|control=b-ctl.example:4001|control-mode=dynamic',
                false,
            );
            agent.doWork();

            expect(lookups.map((l) => l.host).sort()).toEqual(['a-peer.example', 'b-ctl.example'].sort());
            lookups[0]!.callback(null, '10.0.0.1', 4);
            expect(result.get()).toBeNull();
            lookups[1]!.callback(null, '10.0.0.2', 4);
            expect(result.get()).not.toBeNull();
        });

        it('Regression: a name that is in the cache is not looked up again', () => {
            DefaultNameResolver.cache('cached.example', DefaultNameResolver.INSTANCE.resolve('127.0.0.2', 'x', false)!);
            const result = proxy.parseChannel('aeron:udp?endpoint=cached.example:4000', false);

            agent.doWork();

            expect(lookups).toEqual([]);
            expect((result.get() as UdpChannel).remoteData().getAddress()?.getHostAddress()).toBe('127.0.0.2');
        });

        it('Regression: a failed look-up reaches the client as the unknown host error', () => {
            let woken = 0;
            agent.setWakeUp(() => woken++);
            const result = proxy.parseChannel('aeron:udp?endpoint=no-such-host.example:4000', false);

            agent.doWork();
            lookups[0]!.callback(new Error('ENOTFOUND'));

            expect(() => result.get()).toThrowError(/no-such-host\.example/);
            expect(woken).toBe(1);
        });

        it('Regression: a dns.lookup that throws completes the result with the error', () => {
            vi.mocked(dns.lookup).mockImplementation((() => {
                throw new Error('lookup failed to start');
            }) as never);
            const result = proxy.parseChannel('aeron:udp?endpoint=some-host.example:4000', false);

            agent.doWork();

            expect(() => result.get()).toThrowError('lookup failed to start');
        });

        it('Regression: failPendingLookups answers a waiting parse with the unknown host error, once', () => {
            const result = proxy.parseChannel('aeron:udp?endpoint=blocked.example:4000', false);
            agent.doWork();
            expect(result.get()).toBeNull();

            expect(proxy.failPendingLookups()).toBe(1);
            expect(() => result.get()).toThrowError(/blocked\.example/);
            expect(proxy.failPendingLookups()).toBe(0);

            // the callback that comes later fills the cache and completes nothing again
            lookups[0]!.callback(null, '10.5.5.5', 4);
            expect(() => result.get()).toThrowError(/blocked\.example/);
            expect(DefaultNameResolver.INSTANCE.resolve('blocked.example', ENDPOINT_PARAM_NAME, false)).not.toBeNull();
        });

        it('Regression: the address of a destination is looked up by the driver too', () => {
            const result = proxy.destinationAddress(ChannelUri.parse('aeron:udp?endpoint=dest-host.example:4010'));

            agent.doWork();
            expect(result.get()).toBeNull();
            lookups[0]!.callback(null, '10.4.4.4', 4);

            const address = result.get() as InetSocketAddress;
            expect(address.getAddress()?.getHostAddress()).toBe('10.4.4.4');
            expect(address.getPort()).toBe(4010);
        });
    });

    it('answers the address of a destination', () => {
        const result = proxy.destinationAddress(ChannelUri.parse('aeron:udp?endpoint=127.0.0.1:4010'));

        agent.doWork();

        expect((result.get() as InetSocketAddress).getPort()).toBe(4010);
    });

    it('makes publication and image logs and frees them on request', () => {
        const publication = proxy.newPublicationLog(7, 64 * 1024, false);
        const image = proxy.newImageLog(8, 64 * 1024, true);

        agent.doWork();
        agent.doWork();

        const publicationLog = publication.get() as RawLog;
        const imageLog = image.get() as RawLog;
        expect(publicationLog.termLength()).toBe(64 * 1024);
        expect(imageLog.termLength()).toBe(64 * 1024);

        proxy.freeLogBuffer(publicationLog);
        agent.doWork();
        expect(publicationLog.free()).toBe(true);
    });

    it('a result that is not completed is null and an error is thrown on every get', () => {
        const result = new CommandResult<number>();
        expect(result.get()).toBeNull();
        result.error(new Error('failed'));
        expect(() => result.get()).toThrowError('failed');
        expect(() => result.get()).toThrowError('failed');
    });

    it('a task that throws is counted and the agent goes on', () => {
        const queue = ctx.nativeResourceAgentCommandQueue()!;
        queue.offer(() => {
            throw new Error('task failed');
        });

        expect(agent.doWork()).toBe(1);
        expect(errors.map((e) => e.message)).toEqual(['task failed']);
    });
});
