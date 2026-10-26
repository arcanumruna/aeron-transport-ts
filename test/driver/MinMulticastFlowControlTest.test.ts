/*
 * Copyright 2014-2025 Real Logic Limited.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified: ported to TypeScript for aeron-transport-ts.
 */
// Port of io/aeron/driver/MinMulticastFlowControlTest.java @ 1.53.3
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { CountersManager } from '../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../src/agrona/concurrent/status/CountersReader.js';
import { StatusMessageFlyweight } from '../../src/client/protocol/StatusMessageFlyweight.js';
import { Configuration } from '../../src/driver/Configuration.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { UdpChannel } from '../../src/driver/media/UdpChannel.js';
import { MinMulticastFlowControl } from '../../src/driver/MinMulticastFlowControl.js';

const DEFAULT_GROUP_SIZE = 3;
const DEFAULT_TIMEOUT = Configuration.flowControlReceiverTimeoutNs();
const WINDOW_LENGTH = 16 * 1024;
const COUNTERS_BUFFER_LENGTH = 16 * 1024;

/** `Tests.newCountersManager(length)`: a counters manager with `length` bytes of values. */
function newCountersManager(length: number): CountersManager {
    return new CountersManager(
        new UnsafeBuffer(new ArrayBuffer(length * (CountersReader.METADATA_LENGTH / CountersReader.COUNTER_LENGTH))),
        new UnsafeBuffer(new ArrayBuffer(length)),
    );
}

const validUris: [string, number, number][] = [
    ['aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=min', DEFAULT_GROUP_SIZE, DEFAULT_TIMEOUT],
    ['aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=min,t:100ms', DEFAULT_GROUP_SIZE, 100_000_000],
    ['aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=min,g:123', DEFAULT_GROUP_SIZE, DEFAULT_TIMEOUT],
    [
        'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=min,g:3000000000',
        DEFAULT_GROUP_SIZE,
        DEFAULT_TIMEOUT,
    ],
    ['aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=min,g:123,t:100ms', DEFAULT_GROUP_SIZE, 100_000_000],
    ['aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=min,g:100/10', 10, DEFAULT_TIMEOUT],
    ['aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=min,g:/10', 10, DEFAULT_TIMEOUT],
    ['aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=min,g:100/10,t:100ms', 10, 100_000_000],
];

describe('MinMulticastFlowControlTest', () => {
    const tempBuffer = new UnsafeBuffer(new ArrayBuffer(8192));
    const newFlowControl = () => new MinMulticastFlowControl();
    const countersManager = () => newCountersManager(COUNTERS_BUFFER_LENGTH);

    function newContext(): MediaDriver.Context {
        return new MediaDriver.Context().tempBuffer(tempBuffer);
    }

    it.each(validUris)('shouldParseValidFlowControlConfiguration %s', (uri, groupSize, timeout) => {
        const flowControl = newFlowControl();
        flowControl.initialize(
            newContext().flowControlGroupMinSize(DEFAULT_GROUP_SIZE),
            countersManager(),
            UdpChannel.parse(uri),
            0,
            0,
            0,
            0,
            0,
        );

        expect(flowControl.groupMinSize()).toBe(groupSize);
        expect(flowControl.receiverTimeoutNs()).toBe(timeout);
    });

    it('shouldNotBeConnectedUntilGroupMinSizeReached', () => {
        const flowControl = newFlowControl();
        const udpChannel = UdpChannel.parse('aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=min,g:/3');

        flowControl.initialize(newContext(), countersManager(), udpChannel, 0, 0, 0, 0, 0);

        onStatusMessage(flowControl, 1, 0, 5000);
        expect(flowControl.hasRequiredReceivers()).toBe(false);
        onStatusMessage(flowControl, 2, 0, 5000);
        expect(flowControl.hasRequiredReceivers()).toBe(false);
        onStatusMessage(flowControl, 2, 0, 5000);
        expect(flowControl.hasRequiredReceivers()).toBe(false);
        onStatusMessage(flowControl, 3, 0, 5000);
        expect(flowControl.hasRequiredReceivers()).toBe(true);
    });

    it('shouldReportSenderLimitUntilGroupMinSizeIsReached', () => {
        const flowControl = newFlowControl();
        const udpChannel = UdpChannel.parse('aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=min,g:/3');

        flowControl.initialize(newContext(), countersManager(), udpChannel, 0, 0, 0, 0, 0);

        const senderLimit = 5000;
        const termOffset = 6000;
        expect(onStatusMessage(flowControl, 1, termOffset, senderLimit)).toBe(senderLimit);
        expect(onIdle(flowControl, senderLimit)).toBe(senderLimit);
        expect(onStatusMessage(flowControl, 2, termOffset, senderLimit)).toBe(senderLimit);
        expect(onIdle(flowControl, senderLimit)).toBe(senderLimit);
        expect(onStatusMessage(flowControl, 2, termOffset, senderLimit)).toBe(senderLimit);
        expect(onIdle(flowControl, senderLimit)).toBe(senderLimit);
        expect(onStatusMessage(flowControl, 3, termOffset, senderLimit)).toBe(termOffset + WINDOW_LENGTH);
        expect(onIdle(flowControl, senderLimit)).toBe(termOffset + WINDOW_LENGTH);
    });

    it('shouldNotIncludeReceiverMoreThanWindowSizeBehindMinPosition', () => {
        const flowControl = newFlowControl();
        const udpChannel = UdpChannel.parse('aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=min,g:/2');

        flowControl.initialize(newContext(), countersManager(), udpChannel, 0, 0, 0, 0, 0);

        const senderLimit = 5000;
        const termOffset0 = WINDOW_LENGTH * 2;
        const termOffset1 = termOffset0 - (WINDOW_LENGTH + 1);
        const termOffset2 = termOffset0 - WINDOW_LENGTH;

        expect(onStatusMessage(flowControl, 1, termOffset0, senderLimit)).toBe(senderLimit);
        expect(onStatusMessage(flowControl, 2, termOffset1, senderLimit)).toBe(senderLimit);
        expect(onStatusMessage(flowControl, 3, termOffset2, senderLimit)).toBe(termOffset2 + WINDOW_LENGTH);
    });

    it('shouldRemoveOnlyTimedOutReceiversWhenTheLastReceiverHasAlsoTimedOut', () => {
        const flowControl = newFlowControl();
        const udpChannel = UdpChannel.parse(
            'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=min,g:/1,t:100ms',
        );

        flowControl.initialize(newContext(), countersManager(), udpChannel, 0, 0, 0, 0, 0);

        const senderLimit = 5000;
        const termOffsetOne = 1000;
        const termOffsetTwo = 2000;
        const termOffsetThree = 3000;

        onStatusMessage(flowControl, 1, termOffsetOne, senderLimit, 0);
        onStatusMessage(flowControl, 2, termOffsetTwo, senderLimit, 0);
        onStatusMessage(flowControl, 3, termOffsetThree, senderLimit, 0);

        onStatusMessage(flowControl, 2, termOffsetTwo, senderLimit, 50_000_000);

        // receivers one and three have timed out, receiver two has not
        expect(flowControl.onIdle(100_000_001, senderLimit, 0, false)).toBe(termOffsetTwo + WINDOW_LENGTH);

        // receiver two must be the receiver that survived the removal pass
        expect(flowControl.onIdle(100_000_002, senderLimit, 0, false)).toBe(termOffsetTwo + WINDOW_LENGTH);
    });
});

function onStatusMessage(
    flowControl: MinMulticastFlowControl,
    receiverId: number,
    termOffset: number,
    senderLimit: number,
    timeNs: number = 0,
): number {
    const statusMessageFlyweight = new StatusMessageFlyweight();
    statusMessageFlyweight.wrap(new Uint8Array(1024));

    statusMessageFlyweight.receiverId(BigInt(receiverId));
    statusMessageFlyweight.consumptionTermId(0);
    statusMessageFlyweight.consumptionTermOffset(termOffset);
    statusMessageFlyweight.receiverWindowLength(WINDOW_LENGTH);

    return flowControl.onStatusMessage(statusMessageFlyweight, null as never, senderLimit, 0, 0, timeNs);
}

function onIdle(flowControl: MinMulticastFlowControl, senderLimit: number): number {
    return flowControl.onIdle(0, senderLimit, 0, false);
}
