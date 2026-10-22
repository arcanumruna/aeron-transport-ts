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
// Port of org/agrona/concurrent/status/CountersManagerTest.java @ Agrona 2.6.1
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectBuffer } from '../../../../src/agrona/DirectBuffer.js';
import { AtomicCounter } from '../../../../src/agrona/concurrent/status/AtomicCounter.js';
import { CountersManager } from '../../../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../../../src/agrona/concurrent/status/CountersReader.js';
import type { MetaData } from '../../../../src/agrona/concurrent/status/CountersReader.js';
import type { Position } from '../../../../src/agrona/concurrent/status/Position.js';
import type { ReadablePosition } from '../../../../src/agrona/concurrent/status/ReadablePosition.js';
import { UnsafeBufferPosition } from '../../../../src/agrona/concurrent/status/UnsafeBufferPosition.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { IllegalArgumentException, IllegalStateException, RuntimeException } from '../../../../src/agrona/jdk.js';
import { StandardCharsets } from '../../../../src/agrona/jdkLang.js';
import type { MutableDirectBuffer } from '../../../../src/agrona/MutableDirectBuffer.js';
import { assertThrows } from '../../../support/Assertions.js';
import { ByteBuffer } from '../../../support/ByteBuffer.js';

const {
    COUNTER_LENGTH,
    DEFAULT_OWNER_ID,
    DEFAULT_REFERENCE_ID,
    DEFAULT_REGISTRATION_ID,
    DEFAULT_TYPE_ID,
    MAX_KEY_LENGTH,
    MAX_LABEL_LENGTH,
    METADATA_LENGTH,
    NULL_COUNTER_ID,
} = CountersReader;

const { US_ASCII } = StandardCharsets;

function allocateDirect(capacity: number): ArrayBuffer {
    return ByteBuffer.allocateDirect(capacity).arrayBuffer();
}

describe('CountersManagerTest', () => {
    const NUMBER_OF_COUNTERS = 4;
    const FREE_TO_REUSE_TIMEOUT = 1000;
    const TYPE_ID = 101;
    const LABEL = 'label';

    let currentTimestamp: number;

    let metadataBuffer: UnsafeBuffer;
    let valuesBuffer: UnsafeBuffer;
    let manager: CountersManager;
    let reader: CountersReader;
    let managerWithCooldown: CountersManager;

    let consumer: ReturnType<typeof vi.fn<(counterId: number, label: string) => void>>;
    let metaData: ReturnType<typeof vi.fn<MetaData>>;

    beforeEach(() => {
        currentTimestamp = 0;

        metadataBuffer = new UnsafeBuffer(allocateDirect(NUMBER_OF_COUNTERS * METADATA_LENGTH));
        valuesBuffer = new UnsafeBuffer(allocateDirect(NUMBER_OF_COUNTERS * COUNTER_LENGTH));
        manager = new CountersManager(metadataBuffer, valuesBuffer, US_ASCII);
        reader = new CountersManager(metadataBuffer, valuesBuffer, US_ASCII);
        managerWithCooldown = new CountersManager(
            metadataBuffer,
            valuesBuffer,
            US_ASCII,
            { time: () => currentTimestamp },
            FREE_TO_REUSE_TIMEOUT,
        );

        consumer = vi.fn<(counterId: number, label: string) => void>();
        metaData = vi.fn<MetaData>();
    });

    it('shouldSupportEmptyManager', () => {
        const metadataBuffer = new UnsafeBuffer(allocateDirect(0));
        const valuesBuffer = new UnsafeBuffer(allocateDirect(0));
        const manager = new CountersManager(metadataBuffer, valuesBuffer, US_ASCII);

        expect(manager.maxCounterId()).toBe(-1);
        expect(manager.capacity()).toBe(0);
        expect(manager.available()).toBe(0);
    });

    it('shouldTruncateLongLabel', () => {
        const labelLength = MAX_LABEL_LENGTH + 10;
        let sb = '';

        for (let i = 0; i < labelLength; i++) {
            sb += 'x';
        }

        const label = sb;
        const counterId = manager.allocate(label);

        reader.forEach(consumer);
        expect(consumer).toHaveBeenCalledExactlyOnceWith(counterId, label.substring(0, MAX_LABEL_LENGTH));
    });

    it('shouldCopeWithExceptionKeyFunc', () => {
        const ex = new RuntimeException();

        try {
            manager.allocate(LABEL, DEFAULT_TYPE_ID, () => {
                throw ex;
            });
        } catch (caught) {
            expect(caught).toBe(ex);

            const counter = manager.newCounter('new label');
            try {
                expect(counter.id()).toBe(0);
            } finally {
                counter.close();
            }

            return;
        }

        expect.fail('Should have thrown exception');
    });

    it('shouldStoreLabels', () => {
        const counterId = manager.allocate('abc');
        reader.forEach(consumer);
        expect(consumer).toHaveBeenCalledExactlyOnceWith(counterId, 'abc');
    });

    it('shouldSetRegistrationId', () => {
        const counterId = manager.allocate('abc');
        expect(reader.getCounterRegistrationId(counterId)).toBe(DEFAULT_REGISTRATION_ID);

        const registrationId = 777;
        manager.setCounterRegistrationId(counterId, registrationId);
        expect(reader.getCounterRegistrationId(counterId)).toBe(registrationId);
    });

    it('shouldResetValueAndRegistrationIdIfReused', () => {
        const counterIdOne = manager.allocate('abc');
        expect(reader.getCounterRegistrationId(counterIdOne)).toBe(DEFAULT_REGISTRATION_ID);

        const registrationIdOne = 777;
        manager.setCounterRegistrationId(counterIdOne, registrationIdOne);

        manager.free(counterIdOne);
        const counterIdTwo = manager.allocate('def');
        expect(counterIdTwo).toBe(counterIdOne);
        expect(reader.getCounterRegistrationId(counterIdTwo)).toBe(DEFAULT_REGISTRATION_ID);

        const registrationIdTwo = 333;
        manager.setCounterRegistrationId(counterIdTwo, registrationIdTwo);
        expect(reader.getCounterRegistrationId(counterIdTwo)).toBe(registrationIdTwo);
    });

    it('shouldSetOwnerId', () => {
        const counterId = manager.allocate('abc');
        expect(reader.getCounterOwnerId(counterId)).toBe(DEFAULT_OWNER_ID);

        const ownerId = 444;
        manager.setCounterOwnerId(counterId, ownerId);
        expect(reader.getCounterOwnerId(counterId)).toBe(ownerId);
    });

    it('shouldResetValueAndOwnerIdIfReused', () => {
        const counterIdOne = manager.allocate('abc');
        expect(reader.getCounterOwnerId(counterIdOne)).toBe(DEFAULT_OWNER_ID);

        const ownerIdOne = 444;
        manager.setCounterOwnerId(counterIdOne, ownerIdOne);

        manager.free(counterIdOne);
        const counterIdTwo = manager.allocate('def');
        expect(counterIdTwo).toBe(counterIdOne);
        expect(reader.getCounterOwnerId(counterIdTwo)).toBe(DEFAULT_OWNER_ID);

        const ownerIdTwo = 222;
        manager.setCounterOwnerId(counterIdTwo, ownerIdTwo);
        expect(reader.getCounterOwnerId(counterIdTwo)).toBe(ownerIdTwo);
    });

    it('shouldSetReferenceId', () => {
        const counterId = manager.allocate('abc');
        expect(reader.getCounterReferenceId(counterId)).toBe(DEFAULT_REFERENCE_ID);

        const referenceId = 444;
        manager.setCounterReferenceId(counterId, referenceId);
        expect(reader.getCounterReferenceId(counterId)).toBe(referenceId);
    });

    it('shouldResetValueAndReferenceIdIfReused', () => {
        const counterIdOne = manager.allocate('abc');
        expect(reader.getCounterReferenceId(counterIdOne)).toBe(DEFAULT_REFERENCE_ID);

        const referenceIdOne = 444;
        manager.setCounterReferenceId(counterIdOne, referenceIdOne);

        manager.free(counterIdOne);
        const counterIdTwo = manager.allocate('def');
        expect(counterIdTwo).toBe(counterIdOne);
        expect(reader.getCounterReferenceId(counterIdTwo)).toBe(DEFAULT_REFERENCE_ID);

        const referenceIdTwo = 222;
        manager.setCounterReferenceId(counterIdTwo, referenceIdTwo);
        expect(reader.getCounterReferenceId(counterIdTwo)).toBe(referenceIdTwo);
    });

    it('shouldFindByRegistrationId', () => {
        const registrationId = 777;
        manager.allocate('null');
        const counterId = manager.allocate('abc');
        manager.setCounterRegistrationId(counterId, registrationId);

        expect(manager.findByRegistrationId(1)).toBe(NULL_COUNTER_ID);
        expect(manager.findByRegistrationId(registrationId)).toBe(counterId);
    });

    it('shouldFindByTypeIdAndRegistrationId', () => {
        const registrationId = 777;
        const typeId = 666;
        manager.allocate('null');
        const counterId = manager.allocate('abc', typeId);
        manager.setCounterRegistrationId(counterId, registrationId);

        expect(manager.findByRegistrationId(1)).toBe(NULL_COUNTER_ID);
        expect(manager.findByTypeIdAndRegistrationId(DEFAULT_TYPE_ID, registrationId)).toBe(NULL_COUNTER_ID);
        expect(manager.findByTypeIdAndRegistrationId(typeId, 0)).toBe(NULL_COUNTER_ID);
        expect(manager.findByTypeIdAndRegistrationId(typeId, registrationId)).toBe(counterId);
    });

    it('shouldStoreMultipleLabels', () => {
        const abc = manager.allocate('abc');
        const def = manager.allocate('def');
        const ghi = manager.allocate('ghi');

        reader.forEach(consumer);

        // inOrder.verify(...) x3, then inOrder.verifyNoMoreInteractions()
        expect(consumer.mock.calls).toEqual([
            [abc, 'abc'],
            [def, 'def'],
            [ghi, 'ghi'],
        ]);
    });

    it('shouldFreeAndReuseCounters', () => {
        expect(manager.maxCounterId()).toBe(NUMBER_OF_COUNTERS - 1);
        expect(manager.capacity()).toBe(NUMBER_OF_COUNTERS);
        expect(manager.available()).toBe(NUMBER_OF_COUNTERS);

        const abc = manager.allocate('abc');
        const def = manager.allocate('def');
        const ghi = manager.allocate('ghi');

        expect(manager.available()).toBe(NUMBER_OF_COUNTERS - 3);

        manager.free(def);
        expect(manager.available()).toBe(NUMBER_OF_COUNTERS - 2);

        reader.forEach(consumer);

        // inOrder.verify(...) x2, then inOrder.verifyNoMoreInteractions()
        expect(consumer.mock.calls).toEqual([
            [abc, 'abc'],
            [ghi, 'ghi'],
        ]);

        expect(manager.allocate('the next label')).toBe(def);
        expect(manager.available()).toBe(NUMBER_OF_COUNTERS - 3);
    });

    it('shouldFreeAndNotReuseCountersThatHaveCooldown', () => {
        managerWithCooldown.allocate('abc');
        const def = managerWithCooldown.allocate('def');
        const ghi = managerWithCooldown.allocate('ghi');

        managerWithCooldown.free(def);

        currentTimestamp += FREE_TO_REUSE_TIMEOUT - 1;
        expect(managerWithCooldown.allocate('the next label')).toBe(ghi + 1);
    });

    it('shouldFreeAndReuseCountersAfterCooldown', () => {
        managerWithCooldown.allocate('abc');
        const def = managerWithCooldown.allocate('def');
        managerWithCooldown.allocate('ghi');

        managerWithCooldown.free(def);

        currentTimestamp += FREE_TO_REUSE_TIMEOUT;
        expect(managerWithCooldown.allocate('the next label')).toBe(def);
    });

    it('shouldNotOverAllocateCounters', () => {
        manager.allocate('abc');
        manager.allocate('def');
        manager.allocate('ghi');
        manager.allocate('jkl');

        assertThrows(IllegalStateException, () => manager.allocate('mno'));
    });

    it('shouldMapAllocatedCounters', () => {
        manager.allocate('def');

        const id = manager.allocate('abc');
        const reader: ReadablePosition = new UnsafeBufferPosition(valuesBuffer, id);
        const writer: Position = new UnsafeBufferPosition(valuesBuffer, id);
        const expectedValue = 0xf_ffff_ffff;

        writer.setRelease(expectedValue);

        expect(reader.getVolatile()).toBe(expectedValue);
    });

    it('shouldStoreMetaData', () => {
        const typeIdOne = 333;
        const keyOne = 777;

        const typeIdTwo = 222;
        const keyTwo = 444;

        const counterIdOne = manager.allocate('Test Label One', typeIdOne, (buffer) => buffer.putLong(0, keyOne));
        const counterIdTwo = manager.allocate('Test Label Two', typeIdTwo, (buffer) => buffer.putLong(0, keyTwo));

        manager.forEachMetaData(metaData);

        // inOrder.verify(metaData).accept(eq(..), eq(..), argCaptor.capture(), eq(..)) x2, then verifyNoMoreInteractions
        expect(metaData.mock.calls.length).toBe(2);
        const [firstCall, secondCall] = metaData.mock.calls;
        expect(firstCall!.slice(0, 2)).toEqual([counterIdOne, typeIdOne]);
        expect(firstCall![3]).toBe('Test Label One');
        expect(secondCall!.slice(0, 2)).toEqual([counterIdTwo, typeIdTwo]);
        expect(secondCall![3]).toBe('Test Label Two');

        const keyOneBuffer = firstCall![2];
        expect(keyOneBuffer.getLong(0)).toBe(keyOne);

        const keyTwoBuffer = secondCall![2];
        expect(keyTwoBuffer.getLong(0)).toBe(keyTwo);

        expect(manager.getCounterTypeId(counterIdOne)).toBe(typeIdOne);
        expect(manager.getCounterTypeId(counterIdTwo)).toBe(typeIdTwo);
    });

    it('shouldStoreRawData', () => {
        const typeIdOne = 333;
        const keyOne = 777;
        const keyOneBuffer: MutableDirectBuffer = new UnsafeBuffer(allocateDirect(8));
        keyOneBuffer.putLong(0, keyOne);
        const labelOneBuffer: DirectBuffer = new UnsafeBuffer(US_ASCII.encode('Test Label One'));

        const typeIdTwo = 222;
        const keyTwo = 444;
        const keyTwoBuffer: MutableDirectBuffer = new UnsafeBuffer(allocateDirect(8));
        keyTwoBuffer.putLong(0, keyTwo);
        const labelTwoBuffer: DirectBuffer = new UnsafeBuffer(US_ASCII.encode('Test Label Two'));

        const counterIdOne = manager.allocate(
            typeIdOne,
            keyOneBuffer,
            0,
            keyOneBuffer.capacity(),
            labelOneBuffer,
            0,
            labelOneBuffer.capacity(),
        );

        const counterIdTwo = manager.allocate(
            typeIdTwo,
            keyTwoBuffer,
            0,
            keyTwoBuffer.capacity(),
            labelTwoBuffer,
            0,
            labelTwoBuffer.capacity(),
        );

        manager.forEachMetaData(metaData);

        // inOrder.verify(metaData).accept(eq(..), eq(..), argCaptor.capture(), eq(..)) x2, then verifyNoMoreInteractions
        expect(metaData.mock.calls.length).toBe(2);
        const [firstCall, secondCall] = metaData.mock.calls;
        expect(firstCall!.slice(0, 2)).toEqual([counterIdOne, typeIdOne]);
        expect(firstCall![3]).toBe('Test Label One');
        expect(secondCall!.slice(0, 2)).toEqual([counterIdTwo, typeIdTwo]);
        expect(secondCall![3]).toBe('Test Label Two');

        const keyOneBufferCapture = firstCall![2];
        expect(keyOneBufferCapture.getLong(0)).toBe(keyOne);

        const keyTwoBufferCapture = secondCall![2];
        expect(keyTwoBufferCapture.getLong(0)).toBe(keyTwo);
    });

    it('shouldStoreAndLoadValue', () => {
        const counterId = manager.allocate('Test Counter');

        const value = 7;
        manager.setCounterValue(counterId, value);

        expect(manager.getCounterValue(counterId)).toBe(value);
    });

    it('shouldGetAndUpdateCounterLabel', () => {
        const counter: AtomicCounter = manager.newCounter('original label');
        try {
            expect(counter.label()).toBe('original label');
            counter.updateLabel(counter.label() + ' with update');
            expect(counter.label()).toBe('original label with update');
        } finally {
            counter.close();
        }
    });

    it('shouldGetAndUpdateCounterKeyUsingCallback', () => {
        const originalKey = 'original key';
        const updatedKey = 'updated key';

        const counter = manager.newCounter(LABEL, TYPE_ID, (keyBuffer) => keyBuffer.putStringUtf8(0, originalKey));
        try {
            const keyExtractor = new StringKeyExtractor(counter.id());

            manager.forEachMetaData(keyExtractor.accept);
            expect(keyExtractor.key).toBe(originalKey);

            manager.setCounterKey(counter.id(), (keyBuffer) => keyBuffer.putStringUtf8(0, updatedKey));

            manager.forEachMetaData(keyExtractor.accept);
            expect(keyExtractor.key).toBe(updatedKey);
        } finally {
            counter.close();
        }
    });

    it('shouldGetAndUpdateCounterKey', () => {
        const originalKey = 'original key';
        const updatedKey = 'updated key';

        const counter = manager.newCounter(LABEL, TYPE_ID, (keyBuffer) => keyBuffer.putStringUtf8(0, originalKey));
        try {
            const keyExtractor = new StringKeyExtractor(counter.id());

            manager.forEachMetaData(keyExtractor.accept);

            expect(keyExtractor.key).toBe(originalKey);

            const tempBuffer = new UnsafeBuffer(new Uint8Array(128));
            const length = tempBuffer.putStringUtf8(0, updatedKey);

            manager.setCounterKey(counter.id(), tempBuffer, 0, length);

            manager.forEachMetaData(keyExtractor.accept);
            expect(keyExtractor.key).toBe(updatedKey);
        } finally {
            counter.close();
        }
    });

    it('shouldRejectOversizeKeys', () => {
        const originalKey = 'original key';

        const counter = manager.newCounter(LABEL, TYPE_ID, (keyBuffer) => keyBuffer.putStringUtf8(0, originalKey));
        try {
            const tempBuffer = new UnsafeBuffer(new Uint8Array(256));

            try {
                manager.setCounterKey(counter.id(), tempBuffer, 0, MAX_KEY_LENGTH + 1);
                expect.fail('Should have thrown exception');
            } catch (e) {
                if (!(e instanceof IllegalArgumentException)) {
                    throw e;
                }

                expect(true).toBe(true);
            }
        } finally {
            counter.close();
        }
    });

    class StringKeyExtractor {
        private readonly id: number;
        public key: string | null = null;

        public constructor(id: number) {
            this.id = id;
        }

        public readonly accept: MetaData = (counterId, typeId, keyBuffer, label) => {
            if (counterId === this.id && typeId === TYPE_ID) {
                expect(label).toBe(LABEL);
                this.key = keyBuffer.getStringUtf8(0);
            }
        };
    }

    it('shouldAppendLabel', () => {
        const counter = manager.newCounter('original label');
        try {
            expect(counter.label()).toBe('original label');
            counter.appendToLabel(' with update');
            expect(counter.label()).toBe('original label with update');
        } finally {
            counter.close();
        }
    });
});
