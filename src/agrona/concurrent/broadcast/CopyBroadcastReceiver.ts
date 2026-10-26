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
// Port of org/agrona/concurrent/broadcast/CopyBroadcastReceiver.java @ Agrona 2.6.1
import { IllegalStateException } from '../../jdk.js';
import type { MutableDirectBuffer } from '../../MutableDirectBuffer.js';
import type { MessageHandler } from '../MessageHandler.js';
import { UnsafeBuffer } from '../UnsafeBuffer.js';
import type { BroadcastReceiver } from './BroadcastReceiver.js';

/**
 * Receiver that copies messages that have been broadcast to enable a simpler API for the client.
 */
export class CopyBroadcastReceiver {
    /**
     * Default length for the scratch buffer for copying messages into.
     */
    public static readonly SCRATCH_BUFFER_LENGTH: number = 4096;

    private readonly receiver: BroadcastReceiver;
    private readonly scratchBuffer: MutableDirectBuffer;

    /**
     * Wrap a {@link BroadcastReceiver} to simplify the API for receiving messages.
     *
     * @param receiver      to be wrapped.
     * @param scratchBuffer to be used for copying receive buffers, or the maximum length of a message to be copied
     *                      when receiving (the default is {@link SCRATCH_BUFFER_LENGTH}).
     */
    public constructor(
        receiver: BroadcastReceiver,
        scratchBuffer: MutableDirectBuffer | number = CopyBroadcastReceiver.SCRATCH_BUFFER_LENGTH,
    ) {
        this.receiver = receiver;
        // new UnsafeBuffer(ByteBuffer.allocateDirect(scratchBufferLength))
        this.scratchBuffer =
            typeof scratchBuffer === 'number' ? new UnsafeBuffer(new ArrayBuffer(scratchBuffer)) : scratchBuffer;
    }

    /**
     * Get the underlying {@link BroadcastReceiver} which this is wrapping and copying out of.
     *
     * @return the underlying {@link BroadcastReceiver} which this is wrapping and copying out of.
     */
    public broadcastReceiver(): BroadcastReceiver {
        return this.receiver;
    }

    /**
     * Receive one message from the broadcast buffer.
     *
     * @param handler to be called for each message received.
     * @return the number of messages that have been received.
     */
    public receive(handler: MessageHandler): number {
        let messagesReceived = 0;
        const receiver = this.receiver;
        const lastSeenLappedCount = receiver.lappedCount();

        if (receiver.receiveNext()) {
            if (lastSeenLappedCount !== receiver.lappedCount()) {
                throw new IllegalStateException('unable to keep up with broadcast');
            }

            const length = receiver.length();
            const capacity = this.scratchBuffer.capacity();
            if (length > capacity && !this.scratchBuffer.isExpandable()) {
                throw new IllegalStateException('buffer required length of ' + length + ' but only has ' + capacity);
            }

            const msgTypeId = receiver.typeId();
            this.scratchBuffer.putBytes(0, receiver.buffer(), receiver.offset(), length);

            if (!receiver.validate()) {
                throw new IllegalStateException('unable to keep up with broadcast');
            }

            handler.onMessage(msgTypeId, this.scratchBuffer, 0, length);

            messagesReceived = 1;
        }

        return messagesReceived;
    }
}
