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
// Port of org/agrona/collections/NullReference.java @ Agrona 2.6.1
import type { HashCoded } from '../jdkUtil.js';

/**
 * Placeholder object that stands for a null reference in a collection that cannot hold null.
 */
export class NullReference implements HashCoded {
    /**
     * Single instance of the {@link NullReference} class.
     */
    public static readonly INSTANCE: NullReference = new NullReference();

    private constructor() {}

    public hashCode(): number {
        return 0;
    }

    public equals(obj: unknown): boolean {
        return obj === this;
    }
}
