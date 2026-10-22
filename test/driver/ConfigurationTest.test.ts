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
// Port of io/aeron/driver/ConfigurationTest.java @ 1.53.3
import { afterEach, describe, expect, it } from 'vitest';
import { System } from '../../src/agrona/jdkLang.js';
import { Configuration } from '../../src/driver/Configuration.js';

describe('ConfigurationTest', () => {
    afterEach(() => {
        System.clearProperty(Configuration.TERM_BUFFER_SPARSE_FILE_PROP_NAME);
    });

    it('shouldUseSparseFilesByDefault', () => {
        System.clearProperty(Configuration.TERM_BUFFER_SPARSE_FILE_PROP_NAME);
        expect(Configuration.termBufferSparseFile()).toBe(true);
    });

    it.each([true, false])('shouldUseSparseFilesByDefault %s', (useSparseFiles) => {
        System.setProperty(Configuration.TERM_BUFFER_SPARSE_FILE_PROP_NAME, String(useSparseFiles));
        try {
            expect(Configuration.termBufferSparseFile()).toBe(useSparseFiles);
        } finally {
            System.clearProperty(Configuration.TERM_BUFFER_SPARSE_FILE_PROP_NAME);
        }
    });
});
