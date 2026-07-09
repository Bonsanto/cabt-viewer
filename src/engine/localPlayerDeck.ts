import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type LocalPlayerDeckResult =
  | { ok: true; deckText: string }
  | { ok: false; missing?: true; error: string };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_ALLOWED_ROOTS = [
  path.join(FRONTEND_ROOT, 'private'),
  path.join(FRONTEND_ROOT, 'outputs'),
];

export function loadLocalPlayerDeck(env: NodeJS.ProcessEnv = process.env): LocalPlayerDeckResult {
  if (!localPlayerDeckOverrideEnabled(env)) {
    return { ok: false, missing: true, error: 'Local player deck override is disabled.' };
  }

  const filePath = resolveLocalPlayerDeckPath(env);
  const resolved = path.resolve(filePath);
  const allowedRoots = allowedLocalPlayerDeckRoots(env);
  if (!fs.existsSync(resolved)) {
    if (!isUnderAllowedRoot(resolved, allowedRoots)) {
      return {
        ok: false,
        error: `CABT_PLAYER_DECK_PATH must point under an allowed private deck directory: ${resolved}`,
      };
    }
    return { ok: false, missing: true, error: 'No local player deck override configured.' };
  }

  let deckText = '';
  try {
    const realPath = fs.realpathSync(resolved);
    if (!isUnderAllowedRoot(realPath, allowedRoots)) {
      return { ok: false, error: `CABT_PLAYER_DECK_PATH must point under an allowed private deck directory: ${resolved}` };
    }
    if (!fs.statSync(realPath).isFile()) {
      return { ok: false, error: `Local player deck override is not a file: ${resolved}` };
    }
    deckText = fs.readFileSync(realPath, 'utf8').trimEnd();
  } catch (error) {
    return {
      ok: false,
      error: `Unable to read local player deck override: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!deckText.trim()) {
    return { ok: false, error: `Local player deck override is empty: ${resolved}` };
  }
  return { ok: true, deckText };
}

function localPlayerDeckOverrideEnabled(env: NodeJS.ProcessEnv): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(env.CABT_PLAYER_DECK_OVERRIDE ?? '').toLowerCase());
}

function allowedLocalPlayerDeckRoots(env: NodeJS.ProcessEnv): string[] {
  const configured = (env.CABT_PLAYER_DECK_ALLOWED_ROOTS ?? '')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  return (configured.length ? configured : DEFAULT_ALLOWED_ROOTS).map((root) => {
    const resolved = path.resolve(root);
    return fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
  });
}

function isUnderAllowedRoot(filePath: string, roots: string[]): boolean {
  const resolved = path.resolve(filePath);
  return roots.some((root) => {
    const allowed = path.resolve(root);
    return resolved === allowed || resolved.startsWith(`${allowed}${path.sep}`);
  });
}

function resolveLocalPlayerDeckPath(env: NodeJS.ProcessEnv): string {
  if (env.CABT_PLAYER_DECK_PATH) {
    return path.resolve(env.CABT_PLAYER_DECK_PATH);
  }
  return path.join(FRONTEND_ROOT, 'private', 'decks', 'player.decklist');
}
