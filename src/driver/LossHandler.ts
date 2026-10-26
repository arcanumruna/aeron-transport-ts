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
// Port of io/aeron/driver/LossHandler.java @ 1.53.3
/**
 * Handler for a detected loss, called by the {@link LossDetector}. Java's `@FunctionalInterface` is an interface with
 * the one method.
 */
export interface LossHandler {
    /**
     * Called when a gap in the message stream has been detected.
     *
     * @param termId     for the gap
     * @param termOffset for the beginning of the gap
     * @param length     of the gap
     */
    onGapDetected(termId: number, termOffset: number, length: number): void;
}
