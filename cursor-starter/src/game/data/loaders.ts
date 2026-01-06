import Papa from 'papaparse';
import { z } from 'zod';
import type { BasellexRow, PlayDictRow, SegmentRow } from '../types';

async function fetchCSV(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return res.text();
}

const toBool = (v: unknown) => {
  const s = String(v ?? '').trim().toLowerCase();
  if (['true','t','1','yes','y'].includes(s)) return true;
  if (['false','f','0','no','n'].includes(s)) return false;
  return Boolean(v);
};
const toNullIfEmpty = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s.length ? s : null;
};

const BasellexSchema = z.object({
  word: z.string(),
  pos: z.string(),
  zipf: z.coerce.number().catch(0),
  flags: z.string().catch(''),
  theme_tags: z.string().catch(''),
});

const PlayDictSchema = z.object({
  word: z.string(),
  is_clueable: z.union([z.string(), z.number(), z.boolean()]).transform(toBool),
});

const SegmentSchema = z.object({
  text: z.string(),
  len: z.coerce.number().catch(0),
  combo_count: z.coerce.number().catch(0),
  is_syntactic: z.union([z.string(), z.number(), z.boolean()]).transform(toBool),
  morph_prefix: z.string().nullable().transform(toNullIfEmpty).nullable(),
  morph_suffix: z.string().nullable().transform(toNullIfEmpty).nullable(),
  pos_start: z.coerce.number().catch(0),
  pos_end: z.coerce.number().catch(0),
  atomic_slice: z.string().nullable().transform(toNullIfEmpty).nullable(),
  semantic_weight: z.coerce.number().nullable().catch(null),
  game_weight: z.coerce.number().nullable().catch(null),
  start_combo_count: z.coerce.number().nullable().catch(null),
});

export async function loadBasellex(): Promise<BasellexRow[]> {
  const csv = await fetchCSV('/data/basellex_v0.1.csv');
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
  return (parsed.data as any[]).map(row => BasellexSchema.parse(row));
}

export async function loadPlayDict(): Promise<PlayDictRow[]> {
  const csv = await fetchCSV('/data/playdict.csv');
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
  return (parsed.data as any[]).map(row => PlayDictSchema.parse(row));
}

export async function loadSegments(): Promise<SegmentRow[]> {
  const csv = await fetchCSV('/data/segments.csv');
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
  return (parsed.data as any[]).map(row => SegmentSchema.parse(row));
}
