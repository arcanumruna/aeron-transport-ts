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
// Port of io/aeron/logbuffer/RawBlockHandler.java @ 1.53.3
import type { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';

/**
 * Function for handling a raw block of fragments from the log that are contained in the underlying file.
 * <p>
 * An interface with the method `onBlock`, as {@link FragmentHandler}. The log buffers live in memory and there is no
 * underlying file (spec D4), so the `FileChannel` of Java is `unknown` here and no caller passes one.
 */
export interface RawBlockHandler {
    /**
     * Notification of an available block of fragments.
     *
     * @param fileChannel containing the block of fragments.
     * @param fileOffset  at which the block begins, including any frame headers.
     * @param termBuffer  mapped over the block of fragments.
     * @param termOffset  in the termBuffer at which block begins, including any frame headers.
     * @param length      of the block in bytes, including any frame headers that is aligned up to
     *                    {@link FrameDescriptor.FRAME_ALIGNMENT}.
     * @param sessionId   of the stream of fragments.
     * @param termId      of the stream of fragments.
     */
    onBlock(
        fileChannel: unknown,
        fileOffset: number,
        termBuffer: UnsafeBuffer,
        termOffset: number,
        length: number,
        sessionId: number,
        termId: number,
    ): void;
}
