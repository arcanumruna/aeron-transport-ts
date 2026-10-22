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
// Port of io/aeron/logging/LogUtil.java @ 1.53.3 (only appendIpV6Address and ipV6Group; see docs/mapping.md)
import type { DirectBuffer } from '../../agrona/DirectBuffer.js';
import type { Appendable } from '../../agrona/jdk.js';
import { byteToHexStringPadded } from '../../agrona/PrintBufferUtil.js';

/**
 * Utility methods for logging.
 */
export class LogUtil {
    /**
     * Append an IPv6 address as a string.
     *
     * @param builder   to append to.
     * @param buffer    to read from.
     * @param offset    to read from.
     */
    public static appendIpV6Address(builder: Appendable, buffer: DirectBuffer, offset: number): void {
        let bestStart = -1;
        let bestLength = 0;
        let runStart = -1;
        let runLength = 0;

        for (let i = 0; i < 8; i++) {
            if (0 === LogUtil.ipV6Group(buffer, i, offset)) {
                if (-1 === runStart) {
                    runStart = i;
                }
                runLength++;
            } else {
                if (runLength > bestLength) {
                    bestStart = runStart;
                    bestLength = runLength;
                }
                runStart = -1;
                runLength = 0;
            }
        }

        if (runLength > bestLength) {
            bestStart = runStart;
            bestLength = runLength;
        }

        if (bestLength < 2) {
            bestStart = -1;
        }

        builder.append('[');
        for (let i = 0; i < 8;) {
            if (i === bestStart) {
                builder.append('::');
                i += bestLength;
                continue;
            }

            builder.append(byteToHexStringPadded(0xff & buffer.getByte(i * 2 + offset)));
            builder.append(byteToHexStringPadded(0xff & buffer.getByte(i * 2 + 1 + offset)));

            i++;

            if (i < 8 && i !== bestStart) {
                builder.append(':');
            }
        }
        builder.append(']');
    }

    private static ipV6Group(buffer: DirectBuffer, index: number, offset: number): number {
        const byteOffset = index * 2 + offset;
        return ((buffer.getByte(byteOffset) << 8) & 0xff00) | (buffer.getByte(byteOffset + 1) & 0xff);
    }
}
