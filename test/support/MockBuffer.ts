// The part of Mockito that the ring buffer tests use on a mocked `UnsafeBuffer`: `when(...).thenReturn(...)` with
// Mockito's default answers (0 and false), `verify` with a count, the argument matchers `anyInt()` / `anyByte()` (ANY)
// and `InOrder` (verify in order, `times(0)`, `verifyNoMoreInteractions`). Arguments are compared with `===`, so an
// object (`eq(srcBuffer)`) matches by identity. Built on `mock` of test/support/Mockito.ts, whose spies are `vi.fn`.
import { expect, type Mock } from 'vitest';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { mock } from './Mockito.js';

/** `anyInt()`, `anyLong()`, `anyByte()`: matches any argument. */
export const ANY: unique symbol = Symbol('any');

type Spy = Mock<(...args: never[]) => unknown>;

interface Stub {
    readonly args: readonly unknown[];
    readonly values: readonly unknown[];
    calls: number;
}

const STUBS = new WeakMap<object, Stub[]>();

function matches(expected: readonly unknown[], actual: readonly unknown[]): boolean {
    return expected.length === actual.length && expected.every((e, i) => ANY === e || e === actual[i]);
}

/** Mockito's `when(mock.method(args)).thenReturn(a, b, ...)`: the last matching stub answers; the last value repeats. */
export function when(spy: unknown, ...args: unknown[]): { thenReturn(...values: unknown[]): void } {
    const s = spy as Spy;
    return {
        thenReturn(...values: unknown[]): void {
            let stubs = STUBS.get(s);
            if (undefined === stubs) {
                const list: Stub[] = [];
                stubs = list;
                STUBS.set(s, list);
                const fallback = s.getMockImplementation() as ((...a: unknown[]) => unknown) | undefined;
                s.mockImplementation(((...actual: unknown[]) => {
                    for (let i = list.length - 1; i >= 0; i--) {
                        const stub = list[i] as Stub;
                        if (matches(stub.args, actual)) {
                            return stub.values[Math.min(stub.calls++, stub.values.length - 1)];
                        }
                    }
                    return fallback ? fallback(...actual) : 0;
                }) as never);
            }
            stubs.push({ args, values, calls: 0 });
        },
    };
}

function callsOf(spy: unknown, args: readonly unknown[]): number[] {
    const s = spy as Spy;
    const out: number[] = [];
    s.mock.calls.forEach((actual, i) => {
        if (matches(args, actual as unknown[])) {
            out.push(s.mock.invocationCallOrder[i] as number);
        }
    });
    return out;
}

/** `verify(mock, times(n)).method(args)`; Mockito's default is `times(1)`. */
export function verify(spy: unknown, times: number, ...args: unknown[]): void {
    expect(callsOf(spy, args).length, 'number of matching calls').toBe(times);
}

/** `verify(mock, never()).method(args)`. */
export function verifyNever(spy: unknown, ...args: unknown[]): void {
    verify(spy, 0, ...args);
}

/** Mockito's `InOrder` over the given spies (all the methods of the mock). */
export class InOrder {
    private readonly spies: readonly unknown[];
    private last = 0;

    public constructor(spies: readonly unknown[]) {
        this.spies = spies;
    }

    /** Every call of the mock after the last one verified, in order. */
    private remaining(): { order: number; spy: unknown; args: readonly unknown[] }[] {
        return this.spies
            .flatMap((spy) =>
                (spy as Spy).mock.invocationCallOrder.map((order, i) => ({
                    order,
                    spy,
                    args: (spy as Spy).mock.calls[i] as readonly unknown[],
                })),
            )
            .filter((call) => call.order > this.last)
            .sort((a, b) => a.order - b.order);
    }

    /**
     * `inOrder.verify(mock, times(n)).method(args)`, as Mockito does it: with `n` of 1 or more, the first matching call
     * after the last one verified starts a chunk of matching calls that follow one another, and the chunk has `n`
     * calls; with 0, no call after the last one verified matches.
     */
    public verify(spy: unknown, times: number, ...args: unknown[]): void {
        const remaining = this.remaining();
        const isMatch = (call: { spy: unknown; args: readonly unknown[] }): boolean =>
            call.spy === spy && matches(args, call.args);
        if (0 === times) {
            expect(remaining.filter(isMatch).length, 'matching calls after the last verified call').toBe(0);
            return;
        }
        const start = remaining.findIndex(isMatch);
        expect(start, 'a matching call after the last verified call').toBeGreaterThanOrEqual(0);
        let end = start;
        while (end < remaining.length && isMatch(remaining[end] as { spy: unknown; args: readonly unknown[] })) {
            end++;
        }
        expect(end - start, 'matching calls in a row').toBe(times);
        this.last = (remaining[end - 1] as { order: number }).order;
    }

    /** `inOrder.verifyNoMoreInteractions()`: no call of the mock after the last one verified. */
    public verifyNoMoreInteractions(): void {
        expect(this.remaining().length, 'calls after the last verified call').toBe(0);
    }
}

export interface MockedUnsafeBuffer {
    /** `mock(UnsafeBuffer.class)`. */
    readonly buffer: UnsafeBuffer;
    /** The spies of all its methods, by name: `buffer.getIntVolatile` is `spies.getIntVolatile`. */
    readonly spies: Record<string, Spy>;
    /** Every spy, for `InOrder`. */
    readonly all: readonly Spy[];
}

/** `mock(UnsafeBuffer.class)`: every method is a spy that answers 0, or false for a compare and set. */
export function mockUnsafeBuffer(): MockedUnsafeBuffer {
    const { mock: buffer } = mock(UnsafeBuffer);
    const spies: Record<string, Spy> = {};
    const all: Spy[] = [];
    for (let proto: object | null = UnsafeBuffer.prototype; null !== proto && proto !== Object.prototype;) {
        for (const name of Object.getOwnPropertyNames(proto)) {
            const spy = (buffer as unknown as Record<string, unknown>)[name];
            if ('constructor' !== name && !(name in spies) && typeof spy === 'function' && 'mock' in spy) {
                const s = spy as Spy;
                s.mockImplementation((() => (name.startsWith('compareAndSet') ? false : 0)) as never);
                spies[name] = s;
                all.push(s);
            }
        }
        proto = Object.getPrototypeOf(proto) as object | null;
    }
    return { buffer, spies, all };
}
