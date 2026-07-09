import { describe, expect, it } from 'vitest';
import { SAMPLE_DECK } from '../lib/game/deckImport';
import { parseLocalGameDecks } from './deckImportModel';

describe('deck import model', () => {
  it('returns parsed cards for both local players', () => {
    const decks = parseLocalGameDecks(SAMPLE_DECK, SAMPLE_DECK);

    expect(decks.ok).toBe(true);
    if (decks.ok) {
      expect(decks.player1Cards).toHaveLength(60);
      expect(decks.player2Cards).toHaveLength(60);
    }
  });

  it('prefixes parse errors with the deck label', () => {
    const decks = parseLocalGameDecks('Bad Card', '');

    expect(decks.ok).toBe(false);
    if (!decks.ok) {
      expect(decks.error).toContain('Your deck: Line 1: card names must include a set code');
      expect(decks.error).toContain('AI opponent deck: Deck is empty.');
    }
  });

  it('rejects deck cards that the local CABT card table cannot resolve', () => {
    const opponentDeck = SAMPLE_DECK.replace(
      '35 Basic {W} Energy SVE 3',
      '34 Basic {W} Energy SVE 3\n1 Crushing Hammer POR 71',
    );
    const decks = parseLocalGameDecks(SAMPLE_DECK, opponentDeck);

    expect(decks.ok).toBe(false);
    if (!decks.ok) {
      expect(decks.error).toContain('AI opponent deck: Line ');
      expect(decks.error).toContain('could not resolve "1 Crushing Hammer POR 71"');
      expect(decks.error).toContain('Supported prints: Crushing Hammer SVI 168');
    }
  });
});
