// Mockito's `mock(Agent.class)` and `mock(ErrorHandler.class)`: hand fakes whose methods record their calls. The
// defaults are Mockito's: `doWork()` returns 0 and does nothing else.
import { vi } from 'vitest';
import type { Agent } from '../../src/agrona/concurrent/Agent.js';
import type { ErrorHandler } from '../../src/agrona/ErrorHandler.js';

export interface MockAgent extends Agent {
    onStart: ReturnType<typeof vi.fn<() => void>>;
    doWork: ReturnType<typeof vi.fn<() => number>>;
    onClose: ReturnType<typeof vi.fn<() => void>>;
    roleName: ReturnType<typeof vi.fn<() => string>>;
}

export function mockAgent(roleName = 'mock'): MockAgent {
    return {
        onStart: vi.fn<() => void>(),
        doWork: vi.fn<() => number>(() => 0),
        onClose: vi.fn<() => void>(),
        roleName: vi.fn<() => string>(() => roleName),
    };
}

/** Mockito's `reset(mock)`. */
export function resetAgent(agent: MockAgent): void {
    agent.onStart.mockReset();
    agent.doWork.mockReset();
    agent.doWork.mockImplementation(() => 0);
    agent.onClose.mockReset();
    agent.roleName.mockReset();
    agent.roleName.mockImplementation(() => 'mock');
}

export interface MockErrorHandler extends ErrorHandler {
    onError: ReturnType<typeof vi.fn<(throwable: Error) => void>>;
}

export function mockErrorHandler(): MockErrorHandler {
    return { onError: vi.fn<(throwable: Error) => void>() };
}
