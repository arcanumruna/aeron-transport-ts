# Source and test mapping

One row per ported file (spec §5, §8.1). `aeron:` paths are relative to the Aeron `1.53.3` checkout and `agrona:`
paths to the Agrona `2.6.1` checkout (`npm run fetch:refs`). `npm run check:mapping` checks the **Tests** and
**Skipped tests** tables against both sides: every Java test name has a TS test of the same name and the reverse,
the counts are current, and every `it.skip` is listed with its reason.

## Sources

| Java source | TypeScript source | Notes |
|---|---|---|
| `agrona:agrona/src/main/java/org/agrona/BitUtil.java` | `src/agrona/BitUtil.ts` | `int`/`long` overloads: the `long` ones are `findNextPositivePowerOfTwoLong`, `alignLong`, `isEvenLong`, `isPowerOfTwoLong`. `byte[]` is `Uint8Array`; `toHexByteArray` takes a `Uint8Array` or a `string` (the `CharSequence` overload). `fromHexByteArray` throws `ArrayIndexOutOfBoundsException` for a byte above 127 through a private `fromHexDigit`, as the Java table lookup does. |
| `agrona:agrona/src/main/java/org/agrona/Strings.java` | `src/agrona/Strings.ts` | `isEmpty` is a type guard. `parseIntOrDefault` uses `Integer.parseInt` from `jdk.ts`. |
| `agrona:agrona/src/main/java/org/agrona/LangUtil.java` | `src/agrona/LangUtil.ts` | `rethrowUnchecked` returns `never`. There is no checked-exception erasure to do, so the private generic `rethrow` is a plain `throw`. |
| `agrona:agrona/src/main/java/org/agrona/AsciiEncoding.java` | `src/agrona/AsciiEncoding.ts` | `CharSequence` is `string`, `char` and `byte` are `number`. `long` results are `number`: `parseLongAscii` parses the whole 64-bit range with `bigint` and throws `RangeError` above 2^53 - 1. The two SWAR helpers that take eight bytes (`isEightDigitAsciiEncodedNumber`, `parseEightDigitsLittleEndian`) take a `bigint`. `LONG_DIGITS` is a `BigInt64Array`; `LONG_POW_10` is a `number[]` (every power of ten up to 10^18 is exact). `*_VALUE_DIGITS` and `MIN/MAX_*_VALUE` are `Int32Array` / `Uint8Array`. |
| `agrona:agrona/src/main/java/org/agrona/AsciiNumberFormatException.java` | `src/agrona/AsciiNumberFormatException.ts` | Extends `NumberFormatException` from `jdk.ts`. |
| `agrona:agrona/src/main/java/org/agrona/SystemUtil.java` | `src/agrona/SystemUtil.ts` | Only the pure parts: `parseSize`, `formatSize`, `parseDuration`, `formatDuration` and what they use, plus the package-private `isX64Arch(String)`. `long` is `number`, so `Long.MAX_VALUE` in the overflow bounds is `2^53 - 1` (`jdk.ts` `Long.MAX_VALUE`) and `parseDuration` saturates at it. |
| `agrona:agrona/src/main/java/org/agrona/ErrorHandler.java` | `src/agrona/ErrorHandler.ts` | Interface; `Throwable` is `Error`. |
| (no Java file) | `src/agrona/jdk.ts` | JDK stand-ins that Agrona and its tests use: `ByteOrder`, the exception classes (`Exception`, `RuntimeException`, `IllegalArgumentException`, `IllegalStateException`, `NumberFormatException`, `ArithmeticException`, `NullPointerException`, `UnsupportedOperationException`, `IndexOutOfBoundsException`, `ArrayIndexOutOfBoundsException`, each with `name` set to its class name), `Character.isDigit`, `Integer`, `Long` (`MAX_VALUE` / `MIN_VALUE` are the +/-(2^53 - 1) bounds), `TimeUnit.toNanos`, `ThreadLocalRandom.nextInt`, `longToNumber`, `longValueExact`. |

## Tests

| Java test | TypeScript test | Java | TS | Notes |
|---|---|---|---|---|
| `agrona:agrona/src/test/java/org/agrona/BitUtilTest.java` | `test/agrona/BitUtilTest.test.ts` | 7 | 7 | |
| `agrona:agrona/src/test/java/org/agrona/LangUtilTest.java` | `test/agrona/LangUtilTest.test.ts` | 1 | 1 | |
| `agrona:agrona/src/test/java/org/agrona/AsciiEncodingTest.java` | `test/agrona/AsciiEncodingTest.test.ts` | 24 | 24 | |
| `agrona:agrona/src/test/java/org/agrona/SystemUtilTest.java` | `test/agrona/SystemUtilTest.test.ts` | 28 | 28 | |

## Skipped tests

| TypeScript test | Test | Reason |
|---|---|---|
| `test/agrona/AsciiEncodingTest.test.ts` | shouldDetectFourDigitsAsciiEncodedNumbers | needs UnsafeBuffer, ported in T3 |
| `test/agrona/AsciiEncodingTest.test.ts` | shouldParseFourDigitsFromAnAsciiEncodedNumberInLittleEndianByteOrder | needs UnsafeBuffer, ported in T3 |
| `test/agrona/AsciiEncodingTest.test.ts` | shouldDetectEightDigitsAsciiEncodedNumbers | needs UnsafeBuffer, ported in T3 |
| `test/agrona/AsciiEncodingTest.test.ts` | shouldParseEightDigitsFromAnAsciiEncodedNumberInLittleEndianByteOrder | needs UnsafeBuffer, ported in T3 |
| `test/agrona/SystemUtilTest.test.ts` | shouldDoNothingToSystemPropsWhenLoadingFileWhichDoesNotExist | no JVM equivalent: System properties and `loadPropertiesFile` (files, classpath, URLs) are not ported |
| `test/agrona/SystemUtilTest.test.ts` | shouldMergeMultiplePropFilesTogether | no JVM equivalent: System properties and `loadPropertiesFiles` are not ported |
| `test/agrona/SystemUtilTest.test.ts` | shouldOverrideSystemPropertiesWithConfigFromPropFile | no JVM equivalent: System properties and `loadPropertiesFiles` are not ported |
| `test/agrona/SystemUtilTest.test.ts` | shouldNotOverrideSystemPropertiesWithConfigFromPropFile | no JVM equivalent: System properties and `loadPropertiesFile` are not ported |
| `test/agrona/SystemUtilTest.test.ts` | shouldReturnPid | no JVM equivalent: `getPid` (`ProcessHandle`) is not ported |
| `test/agrona/SystemUtilTest.test.ts` | shouldGetNormalProperty | no JVM equivalent: System properties and `getProperty` are not ported |
| `test/agrona/SystemUtilTest.test.ts` | shouldGetNullProperty | no JVM equivalent: System properties and `getProperty` are not ported |
| `test/agrona/SystemUtilTest.test.ts` | shouldGetNullPropertyWithDefault | no JVM equivalent: System properties and `getProperty` are not ported |
| `test/agrona/SystemUtilTest.test.ts` | shouldGetDefaultProperty | no JVM equivalent: System properties and `getProperty` are not ported |
| `test/agrona/SystemUtilTest.test.ts` | isX64ArchSystemTest | no JVM equivalent: `osArch` (the `os.arch` system property) is not ported |
| `test/agrona/SystemUtilTest.test.ts` | isLinuxReturnsTrueForLinuxBasedSystems | no JVM equivalent: `osName` (the `os.name` system property) is not ported |
| `test/agrona/SystemUtilTest.test.ts` | isWindowsReturnsTrueForWindows | no JVM equivalent: `osName` (the `os.name` system property) is not ported |
| `test/agrona/SystemUtilTest.test.ts` | isMacOsReturnsTrueForMacBasedSystems | no JVM equivalent: `osName` (the `os.name` system property) is not ported |

## Adapted tests

Tests whose literal values or mechanism had to change, with the same behaviour asserted. A `long` is a `number` that is
exact to +/-(2^53 - 1) (spec 5.2, D5), so `Long.MAX_VALUE` / `Long.MIN_VALUE` in a test are `jdk.ts` `Long.MAX_VALUE` /
`Long.MIN_VALUE` (2^53 - 1 and -(2^53 - 1)) unless the row says otherwise.

| TypeScript test | Test | What changed and why |
|---|---|---|
| `test/agrona/BitUtilTest.test.ts` | shouldAlignValueToNextMultipleOfAlignmentLong | `align(Long.MAX_VALUE, 64)` is `Long.MIN_VALUE` in Java (the add overflows and wraps). A `number` cannot wrap, so the test asserts the next multiple, 2^53 (`Long.MAX_VALUE + 1`), which is still exact. |
| `test/agrona/AsciiEncodingTest.test.ts` | shouldParseLong | `-123456789876543210` and the `Long.MAX_VALUE` / `Long.MIN_VALUE` strings are outside the safe range: the safe-range equivalents are asserted (`-1234567898765432`, 2^53 - 1 and its neighbours), and the original 19-digit strings are asserted to parse and then throw `RangeError`, which keeps the overflow-check path covered. |
| `test/agrona/AsciiEncodingTest.test.ts` | digitCountLongValue | The values are `bigint`s (`digitCountLong` accepts `number \| bigint`), because the loop reaches `Long.MAX_VALUE` (19 digits). `>>> 1` on a positive long is `>> 1n`. The expected digit counts are the Java ones. |
| `test/agrona/AsciiEncodingTest.test.ts` | parseIntAsciiRoundTrip | `assertEquals` is `node:assert` `strictEqual` inside the 1,000,000-iteration loop: vitest `expect` costs about 6 s for that many calls. Same assertion. |
| `test/agrona/AsciiEncodingTest.test.ts` | parseLongAsciiRoundTrip | A random 64-bit long cannot round-trip through a `number`. The long is shifted right by a random 0 to 63 bits so every digit count occurs; a value inside +/-(2^53 - 1) must parse back to itself, any other value must throw `RangeError`. `node:assert` as in `parseIntAsciiRoundTrip`. |
| `test/agrona/SystemUtilTest.test.ts` | shouldParseSizesWithSuffix | The last three rows (`8589934591g`, `8796093022207m`, `9007199254740991k` reach `Long.MAX_VALUE`) become the largest multiples under 2^53 - 1: `8388607g`, `8589934591m`, `8796093022207k`. |
| `test/agrona/SystemUtilTest.test.ts` | shouldThrowWhenParseSizeOverflows | The rows are the first values past the 2^53 - 1 bound: `8796093022208k`, `8589934592m`, `8388608g`. |
| `test/agrona/SystemUtilTest.test.ts` | shouldParseTimesWithSuffix | The `Long.MAX_VALUE` rows use 2^53 - 1; the rows at the `us`, `ms`, `s` saturation boundary (`9223372036854775us`, `9223372036854ms`, `9223372036s`) become `9007199254740us`, `9007199254ms`, `9007199s`, the largest values that do not saturate. |
| `test/agrona/SystemUtilTest.test.ts` | shouldReturnLongMaxValueIfExceedsForSuffix | `Long.MAX_VALUE` is 2^53 - 1; the rows are the first values that saturate for each suffix (`9007199254741us`, `9007199255ms`, `9007200s`). |
| `test/agrona/SystemUtilTest.test.ts` | formatDurationShouldRejectNegativeValues | `Long.MIN_VALUE` is -(2^53 - 1). |
| `test/agrona/SystemUtilTest.test.ts` | shouldFormatDuration | The `Long.MAX_VALUE` row uses 2^53 - 1. |
| `test/agrona/SystemUtilTest.test.ts` | formatSizeShouldRejectNegativeValues | `Long.MIN_VALUE` is -(2^53 - 1). |
| `test/agrona/SystemUtilTest.test.ts` | shouldFormatSize | The rows for `Long.MAX_VALUE` and for the largest multiples of `g`, `m`, `k` use 2^53 - 1 and the largest multiples under it (`8388607g`, `8589934591m`, `8796093022207k`). |

## Renames

| Java | TypeScript | Reason |
|---|---|---|
| `BitUtil.findNextPositivePowerOfTwo(long)`, `align(long, long)`, `isEven(long)`, `isPowerOfTwo(long)` | `findNextPositivePowerOfTwoLong`, `alignLong`, `isEvenLong`, `isPowerOfTwoLong` | `int` and `long` are both `number`; overloads that cannot be told apart get the Java name with a `Long` suffix (spec 5.1). |
| `AsciiEncoding.digitCount(long)`, `endOffset(long)` | `digitCountLong`, `endOffsetLong` | Same rule. They accept `number \| bigint`: a `bigint` reaches the 19-digit values (addition). |
| `BitUtil.toHexByteArray` (3 overloads), `toHex` (2 overloads) | `toHexByteArray(buffer: Uint8Array \| string, offset?, length?)`, `toHex(buffer, offset?, length?)` | Overloads that differ in arity or in `byte[]` / `CharSequence` become one method with optional parameters and a union. |
| `AsciiEncoding.isDigit(byte)` / `isDigit(char)`, `getDigit(int, byte)` / `getDigit(int, char)` | `isDigit(value)`, `getDigit(index, value)` | A `byte` and a `char` are both `number`. |
| `LangUtil.rethrowUnchecked(Throwable)` returns `void` | returns `never` | Lets the compiler see that control does not continue. |
| `ErrorHandler.onError(Throwable)` | `onError(throwable: Error)` | `Throwable` is `Error`. |
| (none) | `longToNumber`, `longValueExact`, `Long.and`, `Long.numberOfLeadingZeros(number \| bigint)`, `TimeUnit`, `Integer.parseInt` ... in `src/agrona/jdk.ts` | Additions: JDK behaviour that a `long` held in a `number` or a `bigint` needs. |

## Not ported

Members of ported files left out because they serve only out-of-scope features (spec §3).

| Java member | Reason |
|---|---|
| `SystemUtil.PID_NOT_FOUND`, `getPid`, `osName`, `osArch`, `isWindows`, `isLinux`, `isMac`, `isX64Arch()` (the no-argument one), `isDebuggerAttached`, `tmpDirName`, `threadDump` (2 overloads) | OS, JVM, process and file-system queries, with no JavaScript equivalent that Aeron's transport uses (spec 3). |
| `SystemUtil.NULL_PROPERTY_VALUE`, `getProperty` (2), `getSizeAsInt`, `getSizeAsLong`, `getDurationInNanos`, `loadPropertiesFile` (2), `loadPropertiesFiles` (2), `loadProperties`, `PropertyAction` | Java system properties and properties files. Aeron's `Configuration` reads its settings from `process.env` / an options object (a later phase). `parseSize` and `parseDuration`, which they call, are ported. |
