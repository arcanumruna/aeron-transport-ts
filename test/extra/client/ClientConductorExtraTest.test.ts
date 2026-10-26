// Extra tests of T19 (port-only, spec D15, D57, D93, D94): the client conductor against a real `MediaDriver` of the same
// process, driven by the cycles of `EmbeddedRig` on a manual clock where time matters: the heartbeat counter that the
// client finds by its type id and its registration id (D57), the commands of the interaction matrix (same channel and
// stream twice, remove before the reply, a callback that makes a call, client timeout with resources live), and the
// connection of `Aeron.Context` to a driver.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CountersReader } from '../../../src/agrona/concurrent/status/CountersReader.js';
import { Aeron } from '../../../src/client/Aeron.js';
import type { ConcurrentPublication } from '../../../src/client/ConcurrentPublication.js';
import { AeronException } from '../../../src/client/exceptions/AeronException.js';
import { ConcurrentConcludeException } from '../../../src/client/exceptions/ConcurrentConcludeException.js';
import { ConductorServiceTimeoutException } from '../../../src/client/exceptions/ConductorServiceTimeoutException.js';
import { ConfigurationException } from '../../../src/client/exceptions/ConfigurationException.js';
import { DriverTimeoutException } from '../../../src/client/exceptions/DriverTimeoutException.js';
import type { Image } from '../../../src/client/Image.js';
import { HeartbeatTimestamp } from '../../../src/client/status/HeartbeatTimestamp.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import { ThreadingMode } from '../../../src/driver/ThreadingMode.js';
import { EmbeddedRig } from '../../support/EmbeddedRig.js';
import { freeUdpPort } from '../../support/Udp.js';
import type { AgentInvoker } from '../../../src/agrona/concurrent/AgentInvoker.js';

const STREAM_ID = 1001;

describe('ClientConductor extra', () => {
    const rigs: EmbeddedRig[] = [];
    const drivers: MediaDriver[] = [];

    afterEach(() => {
        for (const rig of rigs.splice(0)) {
            rig.close();
        }
        for (const driver of drivers.splice(0)) {
            driver.close();
        }
    });

    function newRig(manualClock = true, configureClient: (ctx: Aeron.Context) => void = () => {}): EmbeddedRig {
        const rig = new EmbeddedRig(manualClock, () => {}, configureClient);
        rigs.push(rig);
        return rig;
    }

    function newChannel(): string {
        return 'aeron:udp?endpoint=localhost:' + freeUdpPort();
    }

    it('theClientFindsItsHeartbeatCounterByTypeIdAndRegistrationIdAndKeepsItCurrent', async () => {
        const rig = newRig(true, (ctx) => ctx.clientName('extra-client'));
        const clientId = rig.aeron.clientId();
        const counters = rig.aeron.countersReader();
        rig.aeron.asyncAddPublication(newChannel(), STREAM_ID); // the driver knows a client from its first command

        // the driver allocates the counter when it first hears of the client, and sends no response about it (D57)
        await rig.until(
            () =>
                CountersReader.NULL_COUNTER_ID !==
                HeartbeatTimestamp.findCounterIdByRegistrationId(
                    counters,
                    HeartbeatTimestamp.HEARTBEAT_TYPE_ID,
                    clientId,
                ),
            'heartbeat counter',
        );
        const counterId = HeartbeatTimestamp.findCounterIdByRegistrationId(
            counters,
            HeartbeatTimestamp.HEARTBEAT_TYPE_ID,
            clientId,
        );

        // the keepalive interval is 500 ms of the clock: after a second the client has stamped the counter with its time
        await rig.until(
            () => counters.getCounterLabel(counterId).includes(' name=extra-client '),
            'client name in the label',
        );
        expect(counters.getCounterLabel(counterId)).toContain(' name=extra-client version=1.53.3 commit=');
        expect((rig.clock?.time() ?? 0) - counters.getCounterValue(counterId)).toBeLessThanOrEqual(600);
        expect(HeartbeatTimestamp.isActive(counters, counterId, HeartbeatTimestamp.HEARTBEAT_TYPE_ID, clientId)).toBe(
            true,
        );
        expect(rig.errors).toEqual([]);
    });

    it('theSameChannelAndStreamTwiceGivesTwoPublicationsOfTheSameStream', () => {
        const rig = newRig(false);
        const channel = newChannel();

        const first = rig.aeron.addPublication(channel, STREAM_ID) as ConcurrentPublication;
        const second = rig.aeron.addPublication(channel, STREAM_ID) as ConcurrentPublication;

        // not `expect(second).not.toBe(first)`: it formats the publication and the 16 MiB terms of its log for the message
        expect(second === first).toBe(false);
        expect(second.sessionId()).toBe(first.sessionId());
        expect(second.originalRegistrationId()).toBe(first.originalRegistrationId());
        expect(second.registrationId()).not.toBe(first.registrationId());

        // closing one leaves the other with its log
        first.close();
        expect(second.isClosed()).toBe(false);
        expect(second.maxMessageLength()).toBeGreaterThan(0);
    });

    it('removingASubscriptionBeforeTheReplyToItsAddLeavesNothingBehind', async () => {
        const rig = newRig();
        const registrationId = rig.aeron.asyncAddSubscription(newChannel(), STREAM_ID);

        rig.aeron.asyncRemoveSubscription(registrationId);

        await rig.until(() => !rig.aeron.hasActiveCommands(), 'idle client');
        expect(rig.aeron.getSubscription(registrationId)).toBeNull();
        expect(rig.errors).toEqual([]);
    });

    it('removingAPublicationBeforeTheReplyToItsAddLeavesNothingBehind', async () => {
        const rig = newRig();
        const registrationId = rig.aeron.asyncAddPublication(newChannel(), STREAM_ID);

        rig.aeron.asyncRemovePublication(registrationId);

        await rig.until(() => !rig.aeron.hasActiveCommands(), 'idle client');
        expect(rig.aeron.getPublication(registrationId)).toBeNull();
        expect(rig.errors).toEqual([]);
    });

    it('aCallbackThatCallsTheClientIsRefusedAndTheErrorGoesToTheErrorHandler', async () => {
        const rig = newRig();
        const channel = newChannel();
        const attempts: Error[] = [];
        const available = vi.fn((_image: Image) => {
            try {
                rig.aeron.addPublication(newChannel(), STREAM_ID);
            } catch (ex) {
                attempts.push(ex as Error);
                throw ex;
            }
        });
        rig.aeron.addSubscription(channel, STREAM_ID, { onAvailableImage: available }, null);
        rig.aeron.addPublication(channel, STREAM_ID);

        await rig.until(() => available.mock.calls.length > 0, 'available image');

        expect(attempts).toHaveLength(1);
        expect(attempts[0]).toBeInstanceOf(AeronException);
        expect(attempts[0]?.message).toBe('ERROR - reentrant calls not permitted during callbacks');
        expect(rig.errors).toContain(attempts[0]);
    });

    it('aClientThatTheDriverHasNotHeardFromTimesOutWithItsResourcesLive', () => {
        const rig = newRig();
        const publication = rig.aeron.asyncAddPublication(newChannel(), STREAM_ID);
        expect(publication).toBeGreaterThan(0);
        for (let i = 0; i < 20; i++) {
            rig.cycle();
        }
        const live = rig.aeron.getPublication(publication) as ConcurrentPublication;
        expect(live.isClosed()).toBe(false);

        // the driver runs alone for longer than the liveness timeout of the clients
        const clock = rig.clock as { ns: number };
        for (let i = 0; i < 12_000; i++) {
            clock.ns += 1_000_000;
            rig.driver.sharedAgentInvoker().invoke();
        }
        (rig.aeron.conductorAgentInvoker() as AgentInvoker).invoke();

        expect(rig.errors.some((e) => e instanceof ConductorServiceTimeoutException)).toBe(true);
        expect(live.isClosed()).toBe(true);
        expect(() => rig.aeron.addPublication(newChannel(), STREAM_ID)).toThrow(AeronException);
    });

    it('theConnectionTakesTheCncFromTheDriverAndTheInvokerOfTheDriverWithIt', () => {
        const driver = MediaDriver.launch(new MediaDriver.Context().threadingMode(ThreadingMode.INVOKER));
        drivers.push(driver);

        const ctx = new Aeron.Context().mediaDriver(driver).useConductorAgentInvoker(true);

        expect(ctx.driverAgentInvoker()).toBe(driver.sharedAgentInvoker());
        const aeron = Aeron.connect(ctx);
        try {
            expect(aeron.clientId()).toBeGreaterThan(0);
            expect(ctx.clientId()).toBe(aeron.clientId());
            expect(ctx.filePageSize()).toBe(driver.context().filePageSize());
            expect(ctx.interServiceTimeoutNs()).toBe(driver.context().clientLivenessTimeoutNs());
            expect(aeron.context()).toBe(ctx);
            expect(aeron.toString()).toBe('Aeron{isClosed=false, clientId=' + aeron.clientId() + '}');
        } finally {
            aeron.close();
        }
    });

    it('aDriverWithNoHeartbeatIsADriverTimeout', () => {
        const driver = MediaDriver.launch(new MediaDriver.Context().threadingMode(ThreadingMode.INVOKER));
        drivers.push(driver);
        // the client's clock is far ahead of the driver's last heartbeat
        const ctx = new Aeron.Context()
            .mediaDriver(driver)
            .useConductorAgentInvoker(true)
            .epochClock({ time: () => Date.now() + 3_600_000 });

        expect(() => Aeron.connect(ctx)).toThrow(DriverTimeoutException);
    });

    it('aContextConcludedTwiceIsRefused', () => {
        const driver = MediaDriver.launch(new MediaDriver.Context().threadingMode(ThreadingMode.INVOKER));
        drivers.push(driver);
        const ctx = new Aeron.Context().mediaDriver(driver).useConductorAgentInvoker(true);
        const aeron = Aeron.connect(ctx);
        try {
            expect(() => Aeron.connect(ctx)).toThrow(ConcurrentConcludeException);
        } finally {
            aeron.close();
        }
    });

    it('aContextWithoutADriverIsAConfigurationError', () => {
        const ctx = new Aeron.Context();

        expect(() => ctx.conclude()).toThrow(ConfigurationException);
    });

    it('theDriverTimeoutOfTheContextBoundsTheWaitForTheReplyOfADriverThatIsNotRun', () => {
        const rig = newRig(false, (ctx) => ctx.driverTimeoutMs(50).driverAgentInvoker(null));

        // no driver invoker: nothing runs the driver while the client waits, so the wait ends at the timeout
        expect(() => rig.aeron.addPublication(newChannel(), STREAM_ID)).toThrow(DriverTimeoutException);
    });
});
