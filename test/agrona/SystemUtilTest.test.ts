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
import { assertParsedLong, assertThrows, assertThrowsExactly } from '../support/Assertions.js';

/** The result of parseDuration for a value whose Java result is `expected`, see shouldParseTimesWithSuffix. */
function assertDuration(value: string, expected: bigint): void {
    // adapted: a duration saturates at Long.MAX_VALUE of jdk.ts (2^53 - 1) in every branch (spec D5)
    expect(SystemUtil.parseDuration('', value)).toBe(
        expected <= BigInt(Long.MAX_VALUE) ? Number(expected) : Long.MAX_VALUE,
    );
}

describe('SystemUtilTest', () => {
    // adapted: a long is a number exact to +/-(2^53 - 1) (spec D5): a result beyond it throws LongOverflowError
    // carrying the exact value, which assertParsedLong asserts. The rows are Java's, then the rows at the 2^53 bound.
    it.each<[string, bigint]>([
        ['0', 0n],
        ['42', 42n],
        ['5k', 5120n],
        ['2K', 2048n],
        ['1m', 1048576n],
        ['10M', 10485760n],
        ['4g', 4294967296n],
        ['10G', 10737418240n],
        ['8589934591g', 9223372035781033984n],
        ['8796093022207m', 9223372036853727232n],
        ['9007199254740991k', 9223372036854774784n],
        ['8388607g', 9007198180999168n],
        ['8589934591m', 9007199253692416n],
        ['8796093022207k', 9007199254739968n],
        ['8796093022208k', 9007199254740992n],
        ['8388608g', 9007199254740992n],
    ])('shouldParseSizesWithSuffix %s', (value, expected) => {
        assertParsedLong(expected, () => SystemUtil.parseSize('', value));
    });

    it.each([[null], ['']])('shouldRejectEmptySizeValue %s', (value) => {
        const exception = assertThrowsExactly(NumberFormatException, () => SystemUtil.parseSize('abc', value));
        expect(exception.message).toBe('abc must be non-empty: ' + value);
    });

    it.each(['-1024', '-5g', '-3K', '-0K', '-2m', '-1M', '-5G'])('shouldRejectEmptyNegativeSizeValue %s', (value) => {
        const exception = assertThrowsExactly(NumberFormatException, () => SystemUtil.parseSize('abc', value));
        expect(exception.message).toBe('abc must be positive: ' + value);
    });

    it.each(['9007199254740992k', '8796093022208m', '8589934592g'])('shouldThrowWhenParseSizeOverflows %s', (value) => {
        const exception = assertThrows(NumberFormatException, () => SystemUtil.parseSize('test', value));
        expect(exception.message).toBe('test would overflow a long: ' + value);
    });

    // adapted: a result beyond 2^53 - 1 saturates at Long.MAX_VALUE of jdk.ts, 2^53 - 1, in every branch (spec D5),
    // where Java saturates at 2^63 - 1. The rows are Java's, then the rows at the 2^53 bound.
    it.each<[string, bigint]>([
        ['0', 0n],
        ['0ns', 0n],
        ['0us', 0n],
        ['0ms', 0n],
        ['0s', 0n],
        ['1', 1n],
        ['1ns', 1n],
        ['4NS', 4n],
        ['44444nS', 44444n],
        ['1024', 1024n],
        ['1us', 1000n],
        ['5us', 5000n],
        ['7US', 7000n],
        ['9uS', 9000n],
        ['12Us', 12000n],
        ['1ms', 1000000n],
        ['123ms', 123000000n],
        ['456MS', 456000000n],
        ['789mS', 789000000n],
        ['2Ms', 2000000n],
        ['1s', 1000000000n],
        ['1S', 1000000000n],
        ['42s', 42000000000n],
        ['9223372036854775807', 9223372036854775807n],
        ['2147483647', 2147483647n],
        ['9223372036854775807ns', 9223372036854775807n],
        ['9223372036854775us', 9223372036854775000n],
        ['9223372036854ms', 9223372036854000000n],
        ['9223372036s', 9223372036000000000n],
        ['9007199254740991', 9007199254740991n],
        ['9007199254740991ns', 9007199254740991n],
        ['9007199254740us', 9007199254740000n],
        ['9007199254ms', 9007199254000000n],
        ['9007199s', 9007199000000000n],
        ['9007199254741us', 9007199254741000n],
        ['9007199255ms', 9007199255000000n],
        ['9007200s', 9007200000000000n],
    ])('shouldParseTimesWithSuffix %s', (value, expected) => {
        assertDuration(value, expected);
    });

    // adapted: Java's Long.MAX_VALUE is 2^63 - 1; every suffix saturates at 2^53 - 1 (see shouldParseTimesWithSuffix)
    it.each([
        '9223372036854775807ns',
        '9223372036854775807us',
        '9223372036854775807ms',
        '9223372036854775807s',
        '9223372036854776us',
        '9223372036855ms',
        '9223372037s',
    ])('shouldReturnLongMaxValueIfExceedsForSuffix %s', (value) => {
        assertDuration(value, 9223372036854775807n);
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
