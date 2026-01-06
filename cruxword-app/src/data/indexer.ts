import type { WordEntry, Candidate } from './types';

export interface WordIndex {
  byLength: Map<number, WordEntry[]>;
  allWords: WordEntry[];
}

export function buildIndex(words: WordEntry[]): WordIndex {
  const byLength = new Map<number, WordEntry[]>();

  words.forEach(word => {
    const length = word.word.length;
    
    // Index by length
    if (!byLength.has(length)) {
      byLength.set(length, []);
    }
    byLength.get(length)!.push(word);
  });

  return {
    byLength,
    allWords: words,
  };
}

export function findCandidates(
  index: WordIndex,
  pattern: string,
  filters: {
    preferClueable?: boolean;
    preferLowFrequency?: boolean;
    allowProperNouns?: boolean;
  } = {}
): Candidate[] {
  const length = pattern.length;
  const candidates = index.byLength.get(length) || [];
  
  // Filter by pattern
  const regex = new RegExp('^' + pattern.replace(/\?/g, '.') + '$');
  const matching = candidates.filter(word => regex.test(word.word));
  
  // Apply filters
  let filtered = matching;
  
  // Exclude banned words
  filtered = filtered.filter(word => !word.banned);
  
  if (filters.preferClueable) {
    filtered = filtered.filter(word => word.is_clueable === true);
  }
  
  if (!filters.allowProperNouns) {
    filtered = filtered.filter(word => 
      !word.pos || word.pos !== 'noun' || !word.flags?.includes('proper')
    );
  }
  
  // Convert to candidates and rank
  const candidatesWithScores: Candidate[] = filtered.map(word => ({
    word: word.word,
    score: calculateScore(word),
    segScore: 0, // Will be computed by segment scoring
    zipf: word.zipf || 0,
    crossingBonus: 0, // Will be computed by crossing analysis
    bestSegments: [], // Will be populated by segment analysis
    is_clueable: word.is_clueable || false,
    theme_tags: word.theme_tags || '',
  }));
  
  // Sort by new ranking rules: lower zipf first, then is_clueable, then alphabetically
  candidatesWithScores.sort((a, b) => {
    // Primary: lower zipf (rarer first)
    const zipfA = a.zipf || 0;
    const zipfB = b.zipf || 0;
    if (zipfA !== zipfB) {
      return zipfA - zipfB;
    }
    
    // Tiebreaker 1: is_clueable (true first)
    if (a.is_clueable !== b.is_clueable) {
      return b.is_clueable ? 1 : -1;
    }
    
    // Tiebreaker 2: alphabetical
    return a.word.localeCompare(b.word);
  });
  
  return candidatesWithScores.slice(0, 200); // Limit to top 200
}

function calculateScore(word: WordEntry): number {
  let score = 0;
  
  // Base score: rarity (lower zipf = higher score)
  const zipf = word.zipf || 0;
  score += 1 / (zipf + 0.01);
  
  // Clueable bonus
  if (word.is_clueable) {
    score += 10;
  }
  
  // Theme boost
  if (word.in_must_keep) {
    score += 50;
  }
  
  return score;
}
