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
// Port of io/aeron/driver/FlowControlTest.java @ 1.53.3
import { describe, expect, it, vi } from 'vitest';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { CountersManager } from '../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../src/agrona/concurrent/status/CountersReader.js';
import { IllegalArgumentException } from '../../src/agrona/jdk.js';
import { Configuration } from '../../src/driver/Configuration.js';
import { FlowControl } from '../../src/driver/FlowControl.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { UdpChannel } from '../../src/driver/media/UdpChannel.js';
import { UnicastFlowControl } from '../../src/driver/UnicastFlowControl.js';
import { assertThrows } from '../support/Assertions.js';

const { calculateRetransmissionLength } = FlowControl;

const MTU_LENGTH = 1024;
const COUNTERS_BUFFER_LENGTH = 16 * 1024;
const TERM_BUFFER_LENGTH = 64 * 1024;

/** `Tests.newCountersManager(length)`: a counters manager with `length` bytes of values. */
function newCountersManager(length: number): CountersManager {
    return new CountersManager(
        new UnsafeBuffer(new ArrayBuffer(length * (CountersReader.METADATA_LENGTH / CountersReader.COUNTER_LENGTH))),
        new UnsafeBuffer(new ArrayBuffer(length)),
    );
}

/**
 * `mockStatic(FlowControl.class)` with `retransmitReceiverWindowMultiple` and `calculateRetransmissionLength` calling
 * the real methods: spies on the two functions of the `FlowControl` object, which pass through.
 */
function withMockedFlowControl(body: (calculateRetransmissionLengthSpy: ReturnType<typeof vi.spyOn>) => void): void {
    vi.spyOn(FlowControl, 'retransmitReceiverWindowMultiple');
    const spy = vi.spyOn(FlowControl, 'calculateRetransmissionLength');
    try {
        body(spy);
    } finally {
        vi.restoreAllMocks();
    }
}

/** `verify(() -> FlowControl.calculateRetransmissionLength(anyInt(), anyInt(), anyInt(), eq(expectedRrwm)))`. */
function verifyCalculateRetransmissionLength(spy: ReturnType<typeof vi.spyOn>, expectedRrwm: number): void {
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), expect.any(Number), expectedRrwm);
}

describe('FlowControlTest', () => {
    it('shouldUseResendLengthIfSmallestValue', () => {
        const resendLength = 1024;

        expect(calculateRetransmissionLength(resendLength, 64 * 1024, 0, 16)).toBe(resendLength);
    });

    it('shouldClampToTheEndOfTheBuffer', () => {
        const expectedLength = 512;
        const termLength = 64 * 1024;
        const termOffset = termLength - expectedLength;

        expect(calculateRetransmissionLength(1024, termLength, termOffset, 16)).toBe(expectedLength);
    });

    it('shouldClampToReceiverWindow', () => {
        const multiplier = 16;
        const expectedLength = Configuration.INITIAL_WINDOW_LENGTH_DEFAULT * multiplier;

        expect(calculateRetransmissionLength(4 * 1024 * 1024, 8 * 1024 * 1024, 0, 16)).toBe(expectedLength);
    });

    it.each([
        ['aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=max'],
        ['aeron:udp?endpoint=224.20.30.39:24326|interface=localhost'],
    ])('shouldUseDefaultRetransmitReceiverWindowMultipleWhenNotSetInUri %s', (uri) => {
        const context = new MediaDriver.Context();

        const rrwm = FlowControl.retransmitReceiverWindowMultiple(
            UdpChannel.parse(uri),
            context.multicastFlowControlRetransmitReceiverWindowMultiple(),
        );
        const defaultRrwm = Configuration.multicastFlowControlRetransmitReceiverWindowMultiple();
        expect(rrwm).toBe(defaultRrwm);
    });

    it.each([
        ['aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=max,rrwm:8'],
        ['aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=max,foo:bar,rrwm:8,a:b'],
        ['aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=min,rrwm:8'],
        ['aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,g:100/10,t:100ms,rrwm:8'],
    ])('shouldUseRetransmitReceiverWindowMultipleFromUri %s', (uri) => {
        const context = new MediaDriver.Context().multicastFlowControlRetransmitReceiverWindowMultiple(2);

        const rrwm = FlowControl.retransmitReceiverWindowMultiple(
            UdpChannel.parse(uri),
            context.multicastFlowControlRetransmitReceiverWindowMultiple(),
        );
        expect(rrwm).toBe(8);
    });

    it.each([['a'], [''], [' '], ['foo'], ['0'], ['-1']])(
        'shouldRejectInvalidRetransmitReceiverWindowMultiple %j',
        (rrwmValue) => {
            const uri = 'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=max,rrwm:' + rrwmValue;

            assertThrows(IllegalArgumentException, () =>
                FlowControl.retransmitReceiverWindowMultiple(UdpChannel.parse(uri), 2),
            );
        },
    );

    it.skip('usesDefaultMulticastRetransmitReceiverWindowMultipleWhenNotSet', () => {
        // Phase 3: parameterised over MaxMulticastFlowControl, MinMulticastFlowControl and TaggedMulticastFlowControl.
    });

    it.skip('usesMulticastRetransmitReceiverWindowMultipleFromContextWhenNotSetInUri', () => {
        // Phase 3: parameterised over MaxMulticastFlowControl, MinMulticastFlowControl and TaggedMulticastFlowControl.
    });

    it.skip('usesMulticastRetransmitReceiverWindowMultipleFromUriWhenSet', () => {
        // Phase 3: parameterised over MaxMulticastFlowControl, MinMulticastFlowControl and TaggedMulticastFlowControl.
    });

    it('usesDefaultUnicastRetransmitReceiverWindowMultipleWhenNotSetInContext', () => {
        const uri = 'aeron:udp?endpoint=localhost:0';
        const expectedRrwm = Configuration.unicastFlowControlRetransmitReceiverWindowMultiple();
        const countersManager = newCountersManager(COUNTERS_BUFFER_LENGTH);

        withMockedFlowControl((calculateRetransmissionLengthSpy) => {
            const context = new MediaDriver.Context().tempBuffer(new UnsafeBuffer(new ArrayBuffer(TERM_BUFFER_LENGTH)));
            const flowControl = new UnicastFlowControl();
            flowControl.initialize(context, countersManager, UdpChannel.parse(uri), 0, 0, 0, 0, 0);

            flowControl.maxRetransmissionLength(0, 32, TERM_BUFFER_LENGTH, MTU_LENGTH);

            verifyCalculateRetransmissionLength(calculateRetransmissionLengthSpy, expectedRrwm);
        });
    });

    it('usesUnicastRetransmitReceiverWindowMultipleFromContextWhenSet', () => {
        const uri = 'aeron:udp?endpoint=localhost:0';
        const expectedRrwm = 2;
        const countersManager = newCountersManager(COUNTERS_BUFFER_LENGTH);

        withMockedFlowControl((calculateRetransmissionLengthSpy) => {
            const context = new MediaDriver.Context()
                .tempBuffer(new UnsafeBuffer(new ArrayBuffer(TERM_BUFFER_LENGTH)))
                .unicastFlowControlRetransmitReceiverWindowMultiple(expectedRrwm);
            const flowControl = new UnicastFlowControl();

            flowControl.initialize(context, countersManager, UdpChannel.parse(uri), 0, 0, 0, 0, 0);

            flowControl.maxRetransmissionLength(0, 32, TERM_BUFFER_LENGTH, MTU_LENGTH);

            verifyCalculateRetransmissionLength(calculateRetransmissionLengthSpy, expectedRrwm);
        });
    });
});
