import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { CabtDemoController, cabtObservationToGameView, type CabtDataMaps } from '../lib/cabt/demoEngine';
import {
  CabtAreaType,
  CabtOptionType,
  CabtSelectContext,
  type CabtAttack,
  type CabtCard,
  type CabtCardData,
  type CabtObservation,
  type CabtOption,
  type CabtSelectData,
} from '../lib/cabt/types';
import rawCardRows from '../lib/cabt/cardData.generated.json';
import type { CardTarget, EngineResponse, LogView } from '../lib/game/types';
import { PlayerType, SlotType } from '../lib/game/types';
import type { ReplayLoadResponse } from '../lib/game/replay';

type Command = {
  type: string;
  payload?: any;
};

type BridgeResponse = {
  ok: boolean;
  id: number;
  error?: string;
  traceback?: string;
  observation?: CabtObservation;
  cards?: CabtCardData[];
  attacks?: CabtAttack[];
};

type PendingBridgeCall = {
  resolve: (value: BridgeResponse) => void;
  reject: (error: Error) => void;
};

type PendingRetreatTarget = {
  playerIndex: number;
  benchIndex: number;
};

type AgentManifest = {
  agents?: Array<{
    id: string;
    path?: string;
    deckUrl?: string;
  }>;
};

type HumanTraceRecord = {
  schemaVersion: 1;
  kind: 'human_play_trace';
  traceId: string;
  createdAt: string;
  source: {
    tool: 'cabt-viewer';
    reviewer: string;
    runId: string;
    agentPath?: string;
  };
  trust: string;
  confidence: number;
  segments: Array<{
    game: number;
    turn: number;
    player: number;
    turnPlan: string;
    decisions: Array<Record<string, unknown>>;
  }>;
};

type HumanTraceOutcome = {
  terminal: boolean;
  result: number | null;
  turn: number | null;
  activePlayer: number | null;
  turnActionIndex: number | null;
  nextContext: number | null;
  nextSelectType: number | null;
  nextMinCount: number | null;
  nextMaxCount: number | null;
  nextOptionCount: number;
};

const TRACE_TRUST_TIERS = new Set(['gold', 'silver', 'bronze', 'debug', 'unreliable']);

const CARD_ROWS = rawCardRows as Array<{
  id: number;
  name: string;
  set: string;
  setNumber: string;
}>;
const CARD_ROWS_BY_ID = new Map<number, (typeof CARD_ROWS)[number]>();
for (const row of CARD_ROWS) {
  if (!CARD_ROWS_BY_ID.has(row.id)) {
    CARD_ROWS_BY_ID.set(row.id, row);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, '..', '..');
const WORKSPACE_ROOT = path.resolve(FRONTEND_ROOT, '..');
const BRIDGE_PATH = path.join(FRONTEND_ROOT, 'src', 'engine', 'cabt_bridge.py');

export class LocalEngineController {
  private readonly demo = new CabtDemoController();
  private readonly bridge: CabtBridgeClient;
  private readonly traceRecorder = new HumanTraceRecorder();
  private observation: CabtObservation | null = null;
  private dataMaps: CabtDataMaps = { cardData: {}, attacks: {} };
  private logs: LogView[] = [];
  private logId = 1;
  private sessionId = '';
  private pendingRetreatTarget: PendingRetreatTarget | null = null;

  constructor() {
    this.bridge = new CabtBridgeClient(() => this.invalidateSession('CABT bridge exited.'));
  }

  async handle(command: Command): Promise<EngineResponse> {
    if (process.env.CABT_ENGINE_MODE === 'demo') {
      return this.demo.handle(command);
    }

    try {
      if (command.type !== 'startGame' && command.type !== 'state') {
        this.assertSession(command.payload);
      }
      switch (command.type) {
        case 'startGame':
          return await this.start(command.payload);
        case 'state':
          return this.viewResponse();
        case 'playCard':
          this.assertNoPendingPrompt();
          return await this.selectMatchingOption((option) => this.matchesPlayCardOption(option, command.payload));
        case 'attack':
          this.assertNoPendingPrompt();
          return await this.selectMatchingOption((option) => this.matchesAttackOption(option, command.payload));
        case 'useAbility':
          this.assertNoPendingPrompt();
          return await this.selectMatchingOption((option) => this.matchesAbilityOption(option, command.payload));
        case 'useStadium':
          this.assertNoPendingPrompt();
          return await this.selectMatchingOption((option) => option.area === CabtAreaType.STADIUM);
        case 'concede':
          return { ok: false, error: 'Concede is not exposed by the CABT native engine.', view: this.view() };
        case 'retreat':
          this.assertNoPendingPrompt();
          return await this.retreat(command.payload);
        case 'passTurn':
          this.assertNoPendingPrompt();
          return await this.selectMatchingOption((option) => option.type === CabtOptionType.END);
        case 'resolvePrompt':
          return await this.applySelection(this.normalizePromptSelection(command.payload?.result));
        default:
          return { ok: false, error: `Unsupported command: ${command.type}`, view: this.view() };
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        view: this.view(),
      };
    }
  }

  listReplays() {
    return {
      ok: true,
      replays: [],
    };
  }

  loadReplay(_id?: string): ReplayLoadResponse {
    return { ok: false, error: 'Replay loading is not wired for the CABT adapter yet.' };
  }

  loadReplayData(_replayData?: string, _name?: string): ReplayLoadResponse {
    return { ok: false, error: 'Replay loading is not wired for the CABT adapter yet.' };
  }

  close(): void {
    this.bridge.close();
    this.invalidateSession('CABT bridge closed.');
  }

  private async start(payload: any): Promise<EngineResponse> {
    const player1Deck = resolveDeck(payload?.player1?.deck ?? [], 'Your deck');
    const player2Deck = resolveDeck(payload?.player2?.deck ?? [], 'AI opponent deck');
    const agentPath = agentPathForId(payload?.player2?.agentId);
    this.bridge.stop();
    this.sessionId = createSessionId();
    this.pendingRetreatTarget = null;
    const response = await this.bridge.request({
      command: 'start',
      deck0: player1Deck,
      deck1: player2Deck,
      agentPath,
    }, { allowStart: true });
    this.applyBridgeResponse(response);
    this.traceRecorder.start(this.sessionId, agentPath);
    this.logs = [{ id: this.logId++, message: `Started real CABT match${agentPath ? ` against ${agentPath}` : ''}.` }];
    return this.viewResponse();
  }

  private async retreat(payload: any): Promise<EngineResponse> {
    const playerIndex = typeof payload?.playerIndex === 'number' ? payload.playerIndex : 0;
    this.pendingRetreatTarget = {
      playerIndex,
      benchIndex: payload?.to,
    };
    const response = await this.selectMatchingOption((option) => option.type === CabtOptionType.RETREAT);
    if (!response.ok) {
      this.pendingRetreatTarget = null;
    }
    return response;
  }

  private async selectMatchingOption(predicate: (option: CabtOption) => boolean): Promise<EngineResponse> {
    const select = this.observation?.select;
    if (!select) {
      throw new Error('No CABT selection is currently available.');
    }
    const index = select.option.findIndex(predicate);
    if (index < 0) {
      throw new Error('That action is not currently legal in the CABT engine.');
    }
    return this.applySelection([index]);
  }

  private async applySelection(selection: number[]): Promise<EngineResponse> {
    const select = this.observation?.select;
    if (!select) {
      throw new Error('No CABT selection is currently available.');
    }
    if (this.canBatchRepeatedSingleSelection(select, selection)) {
      return this.applyRepeatedSingleSelections(selection);
    }
    if (selection.length < select.minCount || selection.length > select.maxCount) {
      throw new Error(`Selection must contain ${select.minCount}-${select.maxCount} option(s).`);
    }
    validateSelectionIndexes(select, selection);
    const traceStep = this.traceRecorder.record(this.observation, selection);
    const response = await this.bridge.request({
      command: 'select',
      selection,
    });
    this.applyBridgeResponse(response);
    this.traceRecorder.recordOutcome(traceStep, this.observation);
    await this.applyPendingRetreatTarget();
    return this.viewResponse();
  }

  private canBatchRepeatedSingleSelection(select: CabtSelectData, selection: number[]): boolean {
    if (selection.length <= select.maxCount || select.maxCount !== 1) {
      return false;
    }
    if (!selection.every((index) => Number.isInteger(index) && index >= 0 && index < select.option.length)) {
      return false;
    }
    if (select.context === CabtSelectContext.DISCARD_ENERGY || select.context === CabtSelectContext.DISCARD_ENERGY_CARD) {
      return new Set(selection).size === selection.length;
    }
    return select.context === CabtSelectContext.DAMAGE_COUNTER || select.context === CabtSelectContext.DAMAGE_COUNTER_ANY;
  }

  private async applyRepeatedSingleSelections(selection: number[]): Promise<EngineResponse> {
    const initialSelect = this.observation?.select;
    if (!initialSelect) {
      throw new Error('No CABT selection is currently available.');
    }
    const selectedKeys = selection.map((index) => this.optionSelectionKey(initialSelect.option[index]) ?? `index:${index}`);
    for (let step = 0; step < selectedKeys.length; step += 1) {
      const select = this.observation?.select;
      if (!select || !this.isRepeatedSingleSelection(select)) {
        break;
      }
      const optionIndex = this.findOptionIndexForKey(select, selectedKeys[step]);
      if (optionIndex < 0) {
        break;
      }
      const traceStep = this.traceRecorder.record(this.observation, [optionIndex]);
      const response = await this.bridge.request({
        command: 'select',
        selection: [optionIndex],
      });
      this.applyBridgeResponse(response);
      this.traceRecorder.recordOutcome(traceStep, this.observation);
    }
    await this.applyPendingRetreatTarget();
    return this.viewResponse();
  }

  private isRepeatedSingleSelection(select: CabtSelectData): boolean {
    return select.maxCount === 1
      && (
        select.context === CabtSelectContext.DISCARD_ENERGY
        || select.context === CabtSelectContext.DISCARD_ENERGY_CARD
        || select.context === CabtSelectContext.DAMAGE_COUNTER
        || select.context === CabtSelectContext.DAMAGE_COUNTER_ANY
      );
  }

  private findOptionIndexForKey(select: CabtSelectData, key: string): number {
    const byKey = select.option.findIndex((option) => this.optionSelectionKey(option) === key);
    if (byKey >= 0) {
      return byKey;
    }
    if (this.isDamageCounterSelection(select)) {
      return -1;
    }
    if (key.startsWith('index:')) {
      const index = Number(key.slice('index:'.length));
      return index >= 0 && index < select.option.length ? index : 0;
    }
    return select.option.length ? 0 : -1;
  }

  private isDamageCounterSelection(select: CabtSelectData): boolean {
    return select.context === CabtSelectContext.DAMAGE_COUNTER || select.context === CabtSelectContext.DAMAGE_COUNTER_ANY;
  }

  private optionSelectionKey(option: CabtOption | undefined): string | undefined {
    if (!option) {
      return undefined;
    }
    if (option.energyIndex !== undefined || option.toolIndex !== undefined) {
      return this.optionCardKey(option) ?? this.optionTargetKey(option);
    }
    return this.optionTargetKey(option) ?? this.optionCardKey(option);
  }

  private optionTargetKey(option: CabtOption): string | undefined {
    if (option.area === undefined || option.area === null || option.index === undefined || option.index === null) {
      return undefined;
    }
    const playerIndex = option.playerIndex ?? this.observation?.current?.yourIndex ?? 'current';
    const energyIndex = option.energyIndex === undefined || option.energyIndex === null ? '' : option.energyIndex;
    const toolIndex = option.toolIndex === undefined || option.toolIndex === null ? '' : option.toolIndex;
    return `target:${playerIndex}:${option.area}:${option.index}:${energyIndex}:${toolIndex}`;
  }

  private optionCardKey(option: CabtOption | undefined): string | undefined {
    const card = option ? this.cardForOption(option) : null;
    if (card?.serial !== undefined && card.serial !== null) {
      return `serial:${card.serial}`;
    }
    return undefined;
  }

  private cardForOption(option: CabtOption): CabtCard | null {
    const current = this.observation?.current;
    if (!current || option.area === undefined || option.area === null || option.index === undefined || option.index === null) {
      return null;
    }
    if (option.area === CabtAreaType.STADIUM) {
      return current.stadium[option.index] ?? null;
    }
    if (option.area === CabtAreaType.LOOKING) {
      return current.looking?.[option.index] ?? null;
    }
    const playerIndex = option.playerIndex ?? current.yourIndex;
    const player = current.players[playerIndex];
    if (!player) {
      return null;
    }
    if (option.area === CabtAreaType.HAND) return player.hand?.[option.index] ?? null;
    if (option.area === CabtAreaType.DISCARD) return player.discard[option.index] ?? null;
    if (option.area === CabtAreaType.PRIZE) return player.prize[option.index] ?? null;
    if (option.area === CabtAreaType.ACTIVE) return attachedCardForOption(player.active[option.index], option) ?? player.active[option.index] ?? null;
    if (option.area === CabtAreaType.BENCH) return attachedCardForOption(player.bench[option.index], option) ?? player.bench[option.index] ?? null;
    return null;
  }

  private async applyPendingRetreatTarget(): Promise<void> {
    if (!this.pendingRetreatTarget || this.observation?.current?.yourIndex !== this.pendingRetreatTarget.playerIndex) {
      return;
    }
    const targetIndex = this.findPendingRetreatTargetOption();
    if (targetIndex < 0) {
      return;
    }

    this.pendingRetreatTarget = null;
    const traceStep = this.traceRecorder.record(this.observation, [targetIndex]);
    const response = await this.bridge.request({
      command: 'select',
      selection: [targetIndex],
    });
    this.applyBridgeResponse(response);
    this.traceRecorder.recordOutcome(traceStep, this.observation);
  }

  private findPendingRetreatTargetOption(): number {
    const select = this.observation?.select;
    const target = this.pendingRetreatTarget;
    if (!select || !target) {
      return -1;
    }
    return select.option.findIndex((option) =>
      option.area === CabtAreaType.BENCH
      && option.index === target.benchIndex
      && (option.playerIndex === undefined || option.playerIndex === null || option.playerIndex === target.playerIndex));
  }

  private applyBridgeResponse(response: BridgeResponse): void {
    if (!response.ok) {
      throw new Error(response.traceback ? `${response.error}\n${response.traceback}` : (response.error ?? 'CABT bridge failed.'));
    }
    this.observation = response.observation ?? null;
    if (response.cards && response.attacks) {
      this.dataMaps = {
        cardData: Object.fromEntries(response.cards.map((card) => [card.cardId, enrichCardData(card)])),
        attacks: Object.fromEntries(response.attacks.map((attack) => [attack.attackId, attack])),
      };
    }
  }

  private viewResponse(): EngineResponse {
    return { ok: true, view: this.view(), sessionId: this.sessionId || undefined };
  }

  private view() {
    const view = cabtObservationToGameView(this.observation, this.logs, this.dataMaps);
    return {
      ...view,
      capabilities: {
        ...view.capabilities,
        concede: false,
      },
    };
  }

  private matchesPlayCardOption(option: CabtOption, payload: any): boolean {
    const typeMatches = option.type === CabtOptionType.PLAY || option.type === CabtOptionType.ATTACH || option.type === CabtOptionType.EVOLVE;
    if (!typeMatches || !this.matchesHandSource(option, payload)) {
      return false;
    }

    if (!this.optionHasInPlayTarget(option)) {
      return true;
    }

    const target = targetToCabt(payload?.playerIndex, payload?.target);
    return option.inPlayArea === target.area
      && option.inPlayIndex === target.index
      && (option.playerIndex === undefined || option.playerIndex === null || option.playerIndex === target.playerIndex);
  }

  private matchesAttackOption(option: CabtOption, payload: any): boolean {
    if (option.type !== CabtOptionType.ATTACK || !option.attackId) {
      return false;
    }
    return this.dataMaps.attacks[option.attackId]?.name === payload?.attack;
  }

  private matchesAbilityOption(option: CabtOption, payload: any): boolean {
    if (option.type !== CabtOptionType.ABILITY) {
      return false;
    }

    const target = targetToCabt(payload?.playerIndex, payload?.target);
    if (option.area !== undefined && option.area !== null && option.area !== target.area) {
      return false;
    }
    if (option.index !== undefined && option.index !== null && option.index !== target.index) {
      return false;
    }
    if (option.playerIndex !== undefined && option.playerIndex !== null && option.playerIndex !== target.playerIndex) {
      return false;
    }

    const abilityName = this.abilityNameForOption(option, target.playerIndex);
    return !abilityName || abilityName === payload?.ability;
  }

  private matchesHandSource(option: CabtOption, payload: any): boolean {
    return option.index === payload?.handIndex
      && (option.area === undefined || option.area === null || option.area === CabtAreaType.HAND)
      && (option.playerIndex === undefined || option.playerIndex === null || option.playerIndex === payload?.playerIndex);
  }

  private optionHasInPlayTarget(option: CabtOption): boolean {
    return option.inPlayArea !== undefined
      && option.inPlayArea !== null
      && option.inPlayIndex !== undefined
      && option.inPlayIndex !== null;
  }

  private abilityNameForOption(option: CabtOption, defaultPlayerIndex: number): string | undefined {
    const cardId = option.cardId ?? this.cardIdForOption(option, defaultPlayerIndex);
    return cardId === undefined ? undefined : this.dataMaps.cardData[cardId]?.skills?.[0]?.name;
  }

  private cardIdForOption(option: CabtOption, defaultPlayerIndex: number): number | undefined {
    if (option.index === undefined || option.index === null) {
      return undefined;
    }
    const playerIndex = option.playerIndex ?? defaultPlayerIndex;
    const player = this.observation?.current?.players[playerIndex];
    if (!player) {
      return undefined;
    }
    if (option.area === CabtAreaType.ACTIVE) {
      return player.active[option.index]?.id;
    }
    if (option.area === CabtAreaType.BENCH) {
      return player.bench[option.index]?.id;
    }
    if (option.area === CabtAreaType.HAND) {
      return player.hand?.[option.index]?.id;
    }
    return undefined;
  }

  private normalizePromptSelection(result: unknown): number[] {
    if (result === null || result === undefined || result === true) {
      return [];
    }
    if (typeof result === 'number') {
      return [result];
    }
    if (Array.isArray(result) && result.every((item) => typeof item === 'number')) {
      return result;
    }
    throw new Error('This CABT prompt expects option index selections.');
  }

  private assertSession(payload?: any): void {
    if (!this.sessionId) {
      throw new Error('No active CABT session. Start a new game.');
    }
    const payloadSessionId = payload?.sessionId;
    if (typeof payloadSessionId !== 'string' || !payloadSessionId) {
      throw new Error('CABT session id is required. Start a new game.');
    }
    if (payloadSessionId !== this.sessionId) {
      throw new Error('CABT session expired. Start a new game.');
    }
  }

  private assertNoPendingPrompt(): void {
    const context = this.observation?.select?.context;
    if (context !== undefined && context !== null && context !== CabtSelectContext.MAIN) {
      throw new Error('Resolve the current CABT prompt before taking another action.');
    }
  }

  private invalidateSession(message: string): void {
    this.sessionId = '';
    this.observation = null;
    this.pendingRetreatTarget = null;
    this.traceRecorder.close();
    this.logs = [...this.logs, { id: this.logId++, message }];
  }
}

class HumanTraceRecorder {
  private trace: HumanTraceRecord | null = null;
  private filePath = '';
  private decisionCount = 0;

  start(sessionId: string, agentPath?: string): void {
    this.close();
    if (!traceEnabled()) {
      return;
    }
    try {
      const traceId = `cabt-${sessionId}`;
      this.filePath = path.join(traceDirectory(), `${sanitizeFileName(traceId)}.jsonl`);
      this.decisionCount = 0;
      this.trace = {
        schemaVersion: 1,
        kind: 'human_play_trace',
        traceId,
        createdAt: new Date().toISOString(),
        source: {
          tool: 'cabt-viewer',
          reviewer: process.env.CABT_TRACE_REVIEWER || 'local-reviewer',
          runId: traceId,
          ...(agentPath ? { agentPath } : {}),
        },
        trust: traceTrust(),
        confidence: traceConfidence(),
        segments: [],
      };
    } catch {
      this.close();
    }
  }

  record(observation: CabtObservation | null, selection: number[]): number | null {
    if (!this.trace || !observation?.select || !observation.current) {
      return null;
    }
    try {
      const select = observation.select;
      validateSelectionIndexes(select, selection);
      const current = observation.current;
      const turn = Number.isInteger(current.turn) ? current.turn : 0;
      const player = Number.isInteger(current.yourIndex) ? current.yourIndex : 0;
      const legalOptionIndexes = select.option.map((_option, index) => index);
      const chosenAction = selection.filter((index) => Number.isInteger(index) && index >= 0);
      const segment = this.segmentFor(turn, player);
      const step = this.decisionCount;
      segment.decisions.push({
        step,
        activePlayer: player,
        turnActionIndex: Number.isInteger(current.turnActionCount) ? current.turnActionCount : this.decisionCount,
        context: select.context,
        selectType: select.type,
        minCount: select.minCount,
        maxCount: select.maxCount,
        legalOptionIndexes,
        legalOptionIds: legalOptionIndexes.map((index) => `select:${index}`),
        legalOptions: select.option.map((option, index) => ({ optionIndex: index, ...jsonClone(option) })),
        chosenAction,
        observation: jsonClone(observation),
      });
      this.decisionCount += 1;
      this.write();
      return step;
    } catch {
      this.close();
      return null;
    }
  }

  recordOutcome(step: number | null, observation: CabtObservation | null): void {
    if (!this.trace || step === null) {
      return;
    }
    try {
      const decision = this.findDecision(step);
      if (!decision) {
        return;
      }
      decision.outcome = outcomeForObservation(observation);
      this.write();
    } catch {
      this.close();
    }
  }

  close(): void {
    this.trace = null;
    this.filePath = '';
    this.decisionCount = 0;
  }

  private segmentFor(turn: number, player: number): HumanTraceRecord['segments'][number] {
    const current = this.trace?.segments.at(-1);
    if (current && current.turn === turn && current.player === player) {
      return current;
    }
    const next = {
      game: 0,
      turn,
      player,
      turnPlan: 'human-vs-ai local play',
      decisions: [],
    };
    this.trace?.segments.push(next);
    return next;
  }

  private write(): void {
    if (!this.trace || !this.filePath || this.trace.segments.length === 0) {
      return;
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(this.trace)}\n`, 'utf8');
  }

  private findDecision(step: number): Record<string, unknown> | undefined {
    for (const segment of this.trace?.segments ?? []) {
      const decision = segment.decisions.find((item) => item.step === step);
      if (decision) {
        return decision;
      }
    }
    return undefined;
  }
}

class CabtBridgeClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingBridgeCall>();
  private stderr = '';
  private generation = 0;

  constructor(private readonly onExit: () => void) {}

  async request(payload: Record<string, unknown>, options: { allowStart?: boolean } = {}): Promise<BridgeResponse> {
    await this.ensureStarted(!!options.allowStart);
    const child = this.child;
    if (!child) {
      throw new Error('CABT session expired. Start a new game.');
    }

    const id = this.nextId++;
    const message = { id, ...payload };
    const response = new Promise<BridgeResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    child.stdin.write(`${JSON.stringify(message)}\n`);
    return response;
  }

  close(): void {
    const child = this.child;
    if (!child) {
      return;
    }
    this.generation += 1;
    this.child = null;
    this.rejectPending(new Error('CABT bridge was closed.'));
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    child.kill('SIGKILL');
  }

  stop(): void {
    this.close();
  }

  private async ensureStarted(allowStart: boolean): Promise<void> {
    if (this.child && !this.child.killed) {
      return;
    }
    if (!allowStart) {
      return;
    }

    const { command, args } = bridgeProcessCommand();
    const generation = this.generation;
    this.stderr = '';
    const child = spawn(command, args, {
      cwd: WORKSPACE_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    const stdout = readline.createInterface({ input: child.stdout });
    stdout.on('line', (line) => this.handleLine(line));
    child.stderr.on('data', (chunk) => {
      this.stderr += String(chunk);
      if (this.stderr.length > 12000) {
        this.stderr = this.stderr.slice(-12000);
      }
    });
    child.on('exit', (code, signal) => {
      if (this.child !== child || this.generation !== generation) {
        return;
      }
      const error = new Error(`CABT bridge exited (${code ?? signal}).${this.stderr ? `\n${this.stderr}` : ''}`);
      this.rejectPending(error);
      this.child = null;
      this.onExit();
    });
  }

  private handleLine(line: string): void {
    const response = JSON.parse(line) as BridgeResponse;
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);
    pending.resolve(response);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function bridgeProcessCommand(): { command: string; args: string[] } {
  if (process.env.CABT_ENGINE_MODE === 'native' || process.platform === 'linux') {
    return { command: process.env.PYTHON ?? 'python3', args: [BRIDGE_PATH] };
  }
  const dockerBridgePath = `/workspace/${toPosixPath(path.relative(WORKSPACE_ROOT, BRIDGE_PATH))}`;
  const sampleSubmissionDir = process.env.CABT_SAMPLE_SUBMISSION_DIR
    ? path.resolve(process.env.CABT_SAMPLE_SUBMISSION_DIR)
    : '';
  const sampleSubmissionArgs = sampleSubmissionDir
    ? [
        '-v',
        `${sampleSubmissionDir}:/cabt-sample-submission:ro`,
        '-e',
        'CABT_SAMPLE_SUBMISSION_DIR=/cabt-sample-submission',
      ]
    : [];
  return {
    command: 'docker',
    args: [
      'run',
      '--rm',
      '-i',
      '--platform',
      'linux/amd64',
      '-v',
      `${WORKSPACE_ROOT}:/workspace`,
      ...sampleSubmissionArgs,
      '-w',
      '/workspace',
      process.env.CABT_DOCKER_IMAGE ?? 'python:3.11-slim',
      'python',
      dockerBridgePath,
    ],
  };
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function traceEnabled(): boolean {
  return process.env.CABT_TRACE_ENABLED !== '0';
}

function traceDirectory(): string {
  if (process.env.CABT_TRACE_DIR) {
    return privateTraceDirectory(path.resolve(process.env.CABT_TRACE_DIR));
  }
  return privateTraceDirectory(path.join(WORKSPACE_ROOT, 'ptcg-kaggle', 'private', 'traces'));
}

function privateTraceDirectory(directory: string): string {
  const resolved = path.resolve(directory);
  const parts = resolved.split(path.sep);
  if (!parts.includes('private') && !parts.includes('outputs')) {
    throw new Error(`CABT_TRACE_DIR must point under a private/ or outputs/ directory: ${resolved}`);
  }
  return resolved;
}

function traceTrust(): string {
  const trust = process.env.CABT_TRACE_TRUST || 'silver';
  return TRACE_TRUST_TIERS.has(trust) ? trust : 'silver';
}

function traceConfidence(): number {
  const raw = Number(process.env.CABT_TRACE_CONFIDENCE ?? 4);
  if (!Number.isFinite(raw)) {
    return 4;
  }
  return Math.max(1, Math.min(5, Math.round(raw)));
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function outcomeForObservation(observation: CabtObservation | null): HumanTraceOutcome {
  const current = observation?.current;
  const select = observation?.select;
  const result = Number.isInteger(current?.result) ? current!.result : null;
  return {
    terminal: result !== null && result >= 0,
    result,
    turn: Number.isInteger(current?.turn) ? current!.turn : null,
    activePlayer: Number.isInteger(current?.yourIndex) ? current!.yourIndex : null,
    turnActionIndex: Number.isInteger(current?.turnActionCount) ? current!.turnActionCount : null,
    nextContext: Number.isInteger(select?.context) ? select!.context : null,
    nextSelectType: Number.isInteger(select?.type) ? select!.type : null,
    nextMinCount: Number.isInteger(select?.minCount) ? select!.minCount : null,
    nextMaxCount: Number.isInteger(select?.maxCount) ? select!.maxCount : null,
    nextOptionCount: Array.isArray(select?.option) ? select!.option.length : 0,
  };
}

function validateSelectionIndexes(select: CabtSelectData, selection: number[]): void {
  if (selection.some((index) => !Number.isInteger(index) || index < 0 || index >= select.option.length)) {
    throw new Error('Selection contains an option index outside the current CABT select options.');
  }
  if (new Set(selection).size !== selection.length) {
    throw new Error('Selection must not contain duplicate option indexes.');
  }
}

function createSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveDeck(cards: unknown[], label: string): number[] {
  const ids = cards.map((card, index) => resolveCardId(card, `${label} card ${index + 1}`));
  if (ids.length !== 60) {
    throw new Error(`${label} must contain exactly 60 cards, found ${ids.length}.`);
  }
  return ids;
}

function resolveCardId(card: unknown, label: string): number {
  if (typeof card === 'number' && Number.isInteger(card)) {
    return card;
  }
  if (typeof card !== 'string') {
    throw new Error(`${label}: expected card name or id.`);
  }
  if (/^\d+$/.test(card.trim())) {
    return Number(card.trim());
  }

  const tokens = card.trim().split(/\s+/);
  const set = tokens.at(-1);
  const name = normalizeCardName(tokens.slice(0, -1).join(' '));
  const candidates = uniqueCardRows().filter((row) => row.set === set && normalizeCardName(row.name) === name);
  if (candidates.length === 1) {
    return candidates[0].id;
  }
  if (candidates.length > 1) {
    throw new Error(`${label}: ${card} matches multiple CABT card IDs.`);
  }
  throw new Error(`${label}: could not resolve "${card}" to a CABT card ID.`);
}

function enrichCardData(card: CabtCardData): CabtCardData {
  const row = CARD_ROWS_BY_ID.get(card.cardId);
  if (!row) {
    return card;
  }
  return {
    ...card,
    set: row.set,
    setNumber: row.setNumber,
  };
}

function uniqueCardRows() {
  return [...CARD_ROWS_BY_ID.values()];
}

function normalizeCardName(name: string): string {
  const withoutAccents = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normalized = withoutAccents.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
  const energy = /^([a-z]+) energy$/.exec(normalized);
  if (!energy) {
    return normalized;
  }
  const energySymbols: Record<string, string> = {
    grass: 'g',
    fire: 'r',
    water: 'w',
    lightning: 'l',
    psychic: 'p',
    fighting: 'f',
    darkness: 'd',
    metal: 'm',
  };
  return energySymbols[energy[1]] ? `basic {${energySymbols[energy[1]]}} energy` : normalized;
}

function agentPathForId(agentId: string | undefined): string | undefined {
  if (!agentId) {
    return undefined;
  }
  const manifestPath = path.join(FRONTEND_ROOT, 'public', 'agents', 'agents.json');
  if (!fs.existsSync(manifestPath)) {
    return undefined;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as AgentManifest;
  return manifest.agents?.find((agent) => agent.id === agentId)?.path;
}

function attachedCardForOption(pokemonCard: { energyCards?: CabtCard[]; tools?: CabtCard[] } | null | undefined, option: CabtOption) {
  if (!pokemonCard) {
    return null;
  }
  if (option.energyIndex !== undefined && option.energyIndex !== null) {
    return pokemonCard.energyCards?.[option.energyIndex] ?? null;
  }
  if (option.toolIndex !== undefined && option.toolIndex !== null) {
    return pokemonCard.tools?.[option.toolIndex] ?? null;
  }
  return null;
}

function targetToCabt(actorIndex: number, target: CardTarget): { playerIndex: number; area: number; index: number } {
  const playerIndex = target.player === PlayerType.BOTTOM_PLAYER ? actorIndex : 1 - actorIndex;
  return {
    playerIndex,
    area: target.slot === SlotType.BENCH ? CabtAreaType.BENCH : CabtAreaType.ACTIVE,
    index: target.index,
  };
}
