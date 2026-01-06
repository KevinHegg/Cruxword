export interface WordEntry {
  word: string;
  zipf: number | null;
  is_clueable: boolean | null;
  pos: string | null;
  flags: string | null;
  theme_tags: string | null;
  banned: boolean;
  in_must_keep: boolean;
  sources: string;
}

export interface GridCell {
  letter: string;
  isBlack: boolean;
  number?: number;
}

export interface Slot {
  id: string;
  dir: 'A' | 'D';
  length: number;
  cells: Array<{ r: number; c: number }>;
  pattern: string; // e.g. "A??LE" ('?' = unknown)
  crossings: Array<{ index: number; otherSlotId: string }>;
  // Legacy fields for compatibility
  startRow?: number;
  startCol?: number;
  direction?: 'across' | 'down';
  crosses?: string[];
}

export interface Candidate {
  word: string;
  score: number;
  segScore: number;
  zipf: number;
  crossingBonus: number;
  bestSegments: string[]; // e.g. ["ab","alo","ne"]
  // Legacy fields
  is_clueable?: boolean;
  theme_tags?: string;
}
