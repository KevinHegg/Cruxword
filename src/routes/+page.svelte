<script>
	import { onMount } from 'svelte';

	const GRID = 10;

	// --- Sample bag (swap later with JSON) ---
	const SAMPLE_STRINGS = [
		// 5
		'MICRO',
		'NEURO',
		'CRUXS',
		'LOGIC',
		'STACK',
		'WORDS',
		'TRACE',
		'SHARE',
		'CLUES',
		'PRUNE',
		// 4
		'OVER',
		'ABLE',
		'NESS',
		'TION',
		'MENT',
		'ANTI',
		'SEMI',
		'CORE',
		'PLAY',
		'GRID',
		// 3
		'ARC',
		'MAP',
		'DOT',
		'KEY',
		'NET',
		'VIZ',
		'BAG',
		'RAG',
		'LOG',
		'CRU',
		// 2
		'ED',
		'ER',
		'LY',
		'IN',
		'UP',
		'ON',
		'OR',
		'IS',
		'IT',
		'AS',
		// 1
		'S',
		'S',
		'S',
		'E',
		'E',
		'R',
		'T',
		'N',
		'L',
		'A'
	];

	const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
	const deepClone = (x) => JSON.parse(JSON.stringify(x));
	const key = (x, y) => `${x},${y}`;

	function makeId(prefix = 'p') {
		return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
	}

	// DOM refs for sizing + hit-testing
	let headerEl;
	let bagEl;
	let boardEl;

	let boardSize = 320; // px outer square
	let cellSize = 32; // px square

	// Game state
	let pieces = [];
	let selectedId = null; // selected stick id (bag or board)
	let toast = '';

	// History
	let history = [];
	function snapshot() {
		history.push(deepClone({ pieces, selectedId }));
		if (history.length > 80) history.shift();
	}
	function undo() {
		if (!history.length) return;
		const prev = history.pop();
		pieces = prev.pieces;
		selectedId = prev.selectedId;
	}
	function reset() {
		snapshot();
		initGame();
	}

	function initGame() {
		pieces = SAMPLE_STRINGS.map((letters, i) => ({
			id: makeId('stick'),
			letters,
			len: letters.length,
			dir: 'h', // 'h' | 'v' (90° toggle, no reversal)
			where: 'bag', // 'bag' | 'board'
			slot: i,
			x: null,
			y: null
		}));
		selectedId = null;
		history = [];
		toast = '';
	}

	// --- Responsive board sizing (no internal padding; borders are the grid) ---
	function viewportW() {
		return window.visualViewport?.width ?? window.innerWidth;
	}
	function viewportH() {
		return window.visualViewport?.height ?? window.innerHeight;
	}

	function recomputeBoardSize() {
		const w = Math.floor(viewportW());
		const h = Math.floor(viewportH());

		const headerH = headerEl?.getBoundingClientRect().height ?? 110;
		const bagH = bagEl?.getBoundingClientRect().height ?? 190;

		// leave a smallIN for safety + safari bars
		const availW = w - 20;
		const availH = h - headerH - bagH - 16;

		const max = Math.max(220, Math.min(availW, availH));

		// force exact 10 cells, no gaps
		const cs = Math.max(20, Math.floor(max / GRID));
		cellSize = cs;
		boardSize = cs * GRID;
	}

	onMount(() => {
		initGame();
		recomputeBoardSize();

		const vv = window.visualViewport;
		const onResize = () => recomputeBoardSize();

		window.addEventListener('resize', onResize, { passive: true });
		vv?.addEventListener('resize', onResize, { passive: true });
		vv?.addEventListener('scroll', onResize, { passive: true });

		return () => {
			window.removeEventListener('resize', onResize);
			vv?.removeEventListener('resize', onResize);
			vv?.removeEventListener('scroll', onResize);
		};
	});

	// --- Derived ---
	$: bagPieces = pieces
		.filter((p) => p.where === 'bag')
		.slice()
		.sort((a, b) => a.slot - b.slot);

	$: boardPieces = pieces.filter((p) => p.where === 'board');

	function cellsOf(p, override = null) {
		const x0 = override?.x ?? p.x;
		const y0 = override?.y ?? p.y;
		const dir = override?.dir ?? p.dir;
		const out = [];
		for (let i = 0; i < p.len; i++) {
			const x = dir === 'h' ? x0 + i : x0;
			const y = dir === 'h' ? y0 : y0 + i;
			out.push({ x, y, ch: p.letters[i] ?? '?' });
		}
		return out;
	}

	function inBounds(x, y) {
		return x >= 0 && x < GRID && y >= 0 && y < GRID;
	}

	// occ: cell -> array of {id,ch}
	$: occ = (() => {
		const m = new Map();
		for (const p of boardPieces) {
			for (const c of cellsOf(p)) {
				if (!inBounds(c.x, c.y)) continue;
				const k = key(c.x, c.y);
				if (!m.has(k)) m.set(k, []);
				m.get(k).push({ id: p.id, ch: c.ch });
			}
		}
		return m;
	})();

	function cellArr(x, y) {
		return occ.get(key(x, y)) ?? [];
	}

	function topLetter(x, y) {
		const arr = cellArr(x, y);
		if (!arr.length) return '';
		// last placed wins
		for (let i = pieces.length - 1; i >= 0; i--) {
			const p = pieces[i];
			if (p.where !== 'board') continue;
			const isHere = cellsOf(p).some((c) => c.x === x && c.y === y);
			if (isHere) {
				const c = cellsOf(p).find((c) => c.x === x && c.y === y);
				return c?.ch ?? arr[arr.length - 1].ch;
			}
		}
		return arr[arr.length - 1].ch;
	}

	// Show quick stats
	$: tilesPlaced = occ.size;
	$: densityPct = Math.round((tilesPlaced / (GRID * GRID)) * 100);

	// --- Rotation icon rules (90° only, keep order) ---
	function toggleDir(id) {
		snapshot();
		const p = pieces.find((x) => x.id === id);
		if (!p) return;
		p.dir = p.dir === 'h' ? 'v' : 'h';
	}

	// --- Legality: no triple stacks; any pair overlaps at most 1 cell ---
	function overlapCount(a, b, aCells, bCells) {
		const bSet = new Set(bCells.map((c) => key(c.x, c.y)));
		let ct = 0;
		for (const c of aCells) if (bSet.has(key(c.x, c.y))) ct++;
		return ct;
	}

	function wouldBeLegalPlacement(moving, nx, ny, ndir, ignoreId = null) {
		const p = moving;
		const newCells = cellsOf(p, { x: nx, y: ny, dir: ndir });

		// in bounds (hard)
		for (const c of newCells) {
			if (!inBounds(c.x, c.y)) return { ok: false, reason: 'Out of bounds.' };
		}

		// no triple stacks
		for (const c of newCells) {
			const arr = cellArr(c.x, c.y).filter((z) => z.id !== ignoreId);
			if (arr.length >= 2) return { ok: false, reason: 'Too many overlaps in one cell.' };
		}

		// per-pair overlap <= 1
		for (const other of boardPieces) {
			if (other.id === ignoreId) continue;
			const otherCells = cellsOf(other);
			const ct = overlapCount(p, other, newCells, otherCells);
			if (ct > 1) return { ok: false, reason: 'Two sticks can intersect at only one tile.' };
		}

		return { ok: true, reason: '' };
	}

	function placeBagPieceAt(id, x, y) {
		const p = pieces.find((z) => z.id === id);
		if (!p || p.where !== 'bag') return;

		// clamp origin so the whole stick fits
		const maxX = p.dir === 'h' ? GRID - p.len : GRID - 1;
		const maxY = p.dir === 'v' ? GRID - p.len : GRID - 1;
		const nx = clamp(x, 0, maxX);
		const ny = clamp(y, 0, maxY);

		const check = wouldBeLegalPlacement(p, nx, ny, p.dir, null);
		if (!check.ok) {
			toast = check.reason;
			return;
		}

		snapshot();
		p.where = 'board';
		p.x = nx;
		p.y = ny;
		toast = '';
	}

	function moveBoardPieceTo(id, x, y, anchorOffset = { dx: 0, dy: 0 }) {
		const p = pieces.find((z) => z.id === id);
		if (!p || p.where !== 'board') return;

		const maxX = p.dir === 'h' ? GRID - p.len : GRID - 1;
		const maxY = p.dir === 'v' ? GRID - p.len : GRID - 1;

		let nx = x - anchorOffset.dx;
		let ny = y - anchorOffset.dy;

		nx = clamp(nx, 0, maxX);
		ny = clamp(ny, 0, maxY);

		const check = wouldBeLegalPlacement(p, nx, ny, p.dir, p.id);
		if (!check.ok) {
			toast = check.reason;
			return;
		}

		p.x = nx;
		p.y = ny;
		toast = '';
	}

	// --- Hit testing: client -> board cell (no padding, no gap) ---
	function clientToCell(clientX, clientY) {
		const r = boardEl?.getBoundingClientRect();
		if (!r) return null;

		const lx = clientX - r.left;
		const ly = clientY - r.top;

		const x = Math.floor(lx / cellSize);
		const y = Math.floor(ly / cellSize);

		if (x < 0 || y < 0 || x >= GRID || y >= GRID) return null;
		return { x, y };
	}

	// --- Select logic (no double-tap; explicit controls) ---
	function select(id) {
		selectedId = id;
		toast = '';
	}

	function onBoardCellTap(x, y) {
		if (!selectedId) return;

		const p = pieces.find((z) => z.id === selectedId);
		if (!p) return;

		if (p.where === 'bag') placeBagPieceAt(p.id, x, y);
		else if (p.where === 'board') {
			// move origin to tapped cell (simple)
			snapshot();
			moveBoardPieceTo(p.id, x, y, { dx: 0, dy: 0 });
		}
	}

	// --- Drag from bag (touch-first) ---
	let bagDrag = null; // { id, active, x, y }
	function bagTouchStart(e, id) {
		e.preventDefault();
		select(id);
		const t = e.touches[0];
		bagDrag = { id, active: true, x: t.clientX, y: t.clientY };
	}
	function bagTouchMove(e) {
		if (!bagDrag?.active) return;
		e.preventDefault();
		const t = e.touches[0];
		bagDrag.x = t.clientX;
		bagDrag.y = t.clientY;
	}
	function bagTouchEnd(e) {
		if (!bagDrag?.active) return;
		e.preventDefault();
		const cell = clientToCell(bagDrag.x, bagDrag.y);
		if (cell) placeBagPieceAt(bagDrag.id, cell.x, cell.y);
		bagDrag = null;
	}

	// --- Drag on board (touch-first) ---
	let boardDrag = null; // { id, dx,dy } dx/dy = anchor offset within the stick
	function pickTopPieceIdAtCell(x, y) {
		// last placed wins
		for (let i = pieces.length - 1; i >= 0; i--) {
			const p = pieces[i];
			if (p.where !== 'board') continue;
			const hit = cellsOf(p).find((c) => c.x === x && c.y === y);
			if (hit) return p.id;
		}
		return null;
	}

	function boardTouchStart(e, x, y) {
		e.preventDefault();
		const id = pickTopPieceIdAtCell(x, y);
		if (!id) {
			onBoardCellTap(x, y);
			return;
		}

		select(id);

		// anchor offset = where inside the stick you grabbed (so it feels right)
		const p = pieces.find((z) => z.id === id);
		const hitIndex = cellsOf(p).findIndex((c) => c.x === x && c.y === y);
		const dx = p.dir === 'h' ? hitIndex : 0;
		const dy = p.dir === 'v' ? hitIndex : 0;

		snapshot();
		boardDrag = { id, dx, dy };
	}

	function boardTouchMove(e) {
		if (!boardDrag) return;
		e.preventDefault();
		const t = e.touches[0];
		const cell = clientToCell(t.clientX, t.clientY);
		if (!cell) return;
		moveBoardPieceTo(boardDrag.id, cell.x, cell.y, { dx: boardDrag.dx, dy: boardDrag.dy });
	}

	function boardTouchEnd(e) {
		if (!boardDrag) return;
		e.preventDefault();
		boardDrag = null;
	}

	// --- Remove stick back to bag (explicit button on selected stick) ---
	function returnSelectedToBag() {
		if (!selectedId) return;
		const p = pieces.find((z) => z.id === selectedId);
		if (!p || p.where !== 'board') return;
		snapshot();
		p.where = 'bag';
		p.x = null;
		p.y = null;
	}

	// --- Submit (placeholder) ---
	function submit() {
		alert(`Submitted (stub)\nTiles: ${tilesPlaced}/100\nDensity: ${densityPct}%`);
	}
</script>

<div class="app">
	<header class="top" bind:this={headerEl}>
		<div class="topRow">
			<div class="title">CRUXWORD</div>
			<div class="rightMini">
				<span class="miniPill">Bag {bagPieces.length}</span>
			</div>
		</div>

		<div class="statsRow">
			<div class="pill">Tiles <b>{tilesPlaced}/100</b></div>
			<div class="pill">Density <b>{densityPct}%</b></div>

			<div class="headerBtns">
				<button class="btn" on:click={reset}>Reset</button>
				<button class="btn primary" on:click={submit}>Submit</button>
			</div>
		</div>

		{#if toast}
			<div class="toast">{toast}</div>
		{/if}
	</header>

	<main class="mid">
		<div
			class="board"
			bind:this={boardEl}
			style="width:{boardSize}px;height:{boardSize}px;grid-template-columns:repeat({GRID},{cellSize}px);grid-template-rows:repeat({GRID},{cellSize}px);"
			on:touchmove|preventDefault={boardTouchMove}
			on:touchend|preventDefault={boardTouchEnd}
		>
			{#each Array(GRID) as _, y}
				{#each Array(GRID) as __, x}
					<div
						class="cell {cellArr(x, y).length ? 'filled' : ''} {cellArr(x, y).length > 1 ? 'overlap' : ''}"
						style="width:{cellSize}px;height:{cellSize}px;"
						on:touchstart|preventDefault={(e) => boardTouchStart(e, x, y)}
					>
						<span class="ch" style={`font-size:${Math.max(12, Math.floor(cellSize * 0.58))}px;`}>
							{topLetter(x, y)}
						</span>
					</div>
				{/each}
			{/each}
		</div>
	</main>

	<footer class="bag" bind:this={bagEl}>
		<div class="bagHead">
			<div class="bagTitle">Morphemes</div>

			<div class="bagBtns">
				<button class="iconBtn" on:click={undo} disabled={history.length === 0} aria-label="Undo" title="Undo">
					↶
				</button>
				<button
					class="iconBtn"
					on:click={() => selectedId && toggleDir(selectedId)}
					disabled={!selectedId}
					aria-label="Rotate selected"
					title="Rotate selected"
				>
					⦿
				</button>
				<button
					class="iconBtn"
					on:click={returnSelectedToBag}
					disabled={!selectedId || !pieces.find((p) => p.id === selectedId && p.where === 'board')}
					aria-label="Return selected"
					title="Return selected"
				>
					⟲
				</button>
			</div>
		</div>

		<div class="bagGrid">
			{#each bagPieces as p (p.id)}
				<div class="stickCard {selectedId === p.id ? 'sel' : ''}">
					<div class="stickTop">
						<div class="len">{p.len}</div>

						<!-- Rotation icon: circle + line, tap toggles h/v (90° only) -->
						<button class="rotBtn" on:click={() => toggleDir(p.id)} aria-label="Rotate">
							<span class="rotGlyph">
								{#if p.dir === 'h'}—{:else}|{/if}
							</span>
						</button>
					</div>

					<!-- Whole card supports tap select + drag-to-board -->
					<div
						class="tiles {p.dir === 'v' ? 'tilesV' : ''}"
						on:click={() => select(p.id)}
						on:touchstart|preventDefault={(e) => bagTouchStart(e, p.id)}
						on:touchmove|preventDefault={bagTouchMove}
						on:touchend|preventDefault={bagTouchEnd}
					>
						{#each p.letters.split('') as ch}
							<div class="tile"><span>{ch}</span></div>
						{/each}
					</div>
				</div>
			{/each}
		</div>

		<div class="hint">
			Tap to select • Tap board to place • Drag sticks onto board • Drag placed stick to move • ⦿ rotates 90°
		</div>
	</footer>
</div>

<style>
	:global(html),
	:global(body) {
		margin: 0;
		padding: 0;
		height: 100%;
		background: radial-gradient(circle at 30% 20%, #0a1630 0%, #060b16 45%, #050812 100%);
		color: #e7ebf2;
		font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
		-webkit-text-size-adjust: 100%;
	}

	:global(*) {
		box-sizing: border-box;
		-webkit-tap-highlight-color: transparent;
	}

	.app {
		height: 100svh;
		display: flex;
		flex-direction: column;
		overflow: hidden; /* no vertical scroll */
		padding-bottom: env(safe-area-inset-bottom);
	}

	/* ---------- Header ---------- */
	.top {
		padding: 10px 12px 6px;
	}

	.topRow {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
	}

	.title {
		font-weight: 900;
		letter-spacing: 0.12em;
		font-size: 20px;
	}

	.rightMini {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.miniPill {
		font-size: 12px;
		opacity: 0.8;
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(255, 255, 255, 0.02);
		padding: 6px 10px;
		border-radius: 14px;
		white-space: nowrap;
	}

	.statsRow {
		margin-top: 10px;
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap; /* keep everything visible on iPhone */
	}

	.pill {
		padding: 8px 10px;
		border-radius: 16px;
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(255, 255, 255, 0.02);
		backdrop-filter: blur(6px);
		font-size: 13px;
		white-space: nowrap;
	}

	.headerBtns {
		margin-left: auto;
		display: flex;
		gap: 8px;
		white-space: nowrap;
	}

	.btn {
		padding: 8px 10px;
		border-radius: 14px;
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(255, 255, 255, 0.03);
		color: inherit;
		font-weight: 800;
		font-size: 13px;
	}

	.btn.primary {
		border-color: rgba(92, 203, 255, 0.35);
		background: rgba(92, 203, 255, 0.12);
	}

	.toast {
		margin-top: 8px;
		font-size: 13px;
		color: rgba(255, 200, 140, 0.95);
	}

	/* ---------- Board ---------- */
	.mid {
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 10px;
	}

	.board {
		display: grid;
		border-radius: 18px;
		overflow: hidden;
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(255, 255, 255, 0.015);
		backdrop-filter: blur(7px);

		/* critical: touch-first */
		touch-action: none;
		user-select: none;
	}

	.cell {
		display: grid;
		place-items: center;

		/* internal grid lines (no padding, no gaps) */
		border-right: 1px solid rgba(255, 255, 255, 0.05);
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
		background: rgba(255, 255, 255, 0.008);
	}

	/* remove right border on last col, bottom border on last row (via nth-child math) is annoying; tolerate it */
	.cell.filled {
		background: rgba(255, 255, 255, 0.12);
	}

	.cell.overlap {
		box-shadow: inset 0 0 0 2px rgba(92, 203, 255, 0.25);
	}

	.ch {
		font-weight: 900;
		letter-spacing: 0.06em;
		color: rgba(255, 255, 255, 0.95);
		pointer-events: none;
	}

	/* ---------- Bag ---------- */
	.bag {
		padding: 10px 12px 10px;
		border-top: 1px solid rgba(255, 255, 255, 0.06);
		background: rgba(255, 255, 255, 0.02);
	}

	.bagHead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 8px;
	}

	.bagTitle {
		font-weight: 900;
		font-size: 18px;
		letter-spacing: 0.06em;
	}

	.bagBtns {
		display: flex;
		gap: 10px;
	}

	.iconBtn {
		width: 42px;
		height: 42px;
		border-radius: 14px;
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(255, 255, 255, 0.03);
		color: inherit;
		font-size: 18px;
		font-weight: 900;
		display: grid;
		place-items: center;
	}

	.iconBtn:disabled {
		opacity: 0.35;
	}

	/* Two rows of morphemes, horizontally scrollable */
	.bagGrid {
		display: grid;
		grid-auto-flow: column;
		grid-template-rows: repeat(2, auto);
		gap: 10px;
		overflow-x: auto;
		padding-bottom: 6px;
		scrollbar-width: none;
		touch-action: pan-x;
	}
	.bagGrid::-webkit-scrollbar {
		display: none;
	}

	.stickCard {
		min-width: 158px;
		border-radius: 18px;
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(255, 255, 255, 0.03);
		padding: 10px;
	}

	.stickCard.sel {
		border-color: rgba(92, 203, 255, 0.4);
		background: rgba(92, 203, 255, 0.08);
	}

	.stickTop {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}

	.len {
		width: 30px;
		height: 30px;
		border-radius: 12px;
		display: grid;
		place-items: center;
		font-weight: 900;
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(0, 0, 0, 0.2);
		font-size: 13px;
	}

	.rotBtn {
		width: 34px;
		height: 34px;
		border-radius: 14px;
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(0, 0, 0, 0.18);
		color: inherit;
		display: grid;
		place-items: center;
		font-weight: 900;
	}

	/* circle + line illusion */
	.rotGlyph {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 2px solid rgba(255, 255, 255, 0.6);
		display: grid;
		place-items: center;
		font-size: 14px;
		line-height: 1;
		color: rgba(255, 255, 255, 0.9);
	}

	.tiles {
		display: grid;
		grid-auto-flow: column;
		gap: 6px;
		justify-content: center;

		/* critical for touch drag */
		touch-action: none;
		user-select: none;
	}

	.tiles.tilesV {
		grid-auto-flow: row;
	}

	.tile {
		width: 28px;
		height: 28px;
		border-radius: 10px;
		display: grid;
		place-items: center;
		background: rgba(255, 255, 255, 0.12);
		border: 1px solid rgba(255, 255, 255, 0.08);
	}

	.tile span {
		font-weight: 900;
		font-size: 14px;
		letter-spacing: 0.06em;
	}

	.hint {
		margin-top: 6px;
		font-size: 12px;
		opacity: 0.8;
	}
</style>
