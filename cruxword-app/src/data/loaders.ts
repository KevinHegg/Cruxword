import Papa from 'papaparse';
import { CanonicalRow, type CanonicalRowT } from './schema';

async function fetchCSV(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return res.text();
}

export async function loadCanonicalDict(): Promise<CanonicalRowT[]> {
  const csv = await fetchCSV('/data/dict_canonical.csv');
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
  return (parsed.data as any[])
    .filter(row => row.word && row.word.trim()) // Filter out empty rows
    .map(row => CanonicalRow.parse(row));
}
