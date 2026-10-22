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
// Port of io/aeron/driver/DefaultNameResolverTest.java @ 1.53.3
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DefaultNameResolver } from '../../src/driver/DefaultNameResolver.js';
import { InetAddress } from '../../src/driver/jdkNet.js';
import { assertEqualsObject } from '../support/Assertions.js';

describe('DefaultNameResolverTest', () => {
    const nameResolver = new DefaultNameResolver();

    it('resolveReturnsNullForUnknownHost', () => {
        const hostName = randomUUID();
        const uriParamName = 'endpoint';
        const isReResolution = false;

        expect(nameResolver.resolve(hostName, uriParamName, isReResolution)).toBeNull();
    });

    it('resolveResolvesLocalhostAddress', () => {
        const hostName = 'localhost';
        const uriParamName = 'control';
        const isReResolution = true;

        const address = nameResolver.resolve(hostName, uriParamName, isReResolution);

        assertEqualsObject(InetAddress.getLoopbackAddress(), address);
    });
});
