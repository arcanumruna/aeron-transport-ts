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
// Port of org/agrona/SystemUtil.java @ Agrona 2.6.1
import { url as inspectorUrl } from 'node:inspector';
import { AsciiEncoding } from './AsciiEncoding.js';
import { Strings } from './Strings.js';
import {
    Character,
    IllegalArgumentException,
    Integer,
    LongOverflowError,
    longToNumber,
    NumberFormatException,
    TimeUnit,
} from './jdk.js';
import { System } from './jdkLang.js';

/**
 * Utilities for inspecting the system.
 */
export class SystemUtil {
    private static readonly ONE_GIGABYTE = 1024 * 1024 * 1024;
    private static readonly ONE_MEGABYTE = 1024 * 1024;
    private static readonly ONE_KILOBYTE = 1024;
    // the bounds are Java's, on the full 64-bit long, as bigints; a result outside +/-(2^53 - 1) is a LongOverflowError
    private static readonly JAVA_LONG_MAX_VALUE = 2n ** 63n - 1n;
    private static readonly MAX_G_VALUE = SystemUtil.JAVA_LONG_MAX_VALUE / BigInt(SystemUtil.ONE_GIGABYTE);
    private static readonly MAX_M_VALUE = SystemUtil.JAVA_LONG_MAX_VALUE / BigInt(SystemUtil.ONE_MEGABYTE);
    private static readonly MAX_K_VALUE = SystemUtil.JAVA_LONG_MAX_VALUE / BigInt(SystemUtil.ONE_KILOBYTE);

    private static readonly ONE_MICROSECOND_NS = 1_000;
    private static readonly ONE_MILLISECOND_NS = SystemUtil.ONE_MICROSECOND_NS * 1000;
    private static readonly ONE_SECOND_NS = SystemUtil.ONE_MILLISECOND_NS * 1000;

    private constructor() {}

    /**
     * Is a debugger attached to the process? Java looks for the JDWP agent in the JVM's input arguments; here it is
     * the inspector (`node --inspect`, a debugger front end) being active.
     *
     * @return true if a debugger is attached otherwise false.
     */
    public static isDebuggerAttached(): boolean {
        return undefined !== inspectorUrl();
    }

    /**
     * Get a size value as an int from a system property. Supports a 'g', 'm', and 'k' suffix to indicate
     * gigabytes, megabytes, or kilobytes respectively.
     *
     * @param propertyName to lookup.
     * @param defaultValue to be applied if the system property is not set.
     * @return the int value.
     * @throws NumberFormatException if the value is out of range or mal-formatted.
     */
    public static getSizeAsInt(propertyName: string, defaultValue: number): number {
        const propertyValue = System.getProperty(propertyName);
        if (null !== propertyValue) {
            const value = SystemUtil.parseSize(propertyName, propertyValue);
            if (value < 0 || value > Integer.MAX_VALUE) {
                throw new NumberFormatException(
                    propertyName + ' must positive and less than Integer.MAX_VALUE: ' + value,
                );
            }

            return value;
        }

        return defaultValue;
    }

    /**
     * Get a size value as a long from a system property. Supports a 'g', 'm', and 'k' suffix to indicate
     * gigabytes, megabytes, or kilobytes respectively.
     *
     * @param propertyName to lookup.
     * @param defaultValue to be applied if the system property is not set.
     * @return the long value.
     * @throws NumberFormatException if the value is out of range or mal-formatted.
     */
    public static getSizeAsLong(propertyName: string, defaultValue: number): number {
        const propertyValue = System.getProperty(propertyName);
        if (null !== propertyValue) {
            return SystemUtil.parseSize(propertyName, propertyValue);
        }

        return defaultValue;
    }

    /**
     * Parse a string representation of a value with optional suffix of 'g', 'm', and 'k' suffix to indicate
     * gigabytes, megabytes, or kilobytes respectively.
     *
     * @param propertyName  that associated with the size value.
     * @param propertyValue to be parsed.
     * @return the long value.
     * @throws NumberFormatException if the value is out of range or mal-formatted.
     */
    public static parseSize(propertyName: string, propertyValue: string | null): number {
        SystemUtil.validateNonNegative(propertyName, propertyValue);

        const suffixIndex = propertyValue.length - 1;
        const lastCharacter = propertyValue.charCodeAt(suffixIndex);
        if (Character.isDigit(lastCharacter)) {
            return AsciiEncoding.parseLongAscii(propertyValue, 0, propertyValue.length);
        }

        const value = SystemUtil.parseLong(propertyValue, 0, suffixIndex);

        switch (String.fromCharCode(lastCharacter)) {
            case 'k':
            case 'K': {
                if (value > SystemUtil.MAX_K_VALUE) {
                    throw new NumberFormatException(propertyName + ' would overflow a long: ' + propertyValue);
                }
                return longToNumber(value * BigInt(SystemUtil.ONE_KILOBYTE));
            }
            case 'm':
            case 'M': {
                if (value > SystemUtil.MAX_M_VALUE) {
                    throw new NumberFormatException(propertyName + ' would overflow a long: ' + propertyValue);
                }
                return longToNumber(value * BigInt(SystemUtil.ONE_MEGABYTE));
            }
            case 'g':
            case 'G': {
                if (value > SystemUtil.MAX_G_VALUE) {
                    throw new NumberFormatException(propertyName + ' would overflow a long: ' + propertyValue);
                }
                return longToNumber(value * BigInt(SystemUtil.ONE_GIGABYTE));
            }
            default:
                throw new NumberFormatException(propertyName + ': ' + propertyValue + ' should end with: k, m, or g.');
        }
    }

    /**
     * Format size value as shortest possible String with an optional suffix. For example, {@code 123} will be
     * formatted as {@code 123}, {@code 2048} will be formatted as {@code 2k}.
     *
     * @param size to format.
     * @return formatted value.
     * @throws IllegalArgumentException if {@code size < 0}.
     * @see #parseDuration(String, String)
     * @since 2.4.0
     */
    public static formatSize(size: number): string {
        if (size < 0) {
            throw new IllegalArgumentException('size must be positive: ' + size);
        }

        if (size >= SystemUtil.ONE_GIGABYTE) {
            const value = Math.trunc(size / SystemUtil.ONE_GIGABYTE);
            if (size === value * SystemUtil.ONE_GIGABYTE) {
                return value + 'g';
            }
        }

        if (size >= SystemUtil.ONE_MEGABYTE) {
            const value = Math.trunc(size / SystemUtil.ONE_MEGABYTE);
            if (size === value * SystemUtil.ONE_MEGABYTE) {
                return value + 'm';
            }
        }

        if (size >= SystemUtil.ONE_KILOBYTE) {
            const value = Math.trunc(size / SystemUtil.ONE_KILOBYTE);
            if (size === value * SystemUtil.ONE_KILOBYTE) {
                return value + 'k';
            }
        }

        return String(size);
    }

    /**
     * Get a time duration in nanoseconds from a system property. Supports a 's', 'ms', 'us', or 'ns' suffix to
     * indicate seconds, milliseconds, microseconds, or nanoseconds respectively. If no suffix is given nanoseconds
     * is assumed.
     * <p>
     * If the resulting duration is greater than {@link Long#MAX_VALUE} (here 2^53 - 1) then {@link Long#MAX_VALUE} is used.
     *
     * @param propertyName to lookup.
     * @param defaultValue to be applied if the system property is not set.
     * @return the long value.
     * @throws NumberFormatException if the value is negative or malformed.
     */
    public static getDurationInNanos(propertyName: string, defaultValue: number): number {
        const propertyValue = System.getProperty(propertyName);
        if (null !== propertyValue) {
            return SystemUtil.parseDuration(propertyName, propertyValue);
        }

        return defaultValue;
    }

    /**
     * Parse a string representation of a time duration with an optional suffix of 's', 'ms', 'us', or 'ns' to
     * indicate seconds, milliseconds, microseconds, or nanoseconds respectively.
     * <p>
     * If the resulting duration is greater than {@link Long#MAX_VALUE} (here 2^53 - 1) then {@link Long#MAX_VALUE} is used.
     *
     * @param propertyName  associated with the duration value.
     * @param propertyValue to be parsed.
     * @return the long value.
     * @throws NumberFormatException if the value is negative or malformed.
     */
    public static parseDuration(propertyName: string, propertyValue: string | null): number {
        SystemUtil.validateNonNegative(propertyName, propertyValue);

        const length = propertyValue.length;
        let c = propertyValue.charCodeAt(length - 1);
        if (Character.isDigit(c)) {
            return TimeUnit.NANOSECONDS.toNanos(SystemUtil.parseLong(propertyValue, 0, length));
        }

        let suffixIndex = length - 1;
        let suffixStartChar = c;
        if ((c === 's'.charCodeAt(0) || c === 'S'.charCodeAt(0)) && length > 1) {
            c = propertyValue.charCodeAt(length - 2);
            if (!Character.isDigit(c)) {
                if (--suffixIndex <= 0) {
                    SystemUtil.throwInvalidDurationFormat(propertyName, propertyValue);
                }
                suffixStartChar = c;
            }
        } else {
            SystemUtil.throwInvalidDurationFormat(propertyName, propertyValue);
        }

        const value = SystemUtil.parseLong(propertyValue, 0, suffixIndex);

        switch (String.fromCharCode(suffixStartChar)) {
            case 'n':
            case 'N':
                return TimeUnit.NANOSECONDS.toNanos(value);
            case 'u':
            case 'U':
                return TimeUnit.MICROSECONDS.toNanos(value);
            case 'm':
            case 'M':
                return TimeUnit.MILLISECONDS.toNanos(value);
            case 's':
            case 'S':
                return TimeUnit.SECONDS.toNanos(value);
            default:
                SystemUtil.throwInvalidDurationFormat(propertyName, propertyValue);
        }
    }

    /**
     * Format duration value as shortest possible String with a suffix. For example, {@code 123} will be
     * formatted as {@code 123ns}, {@code 60'000'000'000} will be formatted as {@code 60s}.
     *
     * @param durationNs value to format.
     * @return formatted value.
     * @throws IllegalArgumentException if {@code duration < 0}.
     * @see #parseDuration(String, String)
     * @since 2.4.0
     */
    public static formatDuration(durationNs: number): string {
        if (durationNs < 0) {
            throw new IllegalArgumentException('duration must be positive: ' + durationNs);
        }

        if (durationNs >= SystemUtil.ONE_SECOND_NS) {
            const value = Math.trunc(durationNs / SystemUtil.ONE_SECOND_NS);
            if (durationNs === value * SystemUtil.ONE_SECOND_NS) {
                return value + 's';
            }
        }

        if (durationNs >= SystemUtil.ONE_MILLISECOND_NS) {
            const value = Math.trunc(durationNs / SystemUtil.ONE_MILLISECOND_NS);
            if (durationNs === value * SystemUtil.ONE_MILLISECOND_NS) {
                return value + 'ms';
            }
        }

        if (durationNs >= SystemUtil.ONE_MICROSECOND_NS) {
            const value = Math.trunc(durationNs / SystemUtil.ONE_MICROSECOND_NS);
            if (durationNs === value * SystemUtil.ONE_MICROSECOND_NS) {
                return value + 'us';
            }
        }

        return durationNs + 'ns';
    }

    /**
     * {@link AsciiEncoding.parseLongAscii} as a `bigint`, so that a long outside +/-(2^53 - 1) keeps its value for the
     * overflow checks of the callers (this is configuration parsing, not a hot path).
     */
    private static parseLong(propertyValue: string, index: number, length: number): bigint {
        try {
            return BigInt(AsciiEncoding.parseLongAscii(propertyValue, index, length));
        } catch (e) {
            if (e instanceof LongOverflowError) {
                return e.value;
            }
            throw e;
        }
    }

    private static validateNonNegative(
        propertyName: string,
        propertyValue: string | null,
    ): asserts propertyValue is string {
        if (Strings.isEmpty(propertyValue)) {
            throw new NumberFormatException(propertyName + ' must be non-empty: ' + propertyValue);
        }

        if ('-' === propertyValue.charAt(0)) {
            throw new NumberFormatException(propertyName + ' must be positive: ' + propertyValue);
        }
    }

    private static throwInvalidDurationFormat(propertyName: string, propertyValue: string): never {
        throw new NumberFormatException(propertyName + ': ' + propertyValue + ' should end with: s, ms, us, or ns.');
    }

    static isX64Arch(arch: string): boolean {
        return arch === 'amd64' || arch === 'x86_64' || arch === 'x64';
    }
}
