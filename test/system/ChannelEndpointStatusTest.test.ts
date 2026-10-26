// Port of aeron-system-tests/src/test/java/io/aeron/ChannelEndpointStatusTest.java @ 1.53.3 (phase 3, T8, D115).
import { describe, expect, it } from 'vitest';
import { AeronException } from '../../src/client/exceptions/AeronException.js';
import { RegistrationException } from '../../src/client/exceptions/RegistrationException.js';
import { ChannelEndpointStatus } from '../../src/client/status/ChannelEndpointStatus.js';
import { InvalidChannelException } from '../../src/driver/exceptions/InvalidChannelException.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import type { Publication } from '../../src/client/Publication.js';
import { systemTests } from '../support/SystemTests.js';
import type { SystemTests, TestClient, TestNode } from '../support/SystemTests.js';

const URI = 'aeron:udp?endpoint=localhost:23456';
const URI_WITH_INTERFACE_PORT = 'aeron:udp?endpoint=localhost:23456|interface=localhost:24567';

const STREAM_ID = 1001;

const TERM_BUFFER_LENGTH = LogBufferDescriptor.TERM_MIN_LENGTH;

describe('ChannelEndpointStatusTest', () => {
    let tests: SystemTests;
    let driverA: TestNode;
    let driverB: TestNode;
    let clientA: TestClient;
    let clientB: TestClient;
    let testException: Error | null;

    // `ThreadingMode.DEDICATED` is `INVOKER` here (spec D3); the ports in use are not errors of the test
    function before(name: string): void {
        tests = systemTests(name, true);
        testException = null;

        const driverErrorHandler = {
            onError: (ex: Error): void => {
                if (
                    ex instanceof AeronException &&
                    (ex.message.includes('Address already in use') || ex.message.includes('EADDRINUSE'))
                ) {
                    return;
                } else if (ex instanceof InvalidChannelException) {
                    return;
                }

                testException = ex;
            },
        };

        driverA = tests.launch((context) =>
            context.publicationTermBufferLength(TERM_BUFFER_LENGTH).errorHandler(driverErrorHandler),
        );
        driverB = tests.launch((context) =>
            context.publicationTermBufferLength(TERM_BUFFER_LENGTH).errorHandler(driverErrorHandler),
        );
        clientA = driverA.clients[0] as TestClient;
        clientB = driverB.clients[0] as TestClient;
        // `clientC` is a third client of the driver B; none of the tests uses it
        tests.connect(driverB);
    }

    it('shouldErrorBadUri', () => {
        before('shouldErrorBadUri');
        expect(() => clientA.aeron.addSubscription('bad uri', STREAM_ID)).toThrow(RegistrationException);
    });

    it('shouldBeAbleToQueryChannelStatusForSubscription', async () => {
        before('shouldBeAbleToQueryChannelStatusForSubscription');
        const subscription = clientA.aeron.addSubscription(URI, STREAM_ID);

        await tests.drainUntil(
            () => subscription.channelStatus() !== ChannelEndpointStatus.INITIALIZING,
            undefined,
            () => 'a channel status that is not INITIALIZING',
        );

        expect(subscription.channelStatus()).toBe(ChannelEndpointStatus.ACTIVE);
        expect(testException).toBeNull();
    });

    it('shouldBeAbleToQueryChannelStatusForPublication', async () => {
        before('shouldBeAbleToQueryChannelStatusForPublication');
        const publication = clientA.aeron.addPublication(URI, STREAM_ID) as Publication;

        await tests.drainUntil(
            () => publication.channelStatus() !== ChannelEndpointStatus.INITIALIZING,
            undefined,
            () => 'a channel status that is not INITIALIZING',
        );

        expect(publication.channelStatus()).toBe(ChannelEndpointStatus.ACTIVE);
        expect(testException).toBeNull();
    });

    it('shouldCatchErrorOnAddressAlreadyInUseForPublications', async () => {
        before('shouldCatchErrorOnAddressAlreadyInUseForPublications');
        const publicationA = clientA.aeron.addPublication(URI_WITH_INTERFACE_PORT, STREAM_ID) as Publication;

        await tests.drainUntil(
            () => publicationA.channelStatus() !== ChannelEndpointStatus.INITIALIZING,
            undefined,
            () => 'a channel status that is not INITIALIZING',
        );

        expect(publicationA.channelStatus()).toBe(ChannelEndpointStatus.ACTIVE);

        let thrown: unknown = null;
        try {
            clientB.aeron.addPublication(URI_WITH_INTERFACE_PORT, STREAM_ID);
        } catch (ex) {
            thrown = ex;
        }

        // `fail("Should have thrown an exception")` unless a RegistrationException was thrown
        expect(thrown).toBeInstanceOf(RegistrationException);
        expect((thrown as RegistrationException).message).toContain(URI_WITH_INTERFACE_PORT);
    });
});
