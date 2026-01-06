export interface Segment {
  text: string;
  len: number;
  combo_count: number;
  start_combo_count: number;
  is_syntactic: boolean;
  morph_prefix: boolean;
  morph_suffix: boolean;
  pos_start: boolean;
  pos_end: boolean;
  atomic_slice: boolean;
  semantic_weight: number;
  game_weight: number;
}

export interface SegmentChain {
  letters: string;
  chain: string[];
  score: number;
  usesOK: boolean;
  perSegmentLifespan: number[];
}

export interface SegmentState {
  segMap: Map<string, Segment>;
  remaining: Map<string, number>;
  loaded: boolean;
}

