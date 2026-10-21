# Source and test mapping

One row per ported file (spec §5, §8.1). `aeron:` paths are relative to the Aeron `1.53.3` checkout and `agrona:`
paths to the Agrona `2.6.1` checkout (`npm run fetch:refs`). `npm run check:mapping` checks the **Tests** and
**Skipped tests** tables against both sides: every Java test name has a TS test of the same name and the reverse,
the counts are current, and every `it.skip` is listed with its reason.

## Sources

| Java source | TypeScript source | Notes |
|---|---|---|
| `agrona:agrona/src/main/java/org/agrona/BitUtil.java` | `src/agrona/BitUtil.ts` | `int`/`long` overloads: the `long` ones are `findNextPositivePowerOfTwoLong`, `alignLong`, `isEvenLong`, `isPowerOfTwoLong`; they and `isAligned` throw `RangeError` for an argument or a result that is not a safe integer (spec D5). `byte[]` is `Uint8Array`; `toHexByteArray` takes a `Uint8Array` or a `string` (the `CharSequence` overload) and throws `ArrayIndexOutOfBoundsException` / `StringIndexOutOfBoundsException` / `NegativeArraySizeException` where Java does. `fromHexByteArray` throws `ArrayIndexOutOfBoundsException` for a byte above 127 through a private `fromHexDigit`, as the Java table lookup does. `next` and `previous` wrap like an `int`. |
| `agrona:agrona/src/main/java/org/agrona/Strings.java` | `src/agrona/Strings.ts` | `isEmpty` is a type guard. `parseIntOrDefault` uses `Integer.parseInt` from `jdk.ts`. |
| `agrona:agrona/src/main/java/org/agrona/LangUtil.java` | `src/agrona/LangUtil.ts` | `rethrowUnchecked` returns `never`. There is no checked-exception erasure to do, so the private generic `rethrow` is a plain `throw`. |
| `agrona:agrona/src/main/java/org/agrona/AsciiEncoding.java` | `src/agrona/AsciiEncoding.ts` | `CharSequence` is `string` (`charAt` and `subSequence` throw `StringIndexOutOfBoundsException` where Java's do), `char` and `byte` are `number`. `long` results are `number` (spec D5): `parseLongAscii` accumulates in a number and switches to `bigint` only when the value leaves +/-(2^53 - 1), then throws `LongOverflowError` carrying the exact long Java returns. `digitCountLong` of a `number` is exact-double arithmetic over `LONG_POW_10`; of a `bigint` it uses `LONG_DIGITS` (a `BigInt64Array`). The SWAR helpers that take eight bytes at once keep their `bigint` form (`isEightDigitAsciiEncodedNumber`, `parseEightDigitsLittleEndian`); the parsers use the added `...Words(high, low)` forms over two int32 words, with the carry and borrow of the 64-bit add and subtract done by hand. `LONG_POW_10` is a `number[]` (every power of ten up to 10^18 is exact); `*_VALUE_DIGITS` and `MIN/MAX_*_VALUE` are `Int32Array` / `Uint8Array`. |
| `agrona:agrona/src/main/java/org/agrona/AsciiNumberFormatException.java` | `src/agrona/AsciiNumberFormatException.ts` | Extends `NumberFormatException` from `jdk.ts`. |
| `agrona:agrona/src/main/java/org/agrona/SystemUtil.java` | `src/agrona/SystemUtil.ts` | Only the pure parts: `parseSize`, `formatSize`, `parseDuration`, `formatDuration` and what they use, plus the package-private `isX64Arch(String)`. The digits are parsed to a `bigint` and checked against Java's 2^63 - 1 bounds, so the overflow errors are Java's; a result outside +/-(2^53 - 1) throws `LongOverflowError` (`parseSize`, and `parseDuration` for a bare number or `ns`) or saturates at 2^53 - 1 (`parseDuration` with `us`, `ms`, `s`), the one saturating function of spec D5. |
| `agrona:agrona/src/main/java/org/agrona/ErrorHandler.java` | `src/agrona/ErrorHandler.ts` | Interface; `Throwable` is `Error`. |
| (no Java file) | `src/agrona/jdk.ts` | JDK stand-ins that Agrona and its tests use (spec D10): `ByteOrder`, the exception classes (`Exception`, `RuntimeException`, `IllegalArgumentException`, `IllegalStateException`, `NumberFormatException`, `ArithmeticException`, `NullPointerException`, `UnsupportedOperationException`, `IndexOutOfBoundsException`, `ArrayIndexOutOfBoundsException`, `StringIndexOutOfBoundsException`, `NegativeArraySizeException`, each with `name` set to its class name), `LongOverflowError` (a `RangeError`), `Character.isDigit` (a table built once), `Integer`, `Long` (`MAX_VALUE` / `MIN_VALUE` are the +/-(2^53 - 1) bounds), `Byte`, `Short`, `TimeUnit.toNanos`, `ThreadLocalRandom`, `Objects.checkFromIndexSize`, `Appendable`, `newStringAscii` (`new String(bytes, US_ASCII)`), `longToNumber`, `longValueExact`, and `dataViewGetLong` / `dataViewSetLong` (a `long` in a `DataView` as a `number`, without allocating). |
| (no Java file) | `test/support/Assertions.ts`, `test/support/Mockito.ts`, `test/support/ByteBuffer.ts` | Test helpers: JUnit's `assertThrows` / `assertThrowsExactly` (which return the exception) and `assertEquals` / `assertNotEquals` for objects, the part of Mockito's `mock` that the tests use, and a small `java.nio.ByteBuffer` stand-in. |
| `agrona:agrona/src/main/java/org/agrona/DirectBuffer.java` | `src/agrona/DirectBuffer.ts` | Interface, plus a `const DirectBuffer` of the same name with the interface constants (`STR_HEADER_LEN`, `DISABLE_BOUNDS_CHECKS_PROP_NAME`, `SHOULD_BOUNDS_CHECK`, always `true`: there are no system properties). `hashCode` and `equals`, which every Java object has, are declared. `long` is `number` (`getLong` throws `RangeError` outside +/-(2^53 - 1)), `getLongBigInt` reads 64 bits. Overloads that differ by parameter type (`getStringAscii`, `getBytes`, `wrap`) are TypeScript overload signatures over one implementation. |
| `agrona:agrona/src/main/java/org/agrona/MutableDirectBuffer.java` | `src/agrona/MutableDirectBuffer.ts` | Interface. `putLong` throws `RangeError`, writing nothing, for a value that is not a safe integer; `putLongBigInt` writes 64 bits. The `String` and `CharSequence` overloads of `putStringAscii` and `putStringWithoutLengthAscii` are one method over `string \| null`. |
| `agrona:agrona/src/main/java/org/agrona/concurrent/AtomicBuffer.java` | `src/agrona/concurrent/AtomicBuffer.ts` | Interface, plus `const AtomicBuffer` with `ALIGNMENT`. The volatile, ordered, release, acquire, opaque and atomic operations are plain single-thread operations with the same names and results. |
| `agrona:agrona/src/main/java/org/agrona/AbstractMutableDirectBuffer.java` | `src/agrona/AbstractMutableDirectBuffer.ts` | `sun.misc.Unsafe` reads and writes of `byteArray` at `addressOffset + index` are `DataView` calls on `_dataView` at `_addressOffset + index`. Fields are `_byteArray`, `_dataView`, `_addressOffset`, `_capacity` (the Java names clash with the accessors). Byte order is the `DataView` `littleEndian` flag instead of `reverseBytes`. The long parsers accumulate in a number and switch to `bigint` only when the value leaves +/-(2^53 - 1), then throw `LongOverflowError`; the 8-digit checks use two int32 words. `setMemory` is `Uint8Array.fill`. Copies allocate nothing and move bytes as memmove does for overlapping views of one `ArrayBuffer` (`copyWithin`, or a loop in the safe direction). UTF-8 uses `TextEncoder` / `TextDecoder` (a lone surrogate is encoded as '?', as `String.getBytes(UTF_8)` does; a byte order mark is kept). |
| `agrona:agrona/src/main/java/org/agrona/concurrent/UnsafeBuffer.java` | `src/agrona/concurrent/UnsafeBuffer.ts` | Constructors and `wrap` take a `Uint8Array` (`byte[]`), an `ArrayBuffer` (the `ByteBuffer`, as a `Uint8Array` over all of it, reused when the same `ArrayBuffer` is wrapped again) or a `DirectBuffer`, with an optional `(offset, length)`; the Java overloads differing only in arity are one method. `wrap(DirectBuffer)` shares the other `UnsafeBuffer`'s `DataView` and allocates one only for a foreign `DirectBuffer` or a new `Uint8Array`. `verifyAlignment` checks `byteOffset + addressOffset` of the window in its `ArrayBuffer` and reports that value as `addressOffset` (spec D9). `toString` is Java's text, with `byteBuffer=null`. |
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
| `test/agrona/concurrent/UnsafeBufferTest.test.ts` | wrapForRawMemoryAddressShouldResetWrapAdjustment | no direct memory / ByteBuffer in JS: `wrap(long address, int length)` is not ported |
| `test/agrona/concurrent/AtomicBufferTest.test.ts` | shouldGetBytesFromBufferToBuffer | no direct memory / ByteBuffer in JS: `getBytes(int, ByteBuffer, int)` is not ported |
| `test/agrona/concurrent/AtomicBufferTest.test.ts` | shouldGetBytesFromBufferToSlice | no direct memory / ByteBuffer in JS: `getBytes(int, ByteBuffer, int)` is not ported |
| `test/agrona/concurrent/AtomicBufferTest.test.ts` | verifyAlignmentShouldThrowForAByteArrayIfStrictAlignmentChecksAreEnabled | no JVM equivalent: whether a `byte[]` is aligned (object layout, `STRICT_ALIGNMENT_CHECKS`) does not exist in JS |
| `test/agrona/concurrent/AtomicBufferTest.test.ts` | verifyAlignmentShouldThrowForAHeapByteBufferArrayIfStrictAlignmentChecksAreEnabled | no JVM equivalent: whether a `byte[]` is aligned (object layout, `STRICT_ALIGNMENT_CHECKS`) does not exist in JS |
| `test/agrona/concurrent/AtomicBufferTest.test.ts` | verifyAlignmentShouldWarnForAByteArrayWhenStrictChecksAreDisabled | no JVM equivalent: whether a `byte[]` is aligned (object layout, `STRICT_ALIGNMENT_CHECKS`) does not exist in JS |
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
| `test/agrona/BitUtilTest.test.ts` | shouldAlignValueToNextMultipleOfAlignmentLong | `align(Long.MAX_VALUE, 64)` is `Long.MIN_VALUE` in Java (the add overflows and wraps). The aligned value, 2^53, is not a safe integer, so `alignLong` throws `RangeError` (spec D5: a result outside +/-(2^53 - 1) throws, it never wraps), and the test asserts the throw. The assertions below it are unchanged. |
| `test/agrona/AsciiEncodingTest.test.ts` | shouldParseLong | Every Java value is kept (`0`, `-123456789876543210`, `Long.MAX_VALUE - 1`, `Long.MAX_VALUE`, `Long.MIN_VALUE + 1`, `Long.MIN_VALUE`, with Java's 2^63 - 1 bounds). `assertParsedLong` asserts the value for a long inside +/-(2^53 - 1), and for one outside it a `LongOverflowError` whose `value` is the exact long Java returns. The two safe bounds, 2^53 - 1 and -(2^53 - 1), are asserted as plain values. |
| `test/agrona/AsciiEncodingTest.test.ts` | digitCountLongValue | The values are `bigint`s (`digitCountLong` accepts `number \| bigint`), because the loop reaches `Long.MAX_VALUE` (19 digits). `>>> 1` on a positive long is `>> 1n`. The expected digit counts are the Java ones. |
| `test/agrona/AsciiEncodingTest.test.ts` | parseIntAsciiRoundTrip | `assertEquals` is `node:assert` `strictEqual` in the loop (`expect` costs seconds for that many calls), and the 1,000,000 iterations are divided by `ITERATIONS_SCALE` (see "Iteration counts" below). Same assertion. |
| `test/agrona/AsciiEncodingTest.test.ts` | parseLongAsciiRoundTrip | Java's random 64-bit long, as a `bigint` (every fourth one in full, the others shifted right by 0 to 63 bits so that every digit count occurs). Inside +/-(2^53 - 1) the parse returns the value; outside it throws `LongOverflowError` whose `value` is the generated long. `node:assert` and `ITERATIONS_SCALE`, as `parseIntAsciiRoundTrip`. |
| `test/agrona/SystemUtilTest.test.ts` | shouldParseSizesWithSuffix | Java's rows are kept. A result outside +/-(2^53 - 1) (`8589934591g`, `8796093022207m`, `9007199254740991k`) throws `LongOverflowError` whose `value` is Java's result, which `assertParsedLong` asserts, with the expected values as `bigint`s. Extra rows at the 2^53 bound follow Java's: `8388607g`, `8589934591m`, `8796093022207k`, `8796093022208k`, `8388608g`. |
| `test/agrona/SystemUtilTest.test.ts` | shouldParseTimesWithSuffix | Java's rows are kept, with `bigint` expected values. A result outside +/-(2^53 - 1) is not returned: the bare number and `ns` throw `LongOverflowError` whose `value` is Java's result, and `us`, `ms` and `s` saturate at `Long.MAX_VALUE` of `jdk.ts`, 2^53 - 1, where Java saturates at 2^63 - 1 (spec D5). Extra rows at the 2^53 bound: `9007199254740991`, `9007199254740991ns`, `9007199254740us`, `9007199254ms`, `9007199s`, `9007199254741us`, `9007199255ms`, `9007200s`. |
| `test/agrona/SystemUtilTest.test.ts` | shouldReturnLongMaxValueIfExceedsForSuffix | Java's rows are kept, expecting Java's `Long.MAX_VALUE` (2^63 - 1): `ns` throws `LongOverflowError` carrying it, the other suffixes saturate at 2^53 - 1. |
| `test/agrona/SystemUtilTest.test.ts` | formatDurationShouldRejectNegativeValues | `Long.MIN_VALUE` is -(2^53 - 1). |
| `test/agrona/SystemUtilTest.test.ts` | shouldFormatDuration | The `Long.MAX_VALUE` row uses 2^53 - 1. |
| `test/agrona/SystemUtilTest.test.ts` | formatSizeShouldRejectNegativeValues | `Long.MIN_VALUE` is -(2^53 - 1). |
| `test/agrona/SystemUtilTest.test.ts` | shouldFormatSize | The rows for `Long.MAX_VALUE` and for the largest multiples of `g`, `m`, `k` use 2^53 - 1 and the largest multiples under it (`8388607g`, `8589934591m`, `8796093022207k`). |
| `test/agrona/AsciiEncodingTest.test.ts` | shouldDetectEightDigitsAsciiEncodedNumbers | The eight bytes are read with `getLongBigInt` (`isEightDigitAsciiEncodedNumber` takes a `bigint`, 8 ASCII digits are above 2^53 - 1), and the 810,811-iteration loop uses `node:assert` instead of `expect`, which costs about 10 s for that many calls. Same assertions. |
| `test/agrona/AsciiEncodingTest.test.ts` | shouldParseEightDigitsFromAnAsciiEncodedNumberInLittleEndianByteOrder | As above: `getLongBigInt`, `node:assert`. |
| `test/agrona/MutableDirectBufferTests.ts` | putIntAsciiRoundTrip | `assertEquals` is `node:assert` `strictEqual` in the loop (`expect` costs seconds for that many calls), and the 10,000,000 iterations are divided by `ITERATIONS_SCALE`. Same assertion. |
| `test/agrona/MutableDirectBufferTests.ts` | putLongAsciiRoundTrip | The full range of a Java long, as a `bigint` (see `AsciiEncodingTest.parseLongAsciiRoundTrip`). `putLongAscii` takes a `number`, so inside +/-(2^53 - 1) the long is put and parsed back; outside it, its digits are written with `putStringWithoutLengthAscii` and `parseLongAscii` must throw `LongOverflowError` whose `value` is the long. `node:assert` and `ITERATIONS_SCALE`. |
| `test/agrona/MutableDirectBufferTests.ts` | putNaturalIntAsciiRoundTrip | `node:assert` and `ITERATIONS_SCALE`, as `putIntAsciiRoundTrip`. |
| `test/agrona/MutableDirectBufferTests.ts` | putNaturalLongAsciiRoundTrip | `nextLong(0, Long.MAX_VALUE)` is a random natural 63-bit long of Java as a `bigint`, handled as in `putLongAsciiRoundTrip` with `parseNaturalLongAscii`. `node:assert` and `ITERATIONS_SCALE`. |
| `test/agrona/MutableDirectBufferTests.ts` | putLongAsciiShouldEncodeBoundaryValues | `Long.MIN_VALUE` / `Long.MAX_VALUE` are -(2^53 - 1) / 2^53 - 1. The `Long.MIN_VALUE` branch of `putLongAscii` (negating it overflows) does not exist for a `number`. |
| `test/agrona/MutableDirectBufferTests.ts` | getBytesShouldCopyIntoDestinationBuffer | `ExpandableArrayBuffer` and `ExpandableDirectByteBuffer` are not ported; the `UnsafeBuffer` rows over a heap and a direct `ByteBuffer` are an `UnsafeBuffer` over a `Uint8Array` and over an `ArrayBuffer`. A `byte` is read back signed: `data[i]` is converted with `(byte)`. |
| `test/agrona/MutableDirectBufferTests.ts` | putBytesShouldCopyBytesFromTheSourceBuffer | As `getBytesShouldCopyIntoDestinationBuffer`. |
| `test/agrona/MutableDirectBufferTests.ts` | equalsReturnsFalseForNull | `assertNotEquals(null, buffer)` is JUnit's `objectsAreEqual`, ported in `test/support/Assertions.ts` as `assertNotEqualsObject`; it does not call `buffer.equals`. `equals` returns `false` for `null`, as the Java does. |
| `test/agrona/concurrent/UnsafeBufferTest.test.ts` | shouldExposePositionAtWhichHeapByteBufferGetsWrapped | The `ByteBuffer` is the stand-in in `test/support/ByteBuffer.ts`; the `UnsafeBuffer` wraps its `ArrayBuffer` at `(ADJUSTMENT_OFFSET, capacity - ADJUSTMENT_OFFSET)`. |
| `test/agrona/concurrent/UnsafeBufferTest.test.ts` | shouldExposePositionAtWhichDirectByteBufferGetsWrapped | As above. |
| `test/agrona/concurrent/UnsafeBufferTest.test.ts` | wrapDirectBuffer | `ExpandableArrayBuffer` and `ExpandableDirectByteBuffer` are not ported; the `UnsafeBuffer` over a heap `ByteBuffer` is over an `ArrayBuffer`; the mock `DirectBuffer` is a hand fake with `vi.fn()` stubs (`addressOffset` is 0, Mockito's default). The `byteBuffer()` assertion is dropped: there is no `byteBuffer()`. |
| `test/agrona/concurrent/UnsafeBufferTest.test.ts` | wrapDirectBufferWithOffsetAndLength | As `wrapDirectBuffer`. |
| `test/agrona/concurrent/UnsafeBufferTest.test.ts` | parseIntAsciiIsNotDependentOnTheBufferEndianness, parseLongAsciiIsNotDependentOnTheBufferEndianness | The `ByteBuffer.order(byteOrder)` is the test/support stand-in, wrapped through its `ArrayBuffer`. An `UnsafeBuffer` always reads little-endian, so the byte order of the stand-in does not reach it: the test holds by construction. |
| `test/agrona/concurrent/UnsafeBufferTest.test.ts` | verifyAlignmentThrowsIllegalStateExceptionIfBufferCreatedFromImproperlyAlignedDirectByteBuffer | `allocateDirectAligned` returns an `ArrayBuffer`, so the improperly aligned buffer is a window at offset `alignment` (1, 2 and 4, as Java's alignments) of one, and `verifyAlignment` must throw `IllegalStateException` (spec D9). |
| `test/agrona/concurrent/UnsafeBufferTest.test.ts` | verifyAlignmentThrowsIllegalStateExceptionIfBufferCreatedFromAnUnalignedAddress | The address 1133 is the offset 1133 of a window in an `ArrayBuffer`. |
| `test/agrona/concurrent/UnsafeBufferTest.test.ts` | (all) | The byte arrays of the fixtures are created for each test in `beforeEach`, as JUnit creates an instance of the test class for each test. |
| `test/agrona/concurrent/AtomicBufferTest.test.ts` | 41 tests that take a `ByteBuffer` (`shouldCopyMemory` to `shouldGetBytesFromBuffer`, all but `shouldGetBytesFromBufferToBuffer` and `shouldGetBytesFromBufferToSlice`) | The `ByteBuffer` that is the independent view of the memory is the stand-in in `test/support/ByteBuffer.ts` (an `ArrayBuffer` window with a byte order and the typed accessors), and `new UnsafeBuffer(buffer)` is `newUnsafeBuffer(buffer)`, which wraps the stand-in's `ArrayBuffer` window. The rows are the same three `nativeBuffers` and one `atomicBuffers` (`allocateDirectAligned(...)` is an `ArrayBuffer`, wrapped by the stand-in). A `long` is a `number`: all the test values (`Integer.MAX_VALUE + 5L`, ...) are safe integers. |
| `test/agrona/BufferUtilTest.test.ts` | shouldBoundsCheckByteArrayIndexWithoutLongOverflow | `Long.MAX_VALUE - 3` is `2^53 - 1 - 3`, the largest index a `number` holds. |
| `test/agrona/BufferUtilTest.test.ts` | shouldAlignToWordBoundary, shouldAlignToCacheLineBoundary | An `ArrayBuffer` has no address: the address is the `byteOffset` (0) of a view of the new buffer, which `isAligned` accepts, and `verifyAlignment` of an `UnsafeBuffer` over it passes. The capacity assertion is kept: the `byteLength` is the capacity. |

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
| `getDigit(int, byte)` / `getDigit(int, char)` messages | one `getDigit(index, value)`: a negative `value` is a byte, which prints as the sign-extended char (`-56` is `'\uFFC8'`), a non-negative one is a char | Java's byte overload prints `(char) value`; the two are told apart by sign, so one method keeps both messages. |
| (none) | `LongOverflowError extends RangeError` with `readonly value: bigint` in `jdk.ts` | Addition (spec D5): thrown by `parseLongAscii`, `parseNaturalLongAscii`, `parseSize`, `parseDuration` and `getLong` for a long outside +/-(2^53 - 1), carrying the exact long Java returns. |
| (none) | `AsciiEncoding.isEightDigitAsciiEncodedNumberWords(high, low)`, `parseEightDigitsLittleEndianWords(high, low)` | Additions: the 8-digit helpers over two int32 words, so that the parsers allocate no `bigint`. |

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

## Iteration counts

The Java tests run their random round trips for 1,000,000 (`AsciiEncodingTest`) and 10,000,000 (`MutableDirectBufferTests`) iterations. Both loops run `count / ITERATIONS_SCALE` iterations, where `test/support/Iterations.ts` has `ITERATIONS_SCALE = process.env.AERON_TS_FULL_ITERATIONS ? 1 : 100`. CI sets `AERON_TS_FULL_ITERATIONS=1` on the Node 24 job only.

## Deviations

The deviations of this port that touch these files (the full list is spec section 6):

| # | Deviation |
|---|---|
| D5 | Every Java `long` is a `number` in +/-(2^53 - 1). A result or stored value outside that range throws `RangeError` (`LongOverflowError` when it is a parsed or stored long, carrying the exact value) and writes nothing; it never wraps. It covers get / put / getAndAdd / add / compareAndSet of longs, `putLongAscii`, `parseLongAscii`, `parseSize` / `parseDuration` and the `BitUtil` long helpers. The one exception is a saturating function: Java's `parseDuration` saturates at `Long.MAX_VALUE`, here at 2^53 - 1. |
| D9 | No `java.nio.ByteBuffer` and no raw addresses: buffers wrap an `ArrayBuffer` or a `Uint8Array`. `verifyAlignment` checks `byteOffset + addressOffset` of the window in its `ArrayBuffer`. |
| D10 | The JDK exception classes live in `src/agrona/jdk.ts`, not in `exceptions.ts`. |

A V8 detail that follows from D5: a number outside the 32-bit small integers (a long above 2^31, a double) is boxed in a heap number when it is passed to or returned from a call that is not inlined. `test/extra/agrona/HotPathAllocationTest.test.ts` asserts that the int-sized paths allocate nothing and that the long paths allocate no more than those heap numbers.
