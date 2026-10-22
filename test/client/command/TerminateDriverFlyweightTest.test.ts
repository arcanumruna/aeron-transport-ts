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
// Port of io/aeron/command/TerminateDriverFlyweightTest.java @ 1.53.3
import { describe, expect, it } from 'vitest';
import { type DirectBuffer } from '../../../src/agrona/DirectBuffer.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { TerminateDriverFlyweight } from '../../../src/client/command/TerminateDriverFlyweight.js';

const { TOKEN_BUFFER_OFFSET } = TerminateDriverFlyweight;

describe('TerminateDriverFlyweight', () => {
    it('tokenBuffer', () => {
        const offset = 24;
        const buffer = new UnsafeBuffer(new ArrayBuffer(128));
        buffer.setMemory(0, offset, 15);
        const flyweight = new TerminateDriverFlyweight();
        flyweight.wrap(buffer, offset);

        flyweight.tokenBuffer(newBuffer(16), 4, 8);

        expect(flyweight.tokenBufferLength()).toBe(8);
        expect(flyweight.tokenBufferOffset()).toBe(TOKEN_BUFFER_OFFSET);
        expect(flyweight.length()).toBe(TOKEN_BUFFER_OFFSET + 8);
    });

    function newBuffer(length: number): DirectBuffer {
        const bytes = new Uint8Array(length).fill(1);
        const buffer = new UnsafeBuffer(new ArrayBuffer(4 + length));
        buffer.putBytes(4, bytes);
        return buffer;
    }
});
