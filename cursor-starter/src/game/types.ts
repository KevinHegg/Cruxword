export interface BasellexRow {
  word: string;
  pos: string;
  zipf: number;
  flags: string;
  theme_tags: string;
}

export interface PlayDictRow {
  word: string;
  is_clueable: boolean | number | string;
}

export interface SegmentRow {
  text: string;
  len: number;
  combo_count: number;
  is_syntactic: boolean | number | string;
  morph_prefix: string | null;
  morph_suffix: string | null;
  pos_start: number;
  pos_end: number;
  atomic_slice: string | null;
  semantic_weight: number | null;
  game_weight: number | null;
  start_combo_count: number | null;
}
