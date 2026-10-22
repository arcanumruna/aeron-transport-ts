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
