/*
 * Copyright 2025 Adaptive Financial Consulting Limited.
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
// Port of io/aeron/driver/media/UnresolvedInterfaceTest.java @ 1.53.3
import { describe, expect, it } from 'vitest';
import { IllegalArgumentException } from '../../../src/agrona/jdk.js';
import { InterfaceSearchAddress } from '../../../src/driver/media/InterfaceSearchAddress.js';
import { NamedInterface } from '../../../src/driver/media/NamedInterface.js';
import { UnresolvedInterface } from '../../../src/driver/media/UnresolvedInterface.js';
import { assertThrows } from '../../support/Assertions.js';

describe('UnresolvedInterfaceTest', () => {
    it('shouldParseValidInterfaceSpecifications', () => {
        expect(UnresolvedInterface.parse('localhost')).toBeInstanceOf(InterfaceSearchAddress);
        expect(UnresolvedInterface.parse('10.0.0.1')).toBeInstanceOf(InterfaceSearchAddress);
        expect(UnresolvedInterface.parse('[2001:db8::1]')).toBeInstanceOf(InterfaceSearchAddress);
        expect(UnresolvedInterface.parse('{lo}')).toBeInstanceOf(NamedInterface);
    });

    it('shouldThrowOnInvalidInterfaceSpecifications', () => {
        assertThrows(IllegalArgumentException, () => UnresolvedInterface.parse(null));
        assertThrows(IllegalArgumentException, () => UnresolvedInterface.parse(''));
    });
});
