import { PlayerType, SlotType, targetFor, type CardTarget, type GameView, type PokemonSlotView, type PromptView } from './types';

export type PromptTargetOption = {
  label: string;
  target: CardTarget;
};

export type AttachPromptTargetOption = PromptTargetOption & {
  card?: unknown;
};

export function sameTarget(a: CardTarget, b: CardTarget): boolean {
  return a.player === b.player && a.slot === b.slot && a.index === b.index;
}

export function targetForPromptSlot(prompt: PromptView, slot: PokemonSlotView): CardTarget {
  return targetFor(prompt.playerIndex, slot.ownerIndex, slot.slot === 'active' ? SlotType.ACTIVE : SlotType.BENCH, slot.index);
}

export function getBoardPromptTargets(current: GameView, prompt: PromptView): CardTarget[] {
  return getPromptTargets(current, prompt, 'blocked').map((item) => item.target);
}

export function getAttachPromptTargets(current: GameView, prompt: PromptView): CardTarget[] {
  return getPromptTargets(current, prompt, 'blockedTo').map((item) => item.target);
}

export function getSelectableTargets(current: GameView, prompt: PromptView): PromptTargetOption[] {
  return getPromptTargets(current, prompt, 'blocked').map(({ player, slot, target }) => ({
    label: slot.slot === 'active' ? `${player.name} active` : `${player.name} bench ${slot.index + 1}`,
    target,
  }));
}

export function getDamageTransferTargets(
  current: GameView,
  prompt: PromptView,
  blockedOption: 'blockedFrom' | 'blockedTo',
): PromptTargetOption[] {
  return getPromptTargets(current, prompt, blockedOption).map(({ player, slot, target }) => ({
    label: slot.slot === 'active' ? `${player.name} active` : `${player.name} bench ${slot.index + 1}`,
    target,
  }));
}

export function getAttachTargets(current: GameView, prompt: PromptView): AttachPromptTargetOption[] {
  return getPromptTargets(current, prompt, 'blockedTo').map(({ player, slot, target }) => ({
    label: slot.slot === 'active' ? `${player.name} active` : `${player.name} bench ${slot.index + 1}`,
    target,
    card: slot.pokemon,
  }));
}

function getPromptTargets(
  current: GameView,
  prompt: PromptView,
  blockedOption: 'blocked' | 'blockedFrom' | 'blockedTo',
): Array<{ player: GameView['players'][number]; slot: PokemonSlotView; target: CardTarget }> {
  if (Array.isArray(prompt.fields.targets)) {
    return (prompt.fields.targets as CardTarget[])
      .map((target) => {
        const player = current.players[playerIndexForPromptTarget(prompt, target)];
        const slot = slotForPromptTarget(player, target);
        return player && slot && !slot.empty ? { player, slot, target } : null;
      })
      .filter((item): item is { player: GameView['players'][number]; slot: PokemonSlotView; target: CardTarget } => !!item);
  }
  const playerType = Number(prompt.fields.playerType ?? PlayerType.ANY);
  const slots = Array.isArray(prompt.fields.slots)
    ? (prompt.fields.slots as number[])
    : [SlotType.ACTIVE, SlotType.BENCH];
  const options = promptOptions(prompt);
  const blocked = Array.isArray(options[blockedOption]) ? (options[blockedOption] as CardTarget[]) : [];
  const result: Array<{ player: GameView['players'][number]; slot: PokemonSlotView; target: CardTarget }> = [];

  for (const player of current.players) {
    const isPromptPlayer = player.index === prompt.playerIndex;
    if (playerType === PlayerType.BOTTOM_PLAYER && !isPromptPlayer) continue;
    if (playerType === PlayerType.TOP_PLAYER && isPromptPlayer) continue;

    if (slots.includes(SlotType.ACTIVE) && !player.active.empty) {
      const target = targetForPromptSlot(prompt, player.active);
      if (!blocked.some((item) => sameTarget(item, target))) {
        result.push({ player, slot: player.active, target });
      }
    }

    if (slots.includes(SlotType.BENCH)) {
      for (const bench of player.bench) {
        if (bench.empty) continue;
        const target = targetForPromptSlot(prompt, bench);
        if (!blocked.some((item) => sameTarget(item, target))) {
          result.push({ player, slot: bench, target });
        }
      }
    }
  }

  return result;
}

function playerIndexForPromptTarget(prompt: PromptView, target: CardTarget) {
  if (target.player === PlayerType.BOTTOM_PLAYER) {
    return prompt.playerIndex;
  }
  if (target.player === PlayerType.TOP_PLAYER) {
    return prompt.playerIndex === 0 ? 1 : 0;
  }
  return prompt.playerIndex;
}

function slotForPromptTarget(player: GameView['players'][number] | undefined, target: CardTarget) {
  if (!player) {
    return undefined;
  }
  if (target.slot === SlotType.ACTIVE) {
    return player.active;
  }
  if (target.slot === SlotType.BENCH) {
    return player.bench.find((slot) => slot.index === target.index);
  }
  return undefined;
}

function promptOptions(prompt: PromptView): Record<string, unknown> {
  const options = prompt.fields.options;
  return options && typeof options === 'object' ? (options as Record<string, unknown>) : {};
}
