// Not in Agrona (CloseHelper has no test there): every overload of CloseHelper.
import { describe, expect, it, vi } from 'vitest';
import { CloseHelper } from '../../../src/agrona/CloseHelper.js';
import type { AtomicCounter } from '../../../src/agrona/concurrent/status/AtomicCounter.js';
import { CountedErrorHandler } from '../../../src/agrona/concurrent/CountedErrorHandler.js';
import { NullPointerException, RuntimeException, getSuppressed } from '../../../src/agrona/jdk.js';
import type { AutoCloseable } from '../../../src/agrona/jdkLang.js';
import { assertThrows } from '../../support/Assertions.js';
import { mockErrorHandler } from '../../support/MockAgent.js';

function closeable(error?: Error): AutoCloseable & { close: ReturnType<typeof vi.fn> } {
    return {
        close: vi.fn(() => {
            if (undefined !== error) {
                throw error;
            }
        }),
    };
}

describe('CloseHelperExtra', () => {
    it('quietCloseIgnoresNullsAndExceptions', () => {
        const ok = closeable();
        const failing = closeable(new RuntimeException('x'));

        CloseHelper.quietClose(null);
        CloseHelper.quietClose(undefined);
        CloseHelper.quietClose(ok);
        CloseHelper.quietClose(failing);

        expect(ok.close).toHaveBeenCalledTimes(1);
        expect(failing.close).toHaveBeenCalledTimes(1);
    });

    it('quietCloseAllClosesEveryoneFromArgumentsOrACollection', () => {
        const a = closeable(new RuntimeException('a'));
        const b = closeable();
        const c = closeable();

        CloseHelper.quietCloseAll(a, null, b);
        CloseHelper.quietCloseAll([a, undefined, c]);
        CloseHelper.quietCloseAll(null);
        CloseHelper.quietCloseAll();

        expect(a.close).toHaveBeenCalledTimes(2);
        expect(b.close).toHaveBeenCalledTimes(1);
        expect(c.close).toHaveBeenCalledTimes(1);
    });

    it('closeRethrowsTheException', () => {
        const error = new RuntimeException('x');

        CloseHelper.close(null);
        expect(() => CloseHelper.close(closeable(error))).toThrow(error);
    });

    it('closeAllClosesEveryoneThenThrowsTheFirstWithTheOthersSuppressed', () => {
        const first = new RuntimeException('first');
        const second = new RuntimeException('second');
        const third = new RuntimeException('third');
        const closeables = [closeable(first), closeable(), closeable(second), null, closeable(third)];

        const thrown = assertThrows(RuntimeException, () => CloseHelper.closeAll(closeables));

        expect(thrown).toBe(first);
        expect(getSuppressed(thrown)).toEqual([second, third]);
        for (const c of closeables) {
            if (null !== c) {
                expect(c.close).toHaveBeenCalledTimes(1);
            }
        }
    });

    it('closeAllWithArgumentsAndWithNothingToThrow', () => {
        const a = closeable();
        const b = closeable();

        CloseHelper.closeAll(a, b);
        CloseHelper.closeAll([a, b]);
        CloseHelper.closeAll(null);
        CloseHelper.closeAll();

        expect(a.close).toHaveBeenCalledTimes(2);
        expect(b.close).toHaveBeenCalledTimes(2);
    });

    it('closeWithAnErrorHandlerReportsInsteadOfThrowing', () => {
        const handler = mockErrorHandler();
        const error = new RuntimeException('x');

        CloseHelper.close(handler, null);
        CloseHelper.close(handler, closeable());
        expect(handler.onError).not.toHaveBeenCalled();

        CloseHelper.close(handler, closeable(error));
        expect(handler.onError).toHaveBeenCalledExactlyOnceWith(error);
    });

    it('closeWithANullErrorHandlerThrowsANullPointerExceptionWithTheErrorSuppressed', () => {
        const error = new RuntimeException('x');

        const thrown = assertThrows(NullPointerException, () => CloseHelper.close(null, closeable(error)));

        expect(thrown.message).toBe('errorHandler is null');
        expect(getSuppressed(thrown)).toEqual([error]);
        CloseHelper.close(null, closeable());
        CloseHelper.close(null, null);
    });

    it('closeAllWithAnErrorHandlerReportsEveryExceptionAndClosesEveryone', () => {
        const handler = mockErrorHandler();
        const one = new RuntimeException('one');
        const two = new RuntimeException('two');
        const closeables = [closeable(one), closeable(), closeable(two)];

        CloseHelper.closeAll(handler, closeables);
        CloseHelper.closeAll(handler, closeables[1]!, null);
        CloseHelper.closeAll(handler, null);
        CloseHelper.closeAll(handler);

        expect(handler.onError.mock.calls).toEqual([[one], [two]]);
        expect(closeables[1]!.close).toHaveBeenCalledTimes(2);
    });

    it('aCloseableThatThrowsANonErrorValueIsPassedOn', () => {
        const handler = mockErrorHandler();
        const odd = {
            close: () => {
                throw 'text';
            },
        } as unknown as AutoCloseable;

        CloseHelper.close(handler, odd);
        expect(handler.onError).toHaveBeenCalledExactlyOnceWith('text' as unknown as Error);
        expect(() => CloseHelper.close(odd)).toThrow();
    });

    it('closeAllWithAnErrorHandlerThatIsCloseableClosesTheCloseablesAndNotTheHandler Regression', () => {
        // a CountedErrorHandler is an ErrorHandler and an AutoCloseable: as the first argument it is the handler (D120)
        const reported = new RuntimeException('reported');
        const delegate = mockErrorHandler();
        const counter = { isClosed: () => false, increment: vi.fn() } as unknown as AtomicCounter;
        const handler = new CountedErrorHandler(delegate, counter);
        const closeables = [closeable(reported), closeable()];

        CloseHelper.closeAll(handler, closeables);
        CloseHelper.closeAll(handler, closeables[1]!);

        expect(handler.isClosed()).toBe(false);
        expect(closeables[0]!.close).toHaveBeenCalledTimes(1);
        expect(closeables[1]!.close).toHaveBeenCalledTimes(2);
        expect(delegate.onError.mock.calls).toEqual([[reported]]);
        expect(counter.increment).toHaveBeenCalledTimes(1);
    });

    it('closeAllOfACloseableErrorHandlerAloneClosesIt', () => {
        const delegate = mockErrorHandler();
        const counter = { isClosed: () => false, increment: vi.fn() } as unknown as AtomicCounter;
        const handler = new CountedErrorHandler(delegate, counter);

        CloseHelper.closeAll(handler);

        expect(handler.isClosed()).toBe(true);
    });
});
