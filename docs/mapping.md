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
| (no Java file) | `src/agrona/jdk.ts` | JDK stand-ins that Agrona and its tests use: `ByteOrder`, the exception classes (`Exception`, `RuntimeException`, `IllegalArgumentException`, `IllegalStateException`, `NumberFormatException`, `ArithmeticException`, `NullPointerException`, `UnsupportedOperationException`, `IndexOutOfBoundsException`, `ArrayIndexOutOfBoundsException`, each with `name` set to its class name), `Character.isDigit`, `Integer`, `Long` (`MAX_VALUE` / `MIN_VALUE` are the +/-(2^53 - 1) bounds), `Byte`, `Short`, `TimeUnit.toNanos`, `ThreadLocalRandom`, `Objects.checkFromIndexSize`, `Appendable`, `newStringAscii` (`new String(bytes, US_ASCII)`), `longToNumber`, `longValueExact`, and `dataViewGetLong` / `dataViewSetLong` (a `long` in a `DataView` as a `number`, without allocating). |
| (no Java file) | `test/support/Assertions.ts`, `test/support/Mockito.ts`, `test/support/ByteBuffer.ts` | Test helpers: JUnit's `assertThrows` / `assertThrowsExactly` (which return the exception) and `assertEquals` / `assertNotEquals` for objects, the part of Mockito's `mock` that the tests use, and a small `java.nio.ByteBuffer` stand-in. |
| `agrona:agrona/src/main/java/org/agrona/DirectBuffer.java` | `src/agrona/DirectBuffer.ts` | Interface, plus a `const DirectBuffer` of the same name with the interface constants (`STR_HEADER_LEN`, `DISABLE_BOUNDS_CHECKS_PROP_NAME`, `SHOULD_BOUNDS_CHECK`, always `true`: there are no system properties). `hashCode` and `equals`, which every Java object has, are declared. `long` is `number` (`getLong` throws `RangeError` outside +/-(2^53 - 1)), `getLongBigInt` reads 64 bits. Overloads that differ by parameter type (`getStringAscii`, `getBytes`, `wrap`) are TypeScript overload signatures over one implementation. |
| `agrona:agrona/src/main/java/org/agrona/MutableDirectBuffer.java` | `src/agrona/MutableDirectBuffer.ts` | Interface. `putLong` throws `RangeError`, writing nothing, for a value that is not a safe integer; `putLongBigInt` writes 64 bits. The `String` and `CharSequence` overloads of `putStringAscii` and `putStringWithoutLengthAscii` are one method over `string \| null`. |
| `agrona:agrona/src/main/java/org/agrona/concurrent/AtomicBuffer.java` | `src/agrona/concurrent/AtomicBuffer.ts` | Interface, plus `const AtomicBuffer` with `ALIGNMENT`. The volatile, ordered, release, acquire, opaque and atomic operations are plain single-thread operations with the same names and results. |
| `agrona:agrona/src/main/java/org/agrona/AbstractMutableDirectBuffer.java` | `src/agrona/AbstractMutableDirectBuffer.ts` | `sun.misc.Unsafe` reads and writes of `byteArray` at `addressOffset + index` are `DataView` calls on `_dataView` at `_addressOffset + index`. Fields are `_byteArray`, `_dataView`, `_addressOffset`, `_capacity` (the Java names clash with the accessors). Byte order is the `DataView` `littleEndian` flag instead of `reverseBytes`. `parseLongAscii`/`parseNaturalLongAscii` parse with `bigint` and return `number` or throw `RangeError`. `setMemory` is `Uint8Array.fill`. UTF-8 uses `TextEncoder` / `TextDecoder` (a lone surrogate is U+FFFD where Java writes '?'). |
| `agrona:agrona/src/main/java/org/agrona/concurrent/UnsafeBuffer.java` | `src/agrona/concurrent/UnsafeBuffer.ts` | Constructors and `wrap` take a `Uint8Array` (`byte[]`), an `ArrayBuffer` (the `ByteBuffer`, as a `Uint8Array` over all of it) or a `DirectBuffer`, with an optional `(offset, length)`; the Java overloads differing only in arity are one method. `wrap(DirectBuffer)` shares the other `UnsafeBuffer`'s `DataView` and allocates one only for a foreign `DirectBuffer` or a new `Uint8Array`. `verifyAlignment` checks the offset of the window in its `ArrayBuffer`. |
| `agrona:agrona/src/main/java/org/agrona/BufferUtil.java` | `src/agrona/BufferUtil.ts` | `ARRAY_BASE_OFFSET` is 0 (a typed array has no object header). `allocateDirectAligned` returns an `ArrayBuffer`: the alignment is checked to be a power of 2, then ignored. |

## Tests

| Java test | TypeScript test | Java | TS | Notes |
|---|---|---|---|---|
| `agrona:agrona/src/test/java/org/agrona/BitUtilTest.java` | `test/agrona/BitUtilTest.test.ts` | 7 | 7 | |
| `agrona:agrona/src/test/java/org/agrona/LangUtilTest.java` | `test/agrona/LangUtilTest.test.ts` | 1 | 1 | |
| `agrona:agrona/src/test/java/org/agrona/AsciiEncodingTest.java` | `test/agrona/AsciiEncodingTest.test.ts` | 24 | 24 | |
| `agrona:agrona/src/test/java/org/agrona/SystemUtilTest.java` | `test/agrona/SystemUtilTest.test.ts` | 28 | 28 | |
| `agrona:agrona/src/test/java/org/agrona/MutableDirectBufferTests.java` | `test/agrona/MutableDirectBufferTests.ts` | 33 | 33 | The abstract base, as `export function mutableDirectBufferTests(newBuffer)`; called by `UnsafeBufferTest`. Not a `.test.ts` file. |
| `agrona:agrona/src/test/java/org/agrona/concurrent/UnsafeBufferTest.java` | `test/agrona/concurrent/UnsafeBufferTest.test.ts` | 57 | 57 | 24 own tests + the 33 inherited. |
| `agrona:agrona/src/test/java/org/agrona/concurrent/AtomicBufferTest.java` | `test/agrona/concurrent/AtomicBufferTest.test.ts` | 50 | 50 | The `ByteBuffer` parameters are the stand-in in `test/support/ByteBuffer.ts`. |
| `agrona:agrona/src/test/java/org/agrona/BufferUtilTest.java` | `test/agrona/BufferUtilTest.test.ts` | 13 | 13 | |

## Skipped tests

| TypeScript test | Test | Reason |
|---|---|---|
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
| `test/agrona/MutableDirectBufferTests.ts` | shouldPutBytesFromByteBuffer | no direct memory / ByteBuffer in JS: `putBytes(int, ByteBuffer, int, int)` is not ported |
| `test/agrona/concurrent/UnsafeBufferTest.test.ts` | parseIntAsciiIsNotDependentOnTheBufferEndianness | no direct memory / ByteBuffer in JS: the byte order of a `ByteBuffer` does not exist for an `ArrayBuffer` |
| `test/agrona/concurrent/UnsafeBufferTest.test.ts` | parseLongAsciiIsNotDependentOnTheBufferEndianness | no direct memory / ByteBuffer in JS: the byte order of a `ByteBuffer` does not exist for an `ArrayBuffer` |
| `test/agrona/concurrent/UnsafeBufferTest.test.ts` | verifyAlignmentThrowsIllegalStateExceptionIfBufferCreatedFromImproperlyAlignedDirectByteBuffer | no direct memory / ByteBuffer in JS: `allocateDirectAligned` cannot return an improperly aligned buffer |
| `test/agrona/concurrent/UnsafeBufferTest.test.ts` | verifyAlignmentThrowsIllegalStateExceptionIfBufferCreatedFromAnUnalignedAddress | no direct memory / ByteBuffer in JS: `UnsafeBuffer(long address, int length)` is not ported |
| `test/agrona/concurrent/UnsafeBufferTest.test.ts` | wrapForRawMemoryAddressShouldResetWrapAdjustment | no direct memory / ByteBuffer in JS: `wrap(long address, int length)` is not ported |
| `test/agrona/concurrent/AtomicBufferTest.test.ts` | shouldGetBytesFromBufferToBuffer | no direct memory / ByteBuffer in JS: `getBytes(int, ByteBuffer, int)` is not ported |
| `test/agrona/concurrent/AtomicBufferTest.test.ts` | shouldGetBytesFromBufferToSlice | no direct memory / ByteBuffer in JS: `getBytes(int, ByteBuffer, int)` is not ported |
| `test/agrona/concurrent/AtomicBufferTest.test.ts` | verifyAlignmentShouldThrowForAByteArrayIfStrictAlignmentChecksAreEnabled | no JVM equivalent: whether a `byte[]` is aligned (object layout, `STRICT_ALIGNMENT_CHECKS`) does not exist in JS |
| `test/agrona/concurrent/AtomicBufferTest.test.ts` | verifyAlignmentShouldThrowForAHeapByteBufferArrayIfStrictAlignmentChecksAreEnabled | no JVM equivalent: whether a `byte[]` is aligned (object layout, `STRICT_ALIGNMENT_CHECKS`) does not exist in JS |
| `test/agrona/concurrent/AtomicBufferTest.test.ts` | verifyAlignmentShouldWarnForAByteArrayWhenStrictChecksAreDisabled | no JVM equivalent: whether a `byte[]` is aligned (object layout, `STRICT_ALIGNMENT_CHECKS`) does not exist in JS |
| `test/agrona/BufferUtilTest.test.ts` | shouldAlignToWordBoundary | no direct memory / ByteBuffer in JS: an `ArrayBuffer` has no address to be aligned |
| `test/agrona/BufferUtilTest.test.ts` | shouldAlignToCacheLineBoundary | no direct memory / ByteBuffer in JS: an `ArrayBuffer` has no address to be aligned |
| `test/agrona/BufferUtilTest.test.ts` | freeIsANoOpIfDirectBufferIsNull | no direct memory / ByteBuffer in JS: `BufferUtil.free` is not ported, memory is garbage collected |
| `test/agrona/BufferUtilTest.test.ts` | freeIsANoOpIfByteBufferIsNull | no direct memory / ByteBuffer in JS: `BufferUtil.free` is not ported, memory is garbage collected |
| `test/agrona/BufferUtilTest.test.ts` | freeIsANoOpIfByteBufferIsNotDirect | no direct memory / ByteBuffer in JS: `BufferUtil.free` is not ported, memory is garbage collected |
| `test/agrona/BufferUtilTest.test.ts` | freeIsANoOpIfDirectBufferContainsNonDirectByteBuffer | no direct memory / ByteBuffer in JS: `BufferUtil.free` is not ported, memory is garbage collected |
| `test/agrona/BufferUtilTest.test.ts` | freeShouldReleaseByteBufferResources | no direct memory / ByteBuffer in JS: `BufferUtil.free` is not ported, memory is garbage collected |
| `test/agrona/BufferUtilTest.test.ts` | freeShouldReleaseDirectBufferResources | no direct memory / ByteBuffer in JS: `BufferUtil.free` is not ported, memory is garbage collected |
| `test/agrona/BufferUtilTest.test.ts` | freeThrowsIllegalArgumentExceptionIfByteBufferIsASlice | no direct memory / ByteBuffer in JS: `BufferUtil.free` is not ported, memory is garbage collected |
| `test/agrona/BufferUtilTest.test.ts` | freeThrowsIllegalArgumentExceptionIfByteBufferIsADuplicate | no direct memory / ByteBuffer in JS: `BufferUtil.free` is not ported, memory is garbage collected |
| `test/agrona/BufferUtilTest.test.ts` | shouldBoundsCheckByteBufferIndexWithoutLongOverflow | no direct memory / ByteBuffer in JS: `boundsCheck(ByteBuffer, long, int)` is not ported |

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
| `test/agrona/AsciiEncodingTest.test.ts` | shouldDetectEightDigitsAsciiEncodedNumbers | The eight bytes are read with `getLongBigInt` (`isEightDigitAsciiEncodedNumber` takes a `bigint`, 8 ASCII digits are above 2^53 - 1), and the 810,811-iteration loop uses `node:assert` instead of `expect`, which costs about 10 s for that many calls. Same assertions. |
| `test/agrona/AsciiEncodingTest.test.ts` | shouldParseEightDigitsFromAnAsciiEncodedNumberInLittleEndianByteOrder | As above: `getLongBigInt`, `node:assert`. |
| `test/agrona/MutableDirectBufferTests.ts` | putIntAsciiRoundTrip | `assertEquals` is `node:assert` `strictEqual` in the 10,000,000-iteration loop (`expect` costs seconds for that many calls); the test has a 120 s timeout. Same assertion. |
| `test/agrona/MutableDirectBufferTests.ts` | putLongAsciiRoundTrip | A random 64-bit long cannot be a `number`: the long is random within +/-(2^53 - 1) with a random number of digits (1 to 16). `node:assert`, as above. The 17 to 19 digit values are covered at the `parseLongAscii` level by `AsciiEncodingTest` (`parseLongAsciiRoundTrip`) and the out-of-range tests. |
| `test/agrona/MutableDirectBufferTests.ts` | putNaturalIntAsciiRoundTrip | `node:assert`, as `putIntAsciiRoundTrip`. |
| `test/agrona/MutableDirectBufferTests.ts` | putNaturalLongAsciiRoundTrip | `nextLong(0, Long.MAX_VALUE)` is a random natural long below 2^53 - 1 with a random number of digits. `node:assert`. |
| `test/agrona/MutableDirectBufferTests.ts` | putLongAsciiShouldEncodeBoundaryValues | `Long.MIN_VALUE` / `Long.MAX_VALUE` are -(2^53 - 1) / 2^53 - 1. The `Long.MIN_VALUE` branch of `putLongAscii` (negating it overflows) does not exist for a `number`. |
| `test/agrona/MutableDirectBufferTests.ts` | getBytesShouldCopyIntoDestinationBuffer | `ExpandableArrayBuffer` and `ExpandableDirectByteBuffer` are not ported; the `UnsafeBuffer` rows over a heap and a direct `ByteBuffer` are an `UnsafeBuffer` over a `Uint8Array` and over an `ArrayBuffer`. A `byte` is read back signed: `data[i]` is converted with `(byte)`. |
| `test/agrona/MutableDirectBufferTests.ts` | putBytesShouldCopyBytesFromTheSourceBuffer | As `getBytesShouldCopyIntoDestinationBuffer`. |
| `test/agrona/MutableDirectBufferTests.ts` | equalsReturnsFalseForNull | `assertNotEquals(null, buffer)` is JUnit's `objectsAreEqual`, ported in `test/support/Assertions.ts` as `assertNotEqualsObject`; it does not call `buffer.equals`. `equals` returns `false` for `null`, as the Java does. |
| `test/agrona/concurrent/UnsafeBufferTest.test.ts` | shouldExposePositionAtWhichHeapByteBufferGetsWrapped | The `ByteBuffer` is the stand-in in `test/support/ByteBuffer.ts`; the `UnsafeBuffer` wraps its `ArrayBuffer` at `(ADJUSTMENT_OFFSET, capacity - ADJUSTMENT_OFFSET)`. |
| `test/agrona/concurrent/UnsafeBufferTest.test.ts` | shouldExposePositionAtWhichDirectByteBufferGetsWrapped | As above. |
| `test/agrona/concurrent/UnsafeBufferTest.test.ts` | wrapDirectBuffer | `ExpandableArrayBuffer` and `ExpandableDirectByteBuffer` are not ported; the `UnsafeBuffer` over a heap `ByteBuffer` is over an `ArrayBuffer`; the mock `DirectBuffer` is a hand fake with `vi.fn()` stubs (`addressOffset` is 0, Mockito's default). The `byteBuffer()` assertion is dropped: there is no `byteBuffer()`. |
| `test/agrona/concurrent/UnsafeBufferTest.test.ts` | wrapDirectBufferWithOffsetAndLength | As `wrapDirectBuffer`. |
| `test/agrona/concurrent/AtomicBufferTest.test.ts` | 41 tests that take a `ByteBuffer` (`shouldCopyMemory` to `shouldGetBytesFromBuffer`, all but `shouldGetBytesFromBufferToBuffer` and `shouldGetBytesFromBufferToSlice`) | The `ByteBuffer` that is the independent view of the memory is the stand-in in `test/support/ByteBuffer.ts` (an `ArrayBuffer` window with a byte order and the typed accessors), and `new UnsafeBuffer(buffer)` is `newUnsafeBuffer(buffer)`, which wraps the stand-in's `ArrayBuffer` window. The rows are the same three `nativeBuffers` and one `atomicBuffers` (`allocateDirectAligned(...)` is an `ArrayBuffer`, wrapped by the stand-in). A `long` is a `number`: all the test values (`Integer.MAX_VALUE + 5L`, ...) are safe integers. |
| `test/agrona/BufferUtilTest.test.ts` | shouldBoundsCheckByteArrayIndexWithoutLongOverflow | `Long.MAX_VALUE - 3` is `2^53 - 1 - 3`, the largest index a `number` holds. |

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
| `AbstractMutableDirectBuffer` fields `byteArray`, `addressOffset`, `capacity`, and `UnsafeBuffer.wrapAdjustment` | `_byteArray`, `_addressOffset`, `_capacity`, `_wrapAdjustment` (new: `_dataView`) | A field cannot have the name of the accessor method of the same name. |
| `DirectBuffer.getLong` and the other `long` accessors / `MutableDirectBuffer.putLong` | add `getLongBigInt(index, byteOrder?)`, `putLongBigInt(index, value: bigint, byteOrder?)` | Additions (spec 5.2): an opaque 64-bit value. `getLong` throws `RangeError` for a stored value outside +/-(2^53 - 1), `putLong` and every `long` write (`putLongAscii`, `getAndAddLong`, ...) throw `RangeError`, writing nothing, for a result that is not a safe integer, where Java wraps. |
| Interface constants (`DirectBuffer.STR_HEADER_LEN`, `SHOULD_BOUNDS_CHECK`, `AtomicBuffer.ALIGNMENT`, ...) | `const DirectBuffer = {...}`, `const AtomicBuffer = {...}` beside the interface of the same name | A TypeScript interface cannot hold values. |
| `DirectBuffer.wrap` (7 overloads), `UnsafeBuffer` constructors (8) | `wrap(buffer: Uint8Array \| ArrayBuffer \| DirectBuffer, offset?, length?)`, `constructor(buffer?, offset?, length?)` | Overloads that differ in arity or only in the buffer type are one method over a union. |
| `getBytes` (5 overloads), `putBytes` (5), `getStringAscii` (6), `getStringWithoutLengthAscii` (2), `getStringUtf8` (3), `putStringUtf8` (4) | TypeScript overload signatures over one implementation, with the same names | The overloads differ by the type of an argument (`byte[]` / `MutableDirectBuffer`, `ByteOrder` / `int` / `Appendable`), so the call sites and the tests read as in Java. |
| `putStringAscii` (4 overloads), `putStringWithoutLengthAscii` (4) | `putStringAscii(index, value, byteOrder?)`, `putStringWithoutLengthAscii(index, value, valueOffset?, length?)` | `String` and `CharSequence` are both `string`; the rest differs in arity. |
| `UnsafeBuffer` uses `ArrayUtil.EMPTY_BYTE_ARRAY` | a module constant `EMPTY_BYTE_ARRAY` | `collections/ArrayUtil` is ported in T4. |

## Not ported

Members of ported files left out because they serve only out-of-scope features (spec §3).

| Java member | Reason |
|---|---|
| `SystemUtil.PID_NOT_FOUND`, `getPid`, `osName`, `osArch`, `isWindows`, `isLinux`, `isMac`, `isX64Arch()` (the no-argument one), `isDebuggerAttached`, `tmpDirName`, `threadDump` (2 overloads) | OS, JVM, process and file-system queries, with no JavaScript equivalent that Aeron's transport uses (spec 3). |
| `SystemUtil.NULL_PROPERTY_VALUE`, `getProperty` (2), `getSizeAsInt`, `getSizeAsLong`, `getDurationInNanos`, `loadPropertiesFile` (2), `loadPropertiesFiles` (2), `loadProperties`, `PropertyAction` | Java system properties and properties files. Aeron's `Configuration` reads its settings from `process.env` / an options object (a later phase). `parseSize` and `parseDuration`, which they call, are ported. |
| `DirectBuffer.wrap(ByteBuffer)`, `wrap(ByteBuffer, int, int)`, `wrap(long, int)`, `byteBuffer()`, `getBytes(int, ByteBuffer, int)`, `getBytes(int, ByteBuffer, int, int)` | No `ByteBuffer` and no raw memory address in JS: an `ArrayBuffer` is wrapped as a `Uint8Array`. |
| `MutableDirectBuffer.putBytes(int, ByteBuffer, int)`, `putBytes(int, ByteBuffer, int, int)` | As above. |
| `AbstractMutableDirectBuffer` `getBytes` / `putBytes` with a `ByteBuffer`; the `reverseBytes` branches (`NATIVE_BYTE_ORDER != LITTLE_ENDIAN` is never true); the `IOException` catch around `Appendable.append` | As above; the native order is little-endian; `append` cannot throw a checked exception. |
| `AtomicBuffer.STRICT_ALIGNMENT_CHECKS_PROP_NAME`, `STRICT_ALIGNMENT_CHECKS` | JVM system property and `os.arch`; alignment of a `byte[]` is not observable. `verifyAlignment` checks the window offset only. |
| `UnsafeBuffer(ByteBuffer)`, `(ByteBuffer, int, int)`, `(long, int)`, `byteBuffer()`, the `byteBuffer` field | As above. |
| `BufferUtil.BYTE_BUFFER_HB_FIELD_OFFSET`, `BYTE_BUFFER_OFFSET_FIELD_OFFSET`, `BYTE_BUFFER_ADDRESS_FIELD_OFFSET`, `boundsCheck(ByteBuffer, long, int)`, `address`, `array`, `arrayOffset`, `free(DirectBuffer)`, `free(ByteBuffer)` | Methods on a `ByteBuffer` or its memory; memory is garbage collected. |
| `UnsafeApi.java` | The `sun.misc.Unsafe` / `VarHandle` wrapper: its calls in the buffers are `DataView` calls. |
