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
// Port of io/aeron/driver/status/SystemCounters.java @ 1.53.3
import { CloseHelper } from '../../agrona/CloseHelper.js';
import { type AtomicCounter } from '../../agrona/concurrent/status/AtomicCounter.js';
import { type CountersManager } from '../../agrona/concurrent/status/CountersManager.js';
import { type AutoCloseable } from '../../agrona/jdkLang.js';
import { SystemCounterDescriptor } from './SystemCounterDescriptor.js';

/**
 * Aggregate entry point for managing counters of system status.
 */
export class SystemCounters implements AutoCloseable {
    /**
     * Java's `EnumMap<SystemCounterDescriptor, AtomicCounter>` is an array indexed by the ordinal of the descriptor,
     * which is what `EnumMap` is inside (see `docs/mapping.md`).
     */
    private readonly counterByDescriptorMap: AtomicCounter[] = [];

    /**
     * Construct the counters for this system.
     *
     * @param countersManager which will manage the underlying storage.
     */
    public constructor(countersManager: CountersManager) {
        for (const descriptor of SystemCounterDescriptor.values()) {
            this.counterByDescriptorMap[descriptor.ordinal()] = descriptor.newCounter(countersManager);
        }
    }

    /**
     * Get the counter for a particular descriptor.
     *
     * @param descriptor by which the counter should be looked up.
     * @return the counter for the given descriptor.
     */
    public get(descriptor: SystemCounterDescriptor): AtomicCounter {
        return this.counterByDescriptorMap[descriptor.ordinal()] as AtomicCounter;
    }

    /**
     * Close all the counters.
     */
    public close(): void {
        CloseHelper.closeAll(this.counterByDescriptorMap);
    }

    public toString(): string {
        // EnumMap.toString(): "{KEY=value, KEY=value}" in ordinal order.
        const descriptors = SystemCounterDescriptor.values();
        let entries = '';
        for (let i = 0; i < descriptors.length; i++) {
            if (i > 0) {
                entries += ', ';
            }
            entries +=
                (descriptors[i] as SystemCounterDescriptor).toString() +
                '=' +
                (this.counterByDescriptorMap[i] as AtomicCounter).toString();
        }

        return 'SystemCounters{counterByDescriptorMap={' + entries + '}}';
    }
}
