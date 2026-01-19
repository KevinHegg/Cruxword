// Dictionary loader for word validation + clueability
let wordSet: Set<string> | null = null;
let clueableSet: Set<string> | null = null;

async function loadWordData(): Promise<void> {
	if (wordSet && clueableSet) return;
	
	try {
		// Try to load from playdict.csv
		const response = await fetch('/data/playdict.csv');
		if (!response.ok) {
			console.warn('Could not load dictionary, using empty set');
			wordSet = new Set();
			clueableSet = new Set();
			return;
		}
		
		const text = await response.text();
		const words = new Set<string>();
		const clueable = new Set<string>();
		
		const lines = text.split('\n');
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			if (trimmed.toLowerCase().startsWith('word,')) continue;
			
			const parts = trimmed.split(',');
			const rawWord = parts[0]?.trim().toUpperCase() || '';
			if (!rawWord || !/^[A-Z]+$/.test(rawWord)) continue;
			
			words.add(rawWord);
			const isClueable = (parts[1] ?? '').trim().toLowerCase() === 'yes';
			if (isClueable) clueable.add(rawWord);
		}
		
		wordSet = words;
		clueableSet = clueable;
		console.log(`Loaded ${wordSet.size} words (${clueableSet.size} clueable) from dictionary`);
	} catch (error) {
		console.warn('Error loading dictionary:', error);
		wordSet = new Set();
		clueableSet = new Set();
	}
}

export async function loadDictionary(): Promise<Set<string>> {
	await loadWordData();
	return wordSet ?? new Set();
}

export async function loadClueableWords(): Promise<Set<string>> {
	await loadWordData();
	return clueableSet ?? new Set();
}

export function isValidWord(word: string, dictionary: Set<string>): boolean {
	if (!dictionary || dictionary.size === 0) {
		// If dictionary not loaded, allow all words (graceful degradation)
		return true;
	}
	return dictionary.has(word.toUpperCase());
}
