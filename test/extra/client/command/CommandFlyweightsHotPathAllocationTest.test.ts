// Not in Aeron: the command flyweights are on the client <-> driver ring path, which is per command, not per message
// (spec 5.3), but their `wrap` and their field accessors still allocate nothing. The string getters and setters allocate
// a string (or read one from the argument) by nature and are not covered: `channel`, `logFileName`, `sourceIdentity`.
// These are per-command paths (spec 5.3), not per-message ones. They run on an ArrayBuffer and on a SharedArrayBuffer
// backing (the CnC is the latter).
// The values stay below 2^30 so that no int is boxed (see test/support/Allocation.ts).
import { describe, it } from 'vitest';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { CorrelatedMessageFlyweight } from '../../../../src/client/command/CorrelatedMessageFlyweight.js';
import { ImageBuffersReadyFlyweight } from '../../../../src/client/command/ImageBuffersReadyFlyweight.js';
import { PublicationMessageFlyweight } from '../../../../src/client/command/PublicationMessageFlyweight.js';
import { RemovePublicationFlyweight } from '../../../../src/client/command/RemovePublicationFlyweight.js';
import { expectNoAllocation } from '../../../support/Allocation.js';

const ITERATIONS = 1_000_000;
const sum = new Int32Array(1);

const BACKINGS: ReadonlyArray<readonly [string, (n: number) => ArrayBufferLike]> = [
    ['ArrayBuffer', (n) => new ArrayBuffer(n)],
    ['SharedArrayBuffer', (n) => new SharedArrayBuffer(n)],
];

describe.each(BACKINGS)('CommandFlyweightsHotPathAllocationTest on a %s', (_name, newBacking) => {
    it('correlatedMessageFlyweightWrapFieldsAndValidateLengthAllocateNothing', async () => {
        const buffer = new UnsafeBuffer(newBacking(64));
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
        const buffer = new UnsafeBuffer(newBacking(128));
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
        const buffer = new UnsafeBuffer(newBacking(128));
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

    it('removePublicationFlyweightFieldsAndRevokeAllocateNothing', async () => {
        const buffer = new UnsafeBuffer(newBacking(64));
        const flyweight = new RemovePublicationFlyweight();

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                flyweight.wrap(buffer, 0);
                flyweight.registrationId(i + 2);
                flyweight.clientId(i).correlationId(i + 1);
                flyweight.revoke(0 === (i & 1));
                sum[0] = (sum[0]! + (flyweight.revoke() ? 1 : 2) + flyweight.registrationId()) | 0;
                flyweight.revoke(true);
                sum[0] = (sum[0]! + (flyweight.revoke() ? 1 : 2)) | 0;
                flyweight.revoke(false);
                sum[0] = (sum[0]! + (flyweight.revoke() ? 1 : 2)) | 0;
            }
        }, ITERATIONS);
    });
});
