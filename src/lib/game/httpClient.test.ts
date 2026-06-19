import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostedAvailableActionsScope, localGameApi, resetLocalSessionForTests } from './httpClient';

const view = {
  ready: true,
  phase: 0,
  phaseLabel: 'Player turn',
  turn: 1,
  activePlayerIndex: 0,
  players: [],
  prompts: [],
  logs: [],
  events: [],
};

function requestBody(fetchMock: ReturnType<typeof vi.fn>, callIndex: number) {
  const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body ?? '{}'));
}

describe('hosted headless requests', () => {
  afterEach(() => {
    resetLocalSessionForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('skips legality dry-runs for latency-sensitive mutation responses', () => {
    expect(hostedAvailableActionsScope({ type: 'playCard' })).toBe('none');
    expect(hostedAvailableActionsScope({ type: 'resolvePrompt' })).toBe('none');
    expect(hostedAvailableActionsScope({ type: 'attack' })).toBe('none');
    expect(hostedAvailableActionsScope({ type: 'retreat' })).toBe('none');
  });

  it('keeps default active-player legality for initial and explicit state requests', () => {
    expect(hostedAvailableActionsScope({ type: 'newGame' })).toBeUndefined();
    expect(hostedAvailableActionsScope({ type: 'state' })).toBeUndefined();
    expect(hostedAvailableActionsScope({ type: 'passTurn' })).toBeUndefined();
  });

  it('allows callers to opt back into scoped legality', () => {
    expect(hostedAvailableActionsScope({ type: 'playCard', availableActionsScope: 'active' })).toBe('active');
    expect(hostedAvailableActionsScope({ type: 'state', availableActionsScope: 'full' })).toBe('full');
  });

  it('recovers a lost local session before resolving a CABT prompt', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ ok: true, view, sessionId: 'session-123' }) })
      .mockResolvedValueOnce({ json: async () => ({ ok: true, view, sessionId: 'session-123' }) });
    vi.stubGlobal('fetch', fetchMock);

    await localGameApi.resolvePrompt(7, [0, 1]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/local-engine');
    expect(requestBody(fetchMock, 0)).toEqual({ type: 'state' });
    expect(requestBody(fetchMock, 1)).toMatchObject({
      type: 'resolvePrompt',
      payload: {
        id: 7,
        result: [0, 1],
        sessionId: 'session-123',
      },
    });
  });
});
