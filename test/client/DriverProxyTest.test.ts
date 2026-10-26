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
// Port of io/aeron/DriverProxyTest.java @ 1.53.3
import { describe, expect, it } from 'vitest';
import type { MessageHandler } from '../../src/agrona/concurrent/MessageHandler.js';
import { ManyToOneRingBuffer } from '../../src/agrona/concurrent/ringbuffer/ManyToOneRingBuffer.js';
import { RingBufferDescriptor } from '../../src/agrona/concurrent/ringbuffer/RingBufferDescriptor.js';
import type { RingBuffer } from '../../src/agrona/concurrent/ringbuffer/RingBuffer.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { MutableDirectBuffer } from '../../src/agrona/MutableDirectBuffer.js';
import { ControlProtocolEvents } from '../../src/client/command/ControlProtocolEvents.js';
import { PublicationMessageFlyweight } from '../../src/client/command/PublicationMessageFlyweight.js';
import { RemovePublicationFlyweight } from '../../src/client/command/RemovePublicationFlyweight.js';
import { RemoveSubscriptionFlyweight } from '../../src/client/command/RemoveSubscriptionFlyweight.js';
import { DriverProxy } from '../../src/client/DriverProxy.js';

const { ADD_PUBLICATION, REMOVE_PUBLICATION, REMOVE_SUBSCRIPTION } = ControlProtocolEvents;
const { TRAILER_LENGTH } = RingBufferDescriptor;

const CHANNEL = 'aeron:udp?interface=localhost:40123|endpoint=localhost:40124';

const STREAM_ID = 1001;
const CORRELATION_ID = 3;
const CLIENT_ID = 7;

describe('DriverProxyTest', () => {
    // JUnit makes a new test class instance for each test, so each test has its own ring buffer.
    function newProxy(): { conductorBuffer: RingBuffer; conductor: DriverProxy } {
        const conductorBuffer = new ManyToOneRingBuffer(new UnsafeBuffer(new ArrayBuffer(TRAILER_LENGTH + 1024)));
        return { conductorBuffer, conductor: new DriverProxy(conductorBuffer, CLIENT_ID) };
    }

    function assertReadsOneMessage(conductorBuffer: RingBuffer, handler: MessageHandler): void {
        const messageCount = conductorBuffer.read(handler);
        expect(messageCount).toBe(1);
    }

    it('threadSendsAddChannelMessage', () => {
        const { conductorBuffer, conductor } = newProxy();

        threadSendsChannelMessage(conductorBuffer, () => conductor.addPublication(CHANNEL, STREAM_ID), ADD_PUBLICATION);
    });

    it('threadSendsRemoveChannelMessage', () => {
        const { conductorBuffer, conductor } = newProxy();

        conductor.removePublication(CORRELATION_ID, false);
        assertReadsOneMessage(conductorBuffer, {
            onMessage(msgTypeId: number, buffer: MutableDirectBuffer, index: number): void {
                const message = new RemovePublicationFlyweight();
                message.wrap(buffer, index);

                expect(msgTypeId).toBe(REMOVE_PUBLICATION);
                expect(message.registrationId()).toBe(CORRELATION_ID);
            },
        });
    });

    it('threadSendsRemoveSubscriberMessage', () => {
        const { conductorBuffer, conductor } = newProxy();

        conductor.removeSubscription(CORRELATION_ID);

        assertReadsOneMessage(conductorBuffer, {
            onMessage(msgTypeId: number, buffer: MutableDirectBuffer, index: number): void {
                const removeMessage = new RemoveSubscriptionFlyweight();
                removeMessage.wrap(buffer, index);

                expect(msgTypeId).toBe(REMOVE_SUBSCRIPTION);
                expect(removeMessage.registrationId()).toBe(CORRELATION_ID);
            },
        });
    });

    function threadSendsChannelMessage(
        conductorBuffer: RingBuffer,
        sendMessage: () => void,
        expectedMsgTypeId: number,
    ): void {
        sendMessage();

        assertReadsOneMessage(conductorBuffer, {
            onMessage(msgTypeId: number, buffer: MutableDirectBuffer, index: number): void {
                const publicationMessage = new PublicationMessageFlyweight();
                publicationMessage.wrap(buffer, index);

                expect(msgTypeId).toBe(expectedMsgTypeId);
                expect(publicationMessage.channel()).toBe(CHANNEL);
                expect(publicationMessage.streamId()).toBe(STREAM_ID);
            },
        });
    }
});
