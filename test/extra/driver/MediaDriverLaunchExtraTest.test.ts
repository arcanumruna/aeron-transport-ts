// Extra tests of T18 (port-only, spec D3, D54): the launch of the `MediaDriver` as `INVOKER` (whatever the threading mode
// of the context says), the order of its agents, and the conductor through the client protocol of one driver: a
// command written to the command ring is answered on the broadcast buffer of the CnC. The IPC, spy and counter
// commands are refused or unknown.
import { afterEach, describe, expect, it } from 'vitest';
import { BroadcastReceiver } from '../../../src/agrona/concurrent/broadcast/BroadcastReceiver.js';
import { CopyBroadcastReceiver } from '../../../src/agrona/concurrent/broadcast/CopyBroadcastReceiver.js';
import { ControlProtocolEvents } from '../../../src/client/command/ControlProtocolEvents.js';
import { CncFileDescriptor } from '../../../src/client/CncFileDescriptor.js';
import { ErrorCode } from '../../../src/client/ErrorCode.js';
import { ConcurrentConcludeException } from '../../../src/client/exceptions/ConcurrentConcludeException.js';
import { ErrorResponseFlyweight } from '../../../src/client/command/ErrorResponseFlyweight.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import { ThreadingMode } from '../../../src/driver/ThreadingMode.js';
import { DriverProxy } from '../../../src/client/DriverProxy.js';
import { freeUdpPort } from '../../support/Udp.js';

const { ON_ERROR, ON_OPERATION_SUCCESS, ON_PUBLICATION_READY, ON_SUBSCRIPTION_READY } = ControlProtocolEvents;
const MAX_INVOKES = 10_000;

interface Response {
    readonly msgTypeId: number;
    readonly correlationId: number;
    readonly errorCode: number;
}

describe('MediaDriver launch', () => {
    const drivers: MediaDriver[] = [];

    afterEach(() => {
        for (const driver of drivers.splice(0)) {
            driver.close();
        }
    });

    function launch(ctx: MediaDriver.Context = new MediaDriver.Context()): MediaDriver {
        const driver = MediaDriver.launch(ctx);
        drivers.push(driver);
        return driver;
    }

    function clientOf(driver: MediaDriver) {
        const ctx = driver.context();
        const toClients = CncFileDescriptor.createToClientsBuffer(
            ctx.cncByteBuffer() as SharedArrayBuffer,
            CncFileDescriptor.createMetaDataBuffer(ctx.cncByteBuffer() as SharedArrayBuffer),
        );
        const receiver = new CopyBroadcastReceiver(new BroadcastReceiver(toClients));
        const proxy = new DriverProxy(ctx.toDriverCommands()!, ctx.toDriverCommands()!.nextCorrelationId());
        const responses: Response[] = [];
        const errorResponse = new ErrorResponseFlyweight();

        return {
            proxy,
            responses,
            /** Invoke the driver until a response to the correlation id arrives. */
            await(correlationId: number): Response {
                for (let i = 0; i < MAX_INVOKES; i++) {
                    driver.sharedAgentInvoker().invoke();
                    receiver.receive({
                        onMessage: (msgTypeId, buffer, index) => {
                            if (ON_ERROR === msgTypeId) {
                                errorResponse.wrap(buffer, index);
                                responses.push({
                                    msgTypeId,
                                    correlationId: errorResponse.offendingCommandCorrelationId(),
                                    errorCode: errorResponse.errorCode().value(),
                                });
                            } else if (ON_PUBLICATION_READY === msgTypeId || ON_SUBSCRIPTION_READY === msgTypeId) {
                                responses.push({ msgTypeId, correlationId: buffer.getLong(index), errorCode: 0 });
                            } else if (ON_OPERATION_SUCCESS === msgTypeId) {
                                responses.push({ msgTypeId, correlationId: buffer.getLong(index), errorCode: 0 });
                            }
                        },
                    });
                    const found = responses.find((r) => r.correlationId === correlationId);
                    if (undefined !== found) {
                        return found;
                    }
                }
                throw new Error('no response to ' + correlationId);
            },
        };
    }

    it('steps the agents from an invoker in order whatever the threading mode, and runs them on the event loop unless INVOKER', () => {
        for (const mode of ThreadingMode.values()) {
            const driver = launch(new MediaDriver.Context().threadingMode(mode));

            // spec D100: the invoker is the driver's agent in every mode; a mode that is not INVOKER has a runner for it
            expect(null === driver.runner()).toBe(ThreadingMode.INVOKER === mode);
            const invoker = driver.sharedAgentInvoker();
            expect(invoker.isStarted()).toBe(true);
            expect(invoker.isRunning()).toBe(true);
            expect(invoker.agent().roleName()).toBe('[sender,receiver,aeron-md-nra,driver-conductor]');
            expect(driver.context().isConcluded()).toBe(true);
            expect(driver.toString()).toBe('MediaDriver{}');
        }
    });

    it('launches with a default context', () => {
        const driver = MediaDriver.launch();
        drivers.push(driver);

        expect(driver.sharedAgentInvoker().isRunning()).toBe(true);
        expect(driver.sharedAgentInvoker().invoke()).toBeGreaterThanOrEqual(0);
    });

    it('closes the invoker, the agents and the context, and closing twice is harmless', () => {
        const driver = launch();
        const ctx = driver.context();

        driver.close();
        driver.close();

        expect(driver.sharedAgentInvoker().isClosed()).toBe(true);
        expect(ctx.toDriverCommands()!.consumerHeartbeatTime()).toBe(-1);
    });

    it('does not launch a driver on a context that was concluded', () => {
        const ctx = new MediaDriver.Context().conclude();

        expect(() => MediaDriver.launch(ctx)).toThrowError(ConcurrentConcludeException);
        ctx.close();
    });

    it('answers a publication, a subscription, and the removal of both', () => {
        const driver = launch();
        const client = clientOf(driver);
        const endpoint = 'aeron:udp?endpoint=127.0.0.1:' + freeUdpPort();

        const pubId = client.proxy.addPublication(endpoint, 1001);
        expect(client.await(pubId).msgTypeId).toBe(ON_PUBLICATION_READY);

        const subId = client.proxy.addSubscription('aeron:udp?endpoint=127.0.0.1:' + freeUdpPort(), 1001);
        expect(client.await(subId).msgTypeId).toBe(ON_SUBSCRIPTION_READY);

        const removePub = client.proxy.removePublication(pubId, false);
        expect(client.await(removePub).msgTypeId).toBe(ON_OPERATION_SUCCESS);
        const removeSub = client.proxy.removeSubscription(subId);
        expect(client.await(removeSub).msgTypeId).toBe(ON_OPERATION_SUCCESS);
    });

    it.each([
        ['an IPC publication', (p: DriverProxy) => p.addPublication('aeron:ipc', 1)],
        ['an IPC subscription', (p: DriverProxy) => p.addSubscription('aeron:ipc', 1)],
        ['a spy subscription', (p: DriverProxy) => p.addSubscription('aeron-spy:aeron:udp?endpoint=127.0.0.1:4000', 1)],
    ])('refuses %s as an invalid channel', (_name, command) => {
        const driver = launch();
        const client = clientOf(driver);

        const response = client.await(command(client.proxy));

        expect(response.msgTypeId).toBe(ON_ERROR);
        expect(response.errorCode).toBe(ErrorCode.INVALID_CHANNEL.value());
    });

    it.each([
        ['an IPC destination', 'aeron:ipc'],
        ['a spy destination', 'aeron-spy:aeron:udp?endpoint=127.0.0.1:4000'],
    ])('refuses to add and remove a receive destination that is %s', (_name, destination) => {
        const driver = launch();
        const client = clientOf(driver);

        const add = client.await(client.proxy.addRcvDestination(1, destination));
        const remove = client.await(client.proxy.removeRcvDestination(1, destination));

        expect(add.errorCode).toBe(ErrorCode.INVALID_CHANNEL.value());
        expect(remove.errorCode).toBe(ErrorCode.INVALID_CHANNEL.value());
    });
});
