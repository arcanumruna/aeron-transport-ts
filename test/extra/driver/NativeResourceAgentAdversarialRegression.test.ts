// Review attack tests (PR #75, issue #12): pending driver-side look-ups at every state.
import dns from 'node:dns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverProxy } from '../../../src/client/DriverProxy.js';
import { DefaultNameResolver } from '../../../src/driver/DefaultNameResolver.js';
import { lookUpHost } from '../../../src/driver/HostNameLookup.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import type { UdpChannel } from '../../../src/driver/media/UdpChannel.js';
import { NativeResourceAgent } from '../../../src/driver/NativeResourceAgent.js';
import type { NativeResourceAgentProxy } from '../../../src/driver/NativeResourceAgentProxy.js';
import { ThreadingMode } from '../../../src/driver/ThreadingMode.js';
import { EmbeddedRig } from '../../support/EmbeddedRig.js';

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
        // issue #77: close drops the pending look-up; nothing reads the result after close, so it stays incomplete
        expect(result.get()).toBeNull();
        expect(woken).toBe(0);
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

describe('NativeResourceAgentLookupLifecycleRegression', () => {
    let ctx: MediaDriver.Context;
    let agent: NativeResourceAgent;
    let proxy: NativeResourceAgentProxy;
    let lookups: { host: string; callback: LookupCallback }[];
    let closed: boolean;

    beforeEach(() => {
        lookups = [];
        closed = false;
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
        vi.restoreAllMocks();
        DefaultNameResolver.clearCache();
        if (!closed) {
            agent.onClose();
        }
        ctx.close();
    });

    it('closeDropsPendingParseSoALateLookUpCompletesNothingAndWakesNoOneRegression', () => {
        let woken = 0;
        agent.setWakeUp(() => woken++);
        const result = proxy.parseChannel('aeron:udp?endpoint=close-parse.example:4000', false);
        agent.doWork();
        expect(lookups.length).toBe(1);

        agent.onClose();
        closed = true;
        expect(agent.failPendingLookups()).toBe(0);

        lookups[0]!.callback(null, '10.1.1.1', 4);
        expect(result.get()).toBeNull();
        expect(woken).toBe(0);
    });

    it('closeDropsPendingReResolutionSoALateLookUpCompletesNothingAndWakesNoOneRegression', () => {
        let woken = 0;
        agent.setWakeUp(() => woken++);
        const result = proxy.reResolveAddress('close-reres.example:4000', 'endpoint');
        agent.doWork();
        expect(lookups.length).toBe(1);

        agent.onClose();
        closed = true;

        lookups[0]!.callback(null, '10.1.1.2', 4);
        expect(result.get()).toBeNull();
        expect(woken).toBe(0);
    });

    it('severalAddsInFlightNeverHoldMoreThanOnePendingLookupSoFailingItIsTheOneTheHeldCallWaitsBehindRegression', () => {
        const rig = new EmbeddedRig(true);
        try {
            const nativeAgent = (
                rig.driver.context().nativeResourceAgentProxy() as unknown as {
                    _nativeResourceAgent: { pendingLookups: Set<unknown> };
                }
            )._nativeResourceAgent;
            const driverProxy = rig.aeron.context().driverProxy() as DriverProxy;
            // written to the driver directly: the client's own look-up (which fills the cache) is bypassed
            for (let i = 0; i < 5; i++) {
                driverProxy.addSubscription('aeron:udp?endpoint=many' + i + '.example:' + (40000 + i), 1001);
            }

            let maxPending = 0;
            for (let cycle = 0; cycle < 50; cycle++) {
                rig.cycle();
                maxPending = Math.max(maxPending, nativeAgent.pendingLookups.size);
            }
            expect(maxPending).toBe(1);
            expect(lookups.map((l) => l.host)).toEqual(['many0.example']); // the others wait behind it

            // finish them one by one: each time exactly one is out
            for (let done = 1; done <= 5; done++) {
                expect(nativeAgent.pendingLookups.size).toBe(1);
                lookups[done - 1]!.callback(null, '127.0.0.1', 4);
                for (let cycle = 0; cycle < 50; cycle++) {
                    rig.cycle();
                    expect(nativeAgent.pendingLookups.size).toBeLessThanOrEqual(1);
                }
                if (done < 5) {
                    expect(lookups.length).toBe(done + 1);
                }
            }
            expect(nativeAgent.pendingLookups.size).toBe(0);
        } finally {
            rig.close();
        }
    });
});

describe('HostNameLookupCoalescingRegression', () => {
    let lookups: { host: string; callback: LookupCallback }[];
    let throwOnNext: boolean;

    beforeEach(() => {
        lookups = [];
        throwOnNext = false;
        DefaultNameResolver.clearCache();
        vi.spyOn(dns, 'lookup').mockImplementation(((host: string, _o: unknown, callback: LookupCallback) => {
            if (throwOnNext) {
                throwOnNext = false;
                throw new Error('refused ' + host);
            }
            lookups.push({ host, callback });
        }) as never);
    });

    afterEach(() => {
        // finish whatever is out so that no in-flight entry leaks into the next test
        for (const l of lookups.splice(0)) {
            try {
                l.callback(new Error('cleanup'));
            } catch (ex) {
                void ex;
            }
        }
        vi.restoreAllMocks();
        DefaultNameResolver.clearCache();
    });

    it('twoCallsForOneHostStartOneLookUpAndBothAreCalledOnceRegression', () => {
        let a = 0;
        let b = 0;
        lookUpHost('coalesce.host', () => a++);
        lookUpHost('coalesce.host', () => b++);
        expect(lookups.length).toBe(1);
        expect(a + b).toBe(0);

        lookups[0]!.callback(null, '10.2.2.2', 4);
        expect([a, b]).toEqual([1, 1]);
    });

    it('theHostKeyIsCaseInsensitiveRegression', () => {
        let n = 0;
        lookUpHost('some.host', () => n++);
        lookUpHost('Some.Host', () => n++);
        expect(lookups.length).toBe(1);
        lookups[0]!.callback(null, '10.2.2.3', 4);
        expect(n).toBe(2);
    });

    it('aRefreshJoinsAnInFlightLookUpAndALaterOneStartsANewOneRegression', () => {
        let n = 0;
        lookUpHost('refresh.host', () => n++);
        lookUpHost('refresh.host', () => n++, true);
        expect(lookups.length).toBe(1);
        lookups[0]!.callback(null, '10.2.2.4', 4);
        expect(n).toBe(2);

        lookUpHost('refresh.host', () => n++, true); // cached, but refresh: a new look-up
        expect(lookups.length).toBe(2);
        expect(n).toBe(2);
        lookups[1]!.callback(null, '10.2.2.5', 4);
        expect(n).toBe(3);
    });

    it('aSynchronousThrowLeavesNoInFlightEntryRegression', () => {
        throwOnNext = true;
        expect(() => lookUpHost('throws.host', () => {})).toThrowError('refused throws.host');
        let n = 0;
        lookUpHost('throws.host', () => n++);
        expect(lookups.length).toBe(1);
        lookups[0]!.callback(null, '10.2.2.6', 4);
        expect(n).toBe(1);
    });

    it('aWaiterThatThrowsDoesNotStopTheOthersAndTheFirstErrorIsRethrownRegression', () => {
        let c = 0;
        lookUpHost('waiters.host', () => {
            throw new Error('first');
        });
        lookUpHost('waiters.host', () => {
            throw new Error('second');
        });
        lookUpHost('waiters.host', () => c++);
        expect(() => lookups[0]!.callback(null, '10.2.2.7', 4)).toThrowError('first');
        expect(c).toBe(1);

        // the entry is gone: the next call looks up again
        lookUpHost('waiters.host', () => {}, true);
        expect(lookups.length).toBe(2);
    });

    it('aWaiterThatLooksTheHostUpAgainStartsANewLookUpRegression', () => {
        let again = 0;
        lookUpHost('again.host', () => {
            lookUpHost('again.host', () => again++, true);
        });
        lookups[0]!.callback(null, '10.2.2.8', 4);
        expect(lookups.length).toBe(2);
        lookups[1]!.callback(null, '10.2.2.8', 4);
        expect(again).toBe(1);
    });
});
