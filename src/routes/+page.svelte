<script>
	import { onMount } from 'svelte';

	const GRID = 10;

	// ---------- Utilities ----------
	const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
	const deepClone = (x) => JSON.parse(JSON.stringify(x));
	const key = (x, y) => `${x},${y}`;

	function makeId(prefix = 'p') {
		return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
	}

	// ---------- Game State ----------
	// One source of truth: all pieces live here; each is either in 'bag' or on 'board'
	// slot: stable "bag slot" so returning puts it back where it came from.
	let pieces = [];
	let selectedId = null;

	// Board sizing (fit iPhone screen, no vertical scroll)
	let boardWrapEl;
	let boardSize = 320; // px (computed)
	let cellSize = 32; // px (computed)

	// Overlay / help
	let showCheat = true; // starts ON
	const CHEAT_TEXT = `How to play
• Tap a stick to select
• Hold-drag a stick to move it
• Hold an intersection to move the whole cluster
• Double-tap a stick to return it to the bag
• Double-tap an intersection to remove those intersecting sticks
• Rotate via the rotate button (or tap rotate while selected)
Goal: make one connected cluster; no short runs (< 3); no multi-overlaps`;

	// History for Undo
	let history = [];
	function snapshot() {
		history.push(deepClone({ pieces, selectedId, showCheat }));
		// keep it small
		if (history.length > 60) history.shift();
	}
	function undo() {
		if (!history.length) return;
		const prev = history.pop();
		pieces = prev.pieces;
		selectedId = prev.selectedId;
		showCheat = prev.showCheat;
	}

	function reset() {
		snapshot();
		initGame();
	}

	// ---------- Bag generation (sample) ----------
	// You can replace this later with JSON bags.
	const SAMPLE_STRINGS = [
		// 5s
		'MICRO',
		'NEURO',
		'CRUXS',
		'LOGIC',
		'STACK',
		'WORDS',
		'SCHEM',
		'TRACE',
		'SHARE',
		'FIBON',
		// 4s
		'OVER',
		'ABLE',
		'NESS',
		'TION',
		'MENT',
		'POST',
		'PREP',
		'ANTI',
		'SEMI',
		'CORE',
		// 3s
		'UN-',
		'RE-',
		'BIO',
		'ARC',
		'RAG',
		'MAP',
		'DOT',
		'GIST',
		'KEY',
		'PIV',
		// 2s
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
		// 1s (singlets)
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

	function initGame() {
		// Create pieces in stable "slots", all start horizontal in the bag.
		pieces = SAMPLE_STRINGS.map((letters, i) => ({
			id: makeId('stick'),
			letters,
			len: letters.length,
			dir: 'h', // 'h' or 'v'
			where: 'bag', // 'bag' | 'board'
			slot: i,
			// board placement:
			x: null,
			y: null
		}));
		selectedId = null;
	}

	onMount(() => {
		initGame();
		recomputeBoardSize();
		window.addEventListener('resize', recomputeBoardSize, { passive: true });
		return () => window.removeEventListener('resize', recomputeBoardSize);
	});

	function recomputeBoardSize() {
		if (!boardWrapEl) return;
		const r = boardWrapEl.getBoundingClientRect();

		// Board should fit inside available vertical space without pushing the bag off-screen.
		// Use the wrap's height and width, minus a little padding.
		const maxW = Math.floor(r.width - 16);
		const maxH = Math.floor(r.height - 10);

		boardSize = Math.max(220, Math.min(maxW, maxH));
		cellSize = Math.floor(boardSize / GRID);
		boardSize = cellSize * GRID; // snap to exact grid pixels
	}

	// ---------- Derived helpers ----------
	$: bagPieces = pieces
		.filter((p) => p.where === 'bag')
		.slice()
		.sort((a, b) => a.slot - b.slot);

	$: boardPieces = pieces.filter((p) => p.where === 'board');

	function cellsOfPiece(p, override = null) {
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

	function inBoundsCell(x, y) {
		return x >= 0 && x < GRID && y >= 0 && y < GRID;
	}

	// Occupancy map: cell -> array of piece ids (and letters)
	$: occ = (() => {
		const m = new Map();
		for (const p of boardPieces) {
			for (const c of cellsOfPiece(p)) {
				if (!inBoundsCell(c.x, c.y)) continue;
				const k = key(c.x, c.y);
				if (!m.has(k)) m.set(k, []);
				m.get(k).push({ id: p.id, ch: c.ch });
			}
		}
		return m;
	})();

	function cellPieces(x, y) {
		return occ.get(key(x, y)) ?? [];
	}

	// Pair overlap counts (to enforce: any two sticks may overlap at most ONE tile)
	$: overlapViolations = (() => {
		const pairCounts = new Map(); // "a|b" => count
		for (const [k, arr] of occ.entries()) {
			if (arr.length <= 1) continue;
			// count all pairs in this cell
			for (let i = 0; i < arr.length; i++) {
				for (let j = i + 1; j < arr.length; j++) {
					const a = arr[i].id;
					const b = arr[j].id;
					const p = a < b ? `${a}|${b}` : `${b}|${a}`;
					pairCounts.set(p, (pairCounts.get(p) ?? 0) + 1);
				}
			}
		}
		const badPairs = new Set();
		for (const [p, ct] of pairCounts.entries()) {
			if (ct > 1) badPairs.add(p); // overlap > 1 cell between same two pieces
		}
		return { pairCounts, badPairs };
	})();

	function isCellMultiOverlap(x, y) {
		const arr = cellPieces(x, y);
		if (arr.length <= 1) return false;
		// If any pair inside this cell already has overlap count > 1, it's a violation cell.
		for (let i = 0; i < arr.length; i++) {
			for (let j = i + 1; j < arr.length; j++) {
				const a = arr[i].id;
				const b = arr[j].id;
				const p = a < b ? `${a}|${b}` : `${b}|${a}`;
				if (overlapViolations.badPairs.has(p)) return true;
			}
		}
		return false;
	}

	// Runs (for min word length >= 3)
	// A "run" is any consecutive occupied cells in a row/col.
	// Submission requires no runs of length 1-2 anywhere.
	$: runInfo = (() => {
		const occupied = Array.from({ length: GRID }, () => Array(GRID).fill(false));
		for (const k of occ.keys()) {
			const [x, y] = k.split(',').map(Number);
			occupied[y][x] = true;
		}

		const validCells = new Set(); // cells that belong to a run length >= 3 (either direction)
		let hasShortRun = false;

		// horizontal
		for (let y = 0; y < GRID; y++) {
			let x = 0;
			while (x < GRID) {
				if (!occupied[y][x]) {
					x++;
					continue;
				}
				let x2 = x;
				while (x2 < GRID && occupied[y][x2]) x2++;
				const len = x2 - x;
				if (len >= 3) {
					for (let xi = x; xi < x2; xi++) validCells.add(key(xi, y));
				} else {
					hasShortRun = true;
				}
				x = x2;
			}
		}

		// vertical
		for (let x = 0; x < GRID; x++) {
			let y = 0;
			while (y < GRID) {
				if (!occupied[y][x]) {
					y++;
					continue;
				}
				let y2 = y;
				while (y2 < GRID && occupied[y2][x]) y2++;
				const len = y2 - y;
				if (len >= 3) {
					for (let yi = y; yi < y2; yi++) validCells.add(key(x, yi));
				} else {
					hasShortRun = true;
				}
				y = y2;
			}
		}

		return { validCells, hasShortRun };
	})();

	function pieceSettled(p) {
		// "Settled" if every tile is part of at least one valid run (h or v) of length >= 3
		for (const c of cellsOfPiece(p)) {
			if (!inBoundsCell(c.x, c.y)) return false;
			if (!runInfo.validCells.has(key(c.x, c.y))) return false;
		}
		return true;
	}

	// Connectivity: pieces are connected if any tile is adjacent (edge) OR overlapping.
	function pieceAdj(pA, pB) {
		const aCells = cellsOfPiece(pA);
		const bSet = new Set(cellsOfPiece(pB).map((c) => key(c.x, c.y)));
		for (const a of aCells) {
			const k0 = key(a.x, a.y);
			if (bSet.has(k0)) return true; // overlap
			// adjacency
			const neigh = [
				[a.x + 1, a.y],
				[a.x - 1, a.y],
				[a.x, a.y + 1],
				[a.x, a.y - 1]
			];
			for (const [nx, ny] of neigh) {
				if (bSet.has(key(nx, ny))) return true;
			}
		}
		return false;
	}

	function connectedComponents() {
		const nodes = boardPieces.map((p) => p.id);
		const byId = new Map(boardPieces.map((p) => [p.id, p]));
		const seen = new Set();
		const comps = [];

		for (const id of nodes) {
			if (seen.has(id)) continue;
			const stack = [id];
			const comp = [];
			seen.add(id);

			while (stack.length) {
				const cur = stack.pop();
				comp.push(cur);
				for (const other of nodes) {
					if (seen.has(other)) continue;
					if (pieceAdj(byId.get(cur), byId.get(other))) {
						seen.add(other);
						stack.push(other);
					}
				}
			}
			comps.push(comp);
		}
		return comps;
	}

	$: comps = connectedComponents();
	$: hasOrphans = comps.length > 1 && boardPieces.length > 0;

	$: tilesPlaced = occ.size;
	$: densityPct = Math.round((tilesPlaced / (GRID * GRID)) * 100);

	// Submission validity:
	// - one big cluster (no orphans)
	// - no short runs anywhere (len < 3)
	// - no multi-overlap violations (any two pieces overlap in > 1 tile)
	$: canSubmit =
		boardPieces.length > 0 &&
		!hasOrphans &&
		!runInfo.hasShortRun &&
		overlapViolations.badPairs.size === 0;

	function submit() {
		// keep MVP: just show a summary popup
		if (!canSubmit) return;
		alert(
			`Submitted!\n\nTiles: ${tilesPlaced}/100\nDensity: ${densityPct}%\nPieces used: ${boardPieces.length}\n\nNext: generate/share a code for friends.`
		);
	}

	// ---------- Selection / rotation ----------
	function selectBagPiece(id) {
		snapshot();
		selectedId = id;
		hideCheatOnAction();
	}

	function rotateSelected() {
		if (!selectedId) return;
		snapshot();
		const p = pieces.find((x) => x.id === selectedId);
		if (!p) return;
		p.dir = p.dir === 'h' ? 'v' : 'h';
		hideCheatOnAction();
	}

	function hideCheatOnAction() {
		if (showCheat) showCheat = false;
	}

	// ---------- Drag / move logic ----------
	let drag = null; // { mode, ids, startX, startY, startPos: Map(id-> {x,y}), dx,dy, dragging }
	let holdTimer = null;
	let pointerDown = null; // { targetType, ... }
	const HOLD_MS = 180;

	function clearHoldTimer() {
		if (holdTimer) {
			clearTimeout(holdTimer);
			holdTimer = null;
		}
	}

	function startDragForPiece(pieceId, clientX, clientY) {
		const p = pieces.find((x) => x.id === pieceId);
		if (!p || p.where !== 'board') return;

		snapshot();

		drag = {
			mode: 'piece',
			ids: [pieceId],
			startX: clientX,
			startY: clientY,
			startPos: new Map([[pieceId, { x: p.x, y: p.y }]]),
			dx: 0,
			dy: 0
		};
		hideCheatOnAction();
	}

	function startDragForCluster(pieceIds, clientX, clientY) {
		snapshot();

		const startPos = new Map();
		for (const id of pieceIds) {
			const p = pieces.find((x) => x.id === id);
			if (p?.where === 'board') startPos.set(id, { x: p.x, y: p.y });
		}
		drag = {
			mode: 'cluster',
			ids: pieceIds.slice(),
			startX: clientX,
			startY: clientY,
			startPos,
			dx: 0,
			dy: 0
		};
		hideCheatOnAction();
	}

	function computeDragDelta(clientX, clientY) {
		if (!drag) return { dx: 0, dy: 0 };
		const dxPx = clientX - drag.startX;
		const dyPx = clientY - drag.startY;
		const dx = Math.round(dxPx / cellSize);
		const dy = Math.round(dyPx / cellSize);
		return { dx, dy };
	}

	function applyDragDelta(dx, dy) {
		if (!drag) return;
		drag.dx = dx;
		drag.dy = dy;
	}

	function endDrag(commit = true) {
		if (!drag) return;
		if (commit) {
			for (const id of drag.ids) {
				const p = pieces.find((x) => x.id === id);
				const s = drag.startPos.get(id);
				if (!p || !s) continue;
				p.x = s.x + drag.dx;
				p.y = s.y + drag.dy;
			}
			// Clamp all pieces back into bounds if needed (simple clamp)
			for (const id of drag.ids) {
				const p = pieces.find((x) => x.id === id);
				if (!p) continue;
				// ensure all cells in bounds by clamping anchor
				const maxX = p.dir === 'h' ? GRID - p.len : GRID - 1;
				const maxY = p.dir === 'v' ? GRID - p.len : GRID - 1;
				p.x = clamp(p.x, 0, maxX);
				p.y = clamp(p.y, 0, maxY);
			}
		}
		drag = null;
	}

	// ---------- Double-tap handling ----------
	let lastTap = { t: 0, kind: '', ref: '' };
	const DOUBLE_MS = 320;

	function isDoubleTap(kind, ref) {
		const now = Date.now();
		const ok = now - lastTap.t <= DOUBLE_MS && lastTap.kind === kind && lastTap.ref === ref;
		lastTap = { t: now, kind, ref };
		return ok;
	}

	function returnPieceToBag(pieceId) {
		snapshot();
		const p = pieces.find((x) => x.id === pieceId);
		if (!p) return;
		p.where = 'bag';
		p.x = null;
		p.y = null;
		// keep its slot; it will reappear where it came from
		hideCheatOnAction();
	}

	function removeIntersectingSticksAtCell(x, y) {
		const arr = cellPieces(x, y);
		if (arr.length <= 1) return;
		snapshot();
		const ids = [...new Set(arr.map((a) => a.id))];
		for (const id of ids) returnPieceToBag(id);
		hideCheatOnAction();
	}

	// ---------- Bag -> Board placement ----------
	function placeSelectedAt(x, y) {
		if (!selectedId) return;
		const p = pieces.find((z) => z.id === selectedId);
		if (!p || p.where !== 'bag') return;

		snapshot();

		// put on board at x,y, clamped
		const maxX = p.dir === 'h' ? GRID - p.len : GRID - 1;
		const maxY = p.dir === 'v' ? GRID - p.len : GRID - 1;

		p.where = 'board';
		p.x = clamp(x, 0, maxX);
		p.y = clamp(y, 0, maxY);

		// keep selected (so quick placement feels good)
		hideCheatOnAction();
	}

	// ---------- Pointer handlers ----------
	function onBoardPointerDown(e, x, y) {
		// prevent iOS double-tap zoom and page scrolling while interacting
		e.preventDefault?.();

		hideCheatOnAction();
		clearHoldTimer();

		const cellArr = cellPieces(x, y);
		const occupied = cellArr.length > 0;

		// If tapped empty: place selected stick
		if (!occupied) {
			// no hold behavior, just place if selected
			pointerDown = { kind: 'emptyCell', x, y };
			return;
		}

		// Occupied cell: decide piece vs cluster hold drag
		const idsHere = [...new Set(cellArr.map((a) => a.id))];
		const isIntersection = idsHere.length > 1;

		pointerDown = { kind: isIntersection ? 'intersection' : 'pieceCell', x, y, idsHere };

		holdTimer = setTimeout(() => {
			holdTimer = null;
			// Hold on intersection => drag entire cluster (connected component of the first piece)
			if (isIntersection) {
				const anyId = idsHere[0];
				const comp = comps.find((c) => c.includes(anyId)) ?? [anyId];
				startDragForCluster(comp, e.clientX, e.clientY);
			} else {
				// Hold on non-intersection => drag just that piece
				startDragForPiece(idsHere[0], e.clientX, e.clientY);
			}
		}, HOLD_MS);
	}

	function onBoardPointerMove(e) {
		if (!drag) return;
		e.preventDefault?.();
		const { dx, dy } = computeDragDelta(e.clientX, e.clientY);
		applyDragDelta(dx, dy);
	}

	function onBoardPointerUp(e, x, y) {
		e.preventDefault?.();
		clearHoldTimer();

		// If dragging, commit drag
		if (drag) {
			endDrag(true);
			return;
		}

		// Not dragging: handle tap behaviors
		if (!pointerDown) return;

		if (pointerDown.kind === 'emptyCell') {
			// tap empty cell => place selected
			placeSelectedAt(x, y);
			pointerDown = null;
			return;
		}

		if (pointerDown.kind === 'pieceCell') {
			const id = pointerDown.idsHere[0];
			const dbl = isDoubleTap('pieceCell', id);
			if (dbl) {
				// double-tap a stick => return it to bag
				returnPieceToBag(id);
			}
			pointerDown = null;
			return;
		}

		if (pointerDown.kind === 'intersection') {
			// double-tap intersection => remove sticks that intersect HERE
			const ref = key(x, y);
			const dbl = isDoubleTap('intersection', ref);
			if (dbl) {
				removeIntersectingSticksAtCell(x, y);
			}
			pointerDown = null;
			return;
		}

		pointerDown = null;
	}

	function onBagPointerDown(e, id) {
		e.preventDefault?.();
		hideCheatOnAction();
		clearHoldTimer();

		// Tap selects; long-hold does nothing special in bag for now.
		selectBagPiece(id);
	}

	// ---------- Rendering helpers ----------
	function letterAtCell(x, y) {
		const arr = cellPieces(x, y);
		if (!arr.length) return '';
		if (arr.length === 1) return arr[0].ch;
		// multiple pieces: show topmost (last in pieces array order by board placement)
		// We'll approximate by taking the last matching piece id in `pieces`.
		const ids = arr.map((a) => a.id);
		for (let i = pieces.length - 1; i >= 0; i--) {
			if (ids.includes(pieces[i].id)) {
				// determine letter for that piece at x,y
				const p = pieces[i];
				for (const c of cellsOfPiece(p)) if (c.x === x && c.y === y) return c.ch;
			}
		}
		return arr[arr.length - 1].ch;
	}

	function cellStateClass(x, y) {
		const k = key(x, y);
		const arr = cellPieces(x, y);
		const multiBad = isCellMultiOverlap(x, y);
		const inValidRun = runInfo.validCells.has(k);
		return [
			arr.length ? 'filled' : '',
			arr.length > 1 ? 'overlap' : '',
			multiBad ? 'overlapBad' : '',
			arr.length && inValidRun ? 'validRun' : '',
			arr.length && !inValidRun ? 'shortRun' : ''
		]
			.filter(Boolean)
			.join(' ');
	}

	// Show piece settled highlight on its tiles (soft "ok" cue)
	function isCellSettled(x, y) {
		const arr = cellPieces(x, y);
		if (!arr.length) return false;
		// settled if all pieces covering this cell are settled
		for (const it of arr) {
			const p = pieces.find((z) => z.id === it.id);
			if (!p) continue;
			if (!pieceSettled(p)) return false;
		}
		return true;
	}

	// For dragging preview: override positions
	function previewPos(id) {
		if (!drag) return null;
		if (!drag.startPos.has(id)) return null;
		const s = drag.startPos.get(id);
		return { x: s.x + drag.dx, y: s.y + drag.dy };
	}

	// For bag display, render a stick as mini tiles
	function pieceTilesForDisplay(p) {
		const letters = p.letters.split('');
		return letters;
	}
</script>

<svelte:window
	on:pointermove={onBoardPointerMove}
	on:pointerup={() => {
		// If user releases outside the board, end drag.
		if (drag) endDrag(true);
		clearHoldTimer();
		pointerDown = null;
	}}
/>

<div class="app">
	<header class="top">
		<div class="brandRow">
			<div class="brand">
				<div class="title">CRUXWORD <span class="muted">(Bag {bagPieces.length})</span></div>
			</div>

			<button
				class="iconBtn"
				aria-label="Help"
				title="Help"
				on:click={() => {
					// toggles; also counts as an action, so it may hide next time.
					showCheat = !showCheat;
				}}
			>
				?
			</button>
		</div>

		<div class="statsRow">
			<div class="pill">Tiles <b>{tilesPlaced}/100</b></div>
			<div class="pill">Density <b>{densityPct}%</b></div>

			<div class="actions">
				<button class="btn" on:click={undo} disabled={history.length === 0}>Undo</button>
				<button class="btn" on:click={reset}>Reset</button>
				<button class="btn primary" on:click={submit} disabled={!canSubmit} title={canSubmit ? 'Submit' : 'Fix: short runs, orphans, or multi-overlaps'}>
					Submit
				</button>
			</div>
		</div>
	</header>

	<main class="middle">
		<div class="boardWrap" bind:this={boardWrapEl}>
			<div
				class="board"
				style="width:{boardSize}px;height:{boardSize}px;grid-template-columns:repeat({GRID}, {cellSize}px);grid-template-rows:repeat({GRID}, {cellSize}px);"
			>
				{#each Array(GRID) as _, y}
					{#each Array(GRID) as __, x}
						<button
							class="cell {cellStateClass(x, y)} {isCellSettled(x, y) ? 'settled' : ''}"
							style="width:{cellSize}px;height:{cellSize}px;"
							on:pointerdown={(e) => onBoardPointerDown(e, x, y)}
							on:pointerup={(e) => onBoardPointerUp(e, x, y)}
							aria-label={`Cell ${x + 1},${y + 1}`}
						>
							<span class="ch">{letterAtCell(x, y)}</span>

							{#if cellPieces(x, y).length > 1}
								<span class="dot" title="Intersection"></span>
							{/if}
						</button>
					{/each}
				{/each}

				{#if showCheat}
					<div class="cheat" on:pointerdown|preventDefault on:pointerup|preventDefault>
						<pre>{CHEAT_TEXT}</pre>
					</div>
				{/if}
			</div>
		</div>
	</main>

	<footer class="bag">
		<div class="bagHead">
			<div class="bagTitle">Morphemes</div>

			<div class="bagTools">
				<button class="iconBtn" aria-label="Rotate selected" title="Rotate selected" on:click={rotateSelected} disabled={!selectedId}>
					↻
				</button>
			</div>
		</div>

		<div class="bagScroller" on:pointerdown={() => hideCheatOnAction()}>
			{#each bagPieces as p (p.id)}
				<button
					class="stickCard {selectedId === p.id ? 'sel' : ''}"
					on:pointerdown={(e) => onBagPointerDown(e, p.id)}
					aria-label={`Stick ${p.letters}`}
				>
					<div class="len">{p.len}</div>
					<div class="miniTiles mini-{p.len}">
						{#each pieceTilesForDisplay(p) as ch}
							<div class="miniCell"><span>{ch}</span></div>
						{/each}
					</div>
				</button>
			{/each}
		</div>

		<div class="bagHint">
			{#if !canSubmit}
				<span class="hintBad">
					{#if hasOrphans}
						Needs one connected cluster.
					{:else if runInfo.hasShortRun}
						No short runs (&lt; 3).
					{:else if overlapViolations.badPairs.size > 0}
						Some sticks overlap more than 1 tile.
					{:else}
						Keep building.
					{/if}
				</span>
			{:else}
				<span class="hintOk">Ready to submit ✓</span>
			{/if}
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
		/* helps reduce iOS double-tap zoom on controls */
		touch-action: manipulation;
	}

	:global(*) {
		-webkit-tap-highlight-color: transparent;
		box-sizing: border-box;
	}

	.app {
		height: 100svh; /* iOS-friendly viewport */
		display: flex;
		flex-direction: column;
		overflow: hidden; /* no vertical scroll */
	}

	.top {
		padding: 14px 14px 10px;
	}

	.brandRow {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.title {
		font-weight: 900;
		letter-spacing: 0.12em;
		font-size: 20px;
	}

	.muted {
		opacity: 0.65;
		font-weight: 700;
		letter-spacing: 0.06em;
		font-size: 13px;
	}

	.statsRow {
		margin-top: 10px;
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.pill {
		padding: 10px 12px;
		border-radius: 16px;
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(255, 255, 255, 0.02);
		backdrop-filter: blur(6px);
		font-size: 14px;
	}

	.actions {
		margin-left: auto;
		display: flex;
		gap: 10px;
	}

	.btn {
		padding: 10px 14px;
		border-radius: 14px;
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(255, 255, 255, 0.03);
		color: inherit;
		font-weight: 700;
	}

	.btn:disabled {
		opacity: 0.45;
	}

	.btn.primary {
		border-color: rgba(92, 203, 255, 0.35);
		background: rgba(92, 203, 255, 0.12);
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
		opacity: 0.4;
	}

	.middle {
		flex: 1;
		min-height: 0;
		display: flex;
		padding: 0 14px;
	}

	.boardWrap {
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.board {
		position: relative;
		display: grid;
		gap: 6px;
		padding: 10px;
		border-radius: 22px;
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(255, 255, 255, 0.02);
		backdrop-filter: blur(7px);
	}

	.cell {
		position: relative;
		border-radius: 12px;
		border: 1px solid rgba(255, 255, 255, 0.06);
		background: rgba(255, 255, 255, 0.012);
		padding: 0;
		display: grid;
		place-items: center;
		touch-action: none; /* board is gesture-heavy */
	}

	/* light grid outline feel */
	.cell:not(.filled) {
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
	}

	.cell.filled {
		background: rgba(255, 255, 255, 0.12);
		border-color: rgba(255, 255, 255, 0.10);
	}

	.cell.validRun {
		/* subtle */
		box-shadow: inset 0 0 0 1px rgba(92, 203, 255, 0.12);
	}

	.cell.shortRun {
		box-shadow: inset 0 0 0 1px rgba(255, 170, 80, 0.28);
	}

	.cell.overlap {
		box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.08);
	}

	.cell.overlapBad {
		box-shadow: inset 0 0 0 2px rgba(255, 90, 90, 0.55);
	}

	.cell.settled.filled:not(.overlapBad) {
		box-shadow: inset 0 0 0 2px rgba(120, 255, 190, 0.18);
	}

	.ch {
		font-weight: 900;
		letter-spacing: 0.06em;
		/* big enough on iPhone: scales with cell size */
		font-size: clamp(14px, 2.4vw, 20px);
		color: rgba(255, 255, 255, 0.95);
		user-select: none;
		pointer-events: none;
	}

	.dot {
		position: absolute;
		right: 6px;
		bottom: 6px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.6);
		opacity: 0.75;
	}

	.cheat {
		position: absolute;
		inset: 18px;
		border-radius: 18px;
		border: 1px solid rgba(255, 255, 255, 0.10);
		background: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(8px);
		display: grid;
		place-items: center;
		padding: 14px;
	}

	.cheat pre {
		margin: 0;
		white-space: pre-wrap;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
			monospace;
		font-size: 12px;
		line-height: 1.35;
		opacity: 0.92;
	}

	.bag {
		padding: 10px 14px 12px;
		border-top: 1px solid rgba(255, 255, 255, 0.06);
		background: rgba(255, 255, 255, 0.02);
	}

	.bagHead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 10px;
	}

	.bagTitle {
		font-weight: 900;
		font-size: 18px;
		letter-spacing: 0.06em;
	}

	.bagTools {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.bagScroller {
		display: flex;
		gap: 12px;
		overflow-x: auto;
		padding-bottom: 8px;
		scrollbar-width: none;
	}
	.bagScroller::-webkit-scrollbar {
		display: none;
	}

	.stickCard {
		flex: 0 0 auto;
		min-width: 140px;
		border-radius: 18px;
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(255, 255, 255, 0.03);
		padding: 10px 10px 12px;
		color: inherit;
		display: grid;
		gap: 8px;
		position: relative;
	}

	.stickCard.sel {
		border-color: rgba(92, 203, 255, 0.40);
		background: rgba(92, 203, 255, 0.08);
	}

	.len {
		position: absolute;
		top: 10px;
		left: 10px;
		width: 30px;
		height: 30px;
		border-radius: 12px;
		display: grid;
		place-items: center;
		font-weight: 900;
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(0, 0, 0, 0.20);
	}

	.miniTiles {
		display: grid;
		grid-auto-flow: column;
		gap: 6px;
		justify-content: center;
		padding-top: 6px;
	}

	.miniCell {
		width: 28px;
		height: 28px;
		border-radius: 10px;
		display: grid;
		place-items: center;
		background: rgba(255, 255, 255, 0.12);
		border: 1px solid rgba(255, 255, 255, 0.08);
	}

	.miniCell span {
		font-weight: 900;
		font-size: 14px;
		letter-spacing: 0.06em;
	}

	.bagHint {
		margin-top: 6px;
		font-size: 13px;
		opacity: 0.9;
	}

	.hintBad {
		color: rgba(255, 200, 140, 0.95);
	}

	.hintOk {
		color: rgba(140, 255, 200, 0.95);
	}
</style>
