export type ParsedDeck = {
  cards: string[];
  entries: ParsedDeckEntry[];
  errors: string[];
};

export type ParsedDeckEntry = {
  card: string;
  line: number;
  raw: string;
};

export type DeckCardMetadata = {
  id: number;
  name: string;
  set: string;
  setNumber?: string | null;
  cardType?: number | null;
};

export const SAMPLE_DECK = `Pokemon: 10
2 Kyogre MEG 34
4 Snover MEG 35
4 Mega Abomasnow ex MEG 36

Trainer: 15
1 Maximum Belt TEF 154
4 Mega Signal MEG 121
2 Cyrano SSP 170
4 Lillie's Determination MEG 119
4 Waitress ASC 215

Energy: 35
35 Basic {W} Energy SVE 3`;

export function parseDeckList(text: string): ParsedDeck {
  const cards: string[] = [];
  const entries: ParsedDeckEntry[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((rawLine, idx) => {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line) {
      return;
    }
    if (/^[^\d:][^:]+:\s*\d+\s*$/.test(line)) {
      return;
    }

    const match = line.match(/^(\d+)\s+(.+)$/);
    const count = match ? Number(match[1]) : 1;
    const name = (match ? match[2] : line)?.trim() ?? '';
    if (!Number.isInteger(count) || count < 1 || count > 60) {
      errors.push(`Line ${idx + 1}: invalid count.`);
      return;
    }
    const tokens = name.split(/\s+/);
    const hasCollectorNumber = /^\d+[a-z]?$/i.test(tokens.at(-1) ?? '');
    const setCode = hasCollectorNumber ? tokens.at(-2) : tokens.at(-1);
    if (!name || !/^[A-Z0-9-]{2,8}$/.test(setCode ?? '')) {
      errors.push(`Line ${idx + 1}: card names must include a set code, for example "Ralts SIT".`);
      return;
    }
    const normalizedName = normalizeImportName(hasCollectorNumber ? tokens.slice(0, -1).join(' ') : name);
    for (let i = 0; i < count; i += 1) {
      cards.push(normalizedName);
    }
    entries.push({ card: normalizedName, line: idx + 1, raw: rawLine.trim() });
  });

  if (cards.length === 0) {
    errors.push('Deck is empty.');
  }

  return { cards, entries, errors };
}

export function validateParsedDeck(parsed: ParsedDeck, cardRows: DeckCardMetadata[]): string[] {
  const errors: string[] = [];
  if (!parsed.errors.length && parsed.cards.length !== 60) {
    errors.push(`Deck must contain exactly 60 cards, found ${parsed.cards.length}.`);
  }

  const resolver = createDeckCardResolver(cardRows);
  for (const entry of parsed.entries) {
    const resolution = resolver.resolve(entry.card);
    if (resolution.status === 'ok') {
      continue;
    }
    const suffix = resolution.suggestions.length ? ` Supported prints: ${resolution.suggestions.join(', ')}.` : '';
    if (resolution.status === 'ambiguous') {
      errors.push(`Line ${entry.line}: "${entry.raw}" matches multiple CABT card IDs.${suffix}`);
    } else {
      errors.push(`Line ${entry.line}: could not resolve "${entry.raw}" to a CABT card ID.${suffix}`);
    }
  }

  return errors;
}

export function formatCabtDeckList(rawDeck: string, cardRows: DeckCardMetadata[]): string {
  const rowsById = new Map(cardRows.map((row) => [row.id, row]));
  const entries = rawDeck
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      if (!/^\d+$/.test(line)) {
        throw new Error(`CABT deck line ${index + 1}: expected a numeric card ID.`);
      }
      const id = Number(line);
      const row = rowsById.get(id);
      if (!row) {
        throw new Error(`CABT deck line ${index + 1}: unknown card ID ${id}.`);
      }
      return row;
    });
  if (entries.length !== 60) {
    throw new Error(`CABT deck must contain exactly 60 cards, found ${entries.length}.`);
  }

  const groups = new Map<string, { row: DeckCardMetadata; count: number }>();
  for (const row of entries) {
    const key = `${row.id}`;
    const group = groups.get(key);
    if (group) {
      group.count += 1;
    } else {
      groups.set(key, { row, count: 1 });
    }
  }

  const sections = [
    { title: 'Pokemon', rows: [] as string[] },
    { title: 'Trainer', rows: [] as string[] },
    { title: 'Energy', rows: [] as string[] },
  ];
  for (const group of groups.values()) {
    const line = `${group.count} ${group.row.name} ${group.row.set}${group.row.setNumber ? ` ${group.row.setNumber}` : ''}`;
    sections[deckSectionIndex(group.row)].rows.push(line);
  }

  return sections
    .filter((section) => section.rows.length)
    .map((section) => [`${section.title}: ${sumCounts(section.rows)}`, ...section.rows].join('\n'))
    .join('\n\n');
}

function deckSectionIndex(row: DeckCardMetadata) {
  if (row.cardType === 0) {
    return 0;
  }
  if (row.cardType === 5 || row.cardType === 6) {
    return 2;
  }
  return 1;
}

function sumCounts(lines: string[]) {
  return lines.reduce((sum, line) => sum + Number(line.split(/\s+/, 1)[0]), 0);
}

function normalizeImportName(name: string): string {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return normalized.replace(/^Basic \{([A-Z])\} Energy\b/, (_match, type: string) => {
    const energyNames: Record<string, string> = {
      G: 'Grass',
      R: 'Fire',
      W: 'Water',
      L: 'Lightning',
      P: 'Psychic',
      F: 'Fighting',
      D: 'Darkness',
      M: 'Metal',
    };
    return `${energyNames[type] ?? type} Energy`;
  });
}

function createDeckCardResolver(cardRows: DeckCardMetadata[]) {
  const byCard = new Map<string, DeckCardMetadata[]>();
  const byName = new Map<string, DeckCardMetadata[]>();
  for (const row of cardRows) {
    const normalizedName = normalizeResolvedCardName(row.name);
    addRow(byCard, `${row.set}\0${normalizedName}`, row);
    addRow(byName, normalizedName, row);
  }

  return {
    resolve(card: string): { status: 'ok' | 'missing' | 'ambiguous'; suggestions: string[] } {
      const tokens = card.trim().split(/\s+/);
      const set = tokens.at(-1) ?? '';
      const normalizedName = normalizeResolvedCardName(tokens.slice(0, -1).join(' '));
      const candidates = byCard.get(`${set}\0${normalizedName}`) ?? [];
      if (candidates.length === 1) {
        return { status: 'ok', suggestions: [] };
      }
      const suggestions = (byName.get(normalizedName) ?? [])
        .slice(0, 5)
        .map((row) => `${row.name} ${row.set}${row.setNumber ? ` ${row.setNumber}` : ''}`);
      return { status: candidates.length > 1 ? 'ambiguous' : 'missing', suggestions };
    },
  };
}

function addRow(map: Map<string, DeckCardMetadata[]>, key: string, row: DeckCardMetadata) {
  const rows = map.get(key);
  if (rows) {
    rows.push(row);
  } else {
    map.set(key, [row]);
  }
}

function normalizeResolvedCardName(name: string): string {
  const withoutAccents = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normalized = withoutAccents.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
  const energy = /^([a-z]+) energy$/.exec(normalized);
  if (!energy) {
    return normalized;
  }
  const energySymbols: Record<string, string> = {
    grass: 'g',
    fire: 'r',
    water: 'w',
    lightning: 'l',
    psychic: 'p',
    fighting: 'f',
    darkness: 'd',
    metal: 'm',
  };
  return energySymbols[energy[1]] ? `basic {${energySymbols[energy[1]]}} energy` : normalized;
}
