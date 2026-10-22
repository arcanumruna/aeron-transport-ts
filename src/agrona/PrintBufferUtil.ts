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
// Port of org/agrona/PrintBufferUtil.java @ 2.6.1 (only byteToHexStringPadded and its table)

const BYTE2HEX_PAD: string[] = new Array<string>(256);

{
    let i: number;
    for (i = 0; i < 10; i++) {
        BYTE2HEX_PAD[i] = '0' + i;
    }

    for (; i < 16; i++) {
        const c = String.fromCharCode('a'.charCodeAt(0) + i - 10);
        BYTE2HEX_PAD[i] = '0' + c;
    }

    for (; i < BYTE2HEX_PAD.length; i++) {
        BYTE2HEX_PAD[i] = i.toString(16);
    }
}

/**
 * Converts the specified byte value into a 2-digit hexadecimal integer.
 *
 * @param value to convert.
 * @return hexadecimal representation of the lowest eight bits of the value.
 */
export function byteToHexStringPadded(value: number): string {
    return BYTE2HEX_PAD[value & 0xff]!;
}
