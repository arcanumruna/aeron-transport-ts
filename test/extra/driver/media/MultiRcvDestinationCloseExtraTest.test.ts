// Not in Aeron (D120): a destination that fails to close is reported through the driver's counted error handler, so that
// the error is counted in the ERRORS system counter and reaches the error handler of the application.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeException } from '../../../../src/agrona/jdk.js';
import { MediaDriver } from '../../../../src/driver/MediaDriver.js';
import { MultiRcvDestination } from '../../../../src/driver/media/MultiRcvDestination.js';
import type { ReceiveDestinationTransport } from '../../../../src/driver/media/ReceiveDestinationTransport.js';
import { SystemCounterDescriptor } from '../../../../src/driver/status/SystemCounterDescriptor.js';

let context: MediaDriver.Context;
const applicationHandler = { onError: vi.fn() };

beforeEach(() => {
    applicationHandler.onError.mockClear();
    context = new MediaDriver.Context().errorHandler(applicationHandler).conclude();
});

afterEach(() => {
    context.close();
});

describe('MultiRcvDestinationCloseExtra', () => {
    it('aDestinationThatFailsToCloseIsCountedAndReachesTheApplicationErrorHandler Regression', () => {
        const error = new RuntimeException('close failed');
        const failing = {
            close: () => {
                throw error;
            },
        };
        const healthy = { close: vi.fn() };
        const destination = new MultiRcvDestination();
        destination.addDestination(failing as unknown as ReceiveDestinationTransport);
        destination.addDestination(healthy as unknown as ReceiveDestinationTransport);
        const errors = context.systemCounters()!.get(SystemCounterDescriptor.ERRORS);
        expect(errors.get()).toBe(0);

        destination.close(context.countedErrorHandler());

        expect(healthy.close).toHaveBeenCalledTimes(1);
        expect(errors.get()).toBe(1);
        expect(applicationHandler.onError).toHaveBeenCalledExactlyOnceWith(error);
        expect(context.countedErrorHandler()!.isClosed()).toBe(false);
    });
});
