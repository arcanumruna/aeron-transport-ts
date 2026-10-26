// Port of aeron-system-tests/src/test/java/io/aeron/FlowControlTests.java @ 1.53.3 (phase 3, T8, D115): the helpers that
// the flow control system tests share. `Tests.sleep(1)` loops are `drainUntil` (a turn is 1 ms of the manual clock).
import { CountersReader } from '../../src/agrona/concurrent/status/CountersReader.js';
import type { Subscription } from '../../src/client/Subscription.js';
import { SystemCounterDescriptor } from '../../src/driver/status/SystemCounterDescriptor.js';
import type { SystemTests } from './SystemTests.js';

export class FlowControlTests {
    /**
     * Waits for the subscriptions to be connected and then for as many status messages as there are subscriptions.
     */
    public static async awaitConnectionAndStatusMessages(
        tests: SystemTests,
        countersReader: CountersReader,
        subscription: Subscription,
        ...subscriptions: Subscription[]
    ): Promise<void> {
        await tests.drainUntil(
            () => subscription.isConnected(),
            undefined,
            () => 'a connected subscription ' + subscription.channel(),
        );

        for (const sub of subscriptions) {
            await tests.drainUntil(
                () => sub.isConnected(),
                undefined,
                () => 'a connected subscription ' + sub.channel(),
            );
        }

        const delta = 1 + subscriptions.length;
        await tests.awaitCounterDelta(countersReader, SystemCounterDescriptor.STATUS_MESSAGES_RECEIVED.id(), delta);
    }

    public static findCounterIdByRegistrationId(
        countersReader: CountersReader,
        counterTypeId: number,
        registrationId: number,
    ): number {
        const buffer = countersReader.metaDataBuffer();

        for (let counterId = 0, maxId = countersReader.maxCounterId(); counterId <= maxId; counterId++) {
            if (
                countersReader.getCounterState(counterId) === CountersReader.RECORD_ALLOCATED &&
                countersReader.getCounterTypeId(counterId) === counterTypeId
            ) {
                const recordOffset = CountersReader.metaDataOffset(counterId);
                if (buffer.getLong(recordOffset + CountersReader.KEY_OFFSET) === registrationId) {
                    return counterId;
                }
            }
        }

        return CountersReader.NULL_COUNTER_ID;
    }
}
