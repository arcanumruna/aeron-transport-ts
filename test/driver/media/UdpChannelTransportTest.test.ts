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
// Port of io/aeron/driver/media/UdpChannelTransportTest.java @ 1.53.3
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Integer } from '../../../src/agrona/jdk.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import type { AtomicCounter } from '../../../src/agrona/concurrent/status/AtomicCounter.js';
import { DataHeaderFlyweight } from '../../../src/client/protocol/DataHeaderFlyweight.js';
import { ErrorFlyweight } from '../../../src/client/protocol/ErrorFlyweight.js';
import { HeaderFlyweight } from '../../../src/client/protocol/HeaderFlyweight.js';
import { NakFlyweight } from '../../../src/client/protocol/NakFlyweight.js';
import { ResolutionEntryFlyweight } from '../../../src/client/protocol/ResolutionEntryFlyweight.js';
import { ResponseSetupFlyweight } from '../../../src/client/protocol/ResponseSetupFlyweight.js';
import { RttMeasurementFlyweight } from '../../../src/client/protocol/RttMeasurementFlyweight.js';
import { SetupFlyweight } from '../../../src/client/protocol/SetupFlyweight.js';
import { StatusMessageFlyweight } from '../../../src/client/protocol/StatusMessageFlyweight.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import { UdpChannelTransport } from '../../../src/driver/media/UdpChannelTransport.js';
import { SystemCounterDescriptor } from '../../../src/driver/status/SystemCounterDescriptor.js';
import { SystemCounters } from '../../../src/driver/status/SystemCounters.js';
import { mock } from '../../support/Mockito.js';

const {
    CURRENT_VERSION,
    HDR_TYPE_ATS_DATA,
    HDR_TYPE_ATS_SETUP,
    HDR_TYPE_ATS_SM,
    HDR_TYPE_DATA,
    HDR_TYPE_ERR,
    HDR_TYPE_EXT,
    HDR_TYPE_NAK,
    HDR_TYPE_PAD,
    HDR_TYPE_RES,
    HDR_TYPE_RSP_SETUP,
    HDR_TYPE_RTTM,
    HDR_TYPE_SETUP,
    HDR_TYPE_SM,
    MIN_HEADER_LENGTH,
} = HeaderFlyweight;

const SHORT_MAX_VALUE = 32767;
const SHORT_MIN_VALUE = -32768;

const invalidFrameLength: [number, number][] = [
    [HDR_TYPE_PAD, DataHeaderFlyweight.HEADER_LENGTH - 1],
    [HDR_TYPE_DATA, DataHeaderFlyweight.HEADER_LENGTH - 1],
    [HDR_TYPE_NAK, NakFlyweight.HEADER_LENGTH - 1],
    [HDR_TYPE_SM, StatusMessageFlyweight.HEADER_LENGTH - 1],
    [HDR_TYPE_ERR, ErrorFlyweight.HEADER_LENGTH - 1],
    [HDR_TYPE_SETUP, SetupFlyweight.HEADER_LENGTH - 1],
    [HDR_TYPE_RTTM, RttMeasurementFlyweight.HEADER_LENGTH - 1],
    [HDR_TYPE_RES, ResolutionEntryFlyweight.MIN_IPV4_FRAME_LENGTH],
    [HDR_TYPE_RSP_SETUP, ResponseSetupFlyweight.HEADER_LENGTH - 1],
];

const validFrameLength: [number, number][] = [
    [HDR_TYPE_PAD, DataHeaderFlyweight.HEADER_LENGTH],
    [HDR_TYPE_DATA, DataHeaderFlyweight.HEADER_LENGTH],
    [HDR_TYPE_NAK, NakFlyweight.HEADER_LENGTH],
    [HDR_TYPE_SM, StatusMessageFlyweight.HEADER_LENGTH],
    [HDR_TYPE_ERR, ErrorFlyweight.HEADER_LENGTH],
    [HDR_TYPE_SETUP, SetupFlyweight.HEADER_LENGTH],
    [HDR_TYPE_RTTM, RttMeasurementFlyweight.HEADER_LENGTH],
    [HDR_TYPE_RES, HeaderFlyweight.MIN_HEADER_LENGTH + ResolutionEntryFlyweight.MIN_IPV4_FRAME_LENGTH],
    [HDR_TYPE_RSP_SETUP, ResponseSetupFlyweight.HEADER_LENGTH],
];

class TestTransport extends UdpChannelTransport {
    public constructor(context: MediaDriver.Context) {
        super(null, null, null, null, null, context, -1, -1);
    }
}

describe('UdpChannelTransportTest', () => {
    // mock(AtomicCounter.class): an object whose increment() records its calls
    const invalidPacketsCounter = { increment: vi.fn() };
    const context = new MediaDriver.Context();
    const headerFlyweight = new HeaderFlyweight(new UnsafeBuffer(new Uint8Array(128)));
    let transport: TestTransport;

    beforeEach(() => {
        invalidPacketsCounter.increment.mockClear();
        const systemCounters = mock(SystemCounters).mock;
        (systemCounters.get as ReturnType<typeof vi.fn>).mockImplementation((descriptor: SystemCounterDescriptor) =>
            descriptor === SystemCounterDescriptor.INVALID_PACKETS
                ? (invalidPacketsCounter as unknown as AtomicCounter)
                : null,
        );
        context.systemCounters(systemCounters);

        transport = new TestTransport(context);
    });

    it.each([Integer.MIN_VALUE, -1, MIN_HEADER_LENGTH - 1])(
        'shouldDiscardFrameIfLengthIsInsufficient [%d]',
        (length) => {
            expect(transport.isValidFrame(headerFlyweight, length)).toBe(false);
            expect(invalidPacketsCounter.increment).toHaveBeenCalledTimes(1);
        },
    );

    it.each([Integer.MIN_VALUE, -4, -1])('shouldDiscardFrameIfFrameLengthIsNegative [%d]', (frameLength) => {
        headerFlyweight.frameLength(frameLength);

        expect(transport.isValidFrame(headerFlyweight, MIN_HEADER_LENGTH)).toBe(false);
        expect(invalidPacketsCounter.increment).toHaveBeenCalledTimes(1);
    });

    // @ValueSource(bytes = { 7, (byte)0xFF, -3 })
    it.each([7, -1, -3])('shouldDiscardFrameIfVersionIsWrong [%d]', (version) => {
        headerFlyweight.frameLength(32).version(version);

        expect(transport.isValidFrame(headerFlyweight, MIN_HEADER_LENGTH)).toBe(false);
        expect(invalidPacketsCounter.increment).toHaveBeenCalledTimes(1);
    });

    it.each([HDR_TYPE_ATS_DATA, HDR_TYPE_ATS_SETUP, HDR_TYPE_ATS_SM])('shouldDiscardAtsFrames [%d]', (type) => {
        headerFlyweight.frameLength(32).version(CURRENT_VERSION).headerType(type);

        expect(transport.isValidFrame(headerFlyweight, MIN_HEADER_LENGTH)).toBe(false);
        expect(invalidPacketsCounter.increment).toHaveBeenCalledTimes(1);
    });

    it.each([HDR_TYPE_RSP_SETUP + 1, HDR_TYPE_EXT, SHORT_MAX_VALUE, SHORT_MIN_VALUE, -1])(
        'shouldDiscardFrameWithInvalidType [%d]',
        (type) => {
            headerFlyweight.frameLength(32).version(CURRENT_VERSION).headerType(type);

            expect(transport.isValidFrame(headerFlyweight, MIN_HEADER_LENGTH)).toBe(false);
            expect(invalidPacketsCounter.increment).toHaveBeenCalledTimes(1);
        },
    );

    it.each(invalidFrameLength)(
        'shouldDiscardFrameIfFrameLengthIsTooSmallForAGivenFrameType [type=%d, frameLength=%d]',
        (type, frameLength) => {
            headerFlyweight.version(CURRENT_VERSION).headerType(type).frameLength(frameLength);

            expect(transport.isValidFrame(headerFlyweight, frameLength)).toBe(false);
            expect(invalidPacketsCounter.increment).toHaveBeenCalledTimes(1);
        },
    );

    it.each(validFrameLength)(
        'shouldAcceptFrameIfFrameLengthIsCorrectForAGivenFrameType [type=%d, frameLength=%d]',
        (type, frameLength) => {
            headerFlyweight.version(CURRENT_VERSION).headerType(type).frameLength(frameLength);

            expect(transport.isValidFrame(headerFlyweight, frameLength)).toBe(true);
            expect(invalidPacketsCounter.increment).not.toHaveBeenCalled();
        },
    );

    it.each(validFrameLength)(
        'shouldDiscardFrameIfFrameLengthIsGreaterThanBufferLength [type=%d, frameLength=%d]',
        (type, frameLength) => {
            // assumeFalse(HDR_TYPE_PAD == type): the case is skipped by the assumption
            if (HDR_TYPE_PAD === type) {
                return;
            }

            headerFlyweight.version(CURRENT_VERSION).headerType(type).frameLength(frameLength);

            expect(transport.isValidFrame(headerFlyweight, frameLength - 1)).toBe(false);
            expect(invalidPacketsCounter.increment).toHaveBeenCalledTimes(1);
        },
    );

    it('shouldAcceptPaddingFrameLongerThanBufferCapacity', () => {
        headerFlyweight.version(CURRENT_VERSION).headerType(HDR_TYPE_PAD).frameLength(1024);

        expect(transport.isValidFrame(headerFlyweight, DataHeaderFlyweight.HEADER_LENGTH)).toBe(true);
        expect(invalidPacketsCounter.increment).not.toHaveBeenCalled();
    });
});
