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
// Port of io/aeron/driver/DefaultMulticastFlowControlSupplierTest.java @ 1.53.3
import { describe, expect, it } from 'vitest';
import { IllegalArgumentException } from '../../src/agrona/jdk.js';
import { DefaultMulticastFlowControlSupplier } from '../../src/driver/DefaultMulticastFlowControlSupplier.js';
import { MaxMulticastFlowControl } from '../../src/driver/MaxMulticastFlowControl.js';
import { UdpChannel } from '../../src/driver/media/UdpChannel.js';
import { MinMulticastFlowControl } from '../../src/driver/MinMulticastFlowControl.js';
import { TaggedMulticastFlowControl } from '../../src/driver/TaggedMulticastFlowControl.js';
import { assertThrows } from '../support/Assertions.js';

describe('DefaultMulticastFlowControlSupplierTest', () => {
    const supplier = new DefaultMulticastFlowControlSupplier();

    it.each([
        'aeron:udp?endpoint=224.20.30.39:54326|interface=localhost|fc=min',
        'aeron:udp?endpoint=224.20.30.39:54326|interface=localhost|fc=min,t:100ms',
        'aeron:udp?endpoint=224.20.30.39:54326|interface=localhost|fc=min,t:100ms,g:10',
    ])('shouldReturnMinFlowControl %s', (uri) => {
        expect(supplier.newInstance(UdpChannel.parse(uri), 0, 0).constructor).toBe(MinMulticastFlowControl);
    });

    it.each([
        'aeron:udp?endpoint=224.20.30.39:54326|interface=localhost|fc=max',
        'aeron:udp?endpoint=224.20.30.39:54326|interface=localhost|fc=max,t:100ms',
        'aeron:udp?endpoint=224.20.30.39:54326|interface=localhost|fc=max,t:100ms,g:10',
    ])('shouldReturnMaxFlowControl %s', (uri) => {
        expect(supplier.newInstance(UdpChannel.parse(uri), 0, 0).constructor).toBe(MaxMulticastFlowControl);
    });

    it.each([
        'aeron:udp?endpoint=224.20.30.39:54326|interface=localhost|fc=tagged',
        'aeron:udp?endpoint=224.20.30.39:54326|interface=localhost|fc=tagged,t:100ms',
        'aeron:udp?endpoint=224.20.30.39:54326|interface=localhost|fc=tagged,t:100ms,g:10',
    ])('shouldReturnTaggedFlowControl %s', (uri) => {
        expect(supplier.newInstance(UdpChannel.parse(uri), 0, 0).constructor).toBe(TaggedMulticastFlowControl);
    });

    it.each([
        'aeron:udp?endpoint=224.20.30.39:54326|interface=localhost|fc=minute',
        'aeron:udp?endpoint=224.20.30.39:54326|interface=localhost|fc=maximillian',
        'aeron:udp?endpoint=224.20.30.39:54326|interface=localhost|fc=taggedalong',
        'aeron:udp?endpoint=224.20.30.39:54326|interface=localhost|fc=foobar',
    ])('shouldRejectInvalidFlowControl %s', (uri) => {
        assertThrows(IllegalArgumentException, () => supplier.newInstance(UdpChannel.parse(uri), 0, 0));
    });
});
