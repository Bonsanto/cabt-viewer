import type { GameCommandApi } from './gameApi';
import type { CardTarget, EngineResponse } from './types';

type Command = {
  type: string;
  payload?: unknown;
  availableActionsScope?: AvailableActionsScope;
};

type AvailableActionsScope = 'none' | 'active' | 'full';

const LOCAL_SESSION_STORAGE_KEY = 'cabt.localSessionId';

let currentSessionId = readStoredSessionId();

function readStoredSessionId(): string {
  try {
    return globalThis.sessionStorage?.getItem(LOCAL_SESSION_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeSessionId(sessionId: string): void {
  currentSessionId = sessionId;
  try {
    globalThis.sessionStorage?.setItem(LOCAL_SESSION_STORAGE_KEY, sessionId);
  } catch {
    // Ignore storage failures; the in-memory session id is enough until reload.
  }
}

function clearSessionId(): void {
  currentSessionId = '';
  try {
    globalThis.sessionStorage?.removeItem(LOCAL_SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

async function recoverCurrentSession(): Promise<void> {
  if (currentSessionId) {
    return;
  }
  const response = await fetch('/local-engine', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'state' }),
  });
  const body = await response.json() as EngineResponse;
  if (body.ok && body.sessionId) {
    storeSessionId(body.sessionId);
  }
}

async function send(command: Command): Promise<EngineResponse> {
  if (command.type !== 'startGame' && command.type !== 'state' && !currentSessionId) {
    await recoverCurrentSession();
  }
  const commandWithSession = command.type === 'startGame' || !currentSessionId
    ? command
    : {
        ...command,
        payload: {
          ...(command.payload && typeof command.payload === 'object' ? command.payload : {}),
          sessionId: currentSessionId,
        },
      };
  const response = await fetch('/local-engine', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commandWithSession),
  });
  const body = await response.json() as EngineResponse;
  if (body.ok && body.sessionId) {
    storeSessionId(body.sessionId);
  } else if (!body.ok && body.error.includes('session')) {
    clearSessionId();
  }
  return body;
}

export function resetLocalSessionForTests(): void {
  clearSessionId();
}

export function hostedAvailableActionsScope(command: Command): AvailableActionsScope | undefined {
  if (command.availableActionsScope) {
    return command.availableActionsScope;
  }

  switch (command.type) {
    case 'playCard':
    case 'attack':
    case 'useAbility':
    case 'useStadium':
    case 'concede':
    case 'retreat':
    case 'resolvePrompt':
      return 'none';
    default:
      return undefined;
  }
}

function hostedAvailableActionsOptions(command: Command): { availableActionsScope?: AvailableActionsScope } {
  const availableActionsScope = hostedAvailableActionsScope(command);
  return availableActionsScope ? { availableActionsScope } : {};
}

export const localGameApi: GameCommandApi & {
  start(player1Deck: string[], player2Deck: string[], agentId?: string): Promise<EngineResponse>;
  state(): Promise<EngineResponse>;
} = {
  start(player1Deck: string[], player2Deck: string[], agentId?: string) {
    return send({
      type: 'startGame',
      payload: {
        player1: { name: 'Player 1', deck: player1Deck },
        player2: { name: 'AI Opponent', deck: player2Deck, agentId },
      },
    });
  },

  state() {
    return send({ type: 'state' });
  },

  playCard(playerIndex: number, handIndex: number, target: CardTarget) {
    return send({ type: 'playCard', payload: { playerIndex, handIndex, target } });
  },

  attack(playerIndex: number, attack: string) {
    return send({ type: 'attack', payload: { playerIndex, attack } });
  },

  useAbility(playerIndex: number, ability: string, target: CardTarget) {
    return send({ type: 'useAbility', payload: { playerIndex, ability, target } });
  },

  useStadium(playerIndex: number) {
    return send({ type: 'useStadium', payload: { playerIndex } });
  },

  concede(playerIndex: number) {
    return send({ type: 'concede', payload: { playerIndex } });
  },

  retreat(playerIndex: number, to: number) {
    return send({ type: 'retreat', payload: { playerIndex, to } });
  },

  passTurn(playerIndex: number) {
    return send({ type: 'passTurn', payload: { playerIndex } });
  },

  resolvePrompt(id: number, result: unknown) {
    return send({ type: 'resolvePrompt', payload: { id, result } });
  },
};
