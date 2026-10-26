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
// Port of io/aeron/status/ChannelEndpointStatus.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { type AtomicCounter } from '../../agrona/concurrent/status/AtomicCounter.js';
import { type CountersManager } from '../../agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../agrona/concurrent/status/CountersReader.js';
import { NULL_VALUE } from '../NullValue.js';

const { SIZE_OF_INT } = BitUtil;
const { MAX_LABEL_LENGTH } = CountersReader;

/**
 * Status of the Aeron media channel for a {@link Publication} or {@link Subscription}.
 */
export class ChannelEndpointStatus {
    private constructor() {}

    /**
     * Channel is being initialized.
     */
    public static readonly INITIALIZING = 0;

    /**
     * Channel has errored. Check error log for information.
     */
    public static readonly ERRORED = -1;

    /**
     * Channel has finished initialization successfully and is active.
     */
    public static readonly ACTIVE = 1;

    /**
     * Channel is being closed.
     */
    public static readonly CLOSING = 2;

    /**
     * No counter ID is allocated yet.
     */
    public static readonly NO_ID_ALLOCATED = NULL_VALUE;

    /**
     * Offset in the key metadata for the channel of the counter.
     */
    public static readonly CHANNEL_OFFSET = 0;

    /**
     * String representation of the channel status.
     *
     * @param status to be converted.
     * @return representation of the channel status.
     */
    public static status(status: number): string {
        if (ChannelEndpointStatus.INITIALIZING === status) {
            return 'INITIALIZING';
        }

        if (ChannelEndpointStatus.ERRORED === status) {
            return 'ERRORED';
        }

        if (ChannelEndpointStatus.ACTIVE === status) {
            return 'ACTIVE';
        }

        if (ChannelEndpointStatus.CLOSING === status) {
            return 'CLOSING';
        }

        return 'unknown id=' + status;
    }

    /**
     * The maximum length in bytes of the encoded channel identity.
     */
    public static readonly MAX_CHANNEL_LENGTH =
        CountersReader.MAX_KEY_LENGTH - (ChannelEndpointStatus.CHANNEL_OFFSET + SIZE_OF_INT);

    /**
     * Allocate an indicator for tracking the status of a channel endpoint.
     *
     * @param tempBuffer      to be used for labels and metadata.
     * @param name            of the counter for the label.
     * @param typeId          of the counter for classification.
     * @param countersManager from which the underlying storage is allocated.
     * @param registrationId  of the action the counter is associated with.
     * @param channel         for the stream of messages.
     * @return a new {@link AtomicCounter} for tracking the status.
     */
    public static allocate(
        tempBuffer: MutableDirectBuffer,
        name: string,
        typeId: number,
        countersManager: CountersManager,
        registrationId: number,
        channel: string,
    ): AtomicCounter {
        const channelLength = tempBuffer.putStringWithoutLengthAscii(
            ChannelEndpointStatus.CHANNEL_OFFSET + SIZE_OF_INT,
            channel,
            0,
            ChannelEndpointStatus.MAX_CHANNEL_LENGTH,
        );
        tempBuffer.putInt(ChannelEndpointStatus.CHANNEL_OFFSET, channelLength);

        const keyLength = channelLength + SIZE_OF_INT;
        let labelLength = 0;
        labelLength += tempBuffer.putStringWithoutLengthAscii(keyLength + labelLength, name);
        labelLength += tempBuffer.putStringWithoutLengthAscii(keyLength + labelLength, ': ');
        labelLength += tempBuffer.putStringWithoutLengthAscii(
            keyLength + labelLength,
            channel,
            0,
            MAX_LABEL_LENGTH - labelLength,
        );

        if (labelLength < MAX_LABEL_LENGTH) {
            tempBuffer.putByte(keyLength + labelLength, 0x20); // ' '
            labelLength += 1;
        }

        const counter = countersManager.newCounter(
            typeId,
            tempBuffer,
            0,
            keyLength,
            tempBuffer,
            keyLength,
            labelLength,
        );
        countersManager.setCounterRegistrationId(counter.id(), registrationId);

        return counter;
    }
}
