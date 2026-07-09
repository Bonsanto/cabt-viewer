import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LocalEngineController } from './localEngine';
import { SlotType, targetFor } from '../lib/game/types';
import { CabtAreaType, CabtLogType, CabtOptionType, CabtSelectContext } from '../lib/cabt/types';

describe('LocalEngineController', () => {
  process.env.CABT_ENGINE_MODE = 'demo';

  it('starts a CABT-shaped demo game and exposes a playable view', async () => {
    const engine = new LocalEngineController();
    const res = await engine.handle({
      type: 'startGame',
      payload: {
        player1: { deck: [] },
        player2: { deck: [] },
      },
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.view.players).toHaveLength(2);
    expect(res.view.phaseLabel).toBe('Player turn');
    expect(res.view.players[0]?.active.pokemon?.name).toBe('Charmander');
    expect(res.view.players[0]?.availableActions?.active?.attacks[0]?.name).toBe('Ember');
  });

  it('accepts existing UI commands through the CABT adapter scaffold', async () => {
    const engine = new LocalEngineController();
    let res = await engine.handle({ type: 'startGame' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    res = await engine.handle({
      type: 'playCard',
      payload: {
        playerIndex: 0,
        handIndex: 0,
        target: targetFor(0, 0, SlotType.ACTIVE),
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.view.players[0]?.active.energy).toHaveLength(2);

    res = await engine.handle({ type: 'attack', payload: { playerIndex: 0, attack: 'Ember' } });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.view.activePlayerIndex).toBe(1);
      expect(res.view.logs.at(-2)?.message).toContain('Ember');
    }
  });

  it('starts self-vs-self without sending agent paths to the bridge', async () => {
    const engine = new LocalEngineController() as any;
    let bridgePayload: Record<string, unknown> | undefined;
    engine.bridge = {
      stop: () => {},
      request: async (payload: Record<string, unknown>) => {
        bridgePayload = payload;
        return { ok: true, observation: null, cards: [], attacks: [] };
      },
    };

    const res = await engine.start({
      player1: { deck: Array(60).fill(1), control: 'self' },
      player2: { deck: Array(60).fill(2), control: 'self', agentId: 'mega-lucario-ex' },
    });

    expect(res.ok).toBe(true);
    expect(bridgePayload?.agentControlled).toEqual([false, false]);
    expect(bridgePayload?.agentPaths).toEqual([undefined, undefined]);
  });

  it('wires agent-controlled players to their selected agent paths', async () => {
    const engine = new LocalEngineController() as any;
    let bridgePayload: Record<string, unknown> | undefined;
    engine.bridge = {
      stop: () => {},
      request: async (payload: Record<string, unknown>) => {
        bridgePayload = payload;
        return { ok: true, observation: null, cards: [], attacks: [] };
      },
    };

    const res = await engine.start({
      player1: { deck: Array(60).fill(1), control: 'agent', agentId: 'first-legal' },
      player2: { deck: Array(60).fill(2), control: 'agent', agentId: 'mega-lucario-ex' },
    });

    expect(res.ok).toBe(true);
    expect(bridgePayload?.agentControlled).toEqual([true, true]);
    expect(bridgePayload?.agentPaths).toEqual([undefined, 'public/agents/mega-lucario-ex/main.py']);
  });

  it('allows state requests to recover the current real CABT session id', async () => {
    const oldMode = process.env.CABT_ENGINE_MODE;
    delete process.env.CABT_ENGINE_MODE;
    try {
      const engine = new LocalEngineController() as any;
      engine.sessionId = 'recover-session';

      const res = await engine.handle({ type: 'state' });

      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.sessionId).toBe('recover-session');
    } finally {
      if (oldMode === undefined) {
        delete process.env.CABT_ENGINE_MODE;
      } else {
        process.env.CABT_ENGINE_MODE = oldMode;
      }
    }
  });

  it('marks concede unavailable for real CABT sessions', async () => {
    const oldMode = process.env.CABT_ENGINE_MODE;
    delete process.env.CABT_ENGINE_MODE;
    try {
      const engine = new LocalEngineController() as any;
      engine.sessionId = 'capability-session';

      const res = await engine.handle({ type: 'state' });

      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.view.capabilities?.concede).toBe(false);
    } finally {
      if (oldMode === undefined) {
        delete process.env.CABT_ENGINE_MODE;
      } else {
        process.env.CABT_ENGINE_MODE = oldMode;
      }
    }
  });

  it('matches real CABT main-phase hand options with omitted source fields', () => {
    const engine = new LocalEngineController() as any;
    const payload = {
      playerIndex: 0,
      handIndex: 3,
      target: targetFor(0, 0, SlotType.ACTIVE),
    };

    expect(engine.matchesPlayCardOption({ type: CabtOptionType.PLAY, index: 3 }, payload)).toBe(true);
    expect(engine.matchesPlayCardOption({
      type: CabtOptionType.ATTACH,
      area: CabtAreaType.HAND,
      index: 3,
      inPlayArea: CabtAreaType.ACTIVE,
      inPlayIndex: 0,
    }, payload)).toBe(true);
    expect(engine.matchesPlayCardOption({
      type: CabtOptionType.ATTACH,
      area: CabtAreaType.HAND,
      index: 3,
      inPlayArea: CabtAreaType.BENCH,
      inPlayIndex: 0,
    }, payload)).toBe(false);
  });

  it('matches CABT ability options to the clicked board slot and ability name', () => {
    const engine = new LocalEngineController() as any;
    engine.observation = {
      current: {
        players: [
          {
            active: [null],
            bench: [{ id: 96 }],
            hand: [],
          },
        ],
      },
    };
    engine.dataMaps = {
      cardData: {
        96: { cardId: 96, name: 'Teal Mask Ogerpon ex', cardType: 0, skills: [{ name: 'Teal Dance' }] },
      },
      attacks: {},
    };

    expect(engine.matchesAbilityOption({
      type: CabtOptionType.ABILITY,
      area: CabtAreaType.BENCH,
      index: 0,
    }, {
      playerIndex: 0,
      ability: 'Teal Dance',
      target: targetFor(0, 0, SlotType.BENCH, 0),
    })).toBe(true);
    expect(engine.matchesAbilityOption({
      type: CabtOptionType.ABILITY,
      area: CabtAreaType.BENCH,
      index: 0,
    }, {
      playerIndex: 0,
      ability: 'Wrong Ability',
      target: targetFor(0, 0, SlotType.BENCH, 0),
    })).toBe(false);
  });

  it('keeps a selected retreat target across intermediate CABT prompts', () => {
    const engine = new LocalEngineController() as any;
    engine.pendingRetreatTarget = { playerIndex: 0, benchIndex: 1 };
    engine.observation = {
      select: {
        option: [
          { area: CabtAreaType.BENCH, index: 0 },
          { area: CabtAreaType.BENCH, index: 1 },
        ],
      },
    };

    expect(engine.findPendingRetreatTargetOption()).toBe(1);
  });

  it('appends bridge auto-step logs to the action timeline sequence', () => {
    const engine = new LocalEngineController() as any;
    const current = currentState();

    engine.applyBridgeResponse({
      ok: true,
      id: 1,
      observation: {
        select: null,
        logs: [{ type: CabtLogType.TURN_END, playerIndex: 1 }],
        current,
      },
      autoSteps: [
        {
          select: null,
          logs: [{ type: CabtLogType.TURN_START, playerIndex: 1 }],
          current,
        },
        {
          select: null,
          logs: [{ type: CabtLogType.TURN_END, playerIndex: 1 }],
          current,
        },
      ],
    });

    const response = engine.viewResponse();

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.view.actionTimeline).toEqual([
      expect.objectContaining({ id: 1, message: 'Player 2 turn started.' }),
      expect.objectContaining({ id: 2, message: 'Player 2 ended their turn.' }),
    ]);
    expect(response.sequence).toEqual([
      expect.objectContaining({
        actionTimeline: [expect.objectContaining({ message: 'Player 2 turn started.' })],
      }),
      expect.objectContaining({
        actionTimeline: [
          expect.objectContaining({ message: 'Player 2 turn started.' }),
          expect.objectContaining({ message: 'Player 2 ended their turn.' }),
        ],
      }),
    ]);
  });

  it('inserts a playback reveal prompt for known deck-to-discard batches', () => {
    const engine = new LocalEngineController() as any;
    engine.dataMaps = {
      cardData: {
        3: { cardId: 3, name: 'Basic {W} Energy', cardType: 5, energyType: 3, set: 'SVE', setNumber: '3' },
        723: { cardId: 723, name: 'Mega Abomasnow ex', cardType: 0, set: 'MEG', setNumber: '36' },
      },
      attacks: {},
    };

    engine.applyBridgeResponse({
      ok: true,
      id: 1,
      observation: {
        select: null,
        logs: [
          { type: CabtLogType.MOVE_CARD, playerIndex: 0, cardId: 3, serial: 10, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.DISCARD },
          { type: CabtLogType.MOVE_CARD, playerIndex: 0, cardId: 723, serial: 11, fromArea: CabtAreaType.DECK, toArea: CabtAreaType.DISCARD },
        ],
        current: currentState(),
      },
      autoSteps: [],
    });

    const response = engine.viewResponse();
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const revealView = response.sequence?.[0];

    expect(revealView?.prompts[0]).toEqual(expect.objectContaining({
      className: 'ConfirmCardsPrompt',
      type: 'playback-reveal',
      message: 'Revealed and discarded cards',
    }));
    expect(revealView?.prompts[0]?.fields.cards).toEqual([
      expect.objectContaining({ name: 'Basic {W} Energy' }),
      expect.objectContaining({ name: 'Mega Abomasnow ex' }),
    ]);
    expect(response.sequence?.[1]?.prompts).toEqual([]);
  });

  it('skips agent decision frames according to manual player controls', () => {
    const engine = new LocalEngineController() as any;
    engine.playerControls = ['self', 'agent'];

    engine.applyBridgeResponse({
      ok: true,
      id: 1,
      observation: {
        select: null,
        logs: [],
        current: currentState(),
      },
      autoSteps: [
        {
          select: {
            type: 1,
            context: CabtSelectContext.TO_ACTIVE,
            minCount: 1,
            maxCount: 1,
            remainDamageCounter: 0,
            remainEnergyCost: 0,
            option: [{ type: CabtOptionType.CARD, area: CabtAreaType.BENCH, index: 0, playerIndex: 1 }],
            deck: null,
            contextCard: null,
            effect: null,
          },
          logs: [],
          current: currentState({ yourIndex: 1 }),
        },
        {
          select: null,
          logs: [],
          current: currentState({ yourIndex: 0 }),
        },
      ],
    });

    const response = engine.viewResponse();
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.sequence).toHaveLength(1);
    expect(response.sequence?.[0]?.prompts).toEqual([]);
  });

  it('batches repeated single-energy retreat payment prompts', async () => {
    const engine = new LocalEngineController() as any;
    const selections: number[][] = [];
    const activeWithFourEnergy = {
      id: 723,
      hp: 350,
      maxHp: 350,
      appearThisTurn: false,
      energies: [3, 3, 3, 3],
      energyCards: [10, 11, 12, 13].map((serial) => ({ id: 3, serial, playerIndex: 0 })),
      tools: [],
      preEvolution: [],
    };
    const current = {
      turn: 1,
      turnActionCount: 0,
      yourIndex: 0,
      firstPlayer: 0,
      supporterPlayed: false,
      stadiumPlayed: false,
      energyAttached: true,
      retreated: false,
      result: -1,
      stadium: [],
      looking: null,
      players: [
        {
          active: [activeWithFourEnergy],
          bench: [{ id: 722, hp: 90, maxHp: 90, appearThisTurn: false, energies: [], energyCards: [], tools: [], preEvolution: [] }],
          benchMax: 5,
          deckCount: 47,
          discard: [],
          prize: [],
          handCount: 0,
          hand: [],
          poisoned: false,
          burned: false,
          asleep: false,
          paralyzed: false,
          confused: false,
        },
        {
          active: [null],
          bench: [],
          benchMax: 5,
          deckCount: 47,
          discard: [],
          prize: [],
          handCount: 0,
          hand: [],
          poisoned: false,
          burned: false,
          asleep: false,
          paralyzed: false,
          confused: false,
        },
      ],
    };
    const energySelect = (energyCards: typeof activeWithFourEnergy.energyCards) => ({
      type: 1,
      context: CabtSelectContext.DISCARD_ENERGY_CARD,
      minCount: 1,
      maxCount: 1,
      remainDamageCounter: 0,
      remainEnergyCost: energyCards.length,
      option: energyCards.map((_card, energyIndex) => ({
        type: CabtOptionType.ENERGY_CARD,
        area: CabtAreaType.ACTIVE,
        index: 0,
        energyIndex,
        playerIndex: 0,
      })),
      deck: null,
      contextCard: null,
      effect: null,
    });

    engine.sessionId = 'test-session';
    engine.pendingRetreatTarget = { playerIndex: 0, benchIndex: 0 };
    engine.dataMaps = { cardData: {}, attacks: {} };
    engine.observation = {
      select: energySelect(activeWithFourEnergy.energyCards),
      logs: [],
      current,
    };
    engine.bridge = {
      request: async ({ selection }: { selection: number[] }) => {
        selections.push(selection);
        activeWithFourEnergy.energyCards.shift();
        activeWithFourEnergy.energies.shift();
        if (activeWithFourEnergy.energyCards.length) {
          return {
            ok: true,
            observation: { select: energySelect(activeWithFourEnergy.energyCards), logs: [], current },
          };
        }
        return {
          ok: true,
          observation: {
            select: {
              type: 1,
              context: CabtSelectContext.TO_ACTIVE,
              minCount: 1,
              maxCount: 1,
              remainDamageCounter: 0,
              remainEnergyCost: 0,
              option: [{ type: CabtOptionType.CARD, area: CabtAreaType.BENCH, index: 0, playerIndex: 0 }],
              deck: null,
              contextCard: null,
              effect: null,
            },
            logs: [],
            current,
          },
        };
      },
    };

    const response = await engine.applySelection([0, 1, 2, 3]);

    expect(selections).toEqual([[0], [0], [0], [0], [0]]);
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.sequence).toHaveLength(5);
  });

  it('rejects duplicate repeated energy-payment selections before CABT requests', async () => {
    const engine = new LocalEngineController() as any;
    let bridgeCalled = false;
    engine.observation = {
      select: {
        type: 2,
        context: CabtSelectContext.DISCARD_ENERGY,
        minCount: 1,
        maxCount: 1,
        remainDamageCounter: 0,
        remainEnergyCost: 2,
        option: [
          { type: CabtOptionType.ENERGY_CARD, area: CabtAreaType.ACTIVE, index: 0, energyIndex: 0, playerIndex: 0 },
          { type: CabtOptionType.ENERGY_CARD, area: CabtAreaType.ACTIVE, index: 0, energyIndex: 1, playerIndex: 0 },
        ],
        deck: null,
        contextCard: null,
        effect: null,
      },
      logs: [],
      current: { turn: 4, turnActionCount: 3, yourIndex: 0 },
    };
    engine.bridge = {
      request: async () => {
        bridgeCalled = true;
        return {
          ok: true,
          observation: { select: null, logs: [], current: engine.observation.current },
        };
      },
    };

    await expect(engine.applySelection([0, 0])).rejects.toThrow(/1-1/);
    expect(bridgeCalled).toBe(false);
  });

  it('batches repeated CABT damage-counter prompts and allows duplicate targets', async () => {
    const engine = new LocalEngineController() as any;
    const selections: number[][] = [];
    const current = {
      turn: 8,
      turnActionCount: 4,
      yourIndex: 0,
      firstPlayer: 0,
      supporterPlayed: false,
      stadiumPlayed: false,
      energyAttached: true,
      retreated: false,
      result: -1,
      stadium: [],
      looking: null,
      players: [],
    };
    let remaining = 4;
    const damageSelect = () => ({
      type: 1,
      context: CabtSelectContext.DAMAGE_COUNTER_ANY,
      minCount: 1,
      maxCount: 1,
      remainDamageCounter: remaining,
      remainEnergyCost: 0,
      option: [
        { type: CabtOptionType.CARD, area: CabtAreaType.BENCH, index: 0, playerIndex: 1 },
        { type: CabtOptionType.CARD, area: CabtAreaType.BENCH, index: 1, playerIndex: 1 },
      ],
      deck: null,
      contextCard: null,
      effect: null,
    });
    engine.sessionId = 'test-session';
    engine.dataMaps = { cardData: {}, attacks: {} };
    engine.observation = {
      select: damageSelect(),
      logs: [],
      current,
    };
    engine.bridge = {
      request: async ({ selection }: { selection: number[] }) => {
        selections.push(selection);
        remaining -= 1;
        return {
          ok: true,
          observation: { select: remaining > 0 ? damageSelect() : null, logs: [], current },
        };
      },
    };

    await engine.applySelection([0, 0, 1, 0]);

    expect(selections).toEqual([[0], [0], [1], [0]]);
  });

  it('does not redirect batched damage counters when a later target is missing', async () => {
    const engine = new LocalEngineController() as any;
    const selections: number[][] = [];
    const current = {
      turn: 8,
      turnActionCount: 4,
      yourIndex: 0,
      firstPlayer: 0,
      supporterPlayed: false,
      stadiumPlayed: false,
      energyAttached: true,
      retreated: false,
      result: -1,
      stadium: [],
      looking: null,
      players: [],
    };
    const damageSelect = (options: number[]) => ({
      type: 1,
      context: CabtSelectContext.DAMAGE_COUNTER_ANY,
      minCount: 1,
      maxCount: 1,
      remainDamageCounter: 2,
      remainEnergyCost: 0,
      option: options.map((index) => ({
        type: CabtOptionType.CARD,
        area: CabtAreaType.BENCH,
        index,
        playerIndex: 1,
      })),
      deck: null,
      contextCard: null,
      effect: null,
    });
    engine.sessionId = 'test-session';
    engine.dataMaps = { cardData: {}, attacks: {} };
    engine.observation = {
      select: damageSelect([0, 1]),
      logs: [],
      current,
    };
    engine.bridge = {
      request: async ({ selection }: { selection: number[] }) => {
        selections.push(selection);
        return {
          ok: true,
          observation: { select: damageSelect([0]), logs: [], current },
        };
      },
    };

    await engine.applySelection([0, 1]);

    expect(selections).toEqual([[0]]);
  });

  it('writes full private human trace snapshots for local selections', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cabt-traces-'));
    const traceDir = path.join(root, 'private', 'traces');
    const oldTraceDir = process.env.CABT_TRACE_DIR;
    const oldTraceEnabled = process.env.CABT_TRACE_ENABLED;
    process.env.CABT_TRACE_DIR = traceDir;
    process.env.CABT_TRACE_ENABLED = '1';
    try {
      const engine = new LocalEngineController() as any;
      const current = {
        turn: 4,
        turnActionCount: 3,
        yourIndex: 0,
        firstPlayer: 0,
        supporterPlayed: false,
        stadiumPlayed: false,
        energyAttached: false,
        retreated: false,
        result: -1,
        stadium: [],
        looking: null,
        players: [],
      };
      engine.sessionId = 'trace-test-session';
      engine.dataMaps = { cardData: {}, attacks: {} };
      engine.observation = {
        select: {
          type: 0,
          context: CabtSelectContext.MAIN,
          minCount: 1,
          maxCount: 1,
          remainDamageCounter: 0,
          remainEnergyCost: 0,
          option: [
            { type: CabtOptionType.PLAY, area: CabtAreaType.HAND, index: 7 },
            { type: CabtOptionType.END },
          ],
          deck: null,
          contextCard: null,
          effect: null,
        },
        logs: [],
        current,
      };
      engine.traceRecorder.start('trace-test-session');
      engine.bridge = {
        request: async () => ({
          ok: true,
          observation: {
            select: null,
            logs: [],
            current: { ...current, turnActionCount: 4 },
          },
        }),
      };

      await engine.applySelection([1]);

      const files = fs.readdirSync(traceDir);
      expect(files).toHaveLength(1);
      const trace = JSON.parse(fs.readFileSync(path.join(traceDir, files[0]!), 'utf8'));
      expect(trace.kind).toBe('human_play_trace');
      expect(trace.source.tool).toBe('cabt-viewer');
      expect(trace.segments[0].turn).toBe(4);
      expect(trace.segments[0].decisions[0].chosenAction).toEqual([1]);
      expect(trace.segments[0].decisions[0].legalOptionIds).toEqual(['select:0', 'select:1']);
      expect(trace.segments[0].decisions[0].legalOptions[0]).toMatchObject({
        optionIndex: 0,
        type: CabtOptionType.PLAY,
        area: CabtAreaType.HAND,
        index: 7,
      });
      expect(trace.segments[0].decisions[0].observation.select.context).toBe(CabtSelectContext.MAIN);
      expect(trace.segments[0].decisions[0].outcome).toMatchObject({
        terminal: false,
        result: -1,
        turn: 4,
        activePlayer: 0,
        turnActionIndex: 4,
        nextContext: null,
        nextOptionCount: 0,
      });
    } finally {
      if (oldTraceDir === undefined) {
        delete process.env.CABT_TRACE_DIR;
      } else {
        process.env.CABT_TRACE_DIR = oldTraceDir;
      }
      if (oldTraceEnabled === undefined) {
        delete process.env.CABT_TRACE_ENABLED;
      } else {
        process.env.CABT_TRACE_ENABLED = oldTraceEnabled;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not record agent-controlled selections as human trace decisions', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cabt-traces-'));
    const traceDir = path.join(root, 'private', 'traces');
    const oldTraceDir = process.env.CABT_TRACE_DIR;
    const oldTraceEnabled = process.env.CABT_TRACE_ENABLED;
    process.env.CABT_TRACE_DIR = traceDir;
    process.env.CABT_TRACE_ENABLED = '1';
    try {
      const engine = new LocalEngineController() as any;
      const current = {
        turn: 2,
        turnActionCount: 1,
        yourIndex: 0,
        firstPlayer: 0,
        supporterPlayed: false,
        stadiumPlayed: false,
        energyAttached: false,
        retreated: false,
        result: -1,
        stadium: [],
        looking: null,
        players: [],
      };
      engine.sessionId = 'agent-trace-session';
      engine.playerControls = ['agent', 'self'];
      engine.dataMaps = { cardData: {}, attacks: {} };
      engine.observation = {
        select: {
          type: 0,
          context: CabtSelectContext.MAIN,
          minCount: 1,
          maxCount: 1,
          remainDamageCounter: 0,
          remainEnergyCost: 0,
          option: [{ type: CabtOptionType.END }],
          deck: null,
          contextCard: null,
          effect: null,
        },
        logs: [],
        current,
      };
      engine.traceRecorder.start('agent-trace-session', { playerControls: ['agent', 'self'] });
      engine.bridge = {
        request: async () => ({
          ok: true,
          observation: {
            select: null,
            logs: [],
            current: { ...current, turnActionCount: 2 },
          },
        }),
      };

      await engine.applySelection([0]);

      expect(fs.existsSync(traceDir) ? fs.readdirSync(traceDir) : []).toEqual([]);
    } finally {
      if (oldTraceDir === undefined) {
        delete process.env.CABT_TRACE_DIR;
      } else {
        process.env.CABT_TRACE_DIR = oldTraceDir;
      }
      if (oldTraceEnabled === undefined) {
        delete process.env.CABT_TRACE_ENABLED;
      } else {
        process.env.CABT_TRACE_ENABLED = oldTraceEnabled;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('tags the latest private trace with trust, confidence, notes, and plan tags', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cabt-traces-'));
    const traceDir = path.join(root, 'private', 'traces');
    const oldTraceDir = process.env.CABT_TRACE_DIR;
    process.env.CABT_TRACE_DIR = traceDir;
    try {
      fs.mkdirSync(traceDir, { recursive: true });
      const tracePath = path.join(traceDir, 'cabt-tag-session.jsonl');
      fs.writeFileSync(tracePath, `${JSON.stringify({
        schemaVersion: 1,
        kind: 'human_play_trace',
        traceId: 'cabt-tag-session',
        createdAt: '2026-06-20T00:00:00Z',
        source: { tool: 'cabt-viewer', reviewer: 'local-reviewer', runId: 'cabt-tag-session' },
        trust: 'silver',
        confidence: 4,
        segments: [],
      })}\n`, 'utf8');

      const engine = new LocalEngineController();
      const response = engine.tagLatestTrace({
        trust: 'gold',
        confidence: 5,
        note: 'mirror_second_perfect_win',
        tags: 'mirror,perfect,mirror',
      });

      expect(response).toMatchObject({
        ok: true,
        trust: 'gold',
        confidence: 5,
        qualityNoteCount: 1,
        planTagCount: 1,
      });
      const tagged = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
      expect(tagged.trust).toBe('gold');
      expect(tagged.confidence).toBe(5);
      expect(tagged.qualityNotes[0]).toMatchObject({
        source: 'cabt-ui',
        note: 'mirror_second_perfect_win',
      });
      expect(tagged.planTags.tags).toEqual(['mirror', 'perfect']);
    } finally {
      if (oldTraceDir === undefined) {
        delete process.env.CABT_TRACE_DIR;
      } else {
        process.env.CABT_TRACE_DIR = oldTraceDir;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('tags the active session trace even when a newer trace file exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cabt-traces-'));
    const traceDir = path.join(root, 'private', 'traces');
    const oldTraceDir = process.env.CABT_TRACE_DIR;
    const oldTraceEnabled = process.env.CABT_TRACE_ENABLED;
    process.env.CABT_TRACE_DIR = traceDir;
    process.env.CABT_TRACE_ENABLED = '1';
    try {
      fs.mkdirSync(traceDir, { recursive: true });
      const engine = new LocalEngineController() as any;
      const current = {
        turn: 3,
        turnActionCount: 1,
        yourIndex: 0,
        firstPlayer: 0,
        supporterPlayed: false,
        stadiumPlayed: false,
        energyAttached: false,
        retreated: false,
        result: -1,
        stadium: [],
        looking: null,
        players: [],
      };
      const observation = {
        select: {
          type: 0,
          context: CabtSelectContext.MAIN,
          minCount: 1,
          maxCount: 1,
          remainDamageCounter: 0,
          remainEnergyCost: 0,
          option: [{ type: CabtOptionType.ATTACK, attackId: 1 }],
          deck: null,
          contextCard: null,
          effect: null,
        },
        logs: [],
        current,
      };
      // Active session writes its own trace file.
      engine.traceRecorder.start('active-session');
      engine.traceRecorder.record(observation, [0]);
      const activePath = path.join(traceDir, 'cabt-active-session.jsonl');
      expect(fs.existsSync(activePath)).toBe(true);

      // A decoy trace with a strictly newer mtime than the active file. The old
      // mtime-based lookup would mistakenly tag this one.
      const decoyPath = path.join(traceDir, 'cabt-decoy.jsonl');
      fs.writeFileSync(decoyPath, `${JSON.stringify({
        schemaVersion: 1,
        kind: 'human_play_trace',
        traceId: 'cabt-decoy',
        createdAt: '2026-06-20T00:00:00Z',
        source: { tool: 'cabt-viewer', reviewer: 'local-reviewer', runId: 'cabt-decoy' },
        trust: 'silver',
        confidence: 4,
        segments: [],
      })}\n`, 'utf8');
      const future = new Date(Date.now() + 60_000);
      fs.utimesSync(decoyPath, future, future);

      const response = engine.tagLatestTrace({
        trust: 'gold',
        confidence: 5,
        note: 'going_first',
        tags: 'mirror',
      });
      expect(response.ok).toBe(true);

      const activeTrace = JSON.parse(fs.readFileSync(activePath, 'utf8').trim());
      expect(activeTrace.trust).toBe('gold');
      expect(activeTrace.confidence).toBe(5);
      expect(activeTrace.qualityNotes[0]).toMatchObject({ note: 'going_first' });

      // Decoy is untouched.
      const decoyTrace = JSON.parse(fs.readFileSync(decoyPath, 'utf8').trim());
      expect(decoyTrace.trust).toBe('silver');
      expect(decoyTrace.confidence).toBe(4);
    } finally {
      if (oldTraceDir === undefined) {
        delete process.env.CABT_TRACE_DIR;
      } else {
        process.env.CABT_TRACE_DIR = oldTraceDir;
      }
      if (oldTraceEnabled === undefined) {
        delete process.env.CABT_TRACE_ENABLED;
      } else {
        process.env.CABT_TRACE_ENABLED = oldTraceEnabled;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('records terminal post-action outcomes for completed games', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cabt-traces-'));
    const traceDir = path.join(root, 'private', 'traces');
    const oldTraceDir = process.env.CABT_TRACE_DIR;
    const oldTraceEnabled = process.env.CABT_TRACE_ENABLED;
    process.env.CABT_TRACE_DIR = traceDir;
    process.env.CABT_TRACE_ENABLED = '1';
    try {
      const engine = new LocalEngineController() as any;
      const current = {
        turn: 12,
        turnActionCount: 7,
        yourIndex: 0,
        firstPlayer: 0,
        supporterPlayed: false,
        stadiumPlayed: false,
        energyAttached: false,
        retreated: false,
        result: -1,
        stadium: [],
        looking: null,
        players: [],
      };
      engine.sessionId = 'trace-terminal-session';
      engine.dataMaps = { cardData: {}, attacks: {} };
      engine.observation = {
        select: {
          type: 0,
          context: CabtSelectContext.MAIN,
          minCount: 1,
          maxCount: 1,
          remainDamageCounter: 0,
          remainEnergyCost: 0,
          option: [{ type: CabtOptionType.ATTACK, attackId: 99 }],
          deck: null,
          contextCard: null,
          effect: null,
        },
        logs: [],
        current,
      };
      engine.traceRecorder.start('trace-terminal-session');
      engine.bridge = {
        request: async () => ({
          ok: true,
          observation: {
            select: null,
            logs: [],
            current: { ...current, turnActionCount: 8, result: 1 },
          },
        }),
      };

      await engine.applySelection([0]);

      const files = fs.readdirSync(traceDir);
      expect(files).toHaveLength(1);
      const trace = JSON.parse(fs.readFileSync(path.join(traceDir, files[0]!), 'utf8'));
      expect(trace.segments[0].decisions[0].outcome).toMatchObject({
        terminal: true,
        result: 1,
        turn: 12,
        activePlayer: 0,
        turnActionIndex: 8,
        nextContext: null,
        nextSelectType: null,
        nextOptionCount: 0,
      });
    } finally {
      if (oldTraceDir === undefined) {
        delete process.env.CABT_TRACE_DIR;
      } else {
        process.env.CABT_TRACE_DIR = oldTraceDir;
      }
      if (oldTraceEnabled === undefined) {
        delete process.env.CABT_TRACE_ENABLED;
      } else {
        process.env.CABT_TRACE_ENABLED = oldTraceEnabled;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('disables trace capture for unsafe directories without blocking gameplay', async () => {
    const unsafeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cabt-unsafe-'));
    const oldTraceDir = process.env.CABT_TRACE_DIR;
    const oldTraceEnabled = process.env.CABT_TRACE_ENABLED;
    process.env.CABT_TRACE_DIR = unsafeDir;
    process.env.CABT_TRACE_ENABLED = '1';
    try {
      const engine = new LocalEngineController() as any;
      expect(() => engine.traceRecorder.start('unsafe-session')).not.toThrow();
      expect(engine.traceRecorder.trace).toBeNull();
      expect(engine.traceRecorder.filePath).toBe('');
    } finally {
      if (oldTraceDir === undefined) {
        delete process.env.CABT_TRACE_DIR;
      } else {
        process.env.CABT_TRACE_DIR = oldTraceDir;
      }
      if (oldTraceEnabled === undefined) {
        delete process.env.CABT_TRACE_ENABLED;
      } else {
        process.env.CABT_TRACE_ENABLED = oldTraceEnabled;
      }
      fs.rmSync(unsafeDir, { recursive: true, force: true });
    }
  });

  it('does not let trace write failures block valid selections', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cabt-traces-'));
    const traceDir = path.join(root, 'private', 'traces');
    const oldTraceDir = process.env.CABT_TRACE_DIR;
    const oldTraceEnabled = process.env.CABT_TRACE_ENABLED;
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('disk full');
    });
    process.env.CABT_TRACE_DIR = traceDir;
    process.env.CABT_TRACE_ENABLED = '1';
    try {
      const engine = new LocalEngineController() as any;
      const current = {
        turn: 4,
        turnActionCount: 3,
        yourIndex: 0,
        firstPlayer: 0,
        supporterPlayed: false,
        stadiumPlayed: false,
        energyAttached: false,
        retreated: false,
        result: -1,
        stadium: [],
        looking: null,
        players: [],
      };
      let bridgeCalled = false;
      engine.sessionId = 'trace-write-failure-session';
      engine.dataMaps = { cardData: {}, attacks: {} };
      engine.observation = {
        select: {
          type: 0,
          context: CabtSelectContext.MAIN,
          minCount: 1,
          maxCount: 1,
          remainDamageCounter: 0,
          remainEnergyCost: 0,
          option: [
            { type: CabtOptionType.PLAY, area: CabtAreaType.HAND, index: 7 },
            { type: CabtOptionType.END },
          ],
          deck: null,
          contextCard: null,
          effect: null,
        },
        logs: [],
        current,
      };
      engine.traceRecorder.start('trace-write-failure-session');
      engine.bridge = {
        request: async () => {
          bridgeCalled = true;
          return {
            ok: true,
            observation: {
              select: null,
              logs: [],
              current: { ...current, turnActionCount: 4 },
            },
          };
        },
      };

      await expect(engine.applySelection([1])).resolves.toMatchObject({ ok: true });

      expect(bridgeCalled).toBe(true);
      expect(engine.traceRecorder.trace).toBeNull();
    } finally {
      writeSpy.mockRestore();
      if (oldTraceDir === undefined) {
        delete process.env.CABT_TRACE_DIR;
      } else {
        process.env.CABT_TRACE_DIR = oldTraceDir;
      }
      if (oldTraceEnabled === undefined) {
        delete process.env.CABT_TRACE_ENABLED;
      } else {
        process.env.CABT_TRACE_ENABLED = oldTraceEnabled;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects invalid selections before CABT requests', async () => {
    const engine = new LocalEngineController() as any;
    let bridgeCalled = false;
    engine.observation = {
      select: {
        type: 0,
        context: CabtSelectContext.MAIN,
        minCount: 1,
        maxCount: 1,
        remainDamageCounter: 0,
        remainEnergyCost: 0,
        option: [{ type: CabtOptionType.END }],
        deck: null,
        contextCard: null,
        effect: null,
      },
      logs: [],
      current: { turn: 0, turnActionCount: 0, yourIndex: 0 },
    };
    engine.bridge = {
      request: async () => {
        bridgeCalled = true;
        return {
          ok: true,
          observation: { select: null, logs: [], current: engine.observation.current },
        };
      },
    };

    await expect(engine.applySelection([3])).rejects.toThrow(/outside/);
    await expect(engine.applySelection([0, 0])).rejects.toThrow(/1-1/);
    expect(bridgeCalled).toBe(false);
  });

  it('rejects normal actions while a CABT prompt is pending', async () => {
    const oldMode = process.env.CABT_ENGINE_MODE;
    delete process.env.CABT_ENGINE_MODE;
    try {
      const engine = new LocalEngineController() as any;
      engine.sessionId = 'prompt-session';
      engine.observation = {
        select: {
          type: 1,
          context: CabtSelectContext.TO_HAND,
          minCount: 1,
          maxCount: 1,
          remainDamageCounter: 0,
          remainEnergyCost: 0,
          option: [{ type: CabtOptionType.CARD, area: CabtAreaType.LOOKING, index: 0 }],
          deck: null,
          contextCard: null,
          effect: null,
        },
        logs: [],
        current: {
          turn: 6,
          turnActionCount: 4,
          yourIndex: 0,
          firstPlayer: 0,
          supporterPlayed: false,
          stadiumPlayed: false,
          energyAttached: false,
          retreated: false,
          result: -1,
          stadium: [],
          looking: null,
          players: [],
        },
      };

      const res = await engine.handle({
        type: 'playCard',
        payload: {
          sessionId: 'prompt-session',
          playerIndex: 0,
          handIndex: 1,
          target: targetFor(0, 0, SlotType.ACTIVE),
        },
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain('Resolve the current CABT prompt');
      }
    } finally {
      if (oldMode === undefined) {
        delete process.env.CABT_ENGINE_MODE;
      } else {
        process.env.CABT_ENGINE_MODE = oldMode;
      }
    }
  });
});

function currentState(overrides: Record<string, unknown> = {}) {
  return {
    turn: 2,
    turnActionCount: 0,
    yourIndex: 0,
    firstPlayer: 0,
    supporterPlayed: false,
    stadiumPlayed: false,
    energyAttached: true,
    retreated: false,
    result: -1,
    stadium: [],
    looking: null,
    players: [
      playerState({ hand: [], handCount: 0 }),
      playerState({ hand: null, handCount: 0 }),
    ],
    ...overrides,
  };
}

function playerState(overrides: Record<string, unknown> = {}) {
  return {
    active: [null],
    bench: [],
    benchMax: 5,
    deckCount: 47,
    discard: [],
    prize: [],
    handCount: 0,
    hand: [],
    poisoned: false,
    burned: false,
    asleep: false,
    paralyzed: false,
    confused: false,
    ...overrides,
  };
}
