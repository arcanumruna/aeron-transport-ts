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
// Port of io/aeron/driver/status/StreamCounter.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { type CountersManager } from '../../agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../agrona/concurrent/status/CountersReader.js';
import { Aeron } from '../../client/Aeron.js';

const { SIZE_OF_INT, SIZE_OF_LONG } = BitUtil;
const { MAX_LABEL_LENGTH } = CountersReader;

/**
 * Allocates counters on a stream of messages.
 * <p>
 * Positions tracked in bytes include:
 * <ul>
 * <li>{@link PublisherPos}: Highest position on a {@link io.aeron.Publication} reached for offers and claims as an
 *     approximation which is sampled once per second.</li>
 * <li>{@link PublisherLimit}: Limit for flow controlling a {@link io.aeron.Publication} offers and claims.</li>
 * <li>{@link SenderPos}: Highest position on a {@link io.aeron.Publication} stream sent to the media.</li>
 * <li>{@link SenderLimit}: Limit for flow controlling a {@link io.aeron.driver.Sender} of a stream.</li>
 * <li>{@link ReceiverHwm}: Highest position observed by the {@link io.aeron.driver.Receiver} when rebuilding an
 *     {@link io.aeron.Image} of a stream.</li>
 * <li>{@link ReceiverPos}: Highest contiguous position rebuilt by the {@link io.aeron.driver.Receiver} on an
 *     {@link io.aeron.Image} of a stream.</li>
 * <li>{@link SubscriberPos}: Consumption position on an {@link io.aeron.Image} of a stream by an individual
 *     Subscriber.</li>
 * </ul>
 */
export class StreamCounter {
    /**
     * Offset in the key metadata for the registration id of the counter.
     */
    public static readonly REGISTRATION_ID_OFFSET = 0;

    /**
     * Offset in the key metadata for the session id of the counter.
     */
    public static readonly SESSION_ID_OFFSET = StreamCounter.REGISTRATION_ID_OFFSET + SIZE_OF_LONG;

    /**
     * Offset in the key metadata for the stream id of the counter.
     */
    public static readonly STREAM_ID_OFFSET = StreamCounter.SESSION_ID_OFFSET + SIZE_OF_INT;

    /**
     * Offset in the key metadata for the channel of the counter.
     */
    public static readonly CHANNEL_OFFSET = StreamCounter.STREAM_ID_OFFSET + SIZE_OF_INT;

    /**
     * The maximum length in bytes of the encoded channel identity.
     */
    public static readonly MAX_CHANNEL_LENGTH =
        CountersReader.MAX_KEY_LENGTH - (StreamCounter.CHANNEL_OFFSET + SIZE_OF_INT);

    private constructor() {}

    /**
     * Allocate a counter id for tracking a position on a stream of messages.
     *
     * @param tempBuffer      to be used for labels and key.
     * @param name            of the counter for the label.
     * @param typeId          of the counter for classification.
     * @param countersManager from which the underlying storage is allocated.
     * @param clientId        to set as counter owner.
     * @param registrationId  to be associated with the counter.
     * @param sessionId       for the stream of messages.
     * @param streamId        for the stream of messages.
     * @param channel         for the stream of messages.
     * @param joinPosition    relevant for `sub-pos` only.
     * @return the id of the allocated counter.
     */
    public static allocateCounterId(
        tempBuffer: MutableDirectBuffer,
        name: string,
        typeId: number,
        countersManager: CountersManager,
        clientId: number,
        registrationId: number,
        sessionId: number,
        streamId: number,
        channel: string,
        joinPosition: number,
    ): number {
        tempBuffer.putLong(StreamCounter.REGISTRATION_ID_OFFSET, registrationId);
        tempBuffer.putInt(StreamCounter.SESSION_ID_OFFSET, sessionId);
        tempBuffer.putInt(StreamCounter.STREAM_ID_OFFSET, streamId);

        const channelLength = tempBuffer.putStringWithoutLengthAscii(
            StreamCounter.CHANNEL_OFFSET + SIZE_OF_INT,
            channel,
            0,
            StreamCounter.MAX_CHANNEL_LENGTH,
        );
        tempBuffer.putInt(StreamCounter.CHANNEL_OFFSET, channelLength);
        const keyLength = StreamCounter.CHANNEL_OFFSET + SIZE_OF_INT + channelLength;

        const labelOffset = BitUtil.align(keyLength, SIZE_OF_INT);
        let labelLength = 0;
        labelLength += tempBuffer.putStringWithoutLengthAscii(labelOffset + labelLength, name);
        labelLength += tempBuffer.putStringWithoutLengthAscii(labelOffset + labelLength, ': ');
        labelLength += tempBuffer.putLongAscii(labelOffset + labelLength, registrationId);
        labelLength += tempBuffer.putStringWithoutLengthAscii(labelOffset + labelLength, ' ');
        labelLength += tempBuffer.putIntAscii(labelOffset + labelLength, sessionId);
        labelLength += tempBuffer.putStringWithoutLengthAscii(labelOffset + labelLength, ' ');
        labelLength += tempBuffer.putIntAscii(labelOffset + labelLength, streamId);
        labelLength += tempBuffer.putStringWithoutLengthAscii(labelOffset + labelLength, ' ');
        labelLength += tempBuffer.putStringWithoutLengthAscii(
            labelOffset + labelLength,
            channel,
            0,
            MAX_LABEL_LENGTH - labelLength,
        );

        if (Aeron.NULL_VALUE !== joinPosition && labelLength < MAX_LABEL_LENGTH - 20) {
            labelLength += tempBuffer.putStringWithoutLengthAscii(labelOffset + labelLength, ' @');
            labelLength += tempBuffer.putLongAscii(labelOffset + labelLength, joinPosition);
        }

        const counterId = countersManager.allocate(
            typeId,
            tempBuffer,
            0,
            keyLength,
            tempBuffer,
            labelOffset,
            labelLength,
        );

        countersManager.setCounterRegistrationId(counterId, registrationId);
        countersManager.setCounterOwnerId(counterId, clientId);

        return counterId;
    }
}
