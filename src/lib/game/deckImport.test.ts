import { describe, expect, it } from 'vitest';
import { formatCabtDeckList, parseDeckList, SAMPLE_DECK, validateParsedDeck } from './deckImport';

describe('deck import', () => {
  it('skips section count headers and expands the default deck to 60 cards', () => {
    const parsed = parseDeckList(SAMPLE_DECK);

    expect(parsed.errors).toEqual([]);
    expect(parsed.cards).toHaveLength(60);
    expect(parsed.cards).toContain('Mega Abomasnow ex MEG');
    expect(parsed.cards).toContain('Waitress ASC');
    expect(parsed.cards).not.toContain('Mega Abomasnow ex MEG 36');
    expect(parsed.cards).not.toContain('Waitress ASC 215');
    expect(parsed.cards).not.toContain('Pokemon: 10');
    expect(parsed.cards).not.toContain('Trainer: 15');
    expect(parsed.cards).not.toContain('Energy: 35');
  });

  it('normalizes accented names from deck exports', () => {
    const parsed = parseDeckList('1 Poké Pad POR 81');

    expect(parsed.errors).toEqual([]);
    expect(parsed.cards).toEqual(['Poke Pad POR']);
  });

  it('normalizes TCG Live basic energy shorthand', () => {
    const parsed = parseDeckList('7 Basic {W} Energy MEE 3');

    expect(parsed.errors).toEqual([]);
    expect(parsed.cards).toEqual([
      'Water Energy MEE',
      'Water Energy MEE',
      'Water Energy MEE',
      'Water Energy MEE',
      'Water Energy MEE',
      'Water Energy MEE',
      'Water Energy MEE',
    ]);
  });

  it('formats CABT deck IDs as grouped import text', () => {
    const deck = [
      ...Array.from({ length: 4 }, () => '723'),
      ...Array.from({ length: 2 }, () => '1145'),
      ...Array.from({ length: 54 }, () => '3'),
    ].join('\n');

    const formatted = formatCabtDeckList(deck, [
      { id: 3, name: 'Basic {W} Energy', set: 'SVE', setNumber: '3', cardType: 5 },
      { id: 723, name: 'Mega Abomasnow ex', set: 'MEG', setNumber: '36', cardType: 0 },
      { id: 1145, name: 'Mega Signal', set: 'MEG', setNumber: '121', cardType: 1 },
    ]);

    expect(formatted).toBe(`Pokemon: 4
4 Mega Abomasnow ex MEG 36

Trainer: 2
2 Mega Signal MEG 121

Energy: 54
54 Basic {W} Energy SVE 3`);
    expect(parseDeckList(formatted).cards).toHaveLength(60);
  });

  it('validates imported names against the local CABT card table', () => {
    const parsed = parseDeckList('1 Crushing Hammer POR 71');

    expect(validateParsedDeck(parsed, [
      { id: 1120, name: 'Crushing Hammer', set: 'SVI', setNumber: '168', cardType: 1 },
    ])).toEqual([
      'Deck must contain exactly 60 cards, found 1.',
      'Line 1: could not resolve "1 Crushing Hammer POR 71" to a CABT card ID. Supported prints: Crushing Hammer SVI 168.',
    ]);
  });

  it('matches deck apostrophes against card-table curly apostrophes', () => {
    const parsed = parseDeckList("1 Xerosic's Machinations SFA 64");

    expect(validateParsedDeck(parsed, [
      { id: 1197, name: 'Xerosic’s Machinations', set: 'SFA', setNumber: '64', cardType: 1 },
    ])).toEqual(['Deck must contain exactly 60 cards, found 1.']);
  });
});
