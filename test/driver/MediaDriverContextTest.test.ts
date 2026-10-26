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
// Port of io/aeron/driver/MediaDriverContextTest.java @ 1.53.3
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorHandler } from '../../src/agrona/ErrorHandler.js';
import { CountedErrorHandler } from '../../src/agrona/concurrent/CountedErrorHandler.js';
import { ArithmeticException, Integer, Long, RuntimeException, TimeUnit } from '../../src/agrona/jdk.js';
import { System } from '../../src/agrona/jdkLang.js';
import { Aeron } from '../../src/client/Aeron.js';
import { CncFileDescriptor } from '../../src/client/CncFileDescriptor.js';
import { ConfigurationException } from '../../src/client/exceptions/ConfigurationException.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { Configuration } from '../../src/driver/Configuration.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { SystemCounterDescriptor } from '../../src/driver/status/SystemCounterDescriptor.js';
import { mock } from '../support/Mockito.js';
import { assertThrows, assertThrowsExactly } from '../support/Assertions.js';

const {
    COUNTERS_VALUES_BUFFER_LENGTH_MAX,
    COUNTERS_VALUES_BUFFER_LENGTH_MIN,
    ERROR_BUFFER_LENGTH_DEFAULT,
    LOSS_REPORT_BUFFER_LENGTH_DEFAULT,
    NAK_MAX_BACKOFF_DEFAULT_NS,
    NAK_MULTICAST_MAX_BACKOFF_PROP_NAME,
    NAK_UNICAST_DELAY_MIN_VALUE_NS,
    UNTETHERED_LINGER_TIMEOUT_PROP_NAME,
    UNTETHERED_WINDOW_LIMIT_TIMEOUT_PROP_NAME,
    UNTETHERED_WINDOW_LIMIT_TIMEOUT_DEFAULT_NS,
} = Configuration;
const { TERM_MAX_LENGTH } = LogBufferDescriptor;
const Context = MediaDriver.Context;
type Context = MediaDriver.Context;

describe('MediaDriverContextTest', () => {
    let context: Context;

    beforeEach(() => {
        context = new Context();
    });

    afterEach(() => {
        context.close();
    });

    it('nakMulticastMaxBackoffNsDefaultValue', () => {
        expect(context.nakMulticastMaxBackoffNs()).toBe(NAK_MAX_BACKOFF_DEFAULT_NS);
    });

    it('nakMulticastMaxBackoffNsValueFromSystemProperty', () => {
        System.setProperty(NAK_MULTICAST_MAX_BACKOFF_PROP_NAME, '333');
        try {
            const context = new Context();
            expect(context.nakMulticastMaxBackoffNs()).toBe(333);
        } finally {
            System.clearProperty(NAK_MULTICAST_MAX_BACKOFF_PROP_NAME);
        }
    });

    it('nakMulticastMaxBackoffNsExplicitValue', () => {
        context.nakMulticastMaxBackoffNs(Long.MIN_VALUE);
        expect(context.nakMulticastMaxBackoffNs()).toBe(Long.MIN_VALUE);
    });

    it.each([Integer.MIN_VALUE, -5, 0, 1024 * 1024, 1024 * 1024 + 64 * 12 - 1])(
        'conductorBufferLengthMustBeWithinRange %s',
        (length) => {
            context.conductorBufferLength(length);

            const exception = assertThrows(ConfigurationException, () => context.conclude());
            expect(exception.message).toContain('conductorBufferLength');
        },
    );

    it.each([Integer.MIN_VALUE, -5, 0, 1024 * 1024, 1024 * 1024 + 64 * 2 - 1])(
        'toClientsBufferLengthMustBeWithinRange %s',
        (length) => {
            context.toClientsBufferLength(length);

            const exception = assertThrows(ConfigurationException, () => context.conclude());
            expect(exception.message).toContain('toClientsBufferLength');
        },
    );

    it.each([-76, 0, COUNTERS_VALUES_BUFFER_LENGTH_MIN - 1, COUNTERS_VALUES_BUFFER_LENGTH_MAX + 1])(
        'counterValuesBufferLengthMustBeWithinRange %s',
        (length) => {
            context.counterValuesBufferLength(length);

            const exception = assertThrows(ConfigurationException, () => context.conclude());
            expect(exception.message).toContain('counterValuesBufferLength');
        },
    );

    it.each([-76, 0, ERROR_BUFFER_LENGTH_DEFAULT - 1])('errorBufferLengthMustBeWithinRange %s', (length) => {
        context.errorBufferLength(length);

        const exception = assertThrows(ConfigurationException, () => context.conclude());
        expect(exception.message).toContain('errorBufferLength');
    });

    // The loss report is a file in the Aeron directory (LossReport, mapLossReport): neither is ported (spec section 3,
    // D4), so the page-aligned lossReportBufferLength check of concludeDependantProperties is not ported either.
    it.skip.each([-6, 0, 5, LOSS_REPORT_BUFFER_LENGTH_DEFAULT - 4096])(
        'lossReportBufferLengthMustBeWithinRange %s',
        (_length) => {},
    );

    it.each([-76, -3, TERM_MAX_LENGTH + 1])('publicationTermWindowLengthMustBeWithinRange %s', (length) => {
        context.publicationTermWindowLength(length);

        const exception = assertThrows(ConfigurationException, () => context.conclude());
        expect(exception.message).toContain('publicationTermWindowLength');
    });

    it.each([-76, -3, TERM_MAX_LENGTH + 1])('ipcPublicationTermWindowLengthMustBeWithinRange %s', (length) => {
        context.ipcPublicationTermWindowLength(length);

        const exception = assertThrows(ConfigurationException, () => context.conclude());
        expect(exception.message).toContain('ipcPublicationTermWindowLength');
    });

    // The native resource agent (NativeResourceAgentProxy, its idle strategy, command queue and thread factory) is not
    // ported with the Context: the thread factories are out of scope (spec D3) and T18 ports the agent for
    // re-resolution (plan T18).
    it.skip('shouldAllowSettingNativeResourceAgentProxy', () => {});

    it.skip('shouldAllowConfiguringNativeResourceAgentIdleStrategy', () => {});

    it.skip('shouldUseSleepingNativeResourceAgentIdleStrategyByDefault', () => {});

    it.skip('shouldConfigureNativeResourceAgentIdleStrategyUsingSystemProperty', () => {});

    it.skip('shouldNotCreateAsyncExecutorIdleStrategyIfNativeResourceAgentNotEnabled', () => {});

    it.skip('shouldInitializeNativeResourceAgentCommandQueue', () => {});

    it.skip('shouldAssignNativeResourceAgentCommandQueue', () => {});

    it.skip('shouldConfigureNativeResourceAgentProxy', () => {});

    it.skip('shouldCreateNativeResourceAgentThreadFactoryIfEnabled', () => {});

    it.skip('shouldNotCreateNativeResourceAgentThreadFactoryIfDisabled', () => {});

    it.each([null, ''])('resolverNameIsRequiredWhenDriverNameResolutionIsUsed %j', (noName) => {
        context.resolverName(noName).resolverInterface('127.0.0.1');

        const exception = assertThrowsExactly(ConfigurationException, () => context.conclude());
        expect(exception.message).toBe('ERROR - `resolverName` is required when `resolverInterface` is set');
    });

    it('shouldAssignCountedErrorHandler', () => {
        expect(context.countedErrorHandler()).toBeNull();
        const countedErrorHandler = mock(CountedErrorHandler).mock;
        context.countedErrorHandler(countedErrorHandler);
        expect(context.countedErrorHandler()).toBe(countedErrorHandler);

        context.conclude();
        expect(context.countedErrorHandler()).toBe(countedErrorHandler);
    });

    it('shouldWrapErrorHandler', () => {
        const customHandler: ErrorHandler = { onError: vi.fn() };
        context.errorHandler(customHandler);
        expect(context.countedErrorHandler()).toBeNull();

        context.conclude();

        const errorHandler = context.errorHandler();
        expect(errorHandler).not.toBeNull();
        expect(errorHandler).not.toBe(customHandler);
        const countedErrorHandler = context.countedErrorHandler();
        expect(countedErrorHandler).not.toBeNull();

        const exception = new RuntimeException('test');
        countedErrorHandler!.onError(exception);

        expect(customHandler.onError).toHaveBeenCalledTimes(1);
        expect(customHandler.onError).toHaveBeenCalledWith(exception);
        const errorCounter = context.systemCounters()!.get(SystemCounterDescriptor.ERRORS);
        expect(errorCounter.get()).toBe(1);
    });

    // ControlTransportPoller (T13) takes the DriverConductorProxy that T17 ports, and conclude creates it with it then.
    it.skip('shouldCreateControlTransportPollerWithCountedErrorHandler', () => {});

    it('shouldCreateDataTransportPollerWithCountedErrorHandler', () => {
        context.dataTransportPoller(null);

        context.conclude();

        const dataTransportPoller = context.dataTransportPoller();
        expect(dataTransportPoller).not.toBeNull();

        // getErrorHandler(transportPoller): the protected field `errorHandler` of UdpTransportPoller, read by reflection
        const errorHandler = (dataTransportPoller as unknown as { errorHandler: unknown }).errorHandler;
        expect(errorHandler).toBe(context.countedErrorHandler());
    });

    it.each([4096, 2 * 1024 * 1024])('shouldAddFilePageSizeToTheCncFile %s', (filePageSize) => {
        context.filePageSize(filePageSize);

        context.conclude();

        const metaDataBuffer = CncFileDescriptor.createMetaDataBuffer(context.cncByteBuffer()!);
        expect(CncFileDescriptor.filePageSize(metaDataBuffer)).toBe(filePageSize);
    });

    it('shouldTestDefaultUntetheredWindowLimitTimeout', () => {
        expect(context.untetheredWindowLimitTimeoutNs()).toBe(UNTETHERED_WINDOW_LIMIT_TIMEOUT_DEFAULT_NS);
    });

    it('shouldTestDefaultUntetheredLingerTimeout', () => {
        expect(context.untetheredLingerTimeoutNs()).toBe(Aeron.NULL_VALUE);
    });

    it('shouldHonorSystemPropertyUntetheredLingerTimeout', () => {
        System.setProperty(UNTETHERED_LINGER_TIMEOUT_PROP_NAME, '222ms');
        try {
            const ctx = new Context();
            expect(ctx.untetheredLingerTimeoutNs()).toBe(TimeUnit.MILLISECONDS.toNanos(222));
        } finally {
            System.clearProperty(UNTETHERED_LINGER_TIMEOUT_PROP_NAME);
        }
    });

    it('shouldHonorSystemPropertyWindowLimitTimeout', () => {
        System.setProperty(UNTETHERED_WINDOW_LIMIT_TIMEOUT_PROP_NAME, '444ms');
        try {
            const ctx = new Context();
            expect(ctx.untetheredWindowLimitTimeoutNs()).toBe(TimeUnit.MILLISECONDS.toNanos(444));
        } finally {
            System.clearProperty(UNTETHERED_WINDOW_LIMIT_TIMEOUT_PROP_NAME);
        }
    });

    it('shouldHonorSystemPropertyOverrideUntetheredLingerTimeoutAndWindowTimeout', () => {
        System.setProperty(UNTETHERED_LINGER_TIMEOUT_PROP_NAME, '222ms');
        System.setProperty(UNTETHERED_WINDOW_LIMIT_TIMEOUT_PROP_NAME, '444ms');
        try {
            const ctx = new Context();
            expect(ctx.untetheredLingerTimeoutNs()).toBe(TimeUnit.MILLISECONDS.toNanos(222));
            expect(ctx.untetheredWindowLimitTimeoutNs()).toBe(TimeUnit.MILLISECONDS.toNanos(444));
        } finally {
            System.clearProperty(UNTETHERED_LINGER_TIMEOUT_PROP_NAME);
            System.clearProperty(UNTETHERED_WINDOW_LIMIT_TIMEOUT_PROP_NAME);
        }
    });

    it('shouldUseNullForUntetheredLingerTimeoutEvenIfWindowIsSet', () => {
        const ctx = new Context().untetheredWindowLimitTimeoutNs(35326745);
        expect(ctx.untetheredLingerTimeoutNs()).toBe(Aeron.NULL_VALUE);
    });

    it.each([Long.MIN_VALUE, -1, 0, NAK_UNICAST_DELAY_MIN_VALUE_NS - 1])(
        'shouldRejectInvalidNakUnicastDelay %s',
        (nakUnicastDelayNs) => {
            context.nakUnicastDelayNs(nakUnicastDelayNs);

            const exception = assertThrowsExactly(ConfigurationException, () => context.conclude());
            expect(exception.message).toBe(
                'ERROR - nakUnicastDelayNs less than min size of ' +
                    NAK_UNICAST_DELAY_MIN_VALUE_NS +
                    ': ' +
                    nakUnicastDelayNs,
            );
        },
    );

    it('shouldAcceptMinNakUnicastDelay', () => {
        context.nakUnicastDelayNs(NAK_UNICAST_DELAY_MIN_VALUE_NS);

        context.conclude();

        expect(context.nakUnicastDelayNs()).toBe(NAK_UNICAST_DELAY_MIN_VALUE_NS);
    });

    it.each([Long.MIN_VALUE, -1, 0])('shouldRejectInvalidNakUnicastRetryDelayRatio %s', (nakUnicastRetryDelayRatio) => {
        context.nakUnicastRetryDelayRatio(nakUnicastRetryDelayRatio);

        const exception = assertThrowsExactly(ConfigurationException, () => context.conclude());
        expect(exception.message).toBe(
            'ERROR - nakUnicastRetryDelayRatio less than min size of 1: ' + nakUnicastRetryDelayRatio,
        );
    });

    it.each([[5000000000, 1000000000000]])(
        'shouldRejectInvalidNakUnicastDelayRetryCombination %s %s',
        (nakUnicastDelayNs, nakUnicastRetryDelayRatio) => {
            context.nakUnicastDelayNs(nakUnicastDelayNs).nakUnicastRetryDelayRatio(nakUnicastRetryDelayRatio);

            const exception = assertThrowsExactly(ArithmeticException, () => context.conclude());
            expect(exception.message).toBe('long overflow');
        },
    );
});
