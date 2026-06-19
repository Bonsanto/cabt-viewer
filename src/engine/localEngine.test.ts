import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LocalEngineController } from './localEngine';
import { SlotType, targetFor } from '../lib/game/types';
import { CabtAreaType, CabtOptionType, CabtSelectContext } from '../lib/cabt/types';

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

    await engine.applySelection([0, 1, 2, 3]);

    expect(selections).toEqual([[0], [0], [0], [0], [0]]);
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
