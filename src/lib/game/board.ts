import type { BoardState, Cell, Orientation, PlacedStick, Stick } from './types';

export function createEmptyBoard(rows = 10, cols = 10): BoardState {
	const cells: (Cell | null)[][] = Array.from({ length: rows }, () =>
		Array.from({ length: cols }, () => null)
	);
	return { rows, cols, cells, placed: {} };
}

export function canPlaceStick(board: BoardState, stick: Stick, row: number, col: number): { ok: boolean; reason?: string } {
	const text = stick.text.toUpperCase();
	const dr = stick.orientation === 'V' ? 1 : 0;
	const dc = stick.orientation === 'H' ? 1 : 0;

	// Bounds
	const endR = row + dr * (text.length - 1);
	const endC = col + dc * (text.length - 1);
	if (row < 0 || col < 0 || endR >= board.rows || endC >= board.cols) {
		return { ok: false, reason: 'Out of bounds' };
	}

	// Letter conflicts: allow overlap only if same letter
	for (let i = 0; i < text.length; i++) {
		const r = row + dr * i;
		const c = col + dc * i;
		const existing = board.cells[r][c];
		if (!existing) continue;
		if (existing.letter !== text[i]) return { ok: false, reason: 'Letter mismatch' };
	}

	return { ok: true };
}

export function placeStick(board: BoardState, stick: Stick, row: number, col: number): BoardState {
	const next = cloneBoard(board);
	const text = stick.text.toUpperCase();
	const dr = stick.orientation === 'V' ? 1 : 0;
	const dc = stick.orientation === 'H' ? 1 : 0;

	for (let i = 0; i < text.length; i++) {
		const r = row + dr * i;
		const c = col + dc * i;
		const ch = text[i];

		const existing = next.cells[r][c];
		if (!existing) {
			next.cells[r][c] = { letter: ch, stickIds: [stick.sid] };
		} else {
			// same letter already guaranteed by canPlaceStick
			if (!existing.stickIds.includes(stick.sid)) existing.stickIds.push(stick.sid);
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
