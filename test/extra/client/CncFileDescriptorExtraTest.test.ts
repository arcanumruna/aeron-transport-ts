// Not in Aeron (it has no CncFileDescriptorTest): the CnC layout of CncFileDescriptor on a SharedArrayBuffer (spec D4,
// D15), checked against the offsets worked out by hand from the Java layout, the sections it carves out, the version
// check and the length helpers. Each case names a mutation that turns it red.
import { describe, expect, it } from 'vitest';
import { SemanticVersion } from '../../../src/agrona/SemanticVersion.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { CncFileDescriptor } from '../../../src/client/CncFileDescriptor.js';
import { AeronException } from '../../../src/client/exceptions/AeronException.js';

const MAX_SAFE = 2 ** 53 - 1;

/** A CnC of a given section sizes on a SharedArrayBuffer, its metadata filled in with Java's helpers. */
function newCnc(sections: { toDriver: number; toClients: number; metadata: number; values: number; errors: number }) {
    const total = sections.toDriver + sections.toClients + sections.metadata + sections.values + sections.errors;
    const length = CncFileDescriptor.computeCncFileLength(total, 64);
    const sab = new SharedArrayBuffer(length);
    const metaData = CncFileDescriptor.createMetaDataBuffer(sab);
    return { sab, length, metaData };
}

describe('CncFileDescriptorExtraTest', () => {
    it('the offsets and lengths are the hand computed ones of the Java layout', () => {
        // mutation: change any SIZE_OF_* in the offset chain (for instance START_TIMESTAMP after SIZE_OF_INT)
        expect(CncFileDescriptor.CNC_VERSION_FIELD_OFFSET).toBe(0);
        expect(CncFileDescriptor.TO_DRIVER_BUFFER_LENGTH_FIELD_OFFSET).toBe(4);
        expect(CncFileDescriptor.TO_CLIENTS_BUFFER_LENGTH_FIELD_OFFSET).toBe(8);
        expect(CncFileDescriptor.COUNTERS_METADATA_BUFFER_LENGTH_FIELD_OFFSET).toBe(12);
        expect(CncFileDescriptor.COUNTERS_VALUES_BUFFER_LENGTH_FIELD_OFFSET).toBe(16);
        expect(CncFileDescriptor.ERROR_LOG_BUFFER_LENGTH_FIELD_OFFSET).toBe(20);
        expect(CncFileDescriptor.CLIENT_LIVENESS_TIMEOUT_FIELD_OFFSET).toBe(24);
        expect(CncFileDescriptor.START_TIMESTAMP_FIELD_OFFSET).toBe(32);
        expect(CncFileDescriptor.PID_FIELD_OFFSET).toBe(40);
        expect(CncFileDescriptor.FILE_PAGE_SIZE_FIELD_OFFSET).toBe(48);
        expect(CncFileDescriptor.META_DATA_LENGTH).toBe(128);
        expect(CncFileDescriptor.END_OF_METADATA_OFFSET).toBe(128);
        expect(CncFileDescriptor.CNC_FILE).toBe('cnc.dat');
        // 0.2.0: major << 16 | minor << 8 | patch
        expect(CncFileDescriptor.CNC_VERSION).toBe(512);
    });

    it('the offset helpers add the base offset to the field offset', () => {
        // mutation: return the field offset without baseOffset, or swap two helpers
        const base = 1000;
        expect(CncFileDescriptor.cncVersionOffset(base)).toBe(1000);
        expect(CncFileDescriptor.toDriverBufferLengthOffset(base)).toBe(1004);
        expect(CncFileDescriptor.toClientsBufferLengthOffset(base)).toBe(1008);
        expect(CncFileDescriptor.countersMetaDataBufferLengthOffset(base)).toBe(1012);
        expect(CncFileDescriptor.countersValuesBufferLengthOffset(base)).toBe(1016);
        expect(CncFileDescriptor.errorLogBufferLengthOffset(base)).toBe(1020);
        expect(CncFileDescriptor.clientLivenessTimeoutOffset(base)).toBe(1024);
        expect(CncFileDescriptor.startTimestampOffset(base)).toBe(1032);
        expect(CncFileDescriptor.pidOffset(base)).toBe(1040);
    });

    it.each([
        [0, 64, 128],
        [1, 64, 192],
        [64, 64, 192],
        [65, 64, 256],
        [100, 4096, 4096],
        [4096, 4096, 8192],
    ])('computeCncFileLength(%i, %i) is %i', (total, alignment, expected) => {
        // mutation: leave out META_DATA_LENGTH, or do not align
        expect(CncFileDescriptor.computeCncFileLength(total, alignment)).toBe(expected);
    });

    it.each([
        [1, 2, 3, 4, 5, 1_000_000_000, 1_700_000_000_000, 4242, 4096],
        [4096, 8192, 16384, 32768, 65536, MAX_SAFE, MAX_SAFE, MAX_SAFE, 2 ** 30],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [2 ** 31 - 1, 1, 2 ** 31 - 1, 1, 2 ** 31 - 1, 2 ** 32, 2 ** 32, 2 ** 32 - 1, 2 ** 31 - 1],
        [-1, -1, -1, -1, -1, -1, -1, -1, -1],
    ])(
        'fillMetaData writes every field at its Java offset and the getters read it back (%i, %i, %i, %i, %i, %i, %i, %i, %i)',
        (toDriver, toClients, counterMetaData, counterValues, errorLog, livenessNs, startMs, pid, pageSize) => {
            // mutation: write a field at a neighbour's offset (liveness at 32), or write the pid as an int
            const sab = new SharedArrayBuffer(128);
            const metaData = CncFileDescriptor.createMetaDataBuffer(sab);
            new Uint8Array(sab).fill(0xaa);

            CncFileDescriptor.fillMetaData(
                metaData,
                toDriver,
                toClients,
                counterMetaData,
                counterValues,
                livenessNs,
                errorLog,
                startMs,
                pid,
                pageSize,
            );

            const dv = new DataView(sab);
            expect(dv.getInt32(4, true)).toBe(toDriver);
            expect(dv.getInt32(8, true)).toBe(toClients);
            expect(dv.getInt32(12, true)).toBe(counterMetaData);
            expect(dv.getInt32(16, true)).toBe(counterValues);
            expect(dv.getInt32(20, true)).toBe(errorLog);
            expect(dv.getBigInt64(24, true)).toBe(BigInt(livenessNs));
            expect(dv.getBigInt64(32, true)).toBe(BigInt(startMs));
            expect(dv.getBigInt64(40, true)).toBe(BigInt(pid));
            expect(dv.getInt32(48, true)).toBe(pageSize);
            // the version is not written by fillMetaData, and nothing past the last field is
            expect(dv.getInt32(0, true)).toBe(0xaaaaaaaa | 0);
            expect(dv.getUint8(52)).toBe(0xaa);

            expect(CncFileDescriptor.clientLivenessTimeoutNs(metaData)).toBe(livenessNs);
            expect(CncFileDescriptor.startTimestampMs(metaData)).toBe(startMs);
            expect(CncFileDescriptor.pid(metaData)).toBe(pid);
            expect(CncFileDescriptor.filePageSize(metaData)).toBe(pageSize);
        },
    );

    it('fillMetaData refuses a long outside +/-(2^53 - 1) (D5)', () => {
        // mutation: write the long fields with putLongBigInt and no range check
        const metaData = CncFileDescriptor.createMetaDataBuffer(new SharedArrayBuffer(128));
        expect(() => CncFileDescriptor.fillMetaData(metaData, 1, 1, 1, 1, 2 ** 53, 1, 0, 0, 1)).toThrow(RangeError);
        expect(() => CncFileDescriptor.fillMetaData(metaData, 1, 1, 1, 1, 0, 1, -(2 ** 53), 0, 1)).toThrow(RangeError);
        expect(() => CncFileDescriptor.fillMetaData(metaData, 1, 1, 1, 1, 0, 1, 0, 2 ** 53, 1)).toThrow(RangeError);
    });

    it('signalCncReady publishes the version with a volatile store that another view reads', () => {
        // mutation: write the version before the other fields, or write 0
        const sab = new SharedArrayBuffer(128);
        const writer = CncFileDescriptor.createMetaDataBuffer(sab);
        const reader = new UnsafeBuffer(sab);
        expect(reader.getIntVolatile(CncFileDescriptor.CNC_VERSION_FIELD_OFFSET)).toBe(0);

        CncFileDescriptor.signalCncReady(writer);

        expect(reader.getIntVolatile(CncFileDescriptor.CNC_VERSION_FIELD_OFFSET)).toBe(CncFileDescriptor.CNC_VERSION);
        expect(new Int32Array(sab)[0]).toBe(512);
    });

    it('createMetaDataBuffer wraps the first 128 bytes of the shared buffer', () => {
        // mutation: wrap META_DATA_LENGTH * 2, or start at 128
        const sab = new SharedArrayBuffer(1024);
        const metaData = CncFileDescriptor.createMetaDataBuffer(sab);
        expect(metaData.capacity()).toBe(128);
        metaData.putByte(0, 7);
        metaData.putByte(127, 9);
        expect(new Uint8Array(sab)[0]).toBe(7);
        expect(new Uint8Array(sab)[127]).toBe(9);
        expect(() => metaData.putByte(128, 1)).toThrow();
    });

    it('each section starts after the ones before it and has the length of the metadata', () => {
        // mutation: leave a length out of one of the offset sums (for instance the counters metadata of the values buffer)
        const sections = { toDriver: 256, toClients: 512, metadata: 1024, values: 2048, errors: 4096 };
        const { sab, length, metaData } = newCnc(sections);
        CncFileDescriptor.fillMetaData(
            metaData,
            sections.toDriver,
            sections.toClients,
            sections.metadata,
            sections.values,
            1,
            sections.errors,
            2,
            3,
            4096,
        );
        const bytes = new Uint8Array(sab);

        const expected: Array<[string, UnsafeBuffer, number, number]> = [
            ['toDriver', CncFileDescriptor.createToDriverBuffer(sab, metaData), 128, sections.toDriver],
            ['toClients', CncFileDescriptor.createToClientsBuffer(sab, metaData), 128 + 256, sections.toClients],
            [
                'metadata',
                CncFileDescriptor.createCountersMetaDataBuffer(sab, metaData),
                128 + 256 + 512,
                sections.metadata,
            ],
            [
                'values',
                CncFileDescriptor.createCountersValuesBuffer(sab, metaData),
                128 + 256 + 512 + 1024,
                sections.values,
            ],
            [
                'errors',
                CncFileDescriptor.createErrorLogBuffer(sab, metaData),
                128 + 256 + 512 + 1024 + 2048,
                sections.errors,
            ],
        ];
        let marker = 1;
        for (const [name, buffer, start, size] of expected) {
            expect(buffer.capacity(), name).toBe(size);
            buffer.putByte(0, marker);
            buffer.putByte(size - 1, marker + 100);
            expect(bytes[start], name + ' first byte').toBe(marker);
            expect(bytes[start + size - 1], name + ' last byte').toBe(marker + 100);
            marker++;
        }
        // the sections are one after the other, ending at the end of the data, within the aligned length
        expect(128 + 256 + 512 + 1024 + 2048 + 4096).toBeLessThanOrEqual(length);
        expect(CncFileDescriptor.isCncFileLengthSufficient(metaData, length)).toBe(true);
    });

    it('sections of a CnC of the smallest sizes still carve out without overlap', () => {
        // mutation: use the section length of the previous section
        const sections = { toDriver: 1, toClients: 2, metadata: 3, values: 4, errors: 5 };
        const { sab, metaData } = newCnc(sections);
        CncFileDescriptor.fillMetaData(metaData, 1, 2, 3, 4, 1, 5, 2, 3, 4096);
        const all = [
            CncFileDescriptor.createToDriverBuffer(sab, metaData),
            CncFileDescriptor.createToClientsBuffer(sab, metaData),
            CncFileDescriptor.createCountersMetaDataBuffer(sab, metaData),
            CncFileDescriptor.createCountersValuesBuffer(sab, metaData),
            CncFileDescriptor.createErrorLogBuffer(sab, metaData),
        ];
        expect(all.map((b) => b.capacity())).toEqual([1, 2, 3, 4, 5]);
        all.forEach((b, i) => {
            for (let j = 0; j < b.capacity(); j++) {
                b.putByte(j, i + 1);
            }
        });
        expect([...new Uint8Array(sab, 128, 15)]).toEqual([1, 2, 2, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5]);
    });

    it('isCncFileLengthSufficient is true from the exact sum of the sections and the metadata, false one byte below', () => {
        // mutation: > instead of >=, or leave the metadata length out
        const sections = { toDriver: 100, toClients: 200, metadata: 300, values: 400, errors: 500 };
        const { metaData } = newCnc(sections);
        CncFileDescriptor.fillMetaData(metaData, 100, 200, 300, 400, 1, 500, 2, 3, 4096);
        const required = 128 + 100 + 200 + 300 + 400 + 500;

        expect(CncFileDescriptor.isCncFileLengthSufficient(metaData, required)).toBe(true);
        expect(CncFileDescriptor.isCncFileLengthSufficient(metaData, required - 1)).toBe(false);
        expect(CncFileDescriptor.isCncFileLengthSufficient(metaData, required + 1)).toBe(true);
        expect(CncFileDescriptor.isCncFileLengthSufficient(metaData, 0)).toBe(false);
    });

    describe('checkVersion', () => {
        it('accepts the version itself and any other minor or patch of the same major', () => {
            // mutation: compare the whole version instead of the major
            expect(() => CncFileDescriptor.checkVersion(CncFileDescriptor.CNC_VERSION)).not.toThrow();
            expect(() => CncFileDescriptor.checkVersion(SemanticVersion.compose(0, 3, 0))).not.toThrow();
            expect(() => CncFileDescriptor.checkVersion(SemanticVersion.compose(0, 2, 7))).not.toThrow();
            expect(() => CncFileDescriptor.checkVersion(SemanticVersion.compose(0, 255, 255))).not.toThrow();
        });

        it('a zero version has major 0, the major of 0.2.0, so it is compatible (as in Java)', () => {
            // mutation: treat 0 as "not ready" and throw
            expect(() => CncFileDescriptor.checkVersion(0)).not.toThrow();
        });

        it.each([
            [SemanticVersion.compose(1, 0, 0), '1.0.0'],
            [SemanticVersion.compose(2, 2, 0), '2.2.0'],
            [SemanticVersion.compose(255, 255, 255), '255.255.255'],
        ])('a different major (%i) throws AeronException with the exact message', (version, text) => {
            // mutation: change the message text (no space before app=), or compare the minor
            let thrown: unknown;
            try {
                CncFileDescriptor.checkVersion(version);
            } catch (e) {
                thrown = e;
            }
            expect(thrown).toBeInstanceOf(AeronException);
            expect((thrown as AeronException).message).toBe(
                'ERROR - CnC version not compatible: app=0.2.0 file=' + text,
            );
        });
    });
});
