// Not in Agrona: the AtomicCounter memory-order variants, the long (spec D5) range, the CountersManager paths that
// CountersManagerTest does not reach (UTF-8 labels, free list, state and deadline, bad ids), the CountersReader
// iterators, the ported members of IntArrayList and the Charset stand-in.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntArrayList } from '../../../src/agrona/collections/IntArrayList.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { AtomicCounter } from '../../../src/agrona/concurrent/status/AtomicCounter.js';
import { CountersManager } from '../../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../../src/agrona/concurrent/status/CountersReader.js';
import { UnsafeBufferPosition } from '../../../src/agrona/concurrent/status/UnsafeBufferPosition.js';
import {
    IllegalArgumentException,
    IllegalStateException,
    IndexOutOfBoundsException,
    Long,
} from '../../../src/agrona/jdk.js';
import { StandardCharsets } from '../../../src/agrona/jdkLang.js';
import { assertThrows } from '../../support/Assertions.js';

const {
    COUNTER_LENGTH,
    METADATA_LENGTH,
    MAX_LABEL_LENGTH,
    MAX_KEY_LENGTH,
    NOT_FREE_TO_REUSE,
    RECORD_ALLOCATED,
    RECORD_RECLAIMED,
    RECORD_UNUSED,
} = CountersReader;

describe('CountersExtra', () => {
    let metadataBuffer: UnsafeBuffer;
    let valuesBuffer: UnsafeBuffer;
    let manager: CountersManager;

    beforeEach(() => {
        metadataBuffer = new UnsafeBuffer(new ArrayBuffer(8 * METADATA_LENGTH));
        valuesBuffer = new UnsafeBuffer(new ArrayBuffer(8 * COUNTER_LENGTH));
        manager = new CountersManager(metadataBuffer, valuesBuffer);
    });

    describe('AtomicCounter', () => {
        it('everyMemoryOrderVariantOfEveryOperationAgrees', () => {
            const counter = new AtomicCounter(valuesBuffer, 3);

            expect([counter.increment(), counter.incrementOrdered(), counter.incrementRelease()]).toEqual([0, 1, 2]);
            expect([counter.incrementOpaque(), counter.incrementPlain()]).toEqual([3, 4]);
            expect(counter.get()).toBe(5);
            expect([counter.getAcquire(), counter.getOpaque(), counter.getWeak(), counter.getPlain()]).toEqual([
                5, 5, 5, 5,
            ]);

            expect([counter.decrement(), counter.decrementOrdered(), counter.decrementRelease()]).toEqual([5, 4, 3]);
            expect([counter.decrementOpaque(), counter.decrementPlain()]).toEqual([2, 1]);
            expect(counter.get()).toBe(0);

            counter.set(10);
            expect(counter.get()).toBe(10);
            counter.setOrdered(11);
            counter.setRelease(12);
            counter.setOpaque(13);
            counter.setWeak(14);
            counter.setPlain(15);
            expect(counter.get()).toBe(15);

            expect([counter.getAndAdd(1), counter.getAndAddOrdered(2), counter.getAndAddRelease(3)]).toEqual([
                15, 16, 18,
            ]);
            expect([counter.getAndAddOpaque(4), counter.getAndAddPlain(5)]).toEqual([21, 25]);
            expect(counter.get()).toBe(30);

            expect(counter.getAndSet(7)).toBe(30);
            expect(counter.compareAndSet(6, 8)).toBe(false);
            expect(counter.get()).toBe(7);
            expect(counter.compareAndSet(7, 8)).toBe(true);
            expect(counter.get()).toBe(8);
        });

        it('proposeMaxOnlyRaisesTheValue', () => {
            const counter = new AtomicCounter(valuesBuffer, 0);
            counter.set(10);

            for (const propose of [
                (v: number) => counter.proposeMax(v),
                (v: number) => counter.proposeMaxOrdered(v),
                (v: number) => counter.proposeMaxRelease(v),
                (v: number) => counter.proposeMaxOpaque(v),
            ]) {
                const before = counter.get();
                expect(propose(before)).toBe(false);
                expect(propose(before - 1)).toBe(false);
                expect(counter.get()).toBe(before);
                expect(propose(before + 5)).toBe(true);
                expect(counter.get()).toBe(before + 5);
            }
        });

        it('countersAreOneCounterLengthApartAndDoNotOverlap', () => {
            const a = new AtomicCounter(valuesBuffer, 0);
            const b = new AtomicCounter(valuesBuffer, 1);
            a.set(1);
            b.set(2);

            expect(valuesBuffer.getLong(0)).toBe(1);
            expect(valuesBuffer.getLong(COUNTER_LENGTH)).toBe(2);
        });

        it('aCounterBeyondTheBufferIsRejected', () => {
            assertThrows(IndexOutOfBoundsException, () => new AtomicCounter(valuesBuffer, 8));
            assertThrows(IndexOutOfBoundsException, () => new UnsafeBufferPosition(valuesBuffer, 8));
            expect(() => new AtomicCounter(valuesBuffer, 7)).not.toThrow();
        });

        it('aLongOutsideThePlusOrMinus2To53MinusOneRangeThrowsAndChangesNothing', () => {
            const counter = new AtomicCounter(valuesBuffer, 0);

            counter.set(Long.MAX_VALUE);
            expect(() => counter.increment()).toThrow(RangeError);
            expect(() => counter.incrementRelease()).toThrow(RangeError);
            expect(() => counter.getAndAdd(1)).toThrow(RangeError);
            expect(counter.get()).toBe(Long.MAX_VALUE);

            counter.set(Long.MIN_VALUE);
            expect(() => counter.decrement()).toThrow(RangeError);
            expect(counter.get()).toBe(Long.MIN_VALUE);
            expect(() => counter.set(2 ** 53)).toThrow(RangeError);
            expect(counter.get()).toBe(Long.MIN_VALUE);
        });

        it('negativeAndLargeValuesRoundTrip', () => {
            const counter = new AtomicCounter(valuesBuffer, 2);

            for (const value of [
                -1,
                -(2 ** 31),
                2 ** 31,
                2 ** 32 + 1,
                -(2 ** 40) - 3,
                Long.MAX_VALUE,
                Long.MIN_VALUE,
            ]) {
                counter.set(value);
                expect(counter.get()).toBe(value);
                expect(valuesBuffer.getLong(2 * COUNTER_LENGTH)).toBe(value);
            }
        });

        it('closeFreesTheCounterOnceAndDisconnectKeepsIt', () => {
            const counter = manager.newCounter('a');
            expect(counter.isClosed()).toBe(false);
            counter.close();
            counter.close();
            expect(counter.isClosed()).toBe(true);
            expect(manager.getCounterState(counter.id())).toBe(RECORD_RECLAIMED);

            const kept = manager.newCounter('b');
            kept.disconnectCountersManager();
            kept.close();
            expect(manager.getCounterState(kept.id())).toBe(RECORD_ALLOCATED);
            expect(kept.label()).toBeNull();
        });

        it('labelAndKeyUpdatesNeedAManager', () => {
            const counter = new AtomicCounter(valuesBuffer, 0);

            expect(counter.label()).toBeNull();
            assertThrows(IllegalStateException, () => counter.updateLabel('x'));
            assertThrows(IllegalStateException, () => counter.appendToLabel('x'));
            assertThrows(IllegalStateException, () => counter.updateKey(() => {}));
            assertThrows(IllegalStateException, () => counter.updateKey(new UnsafeBuffer(new Uint8Array(8)), 0, 8));
        });

        it('updateKeyThroughTheCounterAndAppendIsFluent', () => {
            const counter = manager.newCounter('base');

            expect(counter.appendToLabel('+1').appendToLabel('+2')).toBe(counter);
            expect(counter.label()).toBe('base+1+2');

            counter.updateKey((key) => key.putLong(0, 99));
            const source = new UnsafeBuffer(new Uint8Array(16));
            source.putLong(8, 123);
            counter.updateKey(source, 8, 8);
            const keys: number[] = [];
            manager.forEachMetaData((_id, _type, key) => void keys.push(key.getLong(0)));
            expect(keys).toEqual([123]);
        });

        it('toStringShowsTheValueUntilClosed', () => {
            const counter = manager.newCounter('x');
            counter.set(41);
            expect(counter.toString()).toContain('id=0, value=41');
            counter.close();
            expect(counter.toString()).toContain('isClosed=true, id=0, value=-1');
        });
    });

    describe('CountersManager', () => {
        it('theMetadataBufferMustBeBigEnough', () => {
            assertThrows(
                IllegalArgumentException,
                () => new CountersManager(new UnsafeBuffer(new ArrayBuffer(8 * METADATA_LENGTH - 1)), valuesBuffer),
            );
            expect(
                () => new CountersManager(new UnsafeBuffer(new ArrayBuffer(8 * METADATA_LENGTH)), valuesBuffer),
            ).not.toThrow();
        });

        it('aCounterGetsDefaultsAndItsRecordIsAllocated', () => {
            const id = manager.allocate('label', 77);

            expect(id).toBe(0);
            expect(manager.getCounterState(id)).toBe(RECORD_ALLOCATED);
            expect(manager.getCounterState(1)).toBe(RECORD_UNUSED);
            expect(manager.getCounterTypeId(id)).toBe(77);
            expect(manager.getCounterLabel(id)).toBe('label');
            expect(manager.getCounterValue(id)).toBe(0);
            expect(manager.getFreeForReuseDeadline(id)).toBe(NOT_FREE_TO_REUSE);
        });

        it('freeingSetsTheStateAndTheDeadlineAndClearsTheKey', () => {
            const id = manager.allocate('label', 1, (key) => key.putLong(0, 0x1234_5678_9abc));
            manager.free(id);

            expect(manager.getCounterState(id)).toBe(RECORD_RECLAIMED);
            expect(manager.getFreeForReuseDeadline(id)).toBe(0);
            expect(metadataBuffer.getLong(CountersReader.metaDataOffset(id) + CountersReader.KEY_OFFSET)).toBe(0);
        });

        it('aCounterThatIsNotAllocatedCannotBeFreed', () => {
            assertThrows(IllegalStateException, () => manager.free(0));
            const id = manager.allocate('x');
            manager.free(id);
            assertThrows(IllegalStateException, () => manager.free(id));
        });

        it('aBadCounterIdIsRejectedByEveryAccessor', () => {
            const bad = [-1, 8, 100];
            for (const id of bad) {
                for (const call of [
                    () => manager.getCounterValue(id),
                    () => manager.getCounterRegistrationId(id),
                    () => manager.getCounterOwnerId(id),
                    () => manager.getCounterReferenceId(id),
                    () => manager.getCounterState(id),
                    () => manager.getCounterTypeId(id),
                    () => manager.getFreeForReuseDeadline(id),
                    () => manager.getCounterLabel(id),
                    () => manager.free(id),
                    () => manager.setCounterValue(id, 1),
                    () => manager.setCounterRegistrationId(id, 1),
                    () => manager.setCounterOwnerId(id, 1),
                    () => manager.setCounterReferenceId(id, 1),
                    () => manager.setCounterLabel(id, 'x'),
                    () => manager.setCounterKey(id, () => {}),
                    () => manager.setCounterKey(id, new UnsafeBuffer(new Uint8Array(8)), 0, 8),
                ]) {
                    const error = assertThrows(IllegalArgumentException, call);
                    expect(error.message).toBe(`counter id ${id} out of range: 0 - maxCounterId=7`);
                }
            }
        });

        it('allocationFailureReturnsTheCounterToTheFreeListForReuse', () => {
            expect(() =>
                manager.allocate('x', 0, () => {
                    throw new IllegalStateException('key');
                }),
            ).toThrow(IllegalStateException);

            // the record never became allocated, so it is not free-able, but the id is reused at once
            expect(manager.getCounterState(0)).toBe(RECORD_UNUSED);
            assertThrows(IllegalStateException, () => manager.free(0));
            expect(manager.allocate('y')).toBe(0);
            expect(manager.getCounterLabel(0)).toBe('y');
        });

        it('aFreedIdIsReusedBeforeTheHighWaterMarkIsRaisedAndTheFirstFreedIsReusedFirst', () => {
            const ids = [manager.allocate('a'), manager.allocate('b'), manager.allocate('c'), manager.allocate('d')];
            manager.free(ids[2]!);
            manager.free(ids[1]!);

            expect(manager.available()).toBe(8 - 4 + 2);
            expect(manager.allocate('e')).toBe(ids[2]);
            expect(manager.allocate('f')).toBe(ids[1]);
            expect(manager.allocate('g')).toBe(4);
        });

        it('aReusedCounterStartsAtZero', () => {
            const id = manager.allocate('a');
            manager.setCounterValue(id, 55);
            manager.free(id);

            expect(manager.allocate('b')).toBe(id);
            expect(manager.getCounterValue(id)).toBe(0);
        });

        it('aCooldownIsMeasuredFromTheFreeAndAvailableCountsItToo', () => {
            let now = 5000;
            const cooled = new CountersManager(
                metadataBuffer,
                valuesBuffer,
                StandardCharsets.UTF_8,
                { time: () => now },
                100,
            );
            const id = cooled.allocate('a');
            cooled.free(id);

            expect(cooled.getFreeForReuseDeadline(id)).toBe(5100);
            expect(cooled.available()).toBe(8 - 1);
            now = 5099;
            expect(cooled.available()).toBe(8 - 1);
            expect(cooled.allocate('b')).toBe(1);
            now = 5100;
            expect(cooled.available()).toBe(8 - 2 + 1);
            expect(cooled.allocate('c')).toBe(id);
        });

        it('utf8LabelsAreStoredAsBytesAndTruncatedToTheByteLimit', () => {
            const id = manager.allocate('héllo €');
            expect(manager.getCounterLabel(id)).toBe('héllo €');
            expect(metadataBuffer.getInt(CountersReader.metaDataOffset(id) + CountersReader.LABEL_OFFSET)).toBe(
                new TextEncoder().encode('héllo €').length,
            );

            const long = manager.allocate('é'.repeat(MAX_LABEL_LENGTH));
            expect(metadataBuffer.getInt(CountersReader.metaDataOffset(long) + CountersReader.LABEL_OFFSET)).toBe(
                MAX_LABEL_LENGTH,
            );
        });

        it('anAsciiManagerReplacesNonAsciiCharactersWithAQuestionMark', () => {
            const ascii = new CountersManager(metadataBuffer, valuesBuffer, StandardCharsets.US_ASCII);
            const id = ascii.allocate('aéb');

            expect(ascii.getCounterLabel(id)).toBe('a?b');
        });

        it.each([StandardCharsets.US_ASCII, StandardCharsets.UTF_8])(
            'appendedLabelsAreTruncatedAtTheMaximum %s',
            (charset) => {
                const m = new CountersManager(metadataBuffer, valuesBuffer, charset);
                const id = m.allocate('x'.repeat(MAX_LABEL_LENGTH - 3));

                m.appendToLabel(id, 'abcdef');
                expect(m.getCounterLabel(id)).toBe('x'.repeat(MAX_LABEL_LENGTH - 3) + 'abc');
                m.appendToLabel(id, 'more');
                expect(m.getCounterLabel(id).length).toBe(MAX_LABEL_LENGTH);
            },
        );

        it('setCounterLabelReplacesTheLabelWholly', () => {
            const id = manager.allocate('a long first label');
            manager.setCounterLabel(id, 'short');

            expect(manager.getCounterLabel(id)).toBe('short');
        });

        it('rawAllocationCopiesAtMostTheMaximumKeyAndLabelAndAcceptsANullKey', () => {
            const big = new UnsafeBuffer(new Uint8Array(1024).fill(0x41));
            const a = manager.allocate(5, big, 0, 1024, big, 0, 1024);
            const b = manager.allocate(6, null, 0, 0, big, 0, 3);

            expect(manager.getCounterLabel(a).length).toBe(MAX_LABEL_LENGTH);
            expect(manager.getCounterLabel(b)).toBe('AAA');
            expect(
                metadataBuffer.getByte(
                    CountersReader.metaDataOffset(a) + CountersReader.KEY_OFFSET + MAX_KEY_LENGTH - 1,
                ),
            ).toBe(0x41);
            // the byte after the key is the label length prefix region of the record: untouched by the key copy
            expect(metadataBuffer.getInt(CountersReader.metaDataOffset(a) + CountersReader.LABEL_OFFSET)).toBe(
                MAX_LABEL_LENGTH,
            );
        });

        it('newCounterWithARawKeyAndLabel', () => {
            const label = new UnsafeBuffer(StandardCharsets.UTF_8.encode('raw'));
            const counter = manager.newCounter(9, null, 0, 0, label, 0, label.capacity());

            expect(counter.label()).toBe('raw');
            expect(manager.getCounterTypeId(counter.id())).toBe(9);
            expect(manager.newCounter('typed', 12).id()).toBe(1);
            expect(manager.getCounterTypeId(1)).toBe(12);
        });

        it('aKeyThatFitsExactlyIsAccepted', () => {
            const id = manager.allocate('x');
            const key = new UnsafeBuffer(new Uint8Array(MAX_KEY_LENGTH).fill(7));

            manager.setCounterKey(id, key, 0, MAX_KEY_LENGTH);

            expect(
                metadataBuffer.getByte(
                    CountersReader.metaDataOffset(id) + CountersReader.KEY_OFFSET + MAX_KEY_LENGTH - 1,
                ),
            ).toBe(7);
        });

        it('theKeyBufferHandedToACallbackHasTheExactKeyLength', () => {
            const lengths: number[] = [];
            manager.allocate('x', 0, (key) => lengths.push(key.capacity()));
            manager.setCounterKey(0, (key) => lengths.push(key.capacity()));

            expect(lengths).toEqual([MAX_KEY_LENGTH, MAX_KEY_LENGTH]);
            expect(MAX_KEY_LENGTH).toBe(112);
        });

        it('toStringNamesTheClassAndTheState', () => {
            manager.allocate('a');
            manager.allocate('b');
            manager.free(0);

            expect(manager.toString()).toMatch(
                /^CountersManager\{freeToReuseTimeoutMs=0, highWaterMarkId=1, freeList=\[0\]/,
            );
        });

        it('theLayoutConstantsAreAgronas', () => {
            expect([
                CountersReader.REGISTRATION_ID_OFFSET,
                CountersReader.OWNER_ID_OFFSET,
                CountersReader.REFERENCE_ID_OFFSET,
                CountersReader.TYPE_ID_OFFSET,
                CountersReader.FREE_FOR_REUSE_DEADLINE_OFFSET,
                CountersReader.KEY_OFFSET,
                CountersReader.LABEL_OFFSET,
                CountersReader.FULL_LABEL_LENGTH,
                MAX_LABEL_LENGTH,
                MAX_KEY_LENGTH,
                METADATA_LENGTH,
                COUNTER_LENGTH,
            ]).toEqual([8, 16, 24, 4, 8, 16, 128, 384, 380, 112, 512, 128]);
        });
    });

    describe('CountersReader', () => {
        it('forEachStopsAtTheFirstUnusedRecordAndSkipsReclaimedOnes', () => {
            const a = manager.allocate('a');
            const b = manager.allocate('b');
            const c = manager.allocate('c');
            manager.free(b);

            const seen: [number, string][] = [];
            manager.forEach((id, label) => void seen.push([id, label]));

            expect(seen).toEqual([
                [a, 'a'],
                [c, 'c'],
            ]);
        });

        it('forEachCounterConsumerGivesValueIdAndLabel', () => {
            const a = manager.allocate('a');
            const b = manager.allocate('b');
            manager.setCounterValue(a, 11);
            manager.setCounterValue(b, 2 ** 40);

            const consumer = vi.fn();
            manager.forEachCounterConsumer(consumer);

            expect(consumer.mock.calls).toEqual([
                [11, a, 'a'],
                [2 ** 40, b, 'b'],
            ]);
        });

        it('forEachMetaDataGivesTheTypeAndAKeyBufferOfTheMaximumKeyLength', () => {
            manager.allocate('a', 5);

            const seen: [number, number, number, string][] = [];
            manager.forEachMetaData((id, type, key, label) => void seen.push([id, type, key.capacity(), label]));

            expect(seen).toEqual([[0, 5, MAX_KEY_LENGTH, 'a']]);
        });

        it('findByRegistrationIdSkipsReclaimedCountersAndStopsAtTheFirstUnused', () => {
            const a = manager.allocate('a');
            manager.setCounterRegistrationId(a, 9);
            manager.free(a);
            const b = manager.allocate('b', 3);
            manager.setCounterRegistrationId(b, 9);

            expect(a).toBe(b); // the id was reused with its registration reset, then set again
            expect(manager.findByRegistrationId(9)).toBe(b);
            expect(manager.findByTypeIdAndRegistrationId(3, 9)).toBe(b);
            expect(manager.findByTypeIdAndRegistrationId(4, 9)).toBe(-1);

            manager.free(b);
            expect(manager.findByRegistrationId(9)).toBe(-1);
        });

        it('aReaderSeesWhatTheManagerWritesAndNothingBeyondTheBuffers', () => {
            const reader = new CountersReader(metadataBuffer, valuesBuffer);
            expect(reader.maxCounterId()).toBe(7);
            expect(reader.metaDataBuffer()).toBe(metadataBuffer);
            expect(reader.valuesBuffer()).toBe(valuesBuffer);
            expect(reader.labelCharset()).toBe(StandardCharsets.UTF_8);

            const id = manager.allocate('seen');
            manager.setCounterValue(id, 3);
            expect(reader.getCounterLabel(id)).toBe('seen');
            expect(reader.getCounterValue(id)).toBe(3);
            expect(CountersReader.counterOffset(3)).toBe(3 * COUNTER_LENGTH);
            expect(CountersReader.metaDataOffset(3)).toBe(3 * METADATA_LENGTH);
        });
    });

    describe('UnsafeBufferPosition', () => {
        it('closeFreesTheCounterOfItsManagerOnce', () => {
            const id = manager.allocate('p');
            const position = new UnsafeBufferPosition(valuesBuffer, id, manager);

            expect(position.id()).toBe(id);
            expect(position.isClosed()).toBe(false);
            position.setVolatile(5);
            expect(position.toString()).toBe(`UnsafeBufferPosition{isClosed=false, counterId=${id}, value=5}`);
            position.close();
            position.close();

            expect(position.isClosed()).toBe(true);
            expect(manager.getCounterState(id)).toBe(RECORD_RECLAIMED);
            expect(position.toString()).toBe(`UnsafeBufferPosition{isClosed=true, counterId=${id}, value=-1}`);
        });

        it('everyVariantSharesTheCounterWithAnAtomicCounter', () => {
            const position = new UnsafeBufferPosition(valuesBuffer, 4);
            const counter = new AtomicCounter(valuesBuffer, 4);

            position.setOrdered(3);
            expect(counter.get()).toBe(3);
            expect(position.proposeMaxOrdered(2)).toBe(false);
            expect(position.proposeMaxOrdered(9)).toBe(true);
            expect(counter.get()).toBe(9);
            counter.set(2 ** 45);
            expect([position.get(), position.getVolatile(), position.getAcquire(), position.getOpaque()]).toEqual([
                2 ** 45,
                2 ** 45,
                2 ** 45,
                2 ** 45,
            ]);
        });
    });

    describe('IntArrayList', () => {
        it('addGetRemoveAndGrow', () => {
            const list = new IntArrayList();
            expect(list.isEmpty()).toBe(true);
            expect(list.capacity()).toBe(IntArrayList.INITIAL_CAPACITY);
            expect(list.nullValue()).toBe(IntArrayList.DEFAULT_NULL_VALUE);

            for (let i = 0; i < 100; i++) {
                expect(list.addInt(i * 3)).toBe(true);
            }
            list.pushInt(-7);

            expect(list.size()).toBe(101);
            expect(list.capacity()).toBeGreaterThanOrEqual(101);
            expect(list.getInt(0)).toBe(0);
            expect(list.getInt(99)).toBe(297);
            expect(list.getInt(100)).toBe(-7);

            expect(list.removeAt(1)).toBe(3);
            expect(list.remove(0)).toBe(0);
            expect(list.getInt(0)).toBe(6);
            expect(list.size()).toBe(99);
            expect(list.removeAt(98)).toBe(-7);

            list.clear();
            expect(list.isEmpty()).toBe(true);
        });

        it('indexesOutsideTheListAreRejected', () => {
            const list = new IntArrayList();
            list.addInt(1);

            for (const index of [-1, 1, 5]) {
                assertThrows(IndexOutOfBoundsException, () => list.getInt(index));
                assertThrows(IndexOutOfBoundsException, () => list.removeAt(index));
                assertThrows(IndexOutOfBoundsException, () => list.remove(index));
            }
        });

        it('removeReturnsNullForTheNullValueAndToStringShowsIt', () => {
            const list = new IntArrayList(2, -1);
            list.addInt(4);
            list.addInt(-1);
            list.addInt(6);

            expect(list.toString()).toBe('[4, null, 6]');
            expect(list.remove(1)).toBeNull();
            expect(list.toString()).toBe('[4, 6]');
            expect(new IntArrayList().toString()).toBe('[]');
        });
    });

    describe('Charset', () => {
        it('asciiAndUtf8RoundTrip', () => {
            expect([...StandardCharsets.US_ASCII.encode('aé€')]).toEqual([0x61, 0x3f, 0x3f]);
            expect(StandardCharsets.US_ASCII.decode(new Uint8Array([0x61, 0xe9, 0x7f]))).toBe('a�\x7f');
            expect([...StandardCharsets.UTF_8.encode('é')]).toEqual([0xc3, 0xa9]);
            expect(StandardCharsets.UTF_8.decode(new Uint8Array([0xc3, 0xa9]))).toBe('é');
            expect(StandardCharsets.UTF_8.name()).toBe('UTF-8');
            expect(String(StandardCharsets.US_ASCII)).toBe('US-ASCII');
        });
    });

    describe('cross thread long fields (issue 16)', () => {
        it('ownerIdReferenceIdAndFreeForReuseDeadlineUseTheAtomicLongMethodsRegression', () => {
            const clockMs = { value: 1000 };
            const timed = new CountersManager(
                metadataBuffer,
                valuesBuffer,
                StandardCharsets.UTF_8,
                { time: () => clockMs.value },
                100,
            );
            const plainPuts = [vi.spyOn(metadataBuffer, 'putLong'), vi.spyOn(valuesBuffer, 'putLong')];
            const plainGets = [vi.spyOn(metadataBuffer, 'getLong'), vi.spyOn(valuesBuffer, 'getLong')];
            const releases = [vi.spyOn(metadataBuffer, 'putLongRelease'), vi.spyOn(valuesBuffer, 'putLongRelease')];
            const volatiles = [vi.spyOn(metadataBuffer, 'getLongVolatile'), vi.spyOn(valuesBuffer, 'getLongVolatile')];

            const a = timed.allocate('a');
            timed.setCounterOwnerId(a, 7);
            timed.setCounterReferenceId(a, 9);
            expect(timed.getCounterOwnerId(a)).toBe(7);
            expect(timed.getCounterReferenceId(a)).toBe(9);
            expect(timed.getFreeForReuseDeadline(a)).toBe(NOT_FREE_TO_REUSE);
            timed.free(a);
            expect(timed.getFreeForReuseDeadline(a)).toBe(1100);
            clockMs.value = 2000;
            expect(timed.allocate('b')).toBe(a); // reuse resets owner and reference id
            expect(timed.getCounterOwnerId(a)).toBe(0);

            expect(plainPuts.map((s) => s.mock.calls.length)).toEqual([0, 0]);
            expect(plainGets.map((s) => s.mock.calls.length)).toEqual([0, 0]);
            expect(releases.every((s) => s.mock.calls.length > 0)).toBe(true);
            expect(volatiles.every((s) => s.mock.calls.length > 0)).toBe(true);
        });
    });
});
