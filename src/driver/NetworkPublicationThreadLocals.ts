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
// Port of io/aeron/driver/NetworkPublicationThreadLocals.java @ 1.53.3
import { BitUtil } from '../agrona/BitUtil.js';
import { BufferUtil } from '../agrona/BufferUtil.js';
import { UnsafeBuffer } from '../agrona/concurrent/UnsafeBuffer.js';
import { DataHeaderFlyweight } from '../client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../client/protocol/HeaderFlyweight.js';
import { RttMeasurementFlyweight } from '../client/protocol/RttMeasurementFlyweight.js';
import { SetupFlyweight } from '../client/protocol/SetupFlyweight.js';

const { CACHE_LINE_LENGTH } = BitUtil;

/**
 * The buffers and flyweights that the publications of a sender share: a heartbeat, a setup and a RTT measurement
 * frame, each in a cache line of its own. Java's `ByteBuffer` slices are `UnsafeBuffer` windows on one buffer: the
 * frame is the whole window, so `send(buffer, 0, buffer.capacity())` is Java's `send(buffer)` after `clear()` (spec
 * D9, D32).
 */
export class NetworkPublicationThreadLocals {
    private readonly _heartbeatBuffer: UnsafeBuffer;
    private readonly dataHeader: DataHeaderFlyweight;
    private readonly _setupBuffer: UnsafeBuffer;
    private readonly _setupHeader: SetupFlyweight;
    private readonly _rttMeasurementBuffer: UnsafeBuffer;
    private readonly _rttMeasurementHeader: RttMeasurementFlyweight;

    public constructor() {
        const byteBuffer = BufferUtil.allocateDirectAligned(CACHE_LINE_LENGTH * 4, CACHE_LINE_LENGTH);

        this._heartbeatBuffer = new UnsafeBuffer(byteBuffer, 0, DataHeaderFlyweight.HEADER_LENGTH);
        this.dataHeader = new DataHeaderFlyweight(this._heartbeatBuffer);

        let position = CACHE_LINE_LENGTH;
        this._setupBuffer = new UnsafeBuffer(byteBuffer, position, SetupFlyweight.HEADER_LENGTH);
        this._setupHeader = new SetupFlyweight(this._setupBuffer);

        position += CACHE_LINE_LENGTH;
        this._rttMeasurementBuffer = new UnsafeBuffer(byteBuffer, position, RttMeasurementFlyweight.HEADER_LENGTH);
        this._rttMeasurementHeader = new RttMeasurementFlyweight(this._rttMeasurementBuffer);

        this.dataHeader
            .version(HeaderFlyweight.CURRENT_VERSION)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .headerType(HeaderFlyweight.HDR_TYPE_DATA)
            .frameLength(0);

        this._setupHeader
            .version(HeaderFlyweight.CURRENT_VERSION)
            .headerType(HeaderFlyweight.HDR_TYPE_SETUP)
            .frameLength(SetupFlyweight.HEADER_LENGTH);

        this._rttMeasurementHeader
            .version(HeaderFlyweight.CURRENT_VERSION)
            .headerType(HeaderFlyweight.HDR_TYPE_RTTM)
            .frameLength(RttMeasurementFlyweight.HEADER_LENGTH);
    }

    public heartbeatBuffer(): UnsafeBuffer {
        return this._heartbeatBuffer;
    }

    public heartbeatDataHeader(): DataHeaderFlyweight {
        return this.dataHeader;
    }

    public setupBuffer(): UnsafeBuffer {
        return this._setupBuffer;
    }

    public setupHeader(): SetupFlyweight {
        return this._setupHeader;
    }

    public rttMeasurementBuffer(): UnsafeBuffer {
        return this._rttMeasurementBuffer;
    }

    public rttMeasurementHeader(): RttMeasurementFlyweight {
        return this._rttMeasurementHeader;
    }
}
