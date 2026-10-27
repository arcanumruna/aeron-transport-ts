// Review attack tests (PR #75, issue #12): pending driver-side look-ups at every state.
import dns from 'node:dns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverProxy } from '../../../src/client/DriverProxy.js';
import { DefaultNameResolver } from '../../../src/driver/DefaultNameResolver.js';
import { lookUpHost } from '../../../src/driver/HostNameLookup.js';
import { InetAddress } from '../../../src/driver/jdkNet.js';
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
    const cachedAddress = (host: string): string | undefined => InetAddress.nameCache.get(host)?.getHostAddress();
    let lookups: { host: string; callback: LookupCallback }[];
    let throwOnNext: boolean;
    const ignore = (): void => {};

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
        lookUpHost('coalesce.host', () => a++, ignore);
        lookUpHost('coalesce.host', () => b++, ignore);
        expect(lookups.length).toBe(1);
        expect(a + b).toBe(0);

        lookups[0]!.callback(null, '10.2.2.2', 4);
        expect([a, b]).toEqual([1, 1]);
    });

    it('theHostKeyIsCaseInsensitiveRegression', () => {
        let n = 0;
        lookUpHost('some.host', () => n++, ignore);
        lookUpHost('Some.Host', () => n++, ignore);
        expect(lookups.length).toBe(1);
        lookups[0]!.callback(null, '10.2.2.3', 4);
        expect(n).toBe(2);
    });

    it('aRefreshJoinsAnInFlightLookUpAndALaterOneStartsANewOneRegression', () => {
        let n = 0;
        lookUpHost('refresh.host', () => n++, ignore);
        lookUpHost('refresh.host', () => n++, ignore, true);
        expect(lookups.length).toBe(1);
        lookups[0]!.callback(null, '10.2.2.4', 4);
        expect(n).toBe(2);

        lookUpHost('refresh.host', () => n++, ignore, true); // cached, but refresh: a new look-up
        expect(lookups.length).toBe(2);
        expect(n).toBe(2);
        lookups[1]!.callback(null, '10.2.2.5', 4);
        expect(n).toBe(3);
    });

    it('aSynchronousThrowLeavesNoInFlightEntryRegression', () => {
        throwOnNext = true;
        expect(() => lookUpHost('throws.host', () => {}, ignore)).toThrowError('refused throws.host');
        let n = 0;
        lookUpHost('throws.host', () => n++, ignore);
        expect(lookups.length).toBe(1);
        lookups[0]!.callback(null, '10.2.2.6', 4);
        expect(n).toBe(1);
    });

    it('aWaiterThatThrowsDoesNotStopTheOthersAndEachErrorGoesToItsOwnHandlerRegression', () => {
        // issue #84: the dns callback never throws; each waiter's error goes to that waiter's handler
        let c = 0;
        const errors: string[] = [];
        lookUpHost(
            'waiters.host',
            () => {
                throw new Error('first');
            },
            (ex) => errors.push('a:' + (ex as Error).message),
        );
        lookUpHost(
            'waiters.host',
            () => {
                throw new Error('second');
            },
            (ex) => errors.push('b:' + (ex as Error).message),
        );
        lookUpHost('waiters.host', () => c++, ignore);
        expect(() => lookups[0]!.callback(null, '10.2.2.7', 4)).not.toThrow();
        expect(c).toBe(1);
        expect(errors).toEqual(['a:first', 'b:second']);

        // the entry is gone: the next call looks up again
        lookUpHost('waiters.host', () => {}, ignore, true);
        expect(lookups.length).toBe(2);
    });

    it('anErrorHandlerThatThrowsDoesNotStopTheOtherWaitersRegression', () => {
        let c = 0;
        lookUpHost(
            'handler.host',
            () => {
                throw new Error('waiter');
            },
            () => {
                throw new Error('handler');
            },
        );
        lookUpHost('handler.host', () => c++, ignore);
        expect(() => lookups[0]!.callback(null, '10.2.2.10', 4)).not.toThrow();
        expect(c).toBe(1);
    });

    it('aWaiterThatLooksTheHostUpAgainStartsANewLookUpRegression', () => {
        let again = 0;
        lookUpHost(
            'again.host',
            () => {
                lookUpHost('again.host', () => again++, ignore, true);
            },
            ignore,
        );
        lookups[0]!.callback(null, '10.2.2.8', 4);
        expect(lookups.length).toBe(2);
        lookups[1]!.callback(null, '10.2.2.8', 4);
        expect(again).toBe(1);
    });

    it('aSynchronousCallbackWhoseWaiterThrowsKeepsTheWaitersNewLookUpRegression', () => {
        // a mock that calls back at once (Node never does): the waiter starts a new look-up, then throws; the error
        // goes to its handler and must not be taken for a refusal by dns.lookup, which would drop the new entry
        let first = true;
        vi.mocked(dns.lookup).mockImplementation(((host: string, _o: unknown, callback: LookupCallback) => {
            lookups.push({ host, callback });
            if (first) {
                first = false;
                callback(null, '10.2.2.9', 4);
            }
        }) as never);
        let again = 0;
        const errors: unknown[] = [];
        expect(() =>
            lookUpHost(
                'sync.host',
                () => {
                    lookUpHost('sync.host', () => again++, ignore, true);
                    throw new Error('waiter');
                },
                (ex) => errors.push(ex),
            ),
        ).not.toThrow();
        expect(errors.map((e) => (e as Error).message)).toEqual(['waiter']);
        expect(lookups.length).toBe(2);

        // the next refresh joins the waiter's look-up: had the entry been dropped, it would start a third one
        lookUpHost('sync.host', () => again++, ignore, true);
        expect(lookups.length).toBe(2);
        lookups[1]!.callback(null, '10.2.2.9', 4);
        expect(again).toBe(2);
    });

    it('aHungLookUpDelaysARefreshByAtMostOneRoundRegression', () => {
        // issue #85: a dns.lookup that never calls back must not hold every later refresh forever
        let n = 0;
        let m = 0;
        let r = 0;
        lookUpHost('hung.host', () => n++, ignore); // its dns.lookup never answers
        lookUpHost('hung.host', () => r++, ignore, true); // the first refresh joins it
        expect(lookups.length).toBe(1);
        lookUpHost('hung.host', () => m++, ignore, true); // the next round supersedes it
        expect(lookups.length).toBe(2);
        lookups[1]!.callback(null, '10.2.2.11', 4);
        expect([n, r, m]).toEqual([1, 1, 1]);
        expect(InetAddress.nameCache.has('hung.host')).toBe(true);

        // the hung look-up answers late: older than the answer taken, it neither replaces the cached address nor calls
        // anyone again; a new look-up is not disturbed
        lookUpHost('hung.host', () => m++, ignore, true);
        expect(lookups.length).toBe(3);
        lookups[0]!.callback(null, '10.2.2.12', 4);
        expect([n, r, m]).toEqual([1, 1, 1]);
        expect(cachedAddress('hung.host')).toBe('10.2.2.11');
        lookups[2]!.callback(null, '10.2.2.13', 4);
        expect([n, r, m]).toEqual([1, 1, 2]);
        expect(cachedAddress('hung.host')).toBe('10.2.2.13');
    });

    it('manyRefreshesOfAHungLookUpStartAtMostOneMoreDnsLookUpRegression', () => {
        // issue #85: at most one superseded look-up per name is out, so a name never has more than two dns.lookups
        let n = 0;
        lookUpHost('many.host', () => n++, ignore); // never answers
        for (let i = 0; i < 50; i++) {
            lookUpHost('many.host', () => n++, ignore, true);
        }
        expect(lookups.length).toBe(2);
        lookups[1]!.callback(null, '10.2.2.20', 4);
        expect(n).toBe(51);
        lookups[0]!.callback(null, '10.2.2.21', 4); // late and older: answers no one, keeps the newer address
        expect(n).toBe(51);
        expect(cachedAddress('many.host')).toBe('10.2.2.20');
    });

    it('aLookUpStartedByARefreshIsJoinedByTheNextRefreshRegression', () => {
        // a refresh that starts a look-up does not mark it: the next refresh joins it, the one after supersedes it
        let n = 0;
        lookUpHost('started.host', () => n++, ignore, true);
        lookUpHost('started.host', () => n++, ignore, true);
        expect(lookups.length).toBe(1);
        lookUpHost('started.host', () => n++, ignore, true);
        expect(lookups.length).toBe(2);
        lookups[1]!.callback(null, '10.2.2.22', 4);
        expect(n).toBe(3);
    });

    it('aSupersedingLookUpThatHangsTooHoldsTheWaitersUntilItAnswersAndStartsNoThirdRegression', () => {
        let n = 0;
        lookUpHost('both.host', () => n++, ignore);
        lookUpHost('both.host', () => n++, ignore, true);
        lookUpHost('both.host', () => n++, ignore, true); // supersedes: lookups[1], which hangs too
        lookUpHost('both.host', () => n++, ignore, true); // joins lookups[1]
        lookUpHost('both.host', () => n++, ignore, true); // a superseded one is out: joins, starts no third
        expect(lookups.length).toBe(2);

        lookups[0]!.callback(null, '10.2.2.23', 4); // the superseded one answers first: fills the cache, calls no one
        expect(n).toBe(0);
        expect(cachedAddress('both.host')).toBe('10.2.2.23');

        lookups[1]!.callback(null, '10.2.2.24', 4); // newer: replaces the address and answers every waiter
        expect(n).toBe(5);
        expect(cachedAddress('both.host')).toBe('10.2.2.24');
    });

    it('aNewerFailedAnswerKeepsAnOlderLateAnswerOutOfTheCacheRegression', () => {
        // the newest answer wins even when it is a failure: an older late address is not taken after it
        lookUpHost('fail.host', ignore, ignore);
        lookUpHost('fail.host', ignore, ignore, true);
        lookUpHost('fail.host', ignore, ignore, true);
        expect(lookups.length).toBe(2);
        lookups[1]!.callback(new Error('ENOTFOUND'));
        lookups[0]!.callback(null, '10.2.2.25', 4);
        expect(InetAddress.nameCache.has('fail.host')).toBe(false);
    });

    it('aCachedHostWhoseWaiterThrowsGivesTheErrorToItsHandlerAndDoesNotThrowRegression', () => {
        // a throw from here reads as dns refusing the argument: the error of `done` goes to `onError` instead
        lookUpHost('cached.host', ignore, ignore);
        lookups[0]!.callback(null, '10.2.2.26', 4);
        const errors: string[] = [];
        expect(() =>
            lookUpHost(
                'cached.host',
                () => {
                    throw new Error('done');
                },
                (ex) => errors.push((ex as Error).message),
            ),
        ).not.toThrow();
        expect(errors).toEqual(['done']);
        expect(lookups.length).toBe(1);
    });

    it('aRefreshWhileOnlyPlainLookUpsAreOutJoinsWithoutSupersedingRegression', () => {
        let n = 0;
        lookUpHost('plain.host', () => n++, ignore);
        lookUpHost('plain.host', () => n++, ignore);
        lookUpHost('plain.host', () => n++, ignore, true);
        expect(lookups.length).toBe(1);
        lookUpHost('plain.host', () => n++, ignore); // a plain call never supersedes
        expect(lookups.length).toBe(1);
        lookups[0]!.callback(null, '10.2.2.14', 4);
        expect(n).toBe(4);
    });

    it('aSupersedingRefreshThatDnsRefusesLeavesTheOldLookUpWithItsWaitersRegression', () => {
        let n = 0;
        lookUpHost('refused.host', () => n++, ignore);
        lookUpHost('refused.host', () => n++, ignore, true);
        throwOnNext = true;
        expect(() => lookUpHost('refused.host', () => n++, ignore, true)).toThrowError('refused refused.host');
        expect(lookups.length).toBe(1);
        lookups[0]!.callback(null, '10.2.2.15', 4);
        expect(n).toBe(2);
    });
});
