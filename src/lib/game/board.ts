import type { BoardState, Cell, Orientation, PlacedStick, Stick } from './types';

export function createEmptyBoard(rows = 11, cols = 12): BoardState {
	const cells: (Cell | null)[][] = Array.from({ length: rows }, () =>
		Array.from({ length: cols }, () => null)
	);
	return { rows, cols, cells, placed: {} };
}

export function canPlaceStick(board: BoardState, stick: Stick, row: number, col: number, maxIntersectionsPerWordPair = 1): { ok: boolean; reason?: string } {
	const text = stick.text === '*' ? '*' : stick.text.toUpperCase();
	const dr = stick.orientation === 'V' ? 1 : 0;
	const dc = stick.orientation === 'H' ? 1 : 0;

	// Bounds
	const endR = row + dr * (text.length - 1);
	const endC = col + dc * (text.length - 1);
	if (row < 0 || col < 0 || endR >= board.rows || endC >= board.cols) {
		return { ok: false, reason: 'Out of bounds' };
	}

	// Letter conflicts: allow overlap only if same letter (wildcard matches any)
	const overlapCells: { r: number; c: number }[] = [];
	for (let i = 0; i < text.length; i++) {
		const r = row + dr * i;
		const c = col + dc * i;
		const existing = board.cells[r][c];
		if (!existing) continue;
		overlapCells.push({ r, c });
		const stickChar = text[i];
		// Wildcard matches any existing letter
		if (stickChar !== '*' && existing.letter !== stickChar) {
			return { ok: false, reason: 'Letter mismatch' };
		}
	}

	// Check intersection rule: this stick can only intersect with each existing stick at max 1 cell
	if (overlapCells.length > 0) {
		// Get all existing sticks that would overlap
		const overlappingSticks = new Set<string>();
		for (const { r, c } of overlapCells) {
			const cell = board.cells[r][c];
			if (cell) {
				for (const sid of cell.stickIds) {
					overlappingSticks.add(sid);
				}
			}
		}

		// For each overlapping stick, count intersection cells
		for (const existingSid of overlappingSticks) {
			const existing = board.placed[existingSid];
			if (!existing) continue;

			// Count how many cells this new stick would share with existing stick
			let sharedCount = 0;
			const existingDr = existing.orientation === 'V' ? 1 : 0;
			const existingDc = existing.orientation === 'H' ? 1 : 0;
			
			for (let i = 0; i < existing.text.length; i++) {
				const er = existing.row + existingDr * i;
				const ec = existing.col + existingDc * i;
				
				// Check if this cell is in the new stick's path
				for (let j = 0; j < text.length; j++) {
					const nr = row + dr * j;
					const nc = col + dc * j;
					if (er === nr && ec === nc) {
						sharedCount++;
					}
				}
			}

			if (sharedCount > maxIntersectionsPerWordPair) {
				return { ok: false, reason: `Would intersect with existing stick at ${sharedCount} cells (max ${maxIntersectionsPerWordPair})` };
			}
		}
	}

	return { ok: true };
}

export function placeStick(board: BoardState, stick: Stick, row: number, col: number): BoardState {
	const next = cloneBoard(board);
	const text = stick.text === '*' ? '*' : stick.text.toUpperCase();
	const dr = stick.orientation === 'V' ? 1 : 0;
	const dc = stick.orientation === 'H' ? 1 : 0;

	for (let i = 0; i < text.length; i++) {
		const r = row + dr * i;
		const c = col + dc * i;
		const ch = text[i];

		const existing = next.cells[r][c];
		if (!existing) {
			// For wildcard, display as '*'
			const letter = ch === '*' ? '*' : ch;
			next.cells[r][c] = { letter, stickIds: [stick.sid] };
		} else {
			// same letter already guaranteed by canPlaceStick (or wildcard matches)
			if (!existing.stickIds.includes(stick.sid)) existing.stickIds.push(stick.sid);
			// If placing wildcard on existing cell, keep existing letter (wildcard matches it)
		}
	}

	next.placed[stick.sid] = {
		sid: stick.sid,
		text,
		orientation: stick.orientation,
		row,
		col
	};

	return next;
}

export function removeStick(board: BoardState, sid: string): BoardState {
	const placed = board.placed[sid];
	if (!placed) return board;

	const next = cloneBoard(board);
	const { row, col, orientation, text } = placed;
	const dr = orientation === 'V' ? 1 : 0;
	const dc = orientation === 'H' ? 1 : 0;

	for (let i = 0; i < text.length; i++) {
		const r = row + dr * i;
		const c = col + dc * i;

		const cell = next.cells[r][c];
		if (!cell) continue;

		cell.stickIds = cell.stickIds.filter((x) => x !== sid);

		// If nobody owns it now, clear it.
		// NOTE: If overlapped (same letter) by another stick, keep it.
		if (cell.stickIds.length === 0) next.cells[r][c] = null;
	}

	delete next.placed[sid];
	return next;
}

export function moveStick(board: BoardState, sid: string, newRow: number, newCol: number): BoardState {
	const placed = board.placed[sid];
	if (!placed) return board;

	// Create a Stick object from placed for canPlace
	const tempStick: Stick = { sid, text: placed.text, orientation: placed.orientation, placed: true };

	// Remove then test place to allow movement across its own previous tiles
	let temp = removeStick(board, sid);

	const ok = canPlaceStick(temp, tempStick, newRow, newCol);
	if (!ok.ok) {
		// rollback (return original)
		return board;
	}

	return placeStick(temp, tempStick, newRow, newCol);
}

export function rotateOrientation(o: Orientation): Orientation {
	return o === 'H' ? 'V' : 'H';
}

export function cloneBoard(board: BoardState): BoardState {
	return {
		rows: board.rows,
		cols: board.cols,
		cells: board.cells.map((row) => row.map((c) => (c ? { letter: c.letter, stickIds: [...c.stickIds] } : null))),
		placed: { ...board.placed }
	};
}
