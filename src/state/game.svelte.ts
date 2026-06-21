import type { EngineResponse, GameView } from '../lib/game/types';
import { viewSettingsStore } from './viewSettings.svelte';

class GameStore {
  game = $state<GameView | null>(null);
  error = $state('');
  busy = $state(false);
  resolvingPrompt = $state(false);
  playingSequence = $state(false);
  private playbackConfirmResolve: (() => void) | null = null;
  private generation = 0;

  get currentPrompt() {
    return this.game?.prompts[0];
  }

  get gameFinished() {
    return this.game?.phase === 7;
  }

  setError(message: string) {
    this.error = message;
  }

  reset() {
    this.generation += 1;
    this.game = null;
    this.error = '';
    this.busy = false;
    this.resolvingPrompt = false;
    this.playingSequence = false;
    this.playbackConfirmResolve?.();
    this.playbackConfirmResolve = null;
  }

  async run(command: () => Promise<EngineResponse>) {
    const generation = this.generation;
    this.busy = true;
    try {
      return await this.apply(await command(), generation);
    } finally {
      if (generation === this.generation) {
        this.busy = false;
      }
    }
  }

  async resolve(command: () => Promise<EngineResponse>) {
    const generation = this.generation;
    this.resolvingPrompt = true;
    try {
      return await this.apply(await command(), generation);
    } finally {
      if (generation === this.generation) {
        this.resolvingPrompt = false;
      }
    }
  }

  async apply(response: EngineResponse, generation = this.generation) {
    if (generation !== this.generation) {
      return response;
    }
    if (response.ok) {
      if (response.sequence?.length && (viewSettingsStore.animateActions || response.sequence.some(hasPlaybackPrompt))) {
        this.playingSequence = true;
        try {
          for (const view of response.sequence) {
            this.game = view;
            this.error = '';
            if (hasPlaybackPrompt(view)) {
              this.resolvingPrompt = false;
              await this.waitForPlaybackConfirm();
              if (generation !== this.generation) {
                return response;
              }
            } else if (viewSettingsStore.animateActions) {
              await wait(clampedActionStepDelay());
              if (generation !== this.generation) {
                return response;
              }
            }
          }
        } finally {
          if (generation === this.generation) {
            this.playingSequence = false;
          }
        }
      }
      if (generation !== this.generation) {
        return response;
      }
      this.game = response.view;
      this.error = '';
      return response;
    }

    this.error = response.error;
    if (response.view) {
      this.game = response.view;
    }
    return response;
  }

  confirmPlaybackPrompt() {
    this.playbackConfirmResolve?.();
    this.playbackConfirmResolve = null;
  }

  private waitForPlaybackConfirm() {
    return new Promise<void>((resolve) => {
      this.playbackConfirmResolve = resolve;
    });
  }
}

export const gameStore = new GameStore();

function clampedActionStepDelay() {
  return Math.min(2500, Math.max(50, Math.round(viewSettingsStore.actionStepDelayMs)));
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasPlaybackPrompt(view: GameView) {
  return view.prompts.some((prompt) => prompt.fields.playbackOnly === true);
}
