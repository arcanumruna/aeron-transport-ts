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
// Port of org/agrona/SystemUtilTest.java @ Agrona 2.6.1
import { describe, expect, it } from 'vitest';
import { SystemUtil } from '../../src/agrona/SystemUtil.js';
import { IllegalArgumentException, Long, NumberFormatException } from '../../src/agrona/jdk.js';
import { assertThrows, assertThrowsExactly } from '../support/Assertions.js';

describe('SystemUtilTest', () => {
    // adapted: a long is exact to 2^53 - 1, so the rows that use Long.MAX_VALUE (and the multiples of 'k', 'm' and
    // 'g' that reach it) use Long.MAX_VALUE = 2^53 - 1 instead, which keeps the same boundaries
    it.each([
        ['0', 0],
        ['42', 42],
        ['5k', 5120],
        ['2K', 2048],
        ['1m', 1048576],
        ['10M', 10485760],
        ['4g', 4294967296],
        ['10G', 10737418240],
        ['8388607g', 9007198180999168],
        ['8589934591m', 9007199253692416],
        ['8796093022207k', 9007199254739968],
    ])('shouldParseSizesWithSuffix %s', (value, expected) => {
        expect(SystemUtil.parseSize('', value)).toBe(expected);
    });

    it.each([[null], ['']])('shouldRejectEmptySizeValue %s', (value) => {
        const exception = assertThrowsExactly(NumberFormatException, () => SystemUtil.parseSize('abc', value));
        expect(exception.message).toBe('abc must be non-empty: ' + value);
    });

    it.each(['-1024', '-5g', '-3K', '-0K', '-2m', '-1M', '-5G'])('shouldRejectEmptyNegativeSizeValue %s', (value) => {
        const exception = assertThrowsExactly(NumberFormatException, () => SystemUtil.parseSize('abc', value));
        expect(exception.message).toBe('abc must be positive: ' + value);
    });

    // adapted: the first value of each row is the first value above the 2^53 - 1 bound, not above Long.MAX_VALUE
    it.each(['8796093022208k', '8589934592m', '8388608g'])('shouldThrowWhenParseSizeOverflows %s', (value) => {
        const exception = assertThrows(NumberFormatException, () => SystemUtil.parseSize('test', value));
        expect(exception.message).toBe('test would overflow a long: ' + value);
    });

    // adapted: rows that use Long.MAX_VALUE or reach it use Long.MAX_VALUE = 2^53 - 1 instead
    it.each([
        ['0', 0],
        ['0ns', 0],
        ['0us', 0],
        ['0ms', 0],
        ['0s', 0],
        ['1', 1],
        ['1ns', 1],
        ['4NS', 4],
        ['44444nS', 44444],
        ['1024', 1024],
        ['1us', 1000],
        ['5us', 5000],
        ['7US', 7000],
        ['9uS', 9000],
        ['12Us', 12000],
        ['1ms', 1000000],
        ['123ms', 123000000],
        ['456MS', 456000000],
        ['789mS', 789000000],
        ['2Ms', 2000000],
        ['1s', 1000000000],
        ['1S', 1000000000],
        ['42s', 42000000000],
        ['9007199254740991', 9007199254740991],
        ['2147483647', 2147483647],
        ['9007199254740991ns', 9007199254740991],
        ['9007199254740us', 9007199254740000],
        ['9007199254ms', 9007199254000000],
        ['9007199s', 9007199000000000],
    ])('shouldParseTimesWithSuffix %s', (value, expected) => {
        expect(SystemUtil.parseDuration('', value)).toBe(expected);
    });

    // adapted: Long.MAX_VALUE = 2^53 - 1; the rows are the first values that exceed it for each suffix
    it.each([
        '9007199254740991ns',
        '9007199254740991us',
        '9007199254740991ms',
        '9007199254740991s',
        '9007199254741us',
        '9007199255ms',
        '9007200s',
    ])('shouldReturnLongMaxValueIfExceedsForSuffix %s', (value) => {
        expect(SystemUtil.parseDuration('', value)).toBe(Long.MAX_VALUE);
    });

    it.each([[null], ['']])('shouldRejectEmptyDurationValue %s', (value) => {
        const exception = assertThrowsExactly(NumberFormatException, () => SystemUtil.parseDuration('x', value));
        expect(exception.message).toBe('x must be non-empty: ' + value);
    });

    it.each(['-4', '-1s', '-5S', '-2us', '-9ms', '-11MS', '-1US', '-8NS', '-4444444ns'])(
        'shouldRejectNegativeDurations %s',
        (value) => {
            const exception = assertThrowsExactly(NumberFormatException, () => SystemUtil.parseDuration('x', value));
            expect(exception.message).toBe('x must be positive: ' + value);
        },
    );

    it.each(['123x', '1p', '0xs', '42xxl', 's', 'S', '2ps', '5px', '4u', '5n', '3m', 'us', 'ms', 'ns'])(
        'shouldRejectInvalidDurationSuffix %s',
        (value) => {
            const exception = assertThrows(NumberFormatException, () => SystemUtil.parseDuration('x', value));
            expect(exception.message).toBe('x: ' + value + ' should end with: s, ms, us, or ns.');
        },
    );

    // adapted: Long.MIN_VALUE = -(2^53 - 1)
    it.each([Long.MIN_VALUE, -100])('formatDurationShouldRejectNegativeValues %s', (value) => {
        const exception = assertThrowsExactly(IllegalArgumentException, () => SystemUtil.formatDuration(value));
        expect(exception.message).toBe('duration must be positive: ' + value);
    });

    // adapted: the Long.MAX_VALUE row uses Long.MAX_VALUE = 2^53 - 1
    it.each([
        [0, '0ns'],
        [999, '999ns'],
        [1000, '1us'],
        [5429, '5429ns'],
        [999999, '999999ns'],
        [1000000, '1ms'],
        [1234000, '1234us'],
        [560000000, '560ms'],
        [1560000000, '1560ms'],
        [560000001, '560000001ns'],
        [1000000000, '1s'],
        [120000000000, '120s'],
        [9007199254740991, '9007199254740991ns'],
    ])('shouldFormatDuration %s', (value, expected) => {
        expect(SystemUtil.formatDuration(value)).toBe(expected);
    });

    // adapted: Long.MIN_VALUE = -(2^53 - 1)
    it.each([Long.MIN_VALUE, -3])('formatSizeShouldRejectNegativeValues %s', (value) => {
        const exception = assertThrowsExactly(IllegalArgumentException, () => SystemUtil.formatSize(value));
        expect(exception.message).toBe('size must be positive: ' + value);
    });

    // adapted: the rows that use Long.MAX_VALUE and the largest multiples of 'k', 'm' and 'g' use the 2^53 - 1 bound
    it.each([
        [0, '0'],
        [100, '100'],
        [1024, '1k'],
        [4096, '4k'],
        [1000000, '1000000'],
        [5144576, '5024k'],
        [1048576, '1m'],
        [10485760, '10m'],
        [1000000000, '1000000000'],
        [327155712, '312m'],
        [1073741824, '1g'],
        [13958643712, '13g'],
        [104722333696, '99871m'],
        [9007198180999168, '8388607g'],
        [9007199254740991, '9007199254740991'],
        [9007199253692416, '8589934591m'],
        [9007199254739968, '8796093022207k'],
    ])('shouldFormatSize %s', (value, expected) => {
        expect(SystemUtil.formatSize(value)).toBe(expected);
    });

    it.skip('shouldDoNothingToSystemPropsWhenLoadingFileWhichDoesNotExist', () => {
        // no JVM equivalent: System.getProperties() and loadPropertiesFile are not ported
    });

    it.skip('shouldMergeMultiplePropFilesTogether', () => {
        // no JVM equivalent: System properties and loadPropertiesFiles are not ported
    });

    it.skip('shouldOverrideSystemPropertiesWithConfigFromPropFile', () => {
        // no JVM equivalent: System properties and loadPropertiesFiles are not ported
    });

    it.skip('shouldNotOverrideSystemPropertiesWithConfigFromPropFile', () => {
        // no JVM equivalent: System properties and loadPropertiesFile are not ported
    });

    it.skip('shouldReturnPid', () => {
        // no JVM equivalent: getPid (ProcessHandle) is not ported
    });

    it.skip('shouldGetNormalProperty', () => {
        // no JVM equivalent: System properties and getProperty are not ported
    });

    it.skip('shouldGetNullProperty', () => {
        // no JVM equivalent: System properties and getProperty are not ported
    });

    it.skip('shouldGetNullPropertyWithDefault', () => {
        // no JVM equivalent: System properties and getProperty are not ported
    });

    it.skip('shouldGetDefaultProperty', () => {
        // no JVM equivalent: System properties and getProperty are not ported
    });

    it.each(['x64', 'x86_64', 'amd64'])('isX64ArchShouldDetectProperOsArch %s', (arch) => {
        expect(SystemUtil.isX64Arch(arch)).toBe(true);
    });

    it.each(['aarch64', 'ppc64', 'ppc64le', 'unknown', '', 'x86', 'i386'])('isX64ArchShouldReturnFalse %s', (arch) => {
        expect(SystemUtil.isX64Arch(arch)).toBe(false);
    });

    it.skip('isX64ArchSystemTest', () => {
        // no JVM equivalent: osArch (the os.arch system property) is not ported
    });

    it.skip('isLinuxReturnsTrueForLinuxBasedSystems', () => {
        // no JVM equivalent: osName (the os.name system property) is not ported
    });

    it.skip('isWindowsReturnsTrueForWindows', () => {
        // no JVM equivalent: osName (the os.name system property) is not ported
    });

    it.skip('isMacOsReturnsTrueForMacBasedSystems', () => {
        // no JVM equivalent: osName (the os.name system property) is not ported
    });
});
