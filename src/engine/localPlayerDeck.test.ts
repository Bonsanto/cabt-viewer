import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadLocalPlayerDeck } from './localPlayerDeck';

describe('local player deck override', () => {
  it('loads a non-empty deck from a private path', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cabt-local-deck-'));
    const deckPath = path.join(root, 'private', 'decks', 'player.decklist');
    fs.mkdirSync(path.dirname(deckPath), { recursive: true });
    fs.writeFileSync(deckPath, 'Pokemon: 1\n1 Dreepy TWM 128\n');

    expect(loadLocalPlayerDeck(testEnv(root, deckPath))).toEqual({
      ok: true,
      deckText: 'Pokemon: 1\n1 Dreepy TWM 128',
    });
  });

  it('does not load private deck content unless the override is explicitly enabled', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cabt-local-deck-'));
    const deckPath = path.join(root, 'private', 'decks', 'player.decklist');
    fs.mkdirSync(path.dirname(deckPath), { recursive: true });
    fs.writeFileSync(deckPath, 'Pokemon: 1\n1 Dreepy TWM 128\n');

    expect(loadLocalPlayerDeck({ CABT_PLAYER_DECK_PATH: deckPath, CABT_PLAYER_DECK_ALLOWED_ROOTS: path.join(root, 'private') })).toMatchObject({
      ok: false,
      missing: true,
    });
  });

  it('treats a missing default deck as an optional override', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cabt-local-deck-'));
    const deckPath = path.join(root, 'private', 'decks', 'missing.decklist');

    expect(loadLocalPlayerDeck(testEnv(root, deckPath))).toMatchObject({
      ok: false,
      missing: true,
    });
  });

  it('rejects override paths outside private or outputs directories', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cabt-local-deck-'));
    const deckPath = path.join(root, 'player.decklist');
    fs.writeFileSync(deckPath, 'Pokemon: 1\n1 Dreepy TWM 128\n');

    expect(loadLocalPlayerDeck(testEnv(root, deckPath))).toMatchObject({
      ok: false,
    });
  });

  it('returns a structured error when the override path is a directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cabt-local-deck-'));
    const deckPath = path.join(root, 'private', 'decks');
    fs.mkdirSync(deckPath, { recursive: true });

    expect(loadLocalPlayerDeck(testEnv(root, deckPath))).toMatchObject({
      ok: false,
    });
  });

  it('rejects symlinks that resolve outside the allowed roots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cabt-local-deck-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cabt-outside-deck-'));
    const realDeck = path.join(outside, 'player.decklist');
    const deckPath = path.join(root, 'private', 'decks', 'player.decklist');
    fs.mkdirSync(path.dirname(deckPath), { recursive: true });
    fs.writeFileSync(realDeck, 'Pokemon: 1\n1 Dreepy TWM 128\n');
    fs.symlinkSync(realDeck, deckPath);

    expect(loadLocalPlayerDeck(testEnv(root, deckPath))).toMatchObject({
      ok: false,
    });
  });
});

function testEnv(root: string, deckPath: string): NodeJS.ProcessEnv {
  return {
    CABT_PLAYER_DECK_OVERRIDE: '1',
    CABT_PLAYER_DECK_PATH: deckPath,
    CABT_PLAYER_DECK_ALLOWED_ROOTS: path.join(root, 'private'),
  };
}
