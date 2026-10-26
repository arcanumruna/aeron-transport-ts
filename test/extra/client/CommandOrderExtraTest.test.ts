// Regression tests of the review of T18-T20 (port-only, spec D92): the commands of the client reach the driver in the
// order they were made, however the look-ups of host names complete; a command that fails to be written leaves nothing
// behind; a look-up that completes after close does nothing; a cached name is not looked up; and the unavailable image
// handler rethrows what Java's `catch (Exception)` does not catch. `dns.lookup` is a fake completed by hand.
import dns from 'node:dns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JavaError } from '../../../src/agrona/jdkLang.js';
import type { ClientConductor } from '../../../src/client/ClientConductor.js';
import type { DriverProxy } from '../../../src/client/DriverProxy.js';
import { RegistrationException } from '../../../src/client/exceptions/RegistrationException.js';
import type { ExclusivePublication } from '../../../src/client/ExclusivePublication.js';
import { DefaultNameResolver } from '../../../src/driver/DefaultNameResolver.js';
import { lookUpHost } from '../../../src/driver/HostNameLookup.js';
import { InetAddress } from '../../../src/driver/jdkNet.js';
import { EmbeddedRig } from '../../support/EmbeddedRig.js';
import { freeUdpPort } from '../../support/Udp.js';

type LookupCallback = (err: Error | null, address?: string, family?: number) => void;

const STREAM_ID = 1001;

describe('Command order (D92)', () => {
    let lookups: { host: string; callback: LookupCallback }[];
    let seen: string[];
    const rigs: EmbeddedRig[] = [];

    beforeEach(() => {
        lookups = [];
        seen = [];
        DefaultNameResolver.clearCache();
        vi.spyOn(dns, 'lookup').mockImplementation(((host: string, _options: unknown, callback: LookupCallback) => {
            lookups.push({ host, callback });
        }) as never);
    });

    afterEach(() => {
        for (const rig of rigs.splice(0)) {
            rig.close();
        }
        vi.restoreAllMocks();
        DefaultNameResolver.clearCache();
    });

    function newRig(manualClock = true): EmbeddedRig {
        const rig = new EmbeddedRig(manualClock);
        rigs.push(rig);
        return rig;
    }

    function proxyOf(rig: EmbeddedRig): DriverProxy {
        return rig.aeron.context().driverProxy() as DriverProxy;
    }

    function conductorOf(rig: EmbeddedRig): ClientConductor {
        return (rig.aeron as unknown as { conductor: ClientConductor }).conductor;
    }

    function cycles(rig: EmbeddedRig, count: number): void {
        for (let i = 0; i < count; i++) {
            rig.cycle();
        }
    }

    function complete(index: number): void {
        (lookups[index] as { callback: LookupCallback }).callback(null, '127.0.0.1', 4);
    }

    /** Records the commands that reach the driver, in order, by name and channel (or id). */
    function record(rig: EmbeddedRig): void {
        const proxy = proxyOf(rig);
        for (const name of [
            'addDestination',
            'removeDestination',
            'addRcvDestination',
            'removeRcvDestination',
            'addSubscription',
            'addPublication',
            'removePublication',
            'removeSubscription',
        ] as const) {
            const original = (proxy[name] as (...args: unknown[]) => number).bind(proxy);
            vi.spyOn(proxy, name).mockImplementation(((...args: unknown[]) => {
                seen.push(name + ':' + String(args[0]) + ':' + String(args[1] ?? ''));
                return original(...args);
            }) as never);
        }
    }

    async function manualPublication(rig: EmbeddedRig): Promise<ExclusivePublication> {
        const id = rig.aeron.asyncAddExclusivePublication('aeron:udp?control-mode=manual', STREAM_ID);
        await rig.until(() => null !== rig.aeron.getExclusivePublication(id), 'manual publication');
        return rig.aeron.getExclusivePublication(id) as ExclusivePublication;
    }

    it('anAddThenARemoveOfTheSameDestinationReachTheDriverInOrderWhenTheRemoveLookUpFinishesFirstRegression', async () => {
        const rig = newRig();
        const publication = await manualPublication(rig);
        record(rig);
        const hostA = 'aeron:udp?endpoint=host-a.example:' + freeUdpPort();

        const addId = publication.asyncAddDestination(hostA);
        const removeId = publication.asyncRemoveDestination(hostA);
        expect(lookups.map((l) => l.host)).toEqual(['host-a.example', 'host-a.example']);

        complete(1); // the remove's look-up finishes first
        cycles(rig, 20);
        expect(seen).toEqual([]);

        complete(0);
        cycles(rig, 20);
        expect(seen).toEqual([
            'addDestination:' + publication.registrationId() + ':' + hostA,
            'removeDestination:' + publication.registrationId() + ':' + hostA,
        ]);
        expect(rig.aeron.isCommandActive(addId)).toBe(false);
        expect(rig.aeron.isCommandActive(removeId)).toBe(false);
    });

    it('aRemoveDestinationByIdBehindAPendingAddIsWrittenAfterItRegression', async () => {
        const rig = newRig();
        const publication = await manualPublication(rig);
        record(rig);
        const hostA = 'aeron:udp?endpoint=host-a.example:' + freeUdpPort();

        const addId = publication.asyncAddDestination(hostA);
        const removeId = publication.asyncRemoveDestination(addId);
        expect(rig.aeron.isCommandActive(removeId)).toBe(true);

        cycles(rig, 20);
        expect(seen).toEqual([]);

        complete(0);
        cycles(rig, 20);
        expect(seen).toEqual([
            'addDestination:' + publication.registrationId() + ':' + hostA,
            'removeDestination:' + publication.registrationId() + ':' + addId,
        ]);
    });

    it('anAddSubscriptionWithAnIpLiteralBehindAPendingAddIsWrittenAfterItRegression', async () => {
        const rig = newRig();
        const publication = await manualPublication(rig);
        record(rig);
        const hostA = 'aeron:udp?endpoint=host-a.example:' + freeUdpPort();
        const literal = 'aeron:udp?endpoint=127.0.0.1:' + freeUdpPort();

        publication.asyncAddDestination(hostA);
        const subscriptionId = rig.aeron.asyncAddSubscription(literal, STREAM_ID);
        expect(rig.aeron.isCommandActive(subscriptionId)).toBe(true);

        cycles(rig, 20);
        expect(seen).toEqual([]);

        complete(0);
        cycles(rig, 20);
        expect(seen).toEqual([
            'addDestination:' + publication.registrationId() + ':' + hostA,
            'addSubscription:' + literal + ':' + STREAM_ID,
        ]);
    });

    it('aCommandBehindAnEarlierWaitingOneDoesNotLeaveBeforeItEvenWhenItsOwnLookUpIsDoneRegression', async () => {
        const rig = newRig();
        const publication = await manualPublication(rig);
        record(rig);
        const hostA = 'aeron:udp?endpoint=host-a.example:' + freeUdpPort();
        const hostB = 'aeron:udp?endpoint=host-b.example:' + freeUdpPort();

        publication.asyncAddDestination(hostA);
        publication.asyncAddDestination(hostB);
        complete(1);
        cycles(rig, 20);
        expect(seen).toEqual([]);

        complete(0);
        cycles(rig, 20);
        expect(seen.map((s) => s.split(':')[0])).toEqual(['addDestination', 'addDestination']);
        expect(seen[0]).toContain('host-a.example');
        expect(seen[1]).toContain('host-b.example');
    });

    it('aSynchronousCallBehindAQueuedCommandWritesTheQueueFirstAndDoesNotWaitForTheEventLoopRegression', async () => {
        const rig = newRig(false);
        const publication = await manualPublication(rig);
        record(rig);
        const hostA = 'aeron:udp?endpoint=host-a.example:' + freeUdpPort();
        const literal = 'aeron:udp?endpoint=127.0.0.1:' + freeUdpPort();

        publication.asyncAddDestination(hostA); // waits for a look-up that nothing completes
        publication.addDestination(literal); // synchronous: must neither hang nor overtake

        expect(seen).toEqual([
            'addDestination:' + publication.registrationId() + ':' + hostA,
            'addDestination:' + publication.registrationId() + ':' + literal,
        ]);
    });

    it('afterTheQueueIsEmptyACommandWithoutNamesIsWrittenAtOnceRegression', async () => {
        const rig = newRig();
        const publication = await manualPublication(rig);
        record(rig);
        const hostA = 'aeron:udp?endpoint=host-a.example:' + freeUdpPort();
        const literal = 'aeron:udp?endpoint=127.0.0.1:' + freeUdpPort();

        publication.asyncAddDestination(hostA);
        complete(0);
        cycles(rig, 20);
        seen.length = 0;

        rig.aeron.asyncAddSubscription(literal, STREAM_ID);
        expect(seen).toEqual(['addSubscription:' + literal + ':' + STREAM_ID]);
    });

    it('aFailedQueuedSendLeavesNoPendingSubscriptionInTheResourceMapRegression', () => {
        const rig = newRig();
        vi.spyOn(proxyOf(rig), 'addSubscription').mockImplementation((() => {
            throw new Error('ring full');
        }) as never);
        const channel = 'aeron:udp?endpoint=host-a.example:' + freeUdpPort();

        const id = rig.aeron.asyncAddSubscription(channel, STREAM_ID);
        const map = (conductorOf(rig) as unknown as { resourceByRegIdMap: { get(id: number): unknown } })
            .resourceByRegIdMap;
        expect(map.get(id) === null).toBe(false);

        complete(0);
        cycles(rig, 5);

        expect(map.get(id) === null).toBe(true);
        expect(() => rig.aeron.getSubscription(id)).toThrow(RegistrationException);
        expect(rig.aeron.isCommandActive(id)).toBe(false);
    });

    it('aFailedQueuedSendOfAPublicationLeavesTheCommandAnsweredWithTheErrorRegression', () => {
        const rig = newRig();
        vi.spyOn(proxyOf(rig), 'addPublication').mockImplementation((() => {
            throw new Error('ring full');
        }) as never);
        const channel = 'aeron:udp?endpoint=host-a.example:' + freeUdpPort();

        const id = rig.aeron.asyncAddPublication(channel, STREAM_ID);
        complete(0);
        cycles(rig, 5);

        expect(() => rig.aeron.getPublication(id)).toThrow(RegistrationException);
        expect(rig.aeron.isCommandActive(id)).toBe(false);
    });

    it('aLookUpThatCompletesAfterCloseSendsNothingAndDoesNotWakeTheRunnerRegression', () => {
        const rig = newRig();
        const addPublication = vi.spyOn(proxyOf(rig), 'addPublication');
        const wakeUp = vi.fn();
        rig.aeron.setWakeUp(wakeUp);

        rig.aeron.asyncAddPublication('aeron:udp?endpoint=host-a.example:' + freeUdpPort(), STREAM_ID);
        rig.aeron.close();
        complete(0);

        expect(addPublication).not.toHaveBeenCalled();
        expect(wakeUp).not.toHaveBeenCalled();
        expect(rig.errors).toEqual([]);
    });
});

describe('lookUpHost cache (D92)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        DefaultNameResolver.clearCache();
    });

    it('aCachedNameIsNotLookedUpAgainRegression', () => {
        DefaultNameResolver.clearCache();
        DefaultNameResolver.cache('Cached.Example', InetAddress.getByName('127.0.0.1'));
        const lookup = vi.spyOn(dns, 'lookup');
        const done = vi.fn();

        lookUpHost('cached.example', done);

        expect(lookup).not.toHaveBeenCalled();
        expect(done).toHaveBeenCalledTimes(1);
    });

    it('aRefreshLooksUpACachedNameAgainRegression', () => {
        DefaultNameResolver.clearCache();
        DefaultNameResolver.cache('cached.example', InetAddress.getByName('127.0.0.1'));
        const lookup = vi.spyOn(dns, 'lookup').mockImplementation((() => {}) as never);

        lookUpHost('cached.example', () => {}, true);

        expect(lookup).toHaveBeenCalledTimes(1);
    });

    it('aNameThatIsNotCachedIsLookedUpRegression', () => {
        DefaultNameResolver.clearCache();
        const lookup = vi.spyOn(dns, 'lookup').mockImplementation((() => {}) as never);

        lookUpHost('other.example', () => {});

        expect(lookup).toHaveBeenCalledTimes(1);
    });
});

describe('notifyImageUnavailable (D96)', () => {
    it('aJavaErrorFromTheHandlerPropagatesRegression', () => {
        const rig = new EmbeddedRig(true);
        try {
            const conductor = conductorOfRig(rig);
            const error = new JavaError('fatal');
            const handler = {
                onUnavailableImage: () => {
                    throw error;
                },
            };

            expect(() => conductor.notifyImageUnavailable(handler, {})).toThrow(error);
            expect(rig.errors).toEqual([]);
        } finally {
            rig.close();
        }
    });

    it('anOrdinaryExceptionFromTheHandlerIsToldToTheErrorHandlerRegression', () => {
        const rig = new EmbeddedRig(true);
        try {
            const conductor = conductorOfRig(rig);
            const handler = {
                onUnavailableImage: () => {
                    throw new Error('ordinary');
                },
            };

            conductor.notifyImageUnavailable(handler, {});
            expect(rig.errors.map((e) => e.message)).toEqual(['ordinary']);
        } finally {
            rig.close();
        }
    });
});

function conductorOfRig(rig: EmbeddedRig): {
    notifyImageUnavailable(handler: { onUnavailableImage(image: unknown): void }, image: unknown): void;
} {
    return (rig.aeron as unknown as { conductor: never }).conductor;
}
