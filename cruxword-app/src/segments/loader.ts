import Papa from 'papaparse';
import type { Segment } from './types';

export async function loadSegments(): Promise<Map<string, Segment>> {
  const response = await fetch('/data/segments.csv');
  const csvText = await response.text();

  return new Promise((resolve, reject) => {
    Papa.parse(csvText, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
      complete: (results: Papa.ParseResult<Record<string, string>>) => {
        const segMap = new Map<string, Segment>();

        for (const row of results.data) {
          if (!row.text || row.text.length < 2 || row.text.length > 5) {
            continue;
          }

          const segment: Segment = {
            text: row.text.toLowerCase(),
            len: parseInt(row.len) || row.text.length,
            combo_count: parseInt(row.combo_count) || 0,
            start_combo_count: parseInt(row.start_combo_count) || 0,
            is_syntactic: row.is_syntactic?.toUpperCase() === 'TRUE',
            morph_prefix: row.morph_prefix?.toUpperCase() === 'TRUE',
            morph_suffix: row.morph_suffix?.toUpperCase() === 'TRUE',
            pos_start: row.pos_start?.toUpperCase() === 'TRUE',
            pos_end: row.pos_end?.toUpperCase() === 'TRUE',
            atomic_slice: row.atomic_slice?.toUpperCase() === 'TRUE',
            semantic_weight: parseFloat(row.semantic_weight) || 0,
            game_weight: parseFloat(row.game_weight) || 0,
          };

          segMap.set(segment.text, segment);
        }

        console.log(`Loaded ${segMap.size} segments from segments.csv`);
        resolve(segMap);
      },
      error: error => {
        console.error('Error parsing segments.csv:', error);
        reject(error);
      },
    });
  });
}

export function initializeLifespans(segMap: Map<string, Segment>): Map<string, number> {
  const remaining = new Map<string, number>();

  for (const [text, seg] of segMap.entries()) {
    const lifespan = Math.max(
      1,
      Math.min(3, Math.round(Math.log1p(seg.combo_count) / 2))
    );
    remaining.set(text, lifespan);
  }

  return remaining;
}

