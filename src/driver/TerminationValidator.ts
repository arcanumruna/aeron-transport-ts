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
// Port of io/aeron/driver/TerminationValidator.java @ 1.53.3
import type { DirectBuffer } from '../agrona/DirectBuffer.js';

/**
 * Validate if the driver should terminate based on the provided token. The Aeron directory argument of Java is not
 * passed: there is no directory (spec D4).
 */
export interface TerminationValidator {
    /**
     * Should the given termination request be considered valid or not.
     *
     * @param tokenBuffer of the token in the request.
     * @param tokenOffset of the token within the buffer.
     * @param tokenLength of the token within the buffer.
     * @return true if request is to be considered valid and the driver termination hook should be run or false if not.
     */
    allowTermination(tokenBuffer: DirectBuffer, tokenOffset: number, tokenLength: number): boolean;
}
