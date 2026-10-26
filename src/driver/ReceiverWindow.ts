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
// Not in Java (spec D118): the receiver window members of io/aeron/driver/Configuration.java @ 1.53.3 that
// FlowControl reads.
/**
 * The initial receiver window length and its clamp to the term buffer. `Configuration` re-exports them as
 * `Configuration.INITIAL_WINDOW_LENGTH_DEFAULT` and `Configuration.receiverWindowLength`; `FlowControl` reads them from
 * here, so that `FlowControl` and the strategies that import it do not import `Configuration` (which imports the
 * suppliers, which import the strategies: a cycle through the `extends` of the strategies).
 */
export const ReceiverWindow = {
    /**
     * Default initial window length for flow control sent to a sender: 128 KB.
     */
    INITIAL_WINDOW_LENGTH_DEFAULT: 128 * 1024,

    /**
     * Length to be used for the receiver window taking into account initial window length and term buffer length.
     *
     * @param termBufferLength    for the publication image.
     * @param initialWindowLength set for the channel.
     * @return the length to be used for the receiver window.
     */
    receiverWindowLength(termBufferLength: number, initialWindowLength: number): number {
        return Math.min(initialWindowLength, termBufferLength >> 1);
    },
} as const;
