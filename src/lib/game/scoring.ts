import type { BoardState, ValidationResult } from './types';

function fibBonus(len: number): number {
	// len 6->2, 7->3, 8->5, 9->8, 10->13
	const map: Record<number, number> = { 6: 2, 7: 3, 8: 5, 9: 8, 10: 13 };
	return map[len] ?? 0;
}

export function validateAndScore(board: BoardState, minWordLen = 3, requireSingleCluster = true, maxIntersectionsPerWordPair = 1, dictionary?: Set<string>): ValidationResult {
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

	// Extract words (contiguous sequences)
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
			while (c < cols && board.cells[r][c]) {
				text += board.cells[r][c]!.letter;
				cells.push(`${r},${c}`);
				c++;
			}
			words.push({ text, dir: 'H', row: r, col: startC, len: text.length, cells });
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
			while (r < rows && board.cells[r][c]) {
				text += board.cells[r][c]!.letter;
				cells.push(`${r},${c}`);
				r++;
			}
			words.push({ text, dir: 'V', row: startR, col: c, len: text.length, cells });
		}
	}

	// No short runs (strict MVP): forbid any 1–2 letter horizontal/vertical runs
	const shortRuns = words.filter((w) => w.len > 0 && w.len < minWordLen);
	if (shortRuns.length) {
		issues.push(`Submit blocked: found ${shortRuns.length} short run(s) (length 1–2).`);
	}

	// Intersection rule: any H word and V word share <=1 cell
	const hWords = words.filter((w) => w.dir === 'H' && w.len >= minWordLen);
	const vWords = words.filter((w) => w.dir === 'V' && w.len >= minWordLen);

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
	const validWords = words.filter((w) => {
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
	
	// Check for invalid words
	if (dictionary && dictionary.size > 0) {
		const invalidWords = words.filter((w) => {
			if (w.len < minWordLen) return false;
			if (w.text.includes('*')) return false; // Wildcard words allowed
			return !dictionary.has(w.text);
		});
		if (invalidWords.length > 0) {
			issues.push(`Submit blocked: invalid words found: ${invalidWords.map(w => `"${w.text}"`).join(', ')}`);
		}
	}

	let score = 0;
	for (const w of validWords) {
		score += w.len;
		if (w.len >= 6) score += fibBonus(w.len);
	}

	const ok = issues.length === 0;

	return {
		ok,
		issues,
		density,
		filledCells: filled,
		wordCount: validWords.length,
		score,
		words: validWords.map((w) => ({ text: w.text, dir: w.dir, row: w.row, col: w.col, len: w.len }))
	};
}
