<script lang="ts">
  import { labelFor } from '../game/labels';
  import type { ActionTimelineEvent, LogView } from '../game/types';

  type Props = {
    logs?: LogView[];
    timeline?: ActionTimelineEvent[];
  };

  let { logs = [], timeline = [] }: Props = $props();
  let entries = $derived(timeline.length ? timeline : logs);
  let visibleEntries = $derived(entries.slice(-18).reverse());
</script>

<aside class="log-panel">
  <h2>{timeline.length ? 'Timeline' : 'Log'}</h2>
  {#each visibleEntries as entry}
    <p>{labelFor(entry.message)}</p>
  {/each}
</aside>

<style>
  .log-panel {
    position: absolute;
    z-index: 8;
    right: 14px;
    top: auto;
    bottom: 14px;
    width: 128px;
    transform: none;
    align-self: center;
    max-height: min(28vh, 220px);
    overflow: auto;
    padding: 9px;
    border: 1px solid var(--surface-toolbar-border);
    border-radius: 6px;
    background: var(--surface-toolbar-bg);
    color: var(--text-secondary);
    box-shadow: var(--surface-toolbar-shadow);
    backdrop-filter: blur(var(--backdrop-blur));
    font-size: 10px;
    line-height: 1.25;
  }

  .log-panel h2 {
    margin: 0 0 7px;
    font-size: 11px;
    color: var(--text-primary);
  }

  .log-panel p {
    margin: 0 0 7px;
  }

  @media (max-width: 980px) {
    .log-panel {
      position: static;
      transform: none;
      width: auto;
      max-height: 180px;
    }
  }
</style>
