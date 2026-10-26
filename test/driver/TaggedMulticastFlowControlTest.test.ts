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
// Port of io/aeron/driver/TaggedMulticastFlowControlTest.java @ 1.53.3
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { CountersManager } from '../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../src/agrona/concurrent/status/CountersReader.js';
import { ErrorFlyweight } from '../../src/client/protocol/ErrorFlyweight.js';
import { StatusMessageFlyweight } from '../../src/client/protocol/StatusMessageFlyweight.js';
import { Configuration } from '../../src/driver/Configuration.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { UdpChannel } from '../../src/driver/media/UdpChannel.js';
import { TaggedMulticastFlowControl } from '../../src/driver/TaggedMulticastFlowControl.js';

const { MAX_ERROR_FRAME_LENGTH } = ErrorFlyweight;

const DEFAULT_GROUP_SIZE = 0;
const DEFAULT_GROUP_TAG = Configuration.flowControlGroupTag();
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

const validUris: [string, number, number, number][] = [
    [
        'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged',
        DEFAULT_GROUP_TAG,
        DEFAULT_GROUP_SIZE,
        DEFAULT_TIMEOUT,
    ],
    [
        'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,t:100ms',
        DEFAULT_GROUP_TAG,
        DEFAULT_GROUP_SIZE,
        100_000_000,
    ],
    [
        'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,g:123',
        123,
        DEFAULT_GROUP_SIZE,
        DEFAULT_TIMEOUT,
    ],
    [
        'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,g:3000000000',
        3_000_000_000,
        DEFAULT_GROUP_SIZE,
        DEFAULT_TIMEOUT,
    ],
    [
        'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,g:123,t:100ms',
        123,
        DEFAULT_GROUP_SIZE,
        100_000_000,
    ],
    ['aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,g:100/10', 100, 10, DEFAULT_TIMEOUT],
    [
        'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,g:/10',
        DEFAULT_GROUP_TAG,
        10,
        DEFAULT_TIMEOUT,
    ],
    ['aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,g:100/10,t:100ms', 100, 10, 100_000_000],
];

describe('TaggedMulticastFlowControlTest', () => {
    const tempBuffer = new UnsafeBuffer(new ArrayBuffer(8192));
    const countersManager = () => newCountersManager(COUNTERS_BUFFER_LENGTH);

    function newContext(): MediaDriver.Context {
        return new MediaDriver.Context().tempBuffer(tempBuffer);
    }

    it.each(validUris)('shouldParseValidFlowControlConfiguration %s', (uri, groupTag, groupSize, timeout) => {
        const flowControl = new TaggedMulticastFlowControl();
        flowControl.initialize(newContext(), countersManager(), UdpChannel.parse(uri), 0, 0, 0, 0, 0);

        expect(flowControl.groupTag()).toBe(groupTag);
        expect(flowControl.groupMinSize()).toBe(groupSize);
        expect(flowControl.receiverTimeoutNs()).toBe(timeout);
    });

    it.each([
        'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,g:',
        'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,g:100/',
        'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,g:/',
        'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,t:',
        'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,g:100,t:',
        'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,t:100ms,g:100/',
    ])('shouldFailWithInvalidUris %s', (uri) => {
        const flowControl = new TaggedMulticastFlowControl();

        expect(() =>
            flowControl.initialize(newContext(), countersManager(), UdpChannel.parse(uri), 0, 0, 0, 0, 0),
        ).toThrow();
    });

    it('shouldClampToSenderLimitUntilMinimumGroupSizeIsMet', () => {
        const flowControl = new TaggedMulticastFlowControl();
        const channelGroupSizeThree = UdpChannel.parse(
            'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,g:123/3',
        );

        flowControl.initialize(newContext(), countersManager(), channelGroupSizeThree, 0, 0, 0, 0, 0);
        const groupTag = 123n;

        const senderLimit = 5000;
        const termOffset = 10_000;

        expect(onStatusMessage(flowControl, 0, termOffset, senderLimit, null)).toBe(senderLimit);
        expect(onIdle(flowControl, senderLimit)).toBe(senderLimit);
        expect(onStatusMessage(flowControl, 1, termOffset, senderLimit, groupTag)).toBe(senderLimit);
        expect(onIdle(flowControl, senderLimit)).toBe(senderLimit);
        expect(onStatusMessage(flowControl, 2, termOffset, senderLimit, groupTag)).toBe(senderLimit);
        expect(onIdle(flowControl, senderLimit)).toBe(senderLimit);
        expect(onStatusMessage(flowControl, 3, termOffset, senderLimit, null)).toBe(senderLimit);
        expect(onIdle(flowControl, senderLimit)).toBe(senderLimit);
        expect(onStatusMessage(flowControl, 4, termOffset, senderLimit, groupTag)).toBe(termOffset + WINDOW_LENGTH);
        expect(onIdle(flowControl, senderLimit)).toBe(termOffset + WINDOW_LENGTH);
    });

    it('shouldReturnLastWindowWhenUntilReceiversAreInGroupWithNoMinSize', () => {
        const flowControl = new TaggedMulticastFlowControl();
        const channelGroupSizeThree = UdpChannel.parse(
            'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,g:123',
        );

        flowControl.initialize(newContext(), countersManager(), channelGroupSizeThree, 0, 0, 0, 0, 0);
        const groupTag = 123n;

        const senderLimit = 5000;
        const termOffset0 = 10_000;
        const termOffset1 = 9_999;

        expect(onStatusMessage(flowControl, 0, termOffset0, senderLimit, null)).toBe(termOffset0 + WINDOW_LENGTH);
        expect(onStatusMessage(flowControl, 1, termOffset1, senderLimit, groupTag)).toBe(termOffset1 + WINDOW_LENGTH);
        expect(onStatusMessage(flowControl, 0, termOffset0, senderLimit, null)).toBe(termOffset1 + WINDOW_LENGTH);
    });

    it('shouldNotIncludeReceiverMoreThanWindowSizeBehindMinPosition', () => {
        const flowControl = new TaggedMulticastFlowControl();
        const udpChannel = UdpChannel.parse('aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=min,g:123/2');

        flowControl.initialize(newContext(), countersManager(), udpChannel, 0, 0, 0, 0, 0);

        const senderLimit = 5000;
        const termOffset0 = WINDOW_LENGTH * 2;
        const termOffset1 = termOffset0 - (WINDOW_LENGTH + 1);
        const termOffset2 = termOffset0 - WINDOW_LENGTH;

        expect(onStatusMessage(flowControl, 1, termOffset0, senderLimit, 123n)).toBe(senderLimit);
        expect(onStatusMessage(flowControl, 2, termOffset1, senderLimit, 123n)).toBe(senderLimit);
        expect(onStatusMessage(flowControl, 3, termOffset2, senderLimit, 123n)).toBe(termOffset2 + WINDOW_LENGTH);
    });

    it('shouldRemoveEntryFromFlowControlOnEndOfStream', () => {
        const flowControl = new TaggedMulticastFlowControl();
        const udpChannel = UdpChannel.parse('aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=min,g:123/2');

        flowControl.initialize(newContext(), countersManager(), udpChannel, 0, 0, 0, 0, 0);

        const senderLimit = 5000;
        const termOffset1 = WINDOW_LENGTH;
        const termOffset2 = WINDOW_LENGTH + 1;
        const termOffset3 = WINDOW_LENGTH + 2;

        expect(onStatusMessage(flowControl, 1, termOffset1, senderLimit, 123n)).toBe(senderLimit);
        expect(onStatusMessage(flowControl, 2, termOffset2, senderLimit, 123n)).toBe(termOffset1 + WINDOW_LENGTH);
        expect(onStatusMessage(flowControl, 3, termOffset3, senderLimit, 123n)).toBe(termOffset1 + WINDOW_LENGTH);

        const publicationLimit = onEosStatusMessage(flowControl, 1, termOffset1, senderLimit, 123n);

        expect(publicationLimit).toBe(termOffset1 + WINDOW_LENGTH);
        expect(onIdle(flowControl, senderLimit)).toBe(termOffset2 + WINDOW_LENGTH);
    });

    it('shouldRemoveEntryFromFlowControlOnError', () => {
        const flowControl = new TaggedMulticastFlowControl();
        const udpChannel = UdpChannel.parse('aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=min,g:123/2');

        flowControl.initialize(newContext(), countersManager(), udpChannel, 0, 0, 0, 0, 0);

        const senderLimit = 5000;
        const termOffset1 = WINDOW_LENGTH;
        const termOffset2 = WINDOW_LENGTH + 1;
        const termOffset3 = WINDOW_LENGTH + 2;

        expect(onStatusMessage(flowControl, 1, termOffset1, senderLimit, 123n)).toBe(senderLimit);
        expect(onStatusMessage(flowControl, 2, termOffset2, senderLimit, 123n)).toBe(termOffset1 + WINDOW_LENGTH);
        expect(onStatusMessage(flowControl, 3, termOffset3, senderLimit, 123n)).toBe(termOffset1 + WINDOW_LENGTH);

        onErrorMessage(flowControl, 1, 123n);

        expect(onIdle(flowControl, senderLimit)).toBe(termOffset2 + WINDOW_LENGTH);
    });
});

function onStatusMessage(
    flowControl: TaggedMulticastFlowControl,
    receiverId: number,
    termOffset: number,
    senderLimit: number,
    groupTag: bigint | null,
): number {
    return onStatusMessageWithFlags(flowControl, receiverId, termOffset, senderLimit, groupTag, false);
}

function onEosStatusMessage(
    flowControl: TaggedMulticastFlowControl,
    receiverId: number,
    termOffset: number,
    senderLimit: number,
    groupTag: bigint | null,
): number {
    return onStatusMessageWithFlags(flowControl, receiverId, termOffset, senderLimit, groupTag, true);
}

function onErrorMessage(flowControl: TaggedMulticastFlowControl, receiverId: number, groupTag: bigint | null): void {
    const error = new ErrorFlyweight(new Uint8Array(MAX_ERROR_FRAME_LENGTH));
    error.receiverId(BigInt(receiverId)).groupTag(groupTag);

    flowControl.onError(error, null as never, 0);
}

function onStatusMessageWithFlags(
    flowControl: TaggedMulticastFlowControl,
    receiverId: number,
    termOffset: number,
    senderLimit: number,
    groupTag: bigint | null,
    isEos: boolean,
): number {
    const statusMessageFlyweight = new StatusMessageFlyweight(new Uint8Array(1024));
    const flags = isEos ? StatusMessageFlyweight.END_OF_STREAM_FLAG : 0;

    statusMessageFlyweight.receiverId(BigInt(receiverId));
    statusMessageFlyweight.consumptionTermId(0);
    statusMessageFlyweight.consumptionTermOffset(termOffset);
    statusMessageFlyweight.groupTag(groupTag);
    statusMessageFlyweight.flags(flags);
    statusMessageFlyweight.receiverWindowLength(WINDOW_LENGTH);

    return flowControl.onStatusMessage(statusMessageFlyweight, null as never, senderLimit, 0, 0, 0);
}

function onIdle(flowControl: TaggedMulticastFlowControl, senderLimit: number): number {
    return flowControl.onIdle(0, senderLimit, 0, false);
}
