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
// Port of io/aeron/driver/ext/LossGenerator.java @ 1.53.3
import type { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import type { InetSocketAddress } from '../jdkNet.js';

/**
 * Generator for the loss of frames, to test the reliability of a stream.
 * <p>
 * Java's two overloads are one method (spec D62): the form with a stream, session, term id and term offset is the one
 * with a defined `sessionId`; the Java default of that form delegates to the short one, so an implementation that only
 * has a short form ignores the extra arguments.
 */
export interface LossGenerator {
    /**
     * Should a frame be dropped?
     *
     * @param address The source address of the frame if inbound or the remote address if outbound.
     * @param buffer  The buffer containing the frame data.
     * @param length  The length of the frame.
     * @return true to drop, false to process
     */
    shouldDropFrame(address: InetSocketAddress | null, buffer: UnsafeBuffer | null, length: number): boolean;

    /**
     * Should a frame be dropped?
     *
     * @param address    The source address of the frame if inbound or the remote address if outbound.
     * @param buffer     The buffer containing the frame data.
     * @param streamId   of the incoming frame.
     * @param sessionId  of the incoming frame
     * @param termId     of the incoming frame.
     * @param termOffset of the incoming frame.
     * @param length     of the incoming frame.
     * @return true to drop, false to process
     */
    shouldDropFrame(
        address: InetSocketAddress | null,
        buffer: UnsafeBuffer | null,
        streamId: number,
        sessionId: number,
        termId: number,
        termOffset: number,
        length: number,
    ): boolean;
}
