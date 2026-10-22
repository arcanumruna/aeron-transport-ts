// Not in Aeron (these classes have no test there): ErrorCode, the AeronException family and the constants.
import { describe, expect, it } from 'vitest';
import { Aeron } from '../../../src/client/Aeron.js';
import { CommonContext, InferableBoolean } from '../../../src/client/CommonContext.js';
import { ErrorCode } from '../../../src/client/ErrorCode.js';
import { AeronException, Category } from '../../../src/client/exceptions/AeronException.js';
import { ConductorServiceTimeoutException } from '../../../src/client/exceptions/ConductorServiceTimeoutException.js';
import { ConfigurationException } from '../../../src/client/exceptions/ConfigurationException.js';
import { ControlProtocolException } from '../../../src/client/exceptions/ControlProtocolException.js';
import { RegistrationException } from '../../../src/client/exceptions/RegistrationException.js';
import { TimeoutException } from '../../../src/client/exceptions/TimeoutException.js';

const CODES: [ErrorCode, string, number][] = [
    [ErrorCode.UNUSED, 'UNUSED', 0],
    [ErrorCode.INVALID_CHANNEL, 'INVALID_CHANNEL', 1],
    [ErrorCode.UNKNOWN_SUBSCRIPTION, 'UNKNOWN_SUBSCRIPTION', 2],
    [ErrorCode.UNKNOWN_PUBLICATION, 'UNKNOWN_PUBLICATION', 3],
    [ErrorCode.CHANNEL_ENDPOINT_ERROR, 'CHANNEL_ENDPOINT_ERROR', 4],
    [ErrorCode.UNKNOWN_COUNTER, 'UNKNOWN_COUNTER', 5],
    [ErrorCode.UNKNOWN_COMMAND_TYPE_ID, 'UNKNOWN_COMMAND_TYPE_ID', 6],
    [ErrorCode.MALFORMED_COMMAND, 'MALFORMED_COMMAND', 7],
    [ErrorCode.NOT_SUPPORTED, 'NOT_SUPPORTED', 8],
    [ErrorCode.UNKNOWN_HOST, 'UNKNOWN_HOST', 9],
    [ErrorCode.RESOURCE_TEMPORARILY_UNAVAILABLE, 'RESOURCE_TEMPORARILY_UNAVAILABLE', 10],
    [ErrorCode.GENERIC_ERROR, 'GENERIC_ERROR', 11],
    [ErrorCode.STORAGE_SPACE, 'STORAGE_SPACE', 12],
    [ErrorCode.IMAGE_REJECTED, 'IMAGE_REJECTED', 13],
    [ErrorCode.PUBLICATION_REVOKED, 'PUBLICATION_REVOKED', 14],
    [ErrorCode.UNKNOWN_CODE_VALUE, 'UNKNOWN_CODE_VALUE', -1],
];

describe('ErrorCode', () => {
    it.each(CODES)('getReturnsTheCodeOfItsValue %s', (code, name, value) => {
        expect(code.value()).toBe(value);
        expect(code.name()).toBe(name);
        expect(code.toString()).toBe(name);
        expect(ErrorCode.get(value)).toBe(code);
    });

    it('valuesAreInOrdinalOrder', () => {
        const values = ErrorCode.values();

        expect(values).toHaveLength(16);
        expect(values.map((code) => code.ordinal())).toEqual([...values.keys()]);
        expect(values.map((code) => code.value())).toEqual(CODES.map((row) => row[2]));
        expect(ErrorCode.values()).not.toBe(values);
    });

    it.each([15, 16, 100, -2, -100, 2147483647, -2147483648])(
        'getReturnsUnknownCodeValueWhenOutOfRange %d',
        (value) => {
            expect(ErrorCode.get(value)).toBe(ErrorCode.UNKNOWN_CODE_VALUE);
        },
    );
});

describe('AeronException', () => {
    it('categoryNamesAndOrdinals', () => {
        expect(Category.values().map((c) => c.name())).toEqual(['FATAL', 'ERROR', 'WARN']);
        expect(Category.values().map((c) => c.ordinal())).toEqual([0, 1, 2]);
        expect(AeronException.Category).toBe(Category);
        expect(String(Category.WARN)).toBe('WARN');
    });

    it('defaultConstructorIsErrorWithNoMessage', () => {
        const e = new AeronException();

        expect(e.category()).toBe(Category.ERROR);
        expect(e.message).toBe('');
        expect(e.cause).toBeUndefined();
        expect(e.name).toBe('AeronException');
        expect(e).toBeInstanceOf(Error);
    });

    it.each([Category.FATAL, Category.ERROR, Category.WARN])('categoryConstructorHasNoMessage %s', (category) => {
        const e = new AeronException(category);

        expect(e.category()).toBe(category);
        expect(e.message).toBe('');
    });

    it('messageConstructorPrefixesErrorCategory', () => {
        const e = new AeronException('boom');

        expect(e.category()).toBe(Category.ERROR);
        expect(e.message).toBe('ERROR - boom');
    });

    it('causeConstructorUsesCauseToString', () => {
        const cause = new RangeError('bad');
        const e = new AeronException(cause);

        expect(e.category()).toBe(Category.ERROR);
        expect(e.message).toBe('RangeError: bad');
        expect(e.cause).toBe(cause);
    });

    it('nullCauseConstructorHasNoMessageAndNoCause', () => {
        const e = new AeronException(null);

        expect(e.message).toBe('');
        expect(e.cause).toBeUndefined();
    });

    it.each([Category.FATAL, Category.ERROR, Category.WARN])('messageAndCategoryConstructor %s', (category) => {
        const e = new AeronException('boom', category);

        expect(e.category()).toBe(category);
        expect(e.message).toBe(category.name() + ' - boom');
    });

    it('messageAndCauseConstructor', () => {
        const cause = new Error('inner');
        const e = new AeronException('boom', cause);

        expect(e.category()).toBe(Category.ERROR);
        expect(e.message).toBe('ERROR - boom');
        expect(e.cause).toBe(cause);
    });

    it('causeAndCategoryConstructor', () => {
        const cause = new Error('inner');
        const e = new AeronException(cause, Category.WARN);

        expect(e.category()).toBe(Category.WARN);
        expect(e.message).toBe('Error: inner');
        expect(e.cause).toBe(cause);
    });

    it('messageCauseAndCategoryConstructor', () => {
        const cause = new Error('inner');
        const e = new AeronException('boom', cause, Category.FATAL);

        expect(e.category()).toBe(Category.FATAL);
        expect(e.message).toBe('FATAL - boom');
        expect(e.cause).toBe(cause);
    });

    it('messageCauseAndFlagsConstructors', () => {
        const cause = new Error('inner');
        const four = new AeronException('boom', cause, true, false);
        const five = new AeronException('boom', cause, false, true, Category.WARN);

        expect(four.category()).toBe(Category.ERROR);
        expect(four.message).toBe('ERROR - boom');
        expect(four.cause).toBe(cause);
        expect(five.category()).toBe(Category.WARN);
        expect(five.message).toBe('WARN - boom');
        expect(five.cause).toBe(cause);
    });

    it('isFatalOnlyForAnAeronExceptionOfCategoryFatal', () => {
        expect(AeronException.isFatal(new AeronException(Category.FATAL))).toBe(true);
        expect(AeronException.isFatal(new AeronException(Category.ERROR))).toBe(false);
        expect(AeronException.isFatal(new AeronException(Category.WARN))).toBe(false);
        expect(AeronException.isFatal(new Error('FATAL'))).toBe(false);
        expect(AeronException.isFatal(new ConductorServiceTimeoutException('x'))).toBe(true);
    });
});

describe('AeronException subclasses', () => {
    it('configurationExceptionIsAnErrorWithMessage', () => {
        const e = new ConfigurationException('bad option');

        expect(e).toBeInstanceOf(AeronException);
        expect(e.category()).toBe(Category.ERROR);
        expect(e.message).toBe('ERROR - bad option');
        expect(e.name).toBe('ConfigurationException');
    });

    it('timeoutExceptionConstructors', () => {
        const cause = new Error('inner');

        expect(new TimeoutException().message).toBe('');
        expect(new TimeoutException().category()).toBe(Category.ERROR);
        expect(new TimeoutException('late').message).toBe('ERROR - late');
        expect(new TimeoutException(Category.WARN).category()).toBe(Category.WARN);
        expect(new TimeoutException('late', Category.FATAL).message).toBe('FATAL - late');
        expect(new TimeoutException(cause, Category.WARN).message).toBe('Error: inner');
        expect(new TimeoutException('late', cause, Category.WARN).cause).toBe(cause);
        expect(new TimeoutException('late', cause, true, true, Category.WARN).message).toBe('WARN - late');
    });

    it('conductorServiceTimeoutExceptionIsFatal', () => {
        const e = new ConductorServiceTimeoutException('slow');

        expect(e).toBeInstanceOf(TimeoutException);
        expect(e.category()).toBe(Category.FATAL);
        expect(e.message).toBe('FATAL - slow');
    });

    it('controlProtocolExceptionCategoryFollowsTheCode', () => {
        for (const [code] of CODES) {
            const e = new ControlProtocolException(code, 'msg');

            expect(e.errorCode()).toBe(code);
            expect(e.category()).toBe(
                ErrorCode.RESOURCE_TEMPORARILY_UNAVAILABLE === code ? Category.WARN : Category.ERROR,
            );
            expect(e.message).toBe(e.category().name() + ' - msg');
        }

        const cause = new Error('inner');
        expect(new ControlProtocolException(ErrorCode.GENERIC_ERROR, cause).message).toBe('Error: inner');
        expect(new ControlProtocolException(ErrorCode.GENERIC_ERROR, 'msg', cause).cause).toBe(cause);
    });

    it('registrationExceptionStripsTheCategoryPrefix', () => {
        const rows: [string, string][] = [
            ['ERROR - boom', 'boom'],
            ['FATAL - boom', 'boom'],
            ['WARN - boom', 'boom'],
            ['boom', 'boom'],
            ['ERROR -', 'ERROR -'],
            ['WARN -', 'WARN -'],
            ['', ''],
        ];

        for (const [msg, stripped] of rows) {
            const e = new RegistrationException(42n, 7, ErrorCode.MALFORMED_COMMAND, msg);

            expect(e.message).toBe('ERROR - ' + stripped + ', errorCodeValue=7');
            expect(e.correlationId()).toBe(42n);
            expect(e.errorCode()).toBe(ErrorCode.MALFORMED_COMMAND);
            expect(e.errorCodeValue()).toBe(7);
        }
    });

    it('registrationExceptionWithTemporarilyUnavailableIsWarn', () => {
        const e = new RegistrationException(-1n, 10, ErrorCode.RESOURCE_TEMPORARILY_UNAVAILABLE, 'busy');

        expect(e.category()).toBe(Category.WARN);
        expect(e.message).toBe('WARN - busy, errorCodeValue=10');
    });

    it('registrationExceptionNestsAnotherAsItsCause', () => {
        const original = new RegistrationException(2n ** 63n - 1n, 99, ErrorCode.UNKNOWN_CODE_VALUE, 'unknown');
        const nested = new RegistrationException(original);

        expect(nested.cause).toBe(original);
        expect(nested.category()).toBe(original.category());
        expect(nested.message).toBe('ERROR - unknown, errorCodeValue=99');
        expect(nested.correlationId()).toBe(2n ** 63n - 1n);
        expect(nested.errorCode()).toBe(ErrorCode.UNKNOWN_CODE_VALUE);
        expect(nested.errorCodeValue()).toBe(99);
    });
});

describe('Aeron and CommonContext constants', () => {
    it('constants', () => {
        expect(Aeron.NULL_VALUE).toBe(-1);
        expect(CommonContext.NULL_SESSION_ID).toBe(-1);
        expect(CommonContext.UDP_MEDIA).toBe('udp');
        expect(CommonContext.IPC_MEDIA).toBe('ipc');
        expect(CommonContext.UDP_CHANNEL).toBe('aeron:udp');
        expect(CommonContext.IPC_CHANNEL).toBe('aeron:ipc');
        expect(CommonContext.SPY_PREFIX).toBe('aeron-spy:');
        expect(CommonContext.TAG_PREFIX).toBe('tag:');
        expect(CommonContext.DEFAULT_DRIVER_TIMEOUT_MS).toBe(10_000);
        expect(CommonContext.THREAD_NAMING_DEFAULT).toBe('classic');
        expect(CommonContext.GROUP_TAG_PARAM_NAME).toBe('gtag');
        expect(CommonContext.MTU_LENGTH_PARAM_NAME).toBe('mtu');
    });

    it('everyParamNameIsDistinct', () => {
        const names = Object.entries(CommonContext)
            .filter(([key, value]) => key.endsWith('_PARAM_NAME') && typeof value === 'string')
            .map(([, value]) => value as string);

        expect(names.length).toBeGreaterThanOrEqual(30);
        expect(new Set(names).size).toBe(names.length);
    });

    it('inferableBooleanParse', () => {
        expect(InferableBoolean.parse(null)).toBe(InferableBoolean.INFER);
        expect(InferableBoolean.parse(undefined)).toBe(InferableBoolean.INFER);
        expect(InferableBoolean.parse('infer')).toBe(InferableBoolean.INFER);
        expect(InferableBoolean.parse('true')).toBe(InferableBoolean.FORCE_TRUE);
        expect(InferableBoolean.parse('false')).toBe(InferableBoolean.FORCE_FALSE);
        expect(InferableBoolean.parse('TRUE')).toBe(InferableBoolean.FORCE_FALSE);
        expect(InferableBoolean.parse('')).toBe(InferableBoolean.FORCE_FALSE);
        expect(CommonContext.InferableBoolean).toBe(InferableBoolean);
        expect(InferableBoolean.values().map((v) => v.name())).toEqual(['FORCE_FALSE', 'FORCE_TRUE', 'INFER']);
    });
});
