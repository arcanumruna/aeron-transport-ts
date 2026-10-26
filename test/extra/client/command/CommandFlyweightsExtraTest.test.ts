// Not in Aeron: every command flyweight of io.aeron.command, checked against the byte layout of the Java source (offsets
// worked out by hand from the field declarations), with `long` fields at the D5 bounds, strings at length 0, 1 and the
// longest the buffer holds, the computed lengths and the exact exceptions of `validateLength`.
// Each case names, in a comment, a mutation of the port that turns it red; the mutations that were run are listed in the
// task report.
import { describe, expect, it } from 'vitest';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { IndexOutOfBoundsException, type Appendable } from '../../../../src/agrona/jdk.js';
import { Inet4Address, Inet6Address, InetAddress, InetSocketAddress } from '../../../../src/driver/jdkNet.js';
import { ClientTimeoutFlyweight } from '../../../../src/client/command/ClientTimeoutFlyweight.js';
import { CorrelatedMessageFlyweight } from '../../../../src/client/command/CorrelatedMessageFlyweight.js';
import { DestinationByIdMessageFlyweight } from '../../../../src/client/command/DestinationByIdMessageFlyweight.js';
import { DestinationMessageFlyweight } from '../../../../src/client/command/DestinationMessageFlyweight.js';
import { ErrorResponseFlyweight } from '../../../../src/client/command/ErrorResponseFlyweight.js';
import { ImageBuffersReadyFlyweight } from '../../../../src/client/command/ImageBuffersReadyFlyweight.js';
import { ImageMessageFlyweight } from '../../../../src/client/command/ImageMessageFlyweight.js';
import { OperationSucceededFlyweight } from '../../../../src/client/command/OperationSucceededFlyweight.js';
import { PublicationBuffersReadyFlyweight } from '../../../../src/client/command/PublicationBuffersReadyFlyweight.js';
import { PublicationErrorFrameFlyweight } from '../../../../src/client/command/PublicationErrorFrameFlyweight.js';
import { PublicationMessageFlyweight } from '../../../../src/client/command/PublicationMessageFlyweight.js';
import { RejectImageFlyweight } from '../../../../src/client/command/RejectImageFlyweight.js';
import { RemoveMessageFlyweight } from '../../../../src/client/command/RemoveMessageFlyweight.js';
import { RemovePublicationFlyweight } from '../../../../src/client/command/RemovePublicationFlyweight.js';
import { RemoveSubscriptionFlyweight } from '../../../../src/client/command/RemoveSubscriptionFlyweight.js';
import { SubscriptionMessageFlyweight } from '../../../../src/client/command/SubscriptionMessageFlyweight.js';
import { SubscriptionReadyFlyweight } from '../../../../src/client/command/SubscriptionReadyFlyweight.js';
import { TerminateDriverFlyweight } from '../../../../src/client/command/TerminateDriverFlyweight.js';
import { ErrorCode } from '../../../../src/client/ErrorCode.js';
import { ConfigurationException } from '../../../../src/client/exceptions/ConfigurationException.js';
import { ControlProtocolException } from '../../../../src/client/exceptions/ControlProtocolException.js';

/** The window of a flyweight starts here, so that an offset that ignores `wrap`'s offset shows. */
const BASE = 8;
/** Bytes that no flyweight writes read back as this. */
const FILL = 0xaa;

const MAX_SAFE = 2 ** 53 - 1;
/** The D5 bounds and the values around the 32 bit boundaries. */
const LONGS = [MAX_SAFE, -MAX_SAFE, 0, -1, 1, 2 ** 32, 2 ** 32 - 1, -(2 ** 32), 2 ** 31, -(2 ** 31)];
/** Seeded xorshift64*, so that the random 64 bit case is the same on every run. */
function seededInt64(seed: bigint): bigint {
    let x = seed;
    const mask = (1n << 64n) - 1n;
    x ^= x >> 12n;
    x ^= (x << 25n) & mask;
    x ^= x >> 27n;
    return BigInt.asIntN(64, (x * 0x2545f4914f6cdd1dn) & mask);
}
const BIGS = [-(2n ** 63n), 2n ** 63n - 1n, 0n, -1n, 2n ** 53n, seededInt64(0x9e3779b97f4a7c15n)];
const INTS = [-(2 ** 31), -1, 0, 1, 2 ** 31 - 1];

interface Window {
    ab: ArrayBuffer;
    buffer: UnsafeBuffer;
    dv: DataView;
}

function newWindow(size: number): Window {
    const ab = new ArrayBuffer(size);
    new Uint8Array(ab).fill(FILL);
    return { ab, buffer: new UnsafeBuffer(ab), dv: new DataView(ab) };
}

type Accessor = { (): number; (value: number): unknown };

function accessor(flyweight: object, name: string): Accessor {
    const method = (flyweight as unknown as Record<string, Accessor>)[name];
    if (typeof method !== 'function') {
        throw new Error('no accessor ' + name);
    }
    return method.bind(flyweight) as Accessor;
}

/** The ascii text of a given length. */
function text(length: number): string {
    let s = '';
    for (let i = 0; i < length; i++) {
        s += String.fromCharCode(97 + (i % 26));
    }
    return s;
}

function collector(): Appendable & { text(): string } {
    let s = '';
    const appendable = {
        append(c: string) {
            s += c;
            return appendable;
        },
        text: () => s,
    };
    return appendable as Appendable & { text(): string };
}

interface Wrappable {
    wrap(buffer: UnsafeBuffer, offset: number): unknown;
}

interface Spec {
    name: string;
    make: () => Wrappable;
    /** field name to its offset in the message */
    longs: Record<string, number>;
    /** Opaque 64 bit wire values (spec 5.2): `bigint` accessors. */
    bigs?: Record<string, number>;
    ints: Record<string, number>;
}

const SPECS: Spec[] = [
    {
        name: 'CorrelatedMessageFlyweight',
        make: () => new CorrelatedMessageFlyweight(),
        longs: { clientId: 0, correlationId: 8 },
        ints: {},
    },
    { name: 'ClientTimeoutFlyweight', make: () => new ClientTimeoutFlyweight(), longs: { clientId: 0 }, ints: {} },
    {
        name: 'OperationSucceededFlyweight',
        make: () => new OperationSucceededFlyweight(),
        longs: { correlationId: 0 },
        ints: {},
    },
    {
        name: 'RemoveSubscriptionFlyweight',
        make: () => new RemoveSubscriptionFlyweight(),
        longs: { clientId: 0, correlationId: 8, registrationId: 16 },
        ints: {},
    },
    {
        name: 'RemovePublicationFlyweight',
        make: () => new RemovePublicationFlyweight(),
        longs: { clientId: 0, correlationId: 8, registrationId: 16 },
        ints: {},
    },
    {
        name: 'DestinationByIdMessageFlyweight',
        make: () => new DestinationByIdMessageFlyweight(),
        longs: { clientId: 0, correlationId: 8, resourceRegistrationId: 16, destinationRegistrationId: 24 },
        ints: {},
    },
    {
        name: 'DestinationMessageFlyweight',
        make: () => new DestinationMessageFlyweight(),
        longs: { clientId: 0, correlationId: 8, registrationCorrelationId: 16 },
        ints: {},
    },
    {
        name: 'PublicationMessageFlyweight',
        make: () => new PublicationMessageFlyweight(),
        longs: { clientId: 0, correlationId: 8 },
        ints: { streamId: 16 },
    },
    {
        name: 'SubscriptionMessageFlyweight',
        make: () => new SubscriptionMessageFlyweight(),
        longs: { clientId: 0, correlationId: 8, registrationCorrelationId: 16 },
        ints: { streamId: 24 },
    },
    {
        name: 'ErrorResponseFlyweight',
        make: () => new ErrorResponseFlyweight(),
        longs: { offendingCommandCorrelationId: 0 },
        ints: { errorCodeValue: 8 },
    },
    {
        name: 'SubscriptionReadyFlyweight',
        make: () => new SubscriptionReadyFlyweight(),
        longs: { correlationId: 0 },
        ints: { channelStatusCounterId: 8 },
    },
    {
        name: 'ImageMessageFlyweight',
        make: () => new ImageMessageFlyweight(),
        longs: { correlationId: 0, subscriptionRegistrationId: 8 },
        ints: { streamId: 16 },
    },
    {
        name: 'ImageBuffersReadyFlyweight',
        make: () => new ImageBuffersReadyFlyweight(),
        longs: { correlationId: 0, subscriptionRegistrationId: 16 },
        ints: { sessionId: 8, streamId: 12, subscriberPositionId: 24 },
    },
    {
        name: 'PublicationBuffersReadyFlyweight',
        make: () => new PublicationBuffersReadyFlyweight(),
        longs: { correlationId: 0, registrationId: 8 },
        ints: { sessionId: 16, streamId: 20, publicationLimitCounterId: 24, channelStatusCounterId: 28 },
    },
    {
        name: 'RejectImageFlyweight',
        make: () => new RejectImageFlyweight(),
        longs: { clientId: 0, correlationId: 8, imageCorrelationId: 16, position: 24 },
        ints: {},
    },
    {
        name: 'TerminateDriverFlyweight',
        make: () => new TerminateDriverFlyweight(),
        longs: { clientId: 0, correlationId: 8 },
        ints: {},
    },
    {
        name: 'PublicationErrorFrameFlyweight',
        make: () => new PublicationErrorFrameFlyweight(),
        longs: { registrationId: 0, destinationRegistrationId: 8 },
        bigs: { receiverId: 24, groupTag: 32 },
        ints: { sessionId: 16, streamId: 20, errorCodeValue: 60 },
    },
];

/** `errorCodeValue` has a getter only: it is written through `errorCode(ErrorCode)`. */
function setInt(flyweight: object, name: string, value: number): void {
    if ('errorCodeValue' === name) {
        // a code is its `int` value on the wire, so write that through the raw buffer path of errorCode(): use a stub code
        (flyweight as unknown as { errorCode(c: { value(): number }): unknown }).errorCode({ value: () => value });
    } else {
        accessor(flyweight, name)(value);
    }
}

describe('CommandFlyweightsExtraTest', () => {
    describe.each(SPECS)('$name fields', ({ make, longs, ints, bigs = {} }) => {
        const bigCases = Object.entries(bigs).flatMap(([field, offset]) =>
            BIGS.map((v) => [field, offset, v] as const),
        );

        it.each(bigCases)('bigint %s at %i round trips %d exactly', (field, offset, value) => {
            // mutation: read or write the opaque 64 bit field as a number (throws or rounds above 2^53)
            const { buffer, dv } = newWindow(256);
            const flyweight = make();
            flyweight.wrap(buffer, BASE);
            const big = (flyweight as unknown as Record<string, (v?: bigint) => bigint>)[field]!.bind(flyweight);

            big(value);

            expect(big()).toBe(value);
            expect(dv.getBigInt64(BASE + offset, true)).toBe(value);
            expect(dv.getUint8(BASE + offset - 1)).toBe(FILL);
            expect(dv.getUint8(BASE + offset + 8)).toBe(FILL);
        });

        it.each(Object.keys(bigs))('bigint %s refuses 2^63 and -2^63-1 and writes nothing', (field) => {
            const { buffer, ab } = newWindow(256);
            const flyweight = make();
            flyweight.wrap(buffer, BASE);
            const big = (flyweight as unknown as Record<string, (v?: bigint) => unknown>)[field]!.bind(flyweight);
            const before = new Uint8Array(ab).slice();

            expect(() => big(2n ** 63n)).toThrow();
            expect(() => big(-(2n ** 63n) - 1n)).toThrow();
            expect(new Uint8Array(ab)).toEqual(before);
        });

        const longCases = Object.entries(longs).flatMap(([field, offset]) =>
            LONGS.map((v) => [field, offset, v] as const),
        );

        it.each(longCases)('long %s at %i round trips %d exactly', (field, offset, value) => {
            // mutation: read or write a field at the wrong offset (offset + 8), or ignore wrap's offset (use 0)
            const { buffer, dv } = newWindow(256);
            const flyweight = make();
            flyweight.wrap(buffer, BASE);

            accessor(flyweight, field)(value);

            expect(accessor(flyweight, field)()).toBe(value);
            expect(dv.getBigInt64(BASE + offset, true)).toBe(BigInt(value));
            // the neighbours are untouched
            expect(dv.getUint8(BASE + offset - 1)).toBe(FILL);
            expect(dv.getUint8(BASE + offset + 8)).toBe(FILL);
        });

        it.each(Object.keys(longs))('long %s refuses 2^53 and -2^53 and writes nothing (D5)', (field) => {
            // mutation: write the long as two ints without the D5 range check
            const { buffer, ab } = newWindow(256);
            const flyweight = make();
            flyweight.wrap(buffer, BASE);
            const before = new Uint8Array(ab).slice();

            expect(() => accessor(flyweight, field)(2 ** 53)).toThrow(RangeError);
            expect(() => accessor(flyweight, field)(-(2 ** 53))).toThrow(RangeError);
            expect(new Uint8Array(ab)).toEqual(before);
        });

        const intCases = Object.entries(ints).flatMap(([field, offset]) =>
            INTS.map((v) => [field, offset, v] as const),
        );

        it.each(intCases)('int %s at %i round trips %d', (field, offset, value) => {
            // mutation: swap an int offset with the one next to it, or write big endian
            const { buffer, dv } = newWindow(256);
            const flyweight = make();
            flyweight.wrap(buffer, BASE);

            setInt(flyweight, field, value);

            expect(accessor(flyweight, field)()).toBe(value);
            expect(dv.getInt32(BASE + offset, true)).toBe(value);
            expect(dv.getUint8(BASE + offset - 1)).toBe(FILL);
            expect(dv.getUint8(BASE + offset + 4)).toBe(FILL);
        });

        it('keeps every field apart: all set to different values, all read back', () => {
            // mutation: two fields share an offset, so that the second write overwrites the first
            const { buffer } = newWindow(256);
            const flyweight = make();
            flyweight.wrap(buffer, BASE);
            const expected: Array<[string, number]> = [];
            let n = 1;
            for (const field of Object.keys(longs)) {
                const value = n * 2 ** 33 + n;
                setInt(flyweight, field, value);
                expected.push([field, value]);
                n++;
            }
            const bigExpected: Array<[string, bigint]> = [];
            for (const field of Object.keys(bigs)) {
                const value = BigInt(n) * 0x1000000000001n * -1n;
                (flyweight as unknown as Record<string, (v: bigint) => unknown>)[field]!(value);
                bigExpected.push([field, value]);
                n++;
            }
            for (const field of Object.keys(ints)) {
                const value = -(n * 1000 + 7);
                setInt(flyweight, field, value);
                expected.push([field, value]);
                n++;
            }
            for (const [field, value] of expected) {
                expect(accessor(flyweight, field)(), field).toBe(value);
            }
            for (const [field, value] of bigExpected) {
                expect((flyweight as unknown as Record<string, () => bigint>)[field]!(), field).toBe(value);
            }
        });
    });

    describe('fluent setters', () => {
        it('return the flyweight itself, typed as the subclass', () => {
            // mutation: a setter returns undefined, or a subclass returns the base type's instance
            const { buffer } = newWindow(256);
            const reject = new RejectImageFlyweight().wrap(buffer, BASE);
            expect(reject.clientId(1)).toBe(reject);
            expect(reject.correlationId(2)).toBe(reject);
            expect(reject.imageCorrelationId(3)).toBe(reject);
            expect(reject.position(4)).toBe(reject);
            expect(reject.reason('r')).toBe(reject);
            expect(reject.clientId()).toBe(1);
            expect(reject.correlationId()).toBe(2);

            const publication = new RemovePublicationFlyweight().wrap(buffer, BASE);
            expect(publication.registrationId(5)).toBe(publication);
            expect(publication.revoke(true)).toBe(publication);
            const destination = new DestinationMessageFlyweight().wrap(buffer, BASE);
            expect(destination.channel('x')).toBe(destination);
            expect(destination.registrationCorrelationId(1)).toBe(destination);
            const image = new ImageBuffersReadyFlyweight().wrap(buffer, BASE);
            expect(image.logFileName('l')).toBe(image);
            expect(image.sourceIdentity('s')).toBe(image);
            const terminate = new TerminateDriverFlyweight().wrap(buffer, BASE);
            expect(terminate.tokenBuffer(null, 0, 0)).toBe(terminate);
        });
    });

    describe('lengths', () => {
        it('constants are the hand computed byte counts of the Java layout', () => {
            // mutation: change any SIZE_OF_* in a constant (for instance LENGTH = SIZE_OF_LONG for the correlated header)
            expect(CorrelatedMessageFlyweight.LENGTH).toBe(16);
            expect(ClientTimeoutFlyweight.LENGTH).toBe(8);
            expect(OperationSucceededFlyweight.LENGTH).toBe(8);
            expect(SubscriptionReadyFlyweight.LENGTH).toBe(12);
            expect(DestinationByIdMessageFlyweight.MESSAGE_LENGTH).toBe(32);
            expect(RemoveMessageFlyweight.length()).toBe(24);
            expect(RemoveSubscriptionFlyweight.length()).toBe(24);
            expect(RemovePublicationFlyweight.length()).toBe(32);
            expect(TerminateDriverFlyweight.TOKEN_BUFFER_OFFSET).toBe(20);
            expect(CorrelatedMessageFlyweight.CORRELATION_ID_FIELD_OFFSET).toBe(8);
            expect(RemoveMessageFlyweight.REGISTRATION_ID_FIELD_OFFSET).toBe(16);
        });

        it.each([0, 1, 5, 1000])('computeLength for %i bytes of channel, token or reason', (n) => {
            // mutation: MINIMUM_LENGTH off by SIZE_OF_INT in any of the five
            expect(DestinationMessageFlyweight.computeLength(n)).toBe(28 + n);
            expect(PublicationMessageFlyweight.computeLength(n)).toBe(24 + n);
            expect(SubscriptionMessageFlyweight.computeLength(n)).toBe(32 + n);
            expect(TerminateDriverFlyweight.computeLength(n)).toBe(20 + n);
            expect(RejectImageFlyweight.computeLength(text(n))).toBe(36 + n);
        });

        it('TerminateDriverFlyweight.computeLength refuses a negative token length', () => {
            // mutation: drop the < 0 check
            expect(() => TerminateDriverFlyweight.computeLength(-1)).toThrow(ConfigurationException);
            expect(() => TerminateDriverFlyweight.computeLength(-1)).toThrow('token length must be >= 0: -1');
            expect(TerminateDriverFlyweight.computeLength(0)).toBe(20);
        });
    });

    describe('validateLength', () => {
        /** [flyweight, command id, shortest valid length] */
        const fixed: Array<[string, () => CorrelatedMessageFlyweight, number]> = [
            ['CorrelatedMessageFlyweight', () => new CorrelatedMessageFlyweight(), 16],
            ['RemoveSubscriptionFlyweight', () => new RemoveSubscriptionFlyweight(), 24],
            ['RemovePublicationFlyweight', () => new RemovePublicationFlyweight(), 24],
            ['DestinationByIdMessageFlyweight', () => new DestinationByIdMessageFlyweight(), 32],
        ];

        it.each(fixed)(
            "%s: one byte short throws Java's exception and message, the minimum does not",
            (_n, make, min) => {
                // mutation: change < to <= in the comparison, or drop the msgTypeId from the message
                const { buffer } = newWindow(256);
                const flyweight = make();
                flyweight.wrap(buffer, BASE);

                let thrown: unknown;
                try {
                    flyweight.validateLength(0x0e, min - 1);
                } catch (e) {
                    thrown = e;
                }
                expect(thrown).toBeInstanceOf(ControlProtocolException);
                expect((thrown as ControlProtocolException).message).toBe(
                    'ERROR - command=14 too short: length=' + (min - 1),
                );
                expect((thrown as ControlProtocolException).errorCode()).toBe(ErrorCode.MALFORMED_COMMAND);
                expect(() => flyweight.validateLength(0x0e, min)).not.toThrow();
                expect(() => flyweight.validateLength(0x0e, min + 1000)).not.toThrow();
                expect(() => flyweight.validateLength(0x0e, 0)).toThrow('command=14 too short: length=0');
                expect(() => flyweight.validateLength(1, -1)).toThrow('command=1 too short: length=-1');
            },
        );

        /** [name, make, minimum length, offset of the length field, message of the second check] */
        const variable: Array<[string, () => CorrelatedMessageFlyweight, number, number, string]> = [
            ['DestinationMessageFlyweight', () => new DestinationMessageFlyweight(), 28, 24, 'channel'],
            ['PublicationMessageFlyweight', () => new PublicationMessageFlyweight(), 24, 20, 'channel'],
            ['SubscriptionMessageFlyweight', () => new SubscriptionMessageFlyweight(), 32, 28, 'channel'],
            ['TerminateDriverFlyweight', () => new TerminateDriverFlyweight(), 20, 16, 'token buffer'],
        ];

        it.each(variable)(
            '%s: too short, then too short for the field it carries',
            (_n, make, min, lengthOffset, what) => {
                // mutation: swap the two messages, or check (length - min) <= field instead of <
                const { buffer } = newWindow(256);
                const flyweight = make();
                flyweight.wrap(buffer, BASE);
                buffer.putInt(BASE + lengthOffset, 10);

                expect(() => flyweight.validateLength(7, min - 1)).toThrow(
                    new ControlProtocolException(
                        ErrorCode.MALFORMED_COMMAND,
                        'command=7 too short: length=' + (min - 1),
                    ),
                );
                let thrown: unknown;
                try {
                    flyweight.validateLength(7, min + 9);
                } catch (e) {
                    thrown = e;
                }
                expect(thrown).toBeInstanceOf(ControlProtocolException);
                expect((thrown as ControlProtocolException).message).toBe(
                    'ERROR - command=7 too short for ' + what + ': length=' + (min + 9),
                );
                expect(() => flyweight.validateLength(7, min + 10)).not.toThrow();
                // a field that claims a length of zero needs nothing more than the minimum
                buffer.putInt(BASE + lengthOffset, 0);
                expect(() => flyweight.validateLength(7, min)).not.toThrow();
            },
        );

        it('RejectImageFlyweight: both checks give the same message', () => {
            // mutation: drop the second check (reason longer than the message)
            const { buffer } = newWindow(256);
            const flyweight = new RejectImageFlyweight().wrap(buffer, BASE);
            flyweight.reason(text(10));

            expect(() => flyweight.validateLength(0x10, 35)).toThrow('command=16 too short: length=35');
            expect(() => flyweight.validateLength(0x10, 36 + 9)).toThrow('command=16 too short: length=45');
            expect(() => flyweight.validateLength(0x10, 36 + 10)).not.toThrow();
        });

        it("a negative length field in the buffer cannot make a short message valid beyond Java's arithmetic", () => {
            // mutation: compare with the length field read as unsigned
            const { buffer } = newWindow(256);
            const flyweight = new PublicationMessageFlyweight().wrap(buffer, BASE);
            buffer.putInt(BASE + 20, -1);
            // length - 24 < -1 is false for length >= 23, as in Java
            expect(() => flyweight.validateLength(3, 24)).not.toThrow();
        });
    });

    describe('RemovePublicationFlyweight flags', () => {
        function wrapped(initial: number[]): {
            flyweight: RemovePublicationFlyweight;
            dv: DataView;
            buffer: UnsafeBuffer;
        } {
            const { buffer, dv } = newWindow(256);
            for (let i = 0; i < 8; i++) {
                dv.setUint8(BASE + 24 + i, initial[i]!);
            }
            return { flyweight: new RemovePublicationFlyweight().wrap(buffer, BASE), dv, buffer };
        }

        it('revoke(true) sets bit 0 only, revoke(false) clears bit 0 only', () => {
            // mutation: set the whole word to 1, or clear to 0
            const { flyweight, dv } = wrapped([0xfe, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]);
            expect(flyweight.revoke()).toBe(false);

            flyweight.revoke(true);
            expect(dv.getBigInt64(BASE + 24, true)).toBe(0x7fffffffffffffffn);
            expect(flyweight.revoke()).toBe(true);

            flyweight.revoke(false);
            expect(dv.getBigInt64(BASE + 24, true)).toBe(0x7ffffffffffffffen);
            expect(flyweight.revoke()).toBe(false);
        });

        it('a flags word outside the D5 range (set by a peer) does not throw and keeps its other bits', () => {
            // mutation: read or write the flags with getLong / putLong
            const { flyweight, dv } = wrapped([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]);

            expect(flyweight.revoke()).toBe(true);
            flyweight.revoke(false);
            expect(dv.getBigInt64(BASE + 24, true)).toBe(0x7ffffffffffffffen);
            flyweight.revoke(true);
            expect(dv.getBigInt64(BASE + 24, true)).toBe(0x7fffffffffffffffn);
        });

        it('a negative flags word: -1 has bit 0 set, -2 does not', () => {
            // mutation: compare (flags & 1) with 1 using a signed 64 bit value that was truncated to 53 bits
            const minusOne = wrapped([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
            expect(minusOne.flyweight.revoke()).toBe(true);
            minusOne.flyweight.revoke(false);
            expect(minusOne.dv.getBigInt64(BASE + 24, true)).toBe(-2n);
        });

        it('flagsFieldIsValid and revoke(messageLength) need the full 8 bytes of the flags', () => {
            // mutation: > instead of >= in flagsFieldIsValid
            const { flyweight } = wrapped([1, 0, 0, 0, 0, 0, 0, 0]);
            expect(flyweight.flagsFieldIsValid(31)).toBe(false);
            expect(flyweight.flagsFieldIsValid(32)).toBe(true);
            expect(flyweight.flagsFieldIsValid(0)).toBe(false);
            expect(flyweight.revoke(31)).toBe(false);
            expect(flyweight.revoke(32)).toBe(true);
            expect(flyweight.revoke()).toBe(true);
        });
    });

    // the flyweights with a string at a known offset
    interface StringSpec {
        name: string;
        /** offset of the int length in the message */
        offset: number;
        make: () => Wrappable;
        set: (f: Wrappable, s: string) => unknown;
        get: (f: Wrappable) => string;
        /** the length() after the string was set, as worked out from the Java source */
        length: (f: Wrappable, n: number) => { actual: number; expected: number };
        append: (f: Wrappable, a: Appendable) => void;
        /** room that `length` needs beyond the string (the source identity of the image message) */
        extra?: number;
    }

    const STRINGS: StringSpec[] = [
        {
            name: 'DestinationMessageFlyweight.channel',
            offset: 24,
            make: () => new DestinationMessageFlyweight(),
            set: (f, s) => (f as DestinationMessageFlyweight).channel(s),
            get: (f) => (f as DestinationMessageFlyweight).channel(),
            length: (f, n) => ({ actual: (f as DestinationMessageFlyweight).length(), expected: 24 + 4 + n }),
            append: (f, a) => (f as DestinationMessageFlyweight).appendChannel(a),
        },
        {
            name: 'PublicationMessageFlyweight.channel',
            offset: 20,
            make: () => new PublicationMessageFlyweight(),
            set: (f, s) => (f as PublicationMessageFlyweight).channel(s),
            get: (f) => (f as PublicationMessageFlyweight).channel(),
            length: (f, n) => ({ actual: (f as PublicationMessageFlyweight).length(), expected: 20 + 4 + n }),
            append: (f, a) => (f as PublicationMessageFlyweight).appendChannel(a),
        },
        {
            name: 'SubscriptionMessageFlyweight.channel',
            offset: 28,
            make: () => new SubscriptionMessageFlyweight(),
            set: (f, s) => (f as SubscriptionMessageFlyweight).channel(s),
            get: (f) => (f as SubscriptionMessageFlyweight).channel(),
            length: (f, n) => ({ actual: (f as SubscriptionMessageFlyweight).length(), expected: 28 + 4 + n }),
            append: (f, a) => (f as SubscriptionMessageFlyweight).appendChannel(a),
        },
        {
            name: 'ErrorResponseFlyweight.errorMessage',
            offset: 12,
            make: () => new ErrorResponseFlyweight(),
            set: (f, s) => (f as ErrorResponseFlyweight).errorMessage(s),
            get: (f) => (f as ErrorResponseFlyweight).errorMessage(),
            length: (f, n) => ({ actual: (f as ErrorResponseFlyweight).length(), expected: 12 + 4 + n }),
            append: (f, a) => {
                (f as ErrorResponseFlyweight).appendMessage(a);
            },
        },
        {
            name: 'ImageMessageFlyweight.channel',
            offset: 20,
            make: () => new ImageMessageFlyweight(),
            set: (f, s) => (f as ImageMessageFlyweight).channel(s),
            get: (f) => (f as ImageMessageFlyweight).channel(),
            length: (f, n) => ({ actual: (f as ImageMessageFlyweight).length(), expected: 20 + 4 + n }),
            append: (f, a) => (f as ImageMessageFlyweight).appendChannel(a),
        },
        {
            name: 'ImageBuffersReadyFlyweight.logFileName',
            offset: 28,
            make: () => new ImageBuffersReadyFlyweight(),
            set: (f, s) => (f as ImageBuffersReadyFlyweight).logFileName(s),
            get: (f) => (f as ImageBuffersReadyFlyweight).logFileName(),
            // the source identity follows the log file name aligned to 4, and length() ends after the source identity
            length: (f, n) => {
                const flyweight = f as ImageBuffersReadyFlyweight;
                flyweight.sourceIdentity('');
                return { actual: flyweight.length(), expected: 28 + 4 + Math.ceil(n / 4) * 4 + 4 };
            },
            append: (f, a) => (f as ImageBuffersReadyFlyweight).appendLogFileName(a),
            extra: 8,
        },
        {
            name: 'PublicationBuffersReadyFlyweight.logFileName',
            offset: 32,
            make: () => new PublicationBuffersReadyFlyweight(),
            set: (f, s) => (f as PublicationBuffersReadyFlyweight).logFileName(s),
            get: (f) => (f as PublicationBuffersReadyFlyweight).logFileName(),
            length: (f, n) => ({ actual: (f as PublicationBuffersReadyFlyweight).length(), expected: 32 + 4 + n }),
            append: (f, a) => (f as PublicationBuffersReadyFlyweight).appendLogFileName(a),
        },
        {
            name: 'RejectImageFlyweight.reason',
            offset: 32,
            make: () => new RejectImageFlyweight(),
            set: (f, s) => (f as RejectImageFlyweight).reason(s),
            get: (f) => (f as RejectImageFlyweight).reason(),
            length: (f, n) => ({ actual: (f as RejectImageFlyweight).reasonBufferLength(), expected: n }),
            append: () => {},
        },
        {
            name: 'PublicationErrorFrameFlyweight.errorMessage',
            offset: 64,
            make: () => new PublicationErrorFrameFlyweight(),
            set: (f, s) => (f as PublicationErrorFrameFlyweight).errorMessage(s),
            get: (f) => (f as PublicationErrorFrameFlyweight).errorMessage(),
            length: (f, n) => ({ actual: (f as PublicationErrorFrameFlyweight).length(), expected: 64 + 4 + n }),
            append: (f, a) => {
                (f as PublicationErrorFrameFlyweight).appendMessage(a);
            },
        },
    ];

    describe.each(STRINGS)('$name', ({ offset, make, set, get, length, append, extra = 0 }) => {
        const MAX = 37;

        it.each([0, 1, MAX])(
            'a string of %i characters is stored as an int length and the bytes, and read back',
            (n) => {
                // mutation: store the length as n + 4, write the bytes at offset + 8, or drop the last byte
                const { buffer, dv } = newWindow(BASE + offset + 4 + MAX + extra);
                const flyweight = make();
                flyweight.wrap(buffer, BASE);
                const s = text(n);

                set(flyweight, s);

                expect(get(flyweight)).toBe(s);
                expect(dv.getInt32(BASE + offset, true)).toBe(n);
                for (let i = 0; i < n; i++) {
                    expect(dv.getUint8(BASE + offset + 4 + i)).toBe(s.charCodeAt(i));
                }
                const lengths = length(flyweight, n);
                expect(lengths.actual).toBe(lengths.expected);
                const appendable = collector();
                append(flyweight, appendable);
                if (!(flyweight instanceof RejectImageFlyweight)) {
                    expect(appendable.text()).toBe(s);
                }
            },
        );

        it('one character more than the buffer holds throws IndexOutOfBoundsException and the buffer is not read past', () => {
            // mutation: skip the bounds check by clamping the length to the capacity
            const { buffer } = newWindow(BASE + offset + 4 + MAX);
            const flyweight = make();
            flyweight.wrap(buffer, BASE);

            expect(() => set(flyweight, text(MAX + 1))).toThrow(IndexOutOfBoundsException);
        });
    });

    describe('ImageBuffersReadyFlyweight source identity', () => {
        // [log file name length, source identity length, offset of the source identity, length()]
        it.each([
            [0, 0, 32, 36],
            [1, 0, 36, 40],
            [3, 2, 36, 42],
            [4, 1, 36, 41],
            [5, 2, 40, 46],
            [8, 7, 40, 51],
        ])(
            'log file name of %i bytes and a source identity of %i: length() is %i + ...',
            (logLength, srcLength, srcOffset, total) => {
                // mutation: do not align the log file name to 4 bytes, or add SIZE_OF_LONG instead of SIZE_OF_INT
                const { buffer, dv } = newWindow(256);
                const flyweight = new ImageBuffersReadyFlyweight().wrap(buffer, BASE);

                flyweight.logFileName(text(logLength)).sourceIdentity(text(srcLength));

                expect(dv.getInt32(BASE + srcOffset, true)).toBe(srcLength);
                expect(flyweight.length()).toBe(total);
                expect(flyweight.logFileName()).toBe(text(logLength));
                expect(flyweight.sourceIdentity()).toBe(text(srcLength));
                const appendable = collector();
                flyweight.appendSourceIdentity(appendable);
                expect(appendable.text()).toBe(text(srcLength));
            },
        );

        it('a source identity that fills the buffer exactly, and one more byte that does not fit', () => {
            // mutation: size the source identity from the unaligned log file name length
            const logLength = 5;
            const maxSource = 11;
            const size = BASE + 40 + 4 + maxSource;
            const flyweight = new ImageBuffersReadyFlyweight().wrap(newWindow(size).buffer, BASE);
            flyweight.logFileName(text(logLength)).sourceIdentity(text(maxSource));
            expect(flyweight.sourceIdentity()).toBe(text(maxSource));
            expect(flyweight.length()).toBe(40 + 4 + maxSource);
            expect(() => flyweight.sourceIdentity(text(maxSource + 1))).toThrow(IndexOutOfBoundsException);
        });
    });

    describe('ImageMessageFlyweight', () => {
        it('reading the channel sets the length, as writing it does', () => {
            // mutation: do not assign lengthOfChannel in channel() / appendChannel()
            const { buffer } = newWindow(256);
            new ImageMessageFlyweight().wrap(buffer, BASE).channel(text(9));

            const reader = new ImageMessageFlyweight().wrap(buffer, BASE);
            expect(reader.length()).toBe(20);
            expect(reader.channel()).toBe(text(9));
            expect(reader.length()).toBe(20 + 4 + 9);

            const appender = new ImageMessageFlyweight().wrap(buffer, BASE);
            const appendable = collector();
            appender.appendChannel(appendable);
            expect(appendable.text()).toBe(text(9));
            expect(appender.length()).toBe(20 + 4 + 9);
        });
    });

    describe('ErrorResponseFlyweight', () => {
        it.each(ErrorCode.values().filter((c) => c.value() >= 0))(
            'error code %s round trips through its value',
            (code) => {
                // mutation: write code.ordinal() instead of code.value(), or read with ErrorCode.get(code + 1)
                const { buffer, dv } = newWindow(256);
                const flyweight = new ErrorResponseFlyweight().wrap(buffer, BASE);

                flyweight.errorCode(code);

                expect(flyweight.errorCode()).toBe(code);
                expect(flyweight.errorCodeValue()).toBe(code.value());
                expect(dv.getInt32(BASE + 8, true)).toBe(code.value());
            },
        );

        it('an unknown code value reads back as UNKNOWN_CODE_VALUE, its raw value stays readable', () => {
            // mutation: throw, or return the last code
            const { buffer } = newWindow(256);
            const flyweight = new ErrorResponseFlyweight().wrap(buffer, BASE);
            buffer.putInt(BASE + 8, 12345);
            expect(flyweight.errorCode()).toBe(ErrorCode.UNKNOWN_CODE_VALUE);
            expect(flyweight.errorCodeValue()).toBe(12345);
        });

        it('appendMessage returns the number of bytes appended', () => {
            // mutation: return the length including the 4 byte header
            const { buffer } = newWindow(256);
            const flyweight = new ErrorResponseFlyweight().wrap(buffer, BASE).errorMessage(text(11));
            const appendable = collector();
            expect(flyweight.appendMessage(appendable)).toBe(11);
            expect(appendable.text()).toBe(text(11));
        });
    });

    describe('TerminateDriverFlyweight token', () => {
        function source(length: number): UnsafeBuffer {
            const b = new UnsafeBuffer(new ArrayBuffer(4 + length));
            for (let i = 0; i < length; i++) {
                b.putByte(4 + i, i + 1);
            }
            return b;
        }

        it.each([0, 1, 16])('a token of %i bytes is copied after the length', (n) => {
            // mutation: copy from the buffer's index 0 instead of tokenOffset, or from the wrong destination offset
            const { buffer, dv } = newWindow(256);
            const flyweight = new TerminateDriverFlyweight().wrap(buffer, BASE);

            flyweight.tokenBuffer(source(n), 4, n);

            expect(flyweight.tokenBufferLength()).toBe(n);
            expect(flyweight.length()).toBe(20 + n);
            expect(dv.getInt32(BASE + 16, true)).toBe(n);
            for (let i = 0; i < n; i++) {
                expect(dv.getUint8(BASE + 20 + i)).toBe(i + 1);
            }
            expect(dv.getUint8(BASE + 20 + n)).toBe(FILL);
        });

        it('a null token buffer or a length of 0 writes only the length', () => {
            // mutation: copy when tokenLength >= 0, or when the buffer is null
            const { buffer, dv } = newWindow(256);
            const flyweight = new TerminateDriverFlyweight().wrap(buffer, BASE);

            flyweight.tokenBuffer(null, 0, 5);
            expect(flyweight.tokenBufferLength()).toBe(5);
            expect(dv.getUint8(BASE + 20)).toBe(FILL);

            flyweight.tokenBuffer(source(4), 4, 0);
            expect(flyweight.tokenBufferLength()).toBe(0);
            expect(dv.getUint8(BASE + 20)).toBe(FILL);
        });

        it('tokenBufferOffset is TOKEN_BUFFER_OFFSET', () => {
            // mutation: return the length offset
            expect(new TerminateDriverFlyweight().tokenBufferOffset()).toBe(20);
        });
    });

    describe('PublicationErrorFrameFlyweight source address', () => {
        function socketAddress(bytes: number[], port: number): InetSocketAddress {
            return new InetSocketAddress(InetAddress.getByAddress(null, Uint8Array.from(bytes)), port);
        }

        it.each([0, 1, 4000, 32767, 32768, 65535])(
            'an IPv4 address with port %i is stored in 4 bytes, the other 12 are zeroed',
            (port) => {
                // mutation: skip the setMemory of the 12 bytes, store the port as signed, or write the type as 2
                const { buffer, dv } = newWindow(256);
                const flyweight = new PublicationErrorFrameFlyweight().wrap(buffer, BASE);
                const address = socketAddress([192, 168, 1, 77], port);

                flyweight.sourceAddress(address);

                expect(dv.getInt16(BASE + 40, true)).toBe(1);
                expect(dv.getUint16(BASE + 42, true)).toBe(port);
                expect([...new Uint8Array(dv.buffer, BASE + 44, 16)]).toEqual([
                    192,
                    168,
                    1,
                    77,
                    ...new Array(12).fill(0),
                ]);
                expect(dv.getUint8(BASE + 60)).toBe(FILL);
                const read = flyweight.sourceAddress();
                expect(read.getPort()).toBe(port);
                expect(read.getAddress()).toBeInstanceOf(Inet4Address);
                expect(read.equals(address)).toBe(true);
            },
        );

        it.each([0, 1, 65535])('an IPv6 address with port %i is stored in 16 bytes', (port) => {
            // mutation: write the type as 1, or write only 4 bytes
            const { buffer, dv } = newWindow(256);
            const flyweight = new PublicationErrorFrameFlyweight().wrap(buffer, BASE);
            const bytes = [0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xab, 0xcd];
            const address = socketAddress(bytes, port);

            flyweight.sourceAddress(address);

            expect(dv.getInt16(BASE + 40, true)).toBe(2);
            expect(dv.getUint16(BASE + 42, true)).toBe(port);
            expect([...new Uint8Array(dv.buffer, BASE + 44, 16)]).toEqual(bytes);
            const read = flyweight.sourceAddress();
            expect(read.getAddress()).toBeInstanceOf(Inet6Address);
            expect(read.getPort()).toBe(port);
            expect(read.equals(address)).toBe(true);
        });

        it.each([0, 3, -1, 256])("address type %i is refused with Java's message", (type) => {
            // mutation: treat any type other than 1 as IPv6
            const { buffer } = newWindow(256);
            const flyweight = new PublicationErrorFrameFlyweight().wrap(buffer, BASE);
            buffer.putShort(BASE + 40, type);
            expect(() => flyweight.sourceAddress()).toThrow('Unknown address type:' + type);
        });

        it('an IPv4 address after an IPv6 one leaves no stale bytes', () => {
            // mutation: skip the zero fill of the unused 12 bytes
            const { buffer, dv } = newWindow(256);
            const flyweight = new PublicationErrorFrameFlyweight().wrap(buffer, BASE);
            flyweight.sourceAddress(socketAddress(new Array(16).fill(0x11), 9));
            flyweight.sourceAddress(socketAddress([1, 2, 3, 4], 9));
            expect([...new Uint8Array(dv.buffer, BASE + 44, 16)]).toEqual([1, 2, 3, 4, ...new Array(12).fill(0)]);
        });

        it('errorCode round trips', () => {
            // mutation: write the ordinal
            const { buffer, dv } = newWindow(256);
            const flyweight = new PublicationErrorFrameFlyweight().wrap(buffer, BASE);
            flyweight.errorCode(ErrorCode.GENERIC_ERROR);
            expect(flyweight.errorCode()).toBe(ErrorCode.GENERIC_ERROR);
            expect(dv.getInt32(BASE + 60, true)).toBe(ErrorCode.GENERIC_ERROR.value());
        });
    });

    describe('a window at the end of the buffer', () => {
        it('wrap at an offset leaves the bytes before and after the message alone', () => {
            // mutation: write from offset 0
            const { buffer, dv } = newWindow(BASE + 16);
            new CorrelatedMessageFlyweight().wrap(buffer, BASE).clientId(-1).correlationId(MAX_SAFE);
            for (let i = 0; i < BASE; i++) {
                expect(dv.getUint8(i)).toBe(FILL);
            }
            expect(dv.getBigInt64(BASE, true)).toBe(-1n);
            expect(dv.getBigInt64(BASE + 8, true)).toBe(BigInt(MAX_SAFE));
        });

        it('a message that does not fit throws IndexOutOfBoundsException', () => {
            // mutation: read the correlation id at offset + 16, past the end of the window
            const { buffer } = newWindow(BASE + 15);
            expect(() => new CorrelatedMessageFlyweight().wrap(buffer, BASE).correlationId(1)).toThrow(
                IndexOutOfBoundsException,
            );
        });
    });
});
