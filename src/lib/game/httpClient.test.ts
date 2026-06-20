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

  it('sends player control and agent ids when starting a local CABT game', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true, view, sessionId: 'session-456' }) });
    vi.stubGlobal('fetch', fetchMock);

    await localGameApi.start(['A'], ['B'], {
      player1Control: 'agent',
      player2Control: 'self',
      player1AgentId: 'p1-agent',
      player2AgentId: 'p2-agent',
    });

    expect(requestBody(fetchMock, 0)).toEqual({
      type: 'startGame',
      payload: {
        player1: {
          name: 'Player 1',
          deck: ['A'],
          control: 'agent',
          agentId: 'p1-agent',
        },
        player2: {
          name: 'Player 2',
          deck: ['B'],
          control: 'self',
          agentId: 'p2-agent',
        },
      },
    });
  });

  it('posts latest-trace annotations without requiring a session id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, trust: 'gold', confidence: 5, qualityNoteCount: 1, planTagCount: 1 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await localGameApi.tagLatestTrace({
      trust: 'gold',
      confidence: 5,
      note: 'mirror_second_perfect_win',
      tags: 'mirror,perfect',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/local-engine/traces/tag-latest');
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      trust: 'gold',
      confidence: 5,
      note: 'mirror_second_perfect_win',
      tags: 'mirror,perfect',
    });
  });
});
