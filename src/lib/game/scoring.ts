import type { BoardState, ValidationResult } from './types';

function fibBonus(len: number): number {
	// Bonus starts at length 6: 6->2, 7->3, 8->5, 9->8, 10->13, 11->21, 12->34
	if (len < 6) return 0;
	let a = 1;
	let b = 2;
	if (len === 6) return b;
	for (let l = 7; l <= len; l++) {
		const next = a + b;
		a = b;
		b = next;
	}
	return b;
}

export function validateAndScore(
	board: BoardState,
	minWordLen = 3,
	requireSingleCluster = true,
	maxIntersectionsPerWordPair = 1,
	dictionary?: Set<string>,
	clueableWords?: Set<string>
): ValidationResult {
	const issues: string[] = [];
	const rows = board.rows;
	const cols = board.cols;

	let filled = 0;
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) if (board.cells[r][c]) filled++;
	}
	const density = filled / (rows * cols);

	// Cluster check (edge-adjacent)
	if (requireSingleCluster && filled > 0) {
		const seen = new Set<string>();
		let start: [number, number] | null = null;

		for (let r = 0; r < rows && !start; r++) {
			for (let c = 0; c < cols && !start; c++) if (board.cells[r][c]) start = [r, c];
		}

		if (start) {
			const q: [number, number][] = [start];
			seen.add(`${start[0]},${start[1]}`);

			const dirs = [
				[1, 0],
				[-1, 0],
				[0, 1],
				[0, -1]
			];

			while (q.length) {
				const [r, c] = q.shift()!;
				for (const [dr, dc] of dirs) {
					const rr = r + dr;
					const cc = c + dc;
					if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
					if (!board.cells[rr][cc]) continue;
					const key = `${rr},${cc}`;
					if (seen.has(key)) continue;
					seen.add(key);
					q.push([rr, cc]);
				}
			}

			if (seen.size !== filled) issues.push('Submit blocked: board is not one single connected cluster.');
		}
	}

	// Extract words (contiguous sequences) - but only count sequences that align with complete placed sticks
	// Build a map of cells to the sticks they belong to
	const cellToSticks = new Map<string, Set<string>>();
	for (const [sid, placed] of Object.entries(board.placed)) {
		const dr = placed.orientation === 'V' ? 1 : 0;
		const dc = placed.orientation === 'H' ? 1 : 0;
		for (let i = 0; i < placed.text.length; i++) {
			const r = placed.row + dr * i;
			const c = placed.col + dc * i;
			const key = `${r},${c}`;
			if (!cellToSticks.has(key)) {
				cellToSticks.set(key, new Set());
			}
			cellToSticks.get(key)!.add(sid);
		}
	}

	const words: { text: string; dir: 'H' | 'V'; row: number; col: number; len: number; cells: string[] }[] = [];

	// Horizontal
	for (let r = 0; r < rows; r++) {
		let c = 0;
		while (c < cols) {
			if (!board.cells[r][c]) {
				c++;
				continue;
			}
			const startC = c;
			let text = '';
			const cells: string[] = [];
			const stickIdsInSequence = new Set<string>();
			while (c < cols && board.cells[r][c]) {
				text += board.cells[r][c]!.letter;
				const cellKey = `${r},${c}`;
				cells.push(cellKey);
				// Track which sticks this sequence spans
				const sticksInCell = cellToSticks.get(cellKey);
				if (sticksInCell) {
					for (const sid of sticksInCell) {
						stickIdsInSequence.add(sid);
					}
				}
				c++;
			}
			// Only add if sequence is length >= minWordLen (ignore single letters)
			if (text.length >= minWordLen) {
				words.push({ text, dir: 'H', row: r, col: startC, len: text.length, cells });
			}
		}
	}

	// Vertical
	for (let c = 0; c < cols; c++) {
		let r = 0;
		while (r < rows) {
			if (!board.cells[r][c]) {
				r++;
				continue;
			}
			const startR = r;
			let text = '';
			const cells: string[] = [];
			const stickIdsInSequence = new Set<string>();
			while (r < rows && board.cells[r][c]) {
				text += board.cells[r][c]!.letter;
				const cellKey = `${r},${c}`;
				cells.push(cellKey);
				// Track which sticks this sequence spans
				const sticksInCell = cellToSticks.get(cellKey);
				if (sticksInCell) {
					for (const sid of sticksInCell) {
						stickIdsInSequence.add(sid);
					}
				}
				r++;
			}
			// Only add if sequence is length >= minWordLen (ignore single letters)
			if (text.length >= minWordLen) {
				words.push({ text, dir: 'V', row: startR, col: c, len: text.length, cells });
			}
		}
	}

	// Filter out sub-words: if a word is contained within a longer word in the same direction, remove it
	const filteredWords: typeof words = [];
	for (const w of words) {
		let isSubWord = false;
		for (const other of words) {
			if (w === other) continue;
			if (w.dir !== other.dir) continue;
			if (w.len >= other.len) continue; // w is longer or equal, can't be sub-word
			
			// Check if w is a sub-word of other
			if (w.dir === 'H' && w.row === other.row) {
				// Same row: check if w's cells are all within other's cells
				const otherCells = new Set(other.cells);
				if (w.cells.every(cell => otherCells.has(cell))) {
					isSubWord = true;
					break;
				}
			} else if (w.dir === 'V' && w.col === other.col) {
				// Same column: check if w's cells are all within other's cells
				const otherCells = new Set(other.cells);
				if (w.cells.every(cell => otherCells.has(cell))) {
					isSubWord = true;
					break;
				}
			}
		}
		if (!isSubWord) {
			filteredWords.push(w);
		}
	}
	
	// No short runs - we already filtered these out during extraction (only sequences >= minWordLen)
	// But double-check: should not have any words < minWordLen at this point
	const shortRuns = filteredWords.filter((w) => w.len > 0 && w.len < minWordLen);
	if (shortRuns.length) {
		issues.push(`Submit blocked: found ${shortRuns.length} short run(s) (length 1–2).`);
	}

	// Intersection rule: any H word and V word share <=1 cell
	const hWords = filteredWords.filter((w) => w.dir === 'H' && w.len >= minWordLen);
	const vWords = filteredWords.filter((w) => w.dir === 'V' && w.len >= minWordLen);

	for (const h of hWords) {
		for (const v of vWords) {
			let shared = 0;
			// Fast-ish: iterate smaller set
			const set = new Set(h.cells);
			for (const cell of v.cells) if (set.has(cell)) shared++;
			if (shared > maxIntersectionsPerWordPair) {
				issues.push(
					`Submit blocked: "${h.text}" and "${v.text}" intersect ${shared} times (max ${maxIntersectionsPerWordPair}).`
				);
			}
		}
	}

	// Filter valid words (length and dictionary check)
	const validWords = filteredWords.filter((w) => {
		if (w.len < minWordLen) return false;
		// Check dictionary if available
		if (dictionary && dictionary.size > 0) {
			const wordText = w.text.replace(/\*/g, ''); // Remove wildcards for dictionary check
			if (wordText.length < minWordLen) return false;
			// For now, allow words with wildcards (could enhance later)
			if (w.text.includes('*')) return true; // Wildcard words allowed
			return dictionary.has(w.text);
		}
		return true; // If no dictionary, allow all words
	});
	
	// Check for invalid words (use filteredWords to avoid duplicates)
	if (dictionary && dictionary.size > 0) {
		const invalidWords = filteredWords.filter((w) => {
			if (w.len < minWordLen) return false;
			if (w.text.includes('*')) return false; // Wildcard words allowed
			return !dictionary.has(w.text);
		});
		if (invalidWords.length > 0) {
			issues.push(`Submit blocked: invalid words found: ${invalidWords.map(w => `"${w.text}"`).join(', ')}`);
		}
	}

	// Filter scored words (exclude stop/functional words)
	const scoredWords = validWords.filter((w) => {
		if (w.len < 3) return false;
		if (w.text.includes('*')) return false;
		if (clueableWords && clueableWords.size > 0) {
			return clueableWords.has(w.text);
		}
		return true;
	});
	
	let score = 0;
	for (const w of scoredWords) {
		score += w.len;
		score += fibBonus(w.len);
	}

	const ok = issues.length === 0;

	return {
		ok,
		issues,
		density,
		filledCells: filled,
		wordCount: scoredWords.length,
		score,
		words: validWords.map((w) => ({ text: w.text, dir: w.dir, row: w.row, col: w.col, len: w.len }))
	};
}
