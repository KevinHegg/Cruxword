// Dictionary loader for word validation
let wordSet: Set<string> | null = null;

export async function loadDictionary(): Promise<Set<string>> {
	if (wordSet) return wordSet;
	
	try {
		// Try to load from playdict.csv
		const response = await fetch('/data/playdict.csv');
		if (!response.ok) {
			console.warn('Could not load dictionary, using empty set');
			wordSet = new Set();
			return wordSet;
		}
		
		const text = await response.text();
		const words = text
			.split('\n')
			.map(line => {
				// CSV format: word,is_clueable - extract first column
				const parts = line.split(',');
				return parts[0]?.trim().toUpperCase() || '';
			})
			.filter(word => word.length > 0 && /^[A-Z]+$/.test(word));
		
		wordSet = new Set(words);
		console.log(`Loaded ${wordSet.size} words from dictionary`);
		return wordSet;
	} catch (error) {
		console.warn('Error loading dictionary:', error);
		wordSet = new Set();
		return wordSet;
	}
}

export function isValidWord(word: string, dictionary: Set<string>): boolean {
	if (!dictionary || dictionary.size === 0) {
		// If dictionary not loaded, allow all words (graceful degradation)
		return true;
	}
	return dictionary.has(word.toUpperCase());
}
