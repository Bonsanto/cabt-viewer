export type AgentOption = {
  id: string;
  name: string;
  description?: string;
  path?: string;
  deckUrl?: string;
};

export type GameLogEntry = {
  id: string;
  name: string;
  file: string;
  createdAt?: string;
  players?: string[];
  description?: string;
};

const FALLBACK_AGENT: AgentOption = {
  id: 'first-legal',
  name: 'First legal option',
  description: 'Uses the first legal CABT selection whenever the local engine controls the opponent.',
};

export async function loadAgentOptions(): Promise<AgentOption[]> {
  const agents = await loadJsonList<AgentOption>('/agents/agents.json', 'agents');
  return agents.length ? agents : [FALLBACK_AGENT];
}

export async function loadGameLogs(): Promise<GameLogEntry[]> {
  // Tracked demo fixtures live in logs.json; private locally-recorded matches
  // live in the git-ignored local-logs.json. Merge both, locals first, deduped
  // by id. A missing local manifest 404s to [] and is harmless.
  const [demos, locals] = await Promise.all([
    loadJsonList<GameLogEntry>('/game-logs/logs.json', 'logs'),
    loadJsonList<GameLogEntry>('/game-logs/local-logs.json', 'logs'),
  ]);
  const merged: GameLogEntry[] = [];
  const seen = new Set<string>();
  for (const entry of [...locals, ...demos]) {
    if (seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    merged.push(entry);
  }
  return merged;
}

async function loadJsonList<T extends { id?: unknown }>(url: string, key: string): Promise<T[]> {
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) {
      return [];
    }
    throw new Error(`${url}: ${response.status}`);
  }

  const json = await response.json();
  const list = Array.isArray(json) ? json : json?.[key];
  if (!Array.isArray(list)) {
    throw new Error(`${url}: expected an array or { "${key}": [...] }`);
  }
  return list.filter((item): item is T => !!item && typeof item === 'object' && typeof item.id === 'string');
}
