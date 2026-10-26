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
import { InetSocketAddress } from '../../../src/driver/jdkNet.js';
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
