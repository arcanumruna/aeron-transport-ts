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
// Port of org/agrona/concurrent/MessageHandler.java @ Agrona 2.6.1
import type { MutableDirectBuffer } from '../MutableDirectBuffer.js';

/**
 * Callback interface for processing of messages that are read from a buffer.
 * <p>
 * An interface with the method `onMessage`, as the handlers of the client: a class implements one, and the call sites
 * read the same as Java's.
 */
export interface MessageHandler {
    /**
     * Called for the processing of each message read from a buffer in turn.
     *
     * @param msgTypeId type of the encoded message.
     * @param buffer    containing the encoded message.
     * @param index     at which the encoded message begins.
     * @param length    in bytes of the encoded message.
     */
    onMessage(msgTypeId: number, buffer: MutableDirectBuffer, index: number, length: number): void;
}
