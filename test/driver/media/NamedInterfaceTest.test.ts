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
// Port of io/aeron/driver/media/NamedInterfaceTest.java @ 1.53.3
import { describe, expect, it } from 'vitest';
import { IllegalArgumentException } from '../../../src/agrona/jdk.js';
import { NamedInterface } from '../../../src/driver/media/NamedInterface.js';
import { assertThrows } from '../../support/Assertions.js';

const validInputs: [string, string, number][] = [
    ['{eth0}', 'eth0', 0],
    ['{eth0}:0', 'eth0', 0],
    ['{eth0}:1234', 'eth0', 1234],
    ['{eth0:0}:0', 'eth0:0', 0],
    ['{eth0:1}:2000', 'eth0:1', 2000],
    ['{eth0.100}:80', 'eth0.100', 80],
    ['{x}:5678', 'x', 5678],
    ['{lo}:65535', 'lo', 65535],
    ['{Ethernet 1}', 'Ethernet 1', 0],
    ['{ethernet_32768}', 'ethernet_32768', 0],
    ['{foo{bar-baz-12345}}:9999', 'foo{bar-baz-12345}', 9999],
];

describe('NamedInterfaceTest', () => {
    it.each([
        null,
        '',
        ' ',
        'eth0',
        'eth0:0',
        '{eth0',
        '{eth0}:',
        '{eth0}0',
        '{eth0}:-1000',
        '{eth0};1000',
        '{eth0}:1000:2000',
        '{eth0}:65536',
        '{}',
    ])('shouldThrowIfParseInputIsInvalid [%s]', (invalid) => {
        assertThrows(IllegalArgumentException, () => NamedInterface.parse(invalid));
    });

    it.each(validInputs)('shouldParseValidInputs %s %s %d', (str, name, port) => {
        const namedInterface = NamedInterface.parse(str);
        expect(namedInterface.name).toBe(name);
        expect(namedInterface.port).toBe(port);
    });
});
