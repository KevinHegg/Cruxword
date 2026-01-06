import Papa from 'papaparse';

async function fetchCSV(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return res.text();
}

export interface PlaydictRow {
  word: string;
  is_clueable: string;
}

export interface BasellexRow {
  word: string;
  pos: string;
  zipf: number;
  flags: string;
  theme_tags: string;
}

export interface SegmentRow {
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

export async function loadPlaydict(): Promise<string[]> {
  const csv = await fetchCSV('/data/playdict.csv');
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true }) as Papa.ParseResult<PlaydictRow>;
  const words = parsed.data
    .filter(row => row.word && row.word.trim())
    .map(row => row.word.trim().toLowerCase());
  
  // Dedupe
  return Array.from(new Set(words));
}

export async function loadBasellex(): Promise<Map<string, BasellexRow>> {
  const csv = await fetchCSV('/data/basellex_v0.1.csv');
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true }) as Papa.ParseResult<BasellexRow>;
  
  const map = new Map<string, BasellexRow>();
  parsed.data.forEach(row => {
    if (row.word && row.word.trim()) {
      const word = row.word.trim().toLowerCase();
      const zipf = parseFloat(row.zipf as any) || 0;
      map.set(word, {
        word,
        pos: row.pos || '',
        zipf,
        flags: row.flags || '',
        theme_tags: row.theme_tags || '',
      });
    }
  });
  
  return map;
}

export async function loadSegments(): Promise<Map<string, SegmentRow>> {
  const csv = await fetchCSV('/data/segments.csv');
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true }) as Papa.ParseResult<SegmentRow>;
  
  const map = new Map<string, SegmentRow>();
  parsed.data.forEach(row => {
    if (row.text && row.text.trim()) {
      const text = row.text.trim().toLowerCase();
      map.set(text, {
        text,
        len: parseInt(row.len as any) || 0,
        combo_count: parseInt(row.combo_count as any) || 0,
        start_combo_count: parseInt(row.start_combo_count as any) || 0,
        is_syntactic: String(row.is_syntactic).toLowerCase() === 'true',
        morph_prefix: String(row.morph_prefix).toLowerCase() === 'true',
        morph_suffix: String(row.morph_suffix).toLowerCase() === 'true',
        pos_start: String(row.pos_start).toLowerCase() === 'true',
        pos_end: String(row.pos_end).toLowerCase() === 'true',
        atomic_slice: String(row.atomic_slice).toLowerCase() === 'true',
        semantic_weight: parseFloat(row.semantic_weight as any) || 0,
        game_weight: parseFloat(row.game_weight as any) || 0,
      });
    }
  });
  
  return map;
}

