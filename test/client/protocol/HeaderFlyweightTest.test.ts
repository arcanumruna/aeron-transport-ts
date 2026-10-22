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
// Port of io/aeron/protocol/HeaderFlyweightTest.java @ 1.53.3
import { describe, expect, it } from 'vitest';
import type { Appendable } from '../../../src/agrona/jdk.js';
import { HeaderFlyweight } from '../../../src/client/protocol/HeaderFlyweight.js';

/** Stand-in for `java.lang.StringBuilder`, the only `Appendable` the test uses. */
class StringBuilder implements Appendable {
    private text = '';

    public append(c: string): StringBuilder {
        this.text += c;
        return this;
    }

    public toString(): string {
        return this.text;
    }
}

describe('HeaderFlyweight', () => {
    it('shouldConvertFlags', () => {
        const flags = 0b01101000;

        const flagsAsChars = HeaderFlyweight.flagsToChars(flags);
        expect(flagsAsChars.join('')).toBe('01101000');
    });

    it('shouldAppendFlags', () => {
        const flags = 0b01100000;
        const builder = new StringBuilder();

        HeaderFlyweight.appendFlagsAsChars(flags, builder);
        expect(builder.toString()).toBe('01100000');
    });
});
