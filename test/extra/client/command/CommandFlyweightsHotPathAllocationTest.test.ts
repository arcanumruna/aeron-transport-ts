// Not in Aeron: the command flyweights are on the client <-> driver ring path, which is per command, not per message
// (spec 5.3), but their `wrap` and their field accessors still allocate nothing. The string getters and setters allocate
// a string (or read one from the argument) by nature and are not covered: `channel`, `logFileName`, `sourceIdentity`.
// The values stay below 2^30 so that no int is boxed (see test/support/Allocation.ts).
import { describe, it } from 'vitest';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { CorrelatedMessageFlyweight } from '../../../../src/client/command/CorrelatedMessageFlyweight.js';
import { ImageBuffersReadyFlyweight } from '../../../../src/client/command/ImageBuffersReadyFlyweight.js';
import { PublicationMessageFlyweight } from '../../../../src/client/command/PublicationMessageFlyweight.js';
import { expectNoAllocation } from '../../../support/Allocation.js';

const ITERATIONS = 1_000_000;
const sum = new Int32Array(1);

describe('CommandFlyweightsHotPathAllocationTest', () => {
    it('correlatedMessageFlyweightWrapFieldsAndValidateLengthAllocateNothing', async () => {
        const buffer = new UnsafeBuffer(new ArrayBuffer(64));
        const flyweight = new CorrelatedMessageFlyweight();

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                flyweight.wrap(buffer, i & 0x1f);
                flyweight.clientId(i).correlationId(i + 1);
                sum[0] = (sum[0]! + flyweight.clientId() + flyweight.correlationId()) | 0;
                flyweight.validateLength(1, 16 + (i & 0xff));
            }
        }, ITERATIONS);
    });

    it('publicationMessageFlyweightWrapFieldsLengthAndValidateLengthAllocateNothing', async () => {
        const buffer = new UnsafeBuffer(new ArrayBuffer(128));
        const flyweight = new PublicationMessageFlyweight();
        // a channel of 5 bytes, so that validateLength and length() read a real length field
        flyweight.wrap(buffer, 0).channel('hello');

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                flyweight.wrap(buffer, 0);
                flyweight.clientId(i).correlationId(i + 1);
                flyweight.streamId(i + 2);
                sum[0] = (sum[0]! + flyweight.clientId() + flyweight.correlationId() + flyweight.streamId()) | 0;
                sum[0] = (sum[0]! + flyweight.length() + PublicationMessageFlyweight.computeLength(i & 0xff)) | 0;
                flyweight.validateLength(1, 24 + 5 + (i & 0xff));
            }
        }, ITERATIONS);
    });

    it('imageBuffersReadyFlyweightWrapAndFieldsAllocateNothing', async () => {
        const buffer = new UnsafeBuffer(new ArrayBuffer(128));
        const flyweight = new ImageBuffersReadyFlyweight();
        flyweight.wrap(buffer, 0).logFileName('log').sourceIdentity('source');

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                flyweight.wrap(buffer, 0);
                flyweight
                    .correlationId(i)
                    .sessionId(i + 1)
                    .streamId(i + 2);
                flyweight.subscriberPositionId(i + 3).subscriptionRegistrationId(i + 4);
                sum[0] = (sum[0]! + flyweight.correlationId() + flyweight.sessionId() + flyweight.streamId()) | 0;
                sum[0] = (sum[0]! + flyweight.subscriberPositionId() + flyweight.subscriptionRegistrationId()) | 0;
                // length() reads the lengths of the log file name and the source identity, not the strings
                sum[0] = (sum[0]! + flyweight.length()) | 0;
            }
        }, ITERATIONS);
    });
});
