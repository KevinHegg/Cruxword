import type { Segment, SegmentChain } from './types';

function norm(x: number): number {
  // Simple normalization - can enhance with real min-max if needed
  return Math.min(1, x / 1000);
}

function matchesFixed(pattern: string, start: number, _end: number, piece: string): boolean {
  for (let i = 0; i < piece.length; i++) {
    const patternChar = pattern[start + i];
    if (patternChar !== '?' && patternChar.toLowerCase() !== piece[i].toLowerCase()) {
      return false;
    }
  }
  return true;
}

interface DPState {
  score: number;
  chain: string[];
  lastSeg: Segment | null;
}

export function findTopSegmentChains(
  pattern: string,
  segsByLength: Map<number, Segment[]>,
  remaining: Map<string, number>,
  maxK = 50
): SegmentChain[] {
  const L = pattern.length;
  if (L < 2) return [];

  const minSegs = Math.ceil(L / 5);
  const maxSegs = Math.floor(L / 2);

  const memo = new Map<string, DPState[]>();

  function dp(i: number, segCount: number): DPState[] {
    if (i === L) {
      if (segCount >= minSegs && segCount <= maxSegs) {
        return [{ score: 0, chain: [], lastSeg: null }];
      }
      return [];
    }

    const key = `${i}-${segCount}`;
    if (memo.has(key)) {
      return memo.get(key)!;
    }

    const results: DPState[] = [];

    for (let len = 2; len <= 5; len++) {
      const j = i + len;
      if (j > L) break;

      // Get segments of this length
      const segsOfLen = segsByLength.get(len);
      if (!segsOfLen) continue;
      
      // Iterate through all segments of this length that match the pattern
      for (const seg of segsOfLen) {
        const segText = seg.text;
        
        // Check if fixed letters match
        if (!matchesFixed(pattern, i, j, segText)) continue;

        // Check segment count bounds
        const remainLen = L - j;
        const minLeft = remainLen > 0 ? Math.ceil(remainLen / 5) : 0;
        const maxLeft = remainLen > 0 ? Math.floor(remainLen / 2) : 0;
        const nextCount = segCount + 1;

        if (nextCount + minLeft > maxSegs) continue;
        if (remainLen > 0 && nextCount + maxLeft < minSegs) continue;

        // Calculate piece score
        let ps = seg.game_weight + 0.05 * norm(seg.combo_count + seg.start_combo_count);

        // Edge bonuses
        if (i === 0 && (seg.pos_start || seg.morph_prefix)) {
          ps += 0.08;
        }
        if (j === L && (seg.pos_end || seg.morph_suffix)) {
          ps += 0.08;
        }

        // Get continuations
        const tails = dp(j, nextCount);

        for (const tail of tails) {
          let joinBonus = 0;

          // Join bonus with last segment
          if (tail.lastSeg) {
            const leftOK = seg.morph_suffix || seg.pos_end;
            const rightOK = tail.lastSeg.morph_prefix || tail.lastSeg.pos_start;

            if (leftOK) joinBonus += 0.08;
            if (rightOK) joinBonus += 0.08;
            if (!leftOK && !rightOK) joinBonus -= 0.06;
          }

          results.push({
            score: ps + joinBonus + tail.score,
            chain: [segText.toUpperCase(), ...tail.chain],
            lastSeg: seg,
          });
        }
      }
    }

    // Keep only top scoring results to limit exponential growth (beam search)
    results.sort((a, b) => b.score - a.score);
    const beamWidth = 100; // Limit results per state
    const pruned = results.slice(0, beamWidth);
    
    memo.set(key, pruned);
    return pruned;
  }

  const allResults = dp(0, 0);

  // Convert to SegmentChain format
  const chains: SegmentChain[] = allResults.map(state => {
    const perSegmentLifespan = state.chain.map(seg => remaining.get(seg.toLowerCase()) || 0);
    const usesOK = perSegmentLifespan.every(l => l > 0);

    return {
      letters: state.chain.join(''),
      chain: state.chain,
      score: state.score,
      usesOK,
      perSegmentLifespan,
    };
  });

  // Sort by score descending and take top K
  chains.sort((a, b) => b.score - a.score);
  return chains.slice(0, maxK);
}

