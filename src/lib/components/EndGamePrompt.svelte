<script lang="ts">
  type Props = {
    resultLabel: string;
    turn: number;
    traceTrust: string;
    traceConfidence: number;
    traceNote: string;
    traceTags: string;
    traceTagBusy?: boolean;
    traceTagMessage?: string;
    traceTagError?: string;
    onsaveTraceTag: () => void;
    onconfirm: () => void;
  };

  let {
    resultLabel,
    turn,
    traceTrust = $bindable(),
    traceConfidence = $bindable(),
    traceNote = $bindable(),
    traceTags = $bindable(),
    traceTagBusy = false,
    traceTagMessage = '',
    traceTagError = '',
    onsaveTraceTag,
    onconfirm,
  }: Props = $props();
</script>

<div class="end-game-overlay" role="dialog" aria-modal="true" aria-labelledby="end-game-title">
  <section class="end-game-panel">
    <div>
      <span>Game over</span>
      <h2 id="end-game-title">{resultLabel}</h2>
      <p>Finished on turn {turn}</p>
    </div>
    <section class="trace-tag-panel" aria-label="Trace annotation">
      <div class="trace-grid">
        <label>
          Trust
          <select bind:value={traceTrust}>
            <option value="gold">gold</option>
            <option value="silver">silver</option>
            <option value="bronze">bronze</option>
            <option value="debug">debug</option>
            <option value="unreliable">unreliable</option>
          </select>
        </label>
        <label>
          Confidence
          <input bind:value={traceConfidence} min="1" max="5" type="number" />
        </label>
      </div>
      <label>
        Note
        <input bind:value={traceNote} placeholder="mirror_second_perfect_win" spellcheck="false" />
      </label>
      <label>
        Tags
        <input bind:value={traceTags} placeholder="mirror,perfect" spellcheck="false" />
      </label>
      <div class="trace-actions">
        <button type="button" class="secondary" disabled={traceTagBusy} onclick={onsaveTraceTag}>
          {traceTagBusy ? 'Saving...' : 'Save trace tag'}
        </button>
        {#if traceTagMessage}
          <small class="success">{traceTagMessage}</small>
        {:else if traceTagError}
          <small class="error">{traceTagError}</small>
        {/if}
      </div>
    </section>
    <button type="button" onclick={onconfirm}>Back to main screen</button>
  </section>
</div>

<style>
  .end-game-overlay {
    position: absolute;
    inset: 0;
    z-index: 18;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--overlay-backdrop-bg);
    backdrop-filter: blur(5px);
  }

  .end-game-panel {
    width: min(560px, calc(100vw - 48px));
    display: grid;
    gap: 18px;
    padding: 20px;
    border-radius: 6px;
    border: 1px solid var(--surface-glass-border);
    background: var(--surface-glass-bg);
    color: var(--text-primary);
    box-shadow: var(--surface-glass-shadow);
  }

  .end-game-panel span {
    display: block;
    margin-bottom: 6px;
    color: var(--accent-strong);
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
  }

  .end-game-panel h2 {
    margin: 0;
    color: var(--text-primary);
    font-size: 28px;
    line-height: 1.05;
  }

  .end-game-panel p {
    margin: 8px 0 0;
    color: var(--text-muted);
    font-size: 14px;
  }

  .trace-tag-panel {
    display: grid;
    gap: 10px;
    padding: 12px;
    border-radius: 6px;
    border: 1px solid var(--surface-inset-border);
    background: var(--surface-inset-bg);
  }

  .trace-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 112px;
    gap: 10px;
  }

  .trace-tag-panel label {
    display: grid;
    gap: 6px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 900;
  }

  .trace-tag-panel select,
  .trace-tag-panel input {
    width: 100%;
    min-height: 36px;
    border-radius: 5px;
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: var(--input-text);
    padding: 0 10px;
    font: inherit;
  }

  .trace-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 36px;
  }

  .trace-actions small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 800;
  }

  .trace-actions .success {
    color: var(--accent-strong);
  }

  .trace-actions .error {
    color: var(--danger-strong);
  }

  .end-game-panel button {
    justify-self: start;
    border-radius: 5px;
    border: 1px solid var(--selection-border-strong);
    background: var(--accent-soft);
    color: var(--text-primary);
    padding: 9px 12px;
    font-weight: 900;
  }

  .end-game-panel button.secondary {
    background: var(--button-bg);
    border-color: var(--button-border);
  }

  .end-game-panel button:hover,
  .end-game-panel button:focus-visible {
    border-color: var(--accent-strong);
    background: var(--accent-tint);
  }

  @media (max-width: 560px) {
    .trace-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
