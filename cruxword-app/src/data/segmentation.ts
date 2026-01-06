import type { SegmentRow } from './csvLoaders';

// Memoization cache for segmentation results
const segmentationCache = new Map<string, { score: number; pieces: string[] } | null>();

/**
 * Find the best segmentation of a word using DP
 * Returns null if no valid tiling exists (all pieces must be 2-5 letters from segMap)
 */
export function bestSegmentation(
  word: string,
  segMap: Map<string, SegmentRow>
): { score: number; pieces: string[] } | null {
  const lowerWord = word.toLowerCase();
  
  // Check cache
  if (segmentationCache.has(lowerWord)) {
    const cached = segmentationCache.get(lowerWord)!;
    return cached ? { ...cached } : null;
  }
  
  const memo = new Map<number, { score: number; pieces: string[] } | null>();
  
  function dfs(i: number): { score: number; pieces: string[] } | null {
    if (i === lowerWord.length) {
      return { score: 0, pieces: [] };
    }
    
    if (memo.has(i)) {
      return memo.get(i)!;
    }
    
    let best: { score: number; pieces: string[] } | null = null;
    let bestScore = -1e9;
    
    // Try lengths 2-5
    for (const L of [2, 3, 4, 5]) {
      const j = i + L;
      if (j > lowerWord.length) {
        break;
      }
      
      const piece = lowerWord.slice(i, j);
      const seg = segMap.get(piece);
      
      if (!seg) {
        continue; // This piece doesn't exist in segments
      }
      
      // Get tail segmentation
      const tail = dfs(j);
      if (!tail) {
        continue; // Can't tile the rest
      }
      
      // Calculate piece score
      let pieceScore = seg.game_weight;
      
      // Edge bonuses
      const delta = 0.08;
      if (i === 0 && (seg.pos_start || seg.morph_prefix)) {
        pieceScore += delta;
      }
      if (j === lowerWord.length && (seg.pos_end || seg.morph_suffix)) {
        pieceScore += delta;
      }
      
      // Productivity bonus (normalized combo_count)
      const comboNorm = Math.log1p(seg.combo_count + seg.start_combo_count) / 10;
      pieceScore += 0.05 * comboNorm;
      
      const totalScore = pieceScore + tail.score;
      
      if (totalScore > bestScore) {
        bestScore = totalScore;
        best = {
          score: totalScore,
          pieces: [piece, ...tail.pieces],
        };
      }
    }
    
    memo.set(i, best);
    return best;
  }
  
  const result = dfs(0);
  segmentationCache.set(lowerWord, result ? { ...result } : null);
  return result;
}

/**
 * Normalize zipf score (0-1 range)
 */
export function normalizeZipf(zipf: number, minZipf: number = 2.6, maxZipf: number = 6.7): number {
  if (zipf === 0) return 0.2; // Default to 20th percentile if missing
  return Math.max(0, Math.min(1, (zipf - minZipf) / (maxZipf - minZipf)));
}

