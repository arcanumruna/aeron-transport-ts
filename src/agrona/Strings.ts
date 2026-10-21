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
// Port of org/agrona/Strings.java @ Agrona 2.6.1
import { Integer } from './jdk.js';

/**
 * Utility functions for using Strings.
 */
export class Strings {
    private constructor() {}

    /**
     * Is a string null or empty?
     *
     * @param value to be tested.
     * @return true if the value is null or an empty string.
     */
    public static isEmpty(value: string | null | undefined): value is null | undefined | '' {
        return null == value || value.length === 0;
    }

    /**
     * Parse an int from a String. If the String is null then return the defaultValue.
     *
     * @param value        to be parsed.
     * @param defaultValue to be used if the String value is null.
     * @return the int value of the string or the default on null.
     * @throws NumberFormatException if the value is not an int.
     */
    public static parseIntOrDefault(value: string | null | undefined, defaultValue: number): number {
        if (null == value) {
            return defaultValue;
        }

        return Integer.parseInt(value);
    }
}
