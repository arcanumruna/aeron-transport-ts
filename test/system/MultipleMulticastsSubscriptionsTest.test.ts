// Port of aeron-system-tests/src/test/java/io/aeron/MultipleMulticastsSubscriptionsTest.java @ 1.53.3 (phase 3, T6, D115).
import { describe, expect, it } from 'vitest';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import type { MediaDriver } from '../../src/driver/MediaDriver.js';
import { systemTests } from '../support/SystemTests.js';
import type { SystemTests, TestNode } from '../support/SystemTests.js';

describe('MultipleMulticastsSubscriptionsTest', () => {
    function launch(tests: SystemTests): TestNode {
        return tests.launch((context: MediaDriver.Context) =>
            context.publicationTermBufferLength(LogBufferDescriptor.TERM_MIN_LENGTH),
        );
    }

    it('shouldBindToMultipleMulticastAddressOnTheSamePort', async () => {
        const tests = systemTests('shouldBindToMultipleMulticastAddressOnTheSamePort');
        const driver = launch(tests);

        const uriA = 'aeron:udp?endpoint=239.192.11.87:20123|interface=127.0.0.1';
        const uriB = 'aeron:udp?endpoint=239.192.11.91:20123|interface=127.0.0.1';

        const aeron = driver.aeron;
        const pubA = aeron.addPublication(uriA, 10000)!;
        const pubB = aeron.addPublication(uriB, 10000)!;
        const subA = aeron.addSubscription(uriA, 10000);
        const subB = aeron.addSubscription(uriB, 10000);

        await tests.awaitConnected(pubA);
        await tests.awaitConnected(pubB);
        await tests.awaitConnected(subA);
        await tests.awaitConnected(subB);
        expect(tests.errors()).toEqual([]);
    });

    it('shouldBindToMultipleMulticastAddressOnTheSamePortAsMdsDestinations', async () => {
        const tests = systemTests('shouldBindToMultipleMulticastAddressOnTheSamePortAsMdsDestinations');
        const driver = launch(tests);

        const uriA = 'aeron:udp?endpoint=239.192.11.87:20123|interface=127.0.0.1';
        const uriB = 'aeron:udp?endpoint=239.192.11.91:20123|interface=127.0.0.1';
        const mdsSubscription = 'aeron:udp?control-mode=manual';

        const aeron = driver.aeron;
        const pubA = aeron.addPublication(uriA, 10000)!;
        const pubB = aeron.addPublication(uriB, 10000)!;
        const subA = aeron.addSubscription(mdsSubscription, 10000);
        const subB = aeron.addSubscription(mdsSubscription, 10000);
        subA.addDestination(uriA);
        subB.addDestination(uriB);

        await tests.awaitConnected(pubA);
        await tests.awaitConnected(pubB);
        await tests.awaitConnected(subA);
        await tests.awaitConnected(subB);
        expect(tests.errors()).toEqual([]);
    });

    it('shouldBindToMultipleMulticastAddressOnTheSamePortMixingMdsAndSubscriptions', async () => {
        const tests = systemTests('shouldBindToMultipleMulticastAddressOnTheSamePortMixingMdsAndSubscriptions');
        const driver = launch(tests);

        const uriA = 'aeron:udp?endpoint=239.192.11.87:20123|interface=127.0.0.1';
        const uriB = 'aeron:udp?endpoint=239.192.11.91:20123|interface=127.0.0.1';
        const mdsSubscription = 'aeron:udp?control-mode=manual';

        const aeron = driver.aeron;
        const pubA = aeron.addPublication(uriA, 10000)!;
        const pubB = aeron.addPublication(uriB, 10000)!;
        const subA = aeron.addSubscription(uriA, 10000);
        const subB = aeron.addSubscription(mdsSubscription, 10000);
        subB.addDestination(uriB);

        await tests.awaitConnected(pubA);
        await tests.awaitConnected(pubB);
        await tests.awaitConnected(subA);
        await tests.awaitConnected(subB);
        expect(tests.errors()).toEqual([]);
    });

    it('shouldMulticastSubscriptionsWithSamePortNotConflict', async () => {
        const tests = systemTests('shouldMulticastSubscriptionsWithSamePortNotConflict');
        const driver = launch(tests);

        const uriA = 'aeron:udp?endpoint=239.192.181.39:15492|interface=127.0.0.1';
        const uriB = 'aeron:udp?endpoint=239.192.181.99:15492|interface=127.0.0.1';

        let subAImages = 0;
        let subBImages = 0;
        const aeron = driver.aeron;
        const subA = aeron.addSubscription(
            uriA,
            9382,
            { onAvailableImage: () => void subAImages++ },
            { onUnavailableImage: () => {} },
        );
        const subB = aeron.addSubscription(
            uriB,
            9382,
            { onAvailableImage: () => void subBImages++ },
            { onUnavailableImage: () => {} },
        );
        const pub = aeron.addPublication(uriB, 9382);
        expect(subA).not.toBeNull();
        expect(subB).not.toBeNull();
        expect(pub).not.toBeNull();

        await tests.drainUntil(
            () => subBImages > 0,
            undefined,
            () => 'an image of subscription B',
        );

        expect(subAImages).toBe(0);
        expect(tests.errors()).toEqual([]);
    });
});
