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
// Port of org/agrona/collections/Int2NullableObjectHashMap.java @ Agrona 2.6.1
import { Int2ObjectHashMap } from './Int2ObjectHashMap.js';
import { NullReference } from './NullReference.js';

/**
 * {@link Int2ObjectHashMap} that allows null values.
 *
 * @typeParam V - type of values stored in the {@link Map}.
 */
export class Int2NullableObjectHashMap<V> extends Int2ObjectHashMap<V> {
    /**
     * {@inheritDoc}
     */
    protected override mapNullValue(value: unknown): unknown {
        return null === value ? NullReference.INSTANCE : value;
    }

    /**
     * {@inheritDoc}
     */
    protected override unmapNullValue(value: unknown): V | null {
        return NullReference.INSTANCE === value ? null : (value as V | null);
    }
}
