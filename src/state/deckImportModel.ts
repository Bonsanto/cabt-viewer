import cardRows from '../lib/cabt/cardData.generated.json';
import { parseDeckList, validateParsedDeck } from '../lib/game/deckImport';

export type LocalGameDecks =
  | {
      ok: true;
      player1Cards: string[];
      player2Cards: string[];
    }
  | {
      ok: false;
      error: string;
    };

export function parseLocalGameDecks(deck1Text: string, deck2Text: string): LocalGameDecks {
  const p1 = parseDeckList(deck1Text);
  const p2 = parseDeckList(deck2Text);
  const p1Errors = [...p1.errors, ...validateParsedDeck(p1, cardRows)];
  const p2Errors = [...p2.errors, ...validateParsedDeck(p2, cardRows)];
  if (p1Errors.length || p2Errors.length) {
    return {
      ok: false,
      error: [...p1Errors.map((error) => `Your deck: ${error}`), ...p2Errors.map((error) => `AI opponent deck: ${error}`)].join(
        '\n',
      ),
    };
  }
  return {
    ok: true,
    player1Cards: p1.cards,
    player2Cards: p2.cards,
  };
}

export function parseLocalGameDeck(deckText: string, label: string): { ok: true; cards: string[] } | { ok: false; error: string } {
  const parsed = parseDeckList(deckText);
  const errors = [...parsed.errors, ...validateParsedDeck(parsed, cardRows)];
  if (errors.length) {
    return {
      ok: false,
      error: errors.map((error) => `${label}: ${error}`).join('\n'),
    };
  }
  return { ok: true, cards: parsed.cards };
}
