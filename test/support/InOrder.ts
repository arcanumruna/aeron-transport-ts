// The part of Mockito's `InOrder.verify` that the ported tests use: the given calls happened in the given order, across
// mocks. A call is a spy and the index of the call in `spy.mock.calls`; the arguments are checked with `mock.calls`.
import { expect } from 'vitest';

type Spy = { mock: { invocationCallOrder: number[] } };

export function expectInOrder(...calls: Array<readonly [Spy, number]>): void {
    let previous = 0;
    calls.forEach(([spy, index], i) => {
        const order = spy.mock.invocationCallOrder[index];
        expect(order, `call ${i} (call ${index} of its spy) happened`).toBeDefined();
        expect(order as number, `call ${i} (call ${index} of its spy) is after call ${i - 1}`).toBeGreaterThan(
            previous,
        );
        previous = order as number;
    });
}

type Matchable = { mock: { calls: unknown[][]; invocationCallOrder: number[] } };

function matchesArgs(args: unknown[], matchers: unknown[]): boolean {
    try {
        expect(args).toEqual(matchers);
        return true;
    } catch {
        return false;
    }
}

interface Invocation {
    readonly spy: Matchable;
    readonly args: unknown[];
    readonly order: number;
}

/**
 * Mockito's `InOrder` over the mocks (or spied objects) it is made with: `verify(mock, times(n)).method(matchers)`
 * checks, among the interactions of those mocks after the last verified one, that the first chunk of matching
 * invocations (consecutive in the interactions of the mocks) has n invocations or, when it has not, that n invocations
 * match in all. A verified invocation is the last of what matched.
 */
export class InOrder {
    private readonly spies: Matchable[] = [];
    private last = 0;

    public constructor(...mocks: object[]) {
        for (const target of mocks) {
            for (const name of Object.getOwnPropertyNames(target)) {
                const value = (target as Record<string, unknown>)[name];
                if (typeof value === 'function' && 'mock' in (value as object)) {
                    this.spies.push(value as unknown as Matchable);
                }
            }
        }
    }

    private timeline(): Invocation[] {
        const all: Invocation[] = [];
        for (const spy of this.spies) {
            spy.mock.calls.forEach((args, i) => {
                const order = spy.mock.invocationCallOrder[i] as number;
                if (order > this.last) {
                    all.push({ spy, args, order });
                }
            });
        }
        return all.sort((a, b) => a.order - b.order);
    }

    public verify(fn: unknown, times: number, ...matchers: unknown[]): void {
        const wanted = fn as Matchable;
        const isMatch = (inv: Invocation): boolean => inv.spy === wanted && matchesArgs(inv.args, matchers);
        const unverified = this.timeline();
        const first = unverified.findIndex(isMatch);
        let chunk: Invocation[] = [];
        if (first >= 0) {
            for (let i = first; i < unverified.length && isMatch(unverified[i] as Invocation); i++) {
                chunk.push(unverified[i] as Invocation);
            }
        }
        if (chunk.length !== times) {
            chunk = unverified.filter(isMatch);
        }
        expect(chunk.length, 'matching invocations after the last verified one').toBe(times);
        this.last = (chunk[chunk.length - 1] as Invocation).order;
    }

    /** No interaction on the mocks after the last verified one. */
    public verifyNoMoreInteractions(): void {
        expect(this.timeline().map((inv) => inv.args)).toEqual([]);
    }
}
