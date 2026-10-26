// Extra tests of T19 (port-only, spec D7, D92): a host name in a channel is looked up with `dns.lookup(name, { order:
// 'ipv4first' })` before the command that carries it is written to the driver. The conductor never waits for the look-up:
// an `async` add gets its registration id at once, the command is held and written from a duty cycle after the look-up is
// done, and removing it meanwhile cancels it. `dns.lookup` is replaced by a fake that the test completes by hand.
import dns from 'node:dns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Aeron } from '../../../src/client/Aeron.js';
import type { DriverProxy } from '../../../src/client/DriverProxy.js';
import { RegistrationException } from '../../../src/client/exceptions/RegistrationException.js';
import { DefaultNameResolver } from '../../../src/driver/DefaultNameResolver.js';
import { hostToLookUp, hostsToLookUp } from '../../../src/driver/HostNameLookup.js';
import { EmbeddedRig } from '../../support/EmbeddedRig.js';
import { freeUdpPort } from '../../support/Udp.js';

type LookupCallback = (err: Error | null, address?: string, family?: number) => void;

const STREAM_ID = 1001;

describe('hostsToLookUp', () => {
    it.each([
        ['aeron:udp?endpoint=my-host.example:40124', ['my-host.example']],
        ['aeron:udp?endpoint=a.example:40124|interface=b.example:40123', ['a.example', 'b.example']],
        ['aeron:udp?endpoint=a.example:40124|interface=a.example:40123', ['a.example']],
        ['aeron:udp?control=c.example:40124|control-mode=dynamic', ['c.example']],
        ['aeron:udp?endpoint=a.example:40124|response-endpoint=r.example:40125', ['a.example', 'r.example']],
        ['aeron:udp?endpoint=localhost:40124', []],
        ['aeron:udp?endpoint=LOCALHOST:40124', []],
        ['aeron:udp?endpoint=127.0.0.1:40124', []],
        ['aeron:udp?endpoint=[::1]:40124', []],
        ['aeron:udp?endpoint=0.0.0.0:0', []],
        ['aeron:udp?endpoint=tag:1234', []],
        ['aeron:udp?endpoint=localhost:40124|interface=192.168.0.0/24', []],
        ['aeron:udp?endpoint=localhost:40124|interface=eth0', []],
        ['aeron:udp?control-mode=manual', []],
        ['aeron:udp?endpoint=-bad-.example:40124', []],
        ['aeron:ipc', []],
        ['aeron-spy:aeron:udp?endpoint=a.example:40124', []],
        ['not a channel', []],
        ['aeron:udp?endpoint=a.example:40124|' + 'x=y|'.repeat(1100), []],
    ])('%s', (channel, expected) => {
        expect(hostsToLookUp(channel)).toEqual(expected);
    });

    it.each([
        ['my-host.example:5050', 'my-host.example'],
        ['10.0.0.1:5050', null],
        ['localhost:5050', null],
        ['tag:5', null],
        ['no-port', null],
        ['[::1]:5050', null],
        [':5050', null],
    ])('hostToLookUp %s', (endpoint, expected) => {
        expect(hostToLookUp(endpoint)).toBe(expected);
    });
});

describe('Host name resolution', () => {
    let lookups: { host: string; options: unknown; callback: LookupCallback }[];
    const rigs: EmbeddedRig[] = [];

    beforeEach(() => {
        lookups = [];
        DefaultNameResolver.clearCache();
        vi.spyOn(dns, 'lookup').mockImplementation(((host: string, options: unknown, callback: LookupCallback) => {
            lookups.push({ host, options, callback });
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

    function cycles(rig: EmbeddedRig, count: number): void {
        for (let i = 0; i < count; i++) {
            rig.cycle();
        }
    }

    it('anAsyncAddKeepsTheCommandUntilTheLookUpIsDoneThenWritesItWithTheRegistrationIdItReturned', async () => {
        const rig = newRig();
        const proxy = proxyOf(rig);
        const addExclusivePublication = vi.spyOn(proxy, 'addExclusivePublication');
        const channel = 'aeron:udp?endpoint=my-host.example:' + freeUdpPort();

        const registrationId = rig.aeron.asyncAddExclusivePublication(channel, STREAM_ID);

        expect(lookups.map((l) => l.host)).toEqual(['my-host.example']);
        expect(lookups[0]?.options).toEqual({ order: 'ipv4first' });
        expect(rig.aeron.isCommandActive(registrationId)).toBe(true);

        // the conductor goes on while the look-up is out, and the command is not written
        cycles(rig, 50);
        expect(addExclusivePublication).not.toHaveBeenCalled();
        expect(rig.aeron.getExclusivePublication(registrationId)).toBeNull();
        expect(rig.aeron.isCommandActive(registrationId)).toBe(true);

        (lookups[0] as { callback: LookupCallback }).callback(null, '127.0.0.1', 4);
        expect(addExclusivePublication).not.toHaveBeenCalled(); // written by a duty cycle, not by the callback

        await rig.until(() => null !== rig.aeron.getExclusivePublication(registrationId), 'publication');
        expect(addExclusivePublication).toHaveBeenCalledTimes(1);
        expect(addExclusivePublication).toHaveBeenCalledWith(channel, STREAM_ID, registrationId);
        expect(rig.aeron.getExclusivePublication(registrationId)?.registrationId()).toBe(registrationId);
        expect(rig.aeron.isCommandActive(registrationId)).toBe(false);
        expect(rig.errors).toEqual([]);
    });

    it('theCommandWaitsForEveryHostOfTheChannel', async () => {
        const rig = newRig();
        const addSubscription = vi.spyOn(proxyOf(rig), 'addSubscription');
        const port = freeUdpPort();
        const channel = 'aeron:udp?endpoint=a.example:' + port + '|interface=b.example:0';

        const registrationId = rig.aeron.asyncAddSubscription(channel, STREAM_ID);
        expect(lookups.map((l) => l.host)).toEqual(['a.example', 'b.example']);

        (lookups[0] as { callback: LookupCallback }).callback(null, '127.0.0.1', 4);
        cycles(rig, 10);
        expect(addSubscription).not.toHaveBeenCalled();

        (lookups[1] as { callback: LookupCallback }).callback(null, '127.0.0.1', 4);
        cycles(rig, 10);
        expect(addSubscription).toHaveBeenCalledTimes(1);
        expect(addSubscription).toHaveBeenCalledWith(channel, STREAM_ID, registrationId);
    });

    it('removingTheRegistrationWhileTheLookUpIsOutCancelsTheCommand', () => {
        const rig = newRig();
        const proxy = proxyOf(rig);
        const addPublication = vi.spyOn(proxy, 'addPublication');
        const removePublication = vi.spyOn(proxy, 'removePublication');
        const channel = 'aeron:udp?endpoint=my-host.example:' + freeUdpPort();

        const registrationId = rig.aeron.asyncAddPublication(channel, STREAM_ID);
        expect(rig.aeron.isCommandActive(registrationId)).toBe(true);

        rig.aeron.asyncRemovePublication(registrationId);
        expect(rig.aeron.isCommandActive(registrationId)).toBe(false);
        expect(rig.aeron.hasActiveCommands()).toBe(false);

        (lookups[0] as { callback: LookupCallback }).callback(null, '127.0.0.1', 4);
        cycles(rig, 50);

        // neither the add nor the remove reaches the driver
        expect(addPublication).not.toHaveBeenCalled();
        expect(removePublication).not.toHaveBeenCalled();
        expect(rig.aeron.getPublication(registrationId)).toBeNull();
        expect(rig.errors).toEqual([]);
    });

    it('removingASubscriptionWhileTheLookUpIsOutCancelsTheCommand', () => {
        const rig = newRig();
        const proxy = proxyOf(rig);
        const addSubscription = vi.spyOn(proxy, 'addSubscription');
        const removeSubscription = vi.spyOn(proxy, 'removeSubscription');
        const channel = 'aeron:udp?endpoint=my-host.example:' + freeUdpPort();

        const registrationId = rig.aeron.asyncAddSubscription(channel, STREAM_ID);
        rig.aeron.asyncRemoveSubscription(registrationId);
        expect(rig.aeron.isCommandActive(registrationId)).toBe(false);

        (lookups[0] as { callback: LookupCallback }).callback(null, '127.0.0.1', 4);
        cycles(rig, 50);

        expect(addSubscription).not.toHaveBeenCalled();
        expect(removeSubscription).not.toHaveBeenCalled();
        expect(rig.aeron.getSubscription(registrationId)).toBeNull();
    });

    it('aNameThatDoesNotResolveIsAnsweredByTheDriverWithTheUnknownHostError', async () => {
        const rig = newRig();
        const channel = 'aeron:udp?endpoint=nowhere.example:' + freeUdpPort();

        const registrationId = rig.aeron.asyncAddExclusivePublication(channel, STREAM_ID);
        (lookups[0] as { callback: LookupCallback }).callback(new Error('ENOTFOUND'));

        let error: unknown = null;
        await rig.until(() => {
            try {
                return null !== rig.aeron.getExclusivePublication(registrationId);
            } catch (ex) {
                error = ex;
                return true;
            }
        }, 'answer');

        expect(error).toBeInstanceOf(RegistrationException);
        expect((error as Error).message).toContain('nowhere.example');
        expect(rig.aeron.isCommandActive(registrationId)).toBe(false);
    });

    it('aChannelWithoutADnsNameIsWrittenAtOnceWithNoLookUp', () => {
        const rig = newRig();
        const addPublication = vi.spyOn(proxyOf(rig), 'addPublication');
        const channel = 'aeron:udp?endpoint=localhost:' + freeUdpPort();

        const registrationId = rig.aeron.asyncAddPublication(channel, STREAM_ID);

        expect(lookups).toEqual([]);
        expect(addPublication).toHaveBeenCalledTimes(1);
        // the proxy allocated the id, as in Java: no id is passed
        expect(addPublication).toHaveBeenCalledWith(channel, STREAM_ID);
        expect(rig.aeron.isCommandActive(registrationId)).toBe(true);
    });

    it('asyncAddRcvDestinationWaitsForTheNameOfTheDestination', async () => {
        const rig = newRig();
        const proxy = proxyOf(rig);
        const addRcvDestination = vi.spyOn(proxy, 'addRcvDestination');
        const subscription = (() => {
            const id = rig.aeron.asyncAddSubscription('aeron:udp?control-mode=manual', STREAM_ID);
            return id;
        })();
        await rig.until(() => null !== rig.aeron.getSubscription(subscription), 'manual subscription');
        const manual = rig.aeron.getSubscription(subscription) as NonNullable<ReturnType<Aeron['getSubscription']>>;

        const destination = 'aeron:udp?endpoint=dest.example:' + freeUdpPort();
        const correlationId = manual.asyncAddDestination(destination);

        expect(lookups.map((l) => l.host)).toEqual(['dest.example']);
        cycles(rig, 20);
        expect(addRcvDestination).not.toHaveBeenCalled();
        expect(rig.aeron.isCommandActive(correlationId)).toBe(true);

        (lookups[0] as { callback: LookupCallback }).callback(null, '127.0.0.1', 4);
        await rig.until(() => !rig.aeron.isCommandActive(correlationId), 'destination added');
        expect(addRcvDestination).toHaveBeenCalledWith(subscription, destination, correlationId);
        expect(rig.errors).toEqual([]);
    });

    it('resolveChannelHostsMakesTheSynchronousAddWork', async () => {
        const rig = newRig(false);
        const channel = 'aeron:udp?endpoint=my-host.example:' + freeUdpPort();

        const resolved = rig.aeron.resolveChannelHosts(channel);
        expect(lookups.map((l) => l.host)).toEqual(['my-host.example']);
        (lookups[0] as { callback: LookupCallback }).callback(null, '127.0.0.1', 4);
        await resolved;

        const publication = rig.aeron.addExclusivePublication(channel, STREAM_ID);
        expect(publication).not.toBeNull();
    });

    it('theSynchronousAddWithANameThatWasNotResolvedFailsWithTheUnknownHostError', () => {
        const rig = newRig(false);

        expect(() =>
            rig.aeron.addExclusivePublication('aeron:udp?endpoint=unresolved.example:' + freeUdpPort(), STREAM_ID),
        ).toThrow(RegistrationException);
        expect(lookups).toEqual([]);
    });

    it('closingTheClientWhileTheLookUpIsOutLeavesNothingToWriteAndNothingToFail', () => {
        const rig = newRig();
        const addPublication = vi.spyOn(proxyOf(rig), 'addPublication');
        const wakeUp = vi.fn();
        rig.aeron.setWakeUp(wakeUp);

        rig.aeron.asyncAddPublication('aeron:udp?endpoint=my-host.example:' + freeUdpPort(), STREAM_ID);
        rig.aeron.close();

        (lookups[0] as { callback: LookupCallback }).callback(null, '127.0.0.1', 4);

        expect(addPublication).not.toHaveBeenCalled();
        expect(wakeUp).not.toHaveBeenCalled(); // a closed conductor is not woken
        expect(rig.errors).toEqual([]);
    });

    it('theConductorIsToldWhenALookUpIsDone', () => {
        const rig = newRig();
        const wakeUp = vi.fn();
        rig.aeron.setWakeUp(wakeUp);

        rig.aeron.asyncAddPublication('aeron:udp?endpoint=my-host.example:' + freeUdpPort(), STREAM_ID);
        expect(wakeUp).not.toHaveBeenCalled();

        (lookups[0] as { callback: LookupCallback }).callback(null, '127.0.0.1', 4);
        expect(wakeUp).toHaveBeenCalledTimes(1);
    });

    it('aLookUpThatThrowsAtOnceLeavesTheNameUnresolvedAndTheCommandIsWritten', async () => {
        const rig = newRig();
        const addPublication = vi.spyOn(proxyOf(rig), 'addPublication');
        vi.mocked(dns.lookup).mockImplementation((() => {
            throw new TypeError('the argument is refused');
        }) as never);

        const registrationId = rig.aeron.asyncAddPublication(
            'aeron:udp?endpoint=my-host.example:' + freeUdpPort(),
            STREAM_ID,
        );

        let error: unknown = null;
        await rig.until(() => {
            try {
                return null !== rig.aeron.getPublication(registrationId);
            } catch (ex) {
                error = ex;
                return true;
            }
        }, 'answer');
        expect(addPublication).toHaveBeenCalledTimes(1);
        expect(error).toBeInstanceOf(RegistrationException);
    });
});
