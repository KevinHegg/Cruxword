import type { Slot, Candidate } from './types';
import type { SegmentRow, BasellexRow } from './csvLoaders';
import { bestSegmentation, normalizeZipf } from './segmentation';

export interface FillWordIndex {
  words: string[]; // All words from playdict (lowercase)
  wordsByLen: Map<number, string[]>; // Length -> words
  posIndex: Map<number, Map<number, Map<string, Set<number>>>>; // [length][pos][char] -> Set<wordIndex>
  basellex: Map<string, BasellexRow>;
  segMap: Map<string, SegmentRow>;
  minZipf: number;
  maxZipf: number;
}

/**
 * Build indexes for fast pattern matching
 */
export function buildFillIndex(
  words: string[],
  basellex: Map<string, BasellexRow>,
  segMap: Map<string, SegmentRow>
): FillWordIndex {
  const wordsByLen = new Map<number, string[]>();
  const posIndex = new Map<number, Map<number, Map<string, Set<number>>>>();
  
  // Calculate zipf range
  let minZipf = Infinity;
  let maxZipf = -Infinity;
  basellex.forEach(row => {
    if (row.zipf > 0) {
      minZipf = Math.min(minZipf, row.zipf);
      maxZipf = Math.max(maxZipf, row.zipf);
    }
  });
  
  // Build length index
  words.forEach((word, idx) => {
    const len = word.length;
    if (!wordsByLen.has(len)) {
      wordsByLen.set(len, []);
    }
    wordsByLen.get(len)!.push(word);
  });
  
  return {
    words,
    wordsByLen,
    posIndex,
    basellex,
    segMap,
    minZipf: isFinite(minZipf) ? minZipf : 2.6,
    maxZipf: isFinite(maxZipf) ? maxZipf : 6.7,
  };
}

/**
 * Get position index for a given length (lazy build)
 */
function getPosIndex(
  index: FillWordIndex,
  length: number
): Map<number, Map<string, Set<number>>> {
  if (index.posIndex.has(length)) {
    return index.posIndex.get(length)!;
  }
  
  const posMap = new Map<number, Map<string, Set<number>>>();
  const wordsOfLen = index.wordsByLen.get(length) || [];
  
  wordsOfLen.forEach((word, wordIdx) => {
    const globalIdx = index.words.indexOf(word);
    if (globalIdx === -1) return;
    
    for (let pos = 0; pos < word.length; pos++) {
      const char = word[pos];
      if (!posMap.has(pos)) {
        posMap.set(pos, new Map());
      }
      const charMap = posMap.get(pos)!;
      if (!charMap.has(char)) {
        charMap.set(char, new Set());
      }
      charMap.get(char)!.add(globalIdx);
    }
  });
  
  index.posIndex.set(length, posMap);
  return posMap;
}

/**
 * Get candidates for a slot using segment scoring
 */
export function getCandidates(
  slot: Slot,
  index: FillWordIndex,
  grid: Array<Array<{ letter: string; isBlack: boolean }>>
): Candidate[] {
  const pattern = slot.pattern.toLowerCase();
  const length = pattern.length;
  
  // Get words of matching length
  const wordsOfLen = index.wordsByLen.get(length) || [];
  if (wordsOfLen.length === 0) {
    return [];
  }
  
  // Filter by pattern using position indexes
  let candidateIndices: Set<number> | null = null;
  const posIndex = getPosIndex(index, length);
  
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char !== '?') {
      const charSet = posIndex.get(i)?.get(char);
      if (!charSet) {
        return []; // No words match this position
      }
      if (candidateIndices === null) {
        candidateIndices = new Set(charSet);
      } else {
        // Intersect
        candidateIndices = new Set(
          Array.from(candidateIndices).filter(idx => charSet.has(idx))
        );
      }
    }
  }
  
  // If no fixed letters, use all words of this length
  if (candidateIndices === null) {
    candidateIndices = new Set<number>();
    wordsOfLen.forEach((word, localIdx) => {
      const globalIdx = index.words.indexOf(word);
      if (globalIdx !== -1) {
        candidateIndices!.add(globalIdx);
      }
    });
  }
  
  // Check crossing constraints and compute scores
  const candidates: Candidate[] = [];
  
  for (const wordIdx of candidateIndices) {
    const word = index.words[wordIdx];
    if (!word) continue;
    
    // Check if word matches pattern (double-check)
    let matchesPattern = true;
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] !== '?' && pattern[i] !== word[i]) {
        matchesPattern = false;
        break;
      }
    }
    if (!matchesPattern) continue;
    
    // Check crossing constraints
    let conflicts = false;
    let matchesFixed = 0;
    
    for (let i = 0; i < slot.cells.length; i++) {
      const cell = slot.cells[i];
      const gridCell = grid[cell.r]?.[cell.c];
      if (!gridCell || gridCell.isBlack) continue;
      
      if (gridCell.letter) {
        const fixedLetter = gridCell.letter.toLowerCase();
        if (word[i] !== fixedLetter) {
          conflicts = true;
          break;
        }
        matchesFixed++;
      }
    }
    
    if (conflicts) continue;
    
    // Get segmentation
    const segResult = bestSegmentation(word, index.segMap);
    if (!segResult) continue; // Reject words that can't be tiled
    
    // Get zipf
    const basellexRow = index.basellex.get(word);
    const zipf = basellexRow?.zipf || 0;
    const normZipf = normalizeZipf(zipf, index.minZipf, index.maxZipf);
    
    // Crossing bonus
    const crossingBonus = matchesFixed / length;
    
    // Final score
    const finalScore =
      segResult.score +
      0.10 * normZipf +
      0.10 * crossingBonus;
    
    candidates.push({
      word: word.toUpperCase(),
      score: finalScore,
      segScore: segResult.score,
      zipf,
      crossingBonus,
      bestSegments: segResult.pieces,
    });
  }
  
  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);
  
  return candidates.slice(0, 50); // Top 50 for UI
}

