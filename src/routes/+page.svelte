<script>
	import { onMount } from 'svelte';

	const GRID = 10;

	// Board layout constants (MUST be included in sizing math)
	const PAD = 8; // px inside board frame
	const GAP = 4; // px between cells

	// ---------- Utilities ----------
	const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
	const deepClone = (x) => JSON.parse(JSON.stringify(x));
	const key = (x, y) => `${x},${y}`;

	function makeId(prefix = 'p') {
		return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
	}

	// ---------- DOM refs for sizing / hit testing ----------
	let headerEl;
	let footerEl;
	let boardEl;

	// Computed sizing
	let boardSize = 320; // outer board px (includes PAD + gaps)
	let cellSize = 28; // square cells (px)

	// Overlay / help (starts ON)
	let showCheat = true;

	// History for Undo
	let history = [];
	function snapshot() {
		history.push(deepClone({ pieces, selectedId, showCheat }));
		if (history.length > 80) history.shift();
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

	// ---------- Game State ----------
	let pieces = [];
	let selectedId = null;

	// ---------- Bag generation (sample) ----------
	// Replace later with JSON daily bags.
	const SAMPLE_STRINGS = [
		// 5s
		'MICRO',
		'NEURO',
		'CRUXS',
		'LOGIC',
		'STACK',
		'WORDS',
		'TRACE',
		'SHARE',
		'FIBON',
		'CLUES',
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
		'ARC',
		'RAG',
		'MAP',
		'DOT',
		'KEY',
		'PIV',
		'UNK',
		'GEO',
		'VIZ',
		'NET',
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
		pieces = SAMPLE_STRINGS.map((letters, i) => ({
			id: makeId('stick'),
			letters,
			len: letters.length,
			dir: 'h', // 'h' | 'v'
			where: 'bag', // 'bag' | 'board'
			slot: i,
			x: null,
			y: null
		}));
		selectedId = null;
		showCheat = true;
		history = [];
	}

	function hideCheatOnAction() {
		if (showCheat) showCheat = false;
	}

	// ---------- Viewport sizing ----------
	function viewportW() {
		return window.visualViewport?.width ?? window.innerWidth;
	}
	function viewportH() {
		return window.visualViewport?.height ?? window.innerHeight;
	}

	function recomputeBoardSize() {
		// Available width: basically full screen minus side padding.
		const availW = Math.floor(viewportW() - 28);

		// Available height: viewport minus header/footer (no vertical scrolling).
		const headerH = headerEl?.getBoundingClientRect().height ?? 130;
		const footerH = footerEl?.getBoundingClientRect().height ?? 210;

		const availH = Math.floor(viewportH() - headerH - footerH - 12);

		const maxOuter = Math.max(220, Math.min(availW, availH));

		// IMPORTANT: include PAD + GAP in the cell math
		const usable = maxOuter - PAD * 2 - GAP * (GRID - 1);
		const cs = Math.max(18, Math.floor(usable / GRID));

		cellSize = cs;
		boardSize = cs * GRID + PAD * 2 + GAP * (GRID - 1);
	}

	onMount(() => {
		initGame();
		recomputeBoardSize();

		const vv = window.visualViewport;
		const onResize = () => recomputeBoardSize();

		window.addEventListener('resize', onResize, { passive: true });
		vv?.addEventListener('resize', onResize, { passive: true });
		vv?.addEventListener('scroll', onResize, { passive: true }); // safari bars

		return () => {
			window.removeEventListener('resize', onResize);
			vv?.removeEventListener('resize', onResize);
			vv?.removeEventListener('scroll', onResize);
		};
	});

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

	// Occupancy: cell -> array of {id,ch}
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

	// Pair overlap counts (any two sticks may overlap in at most 1 tile)
	$: overlapViolations = (() => {
		const pairCounts = new Map();
		for (const arr of occ.values()) {
			if (arr.length <= 1) continue;
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
		for (const [p, ct] of pairCounts.entries()) if (ct > 1) badPairs.add(p);
		return { pairCounts, badPairs };
	})();

	function isCellMultiOverlap(x, y) {
		const arr = cellPieces(x, y);
		if (arr.length <= 1) return false;
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

	// Runs (minimum word length >= 3)
	$: runInfo = (() => {
		const occupied = Array.from({ length: GRID }, () => Array(GRID).fill(false));
		for (const k of occ.keys()) {
			const [x, y] = k.split(',').map(Number);
			occupied[y][x] = true;
		}

		const validCells = new Set();
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
				if (len >= 3) for (let xi = x; xi < x2; xi++) validCells.add(key(xi, y));
				else hasShortRun = true;
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
				if (len >= 3) for (let yi = y; yi < y2; yi++) validCells.add(key(x, yi));
				else hasShortRun = true;
				y = y2;
			}
		}

		return { validCells, hasShortRun };
	})();

	// Connectivity: adjacency OR overlap connects pieces
	function pieceAdj(pA, pB) {
		const aCells = cellsOfPiece(pA);
		const bSet = new Set(cellsOfPiece(pB).map((c) => key(c.x, c.y)));
		for (const a of aCells) {
			if (bSet.has(key(a.x, a.y))) return true;
			const neigh = [
				[a.x + 1, a.y],
				[a.x - 1, a.y],
				[a.x, a.y + 1],
				[a.x, a.y - 1]
			];
			for (const [nx, ny] of neigh) if (bSet.has(key(nx, ny))) return true;
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

	// Submit validity: one cluster + no short runs + no multi-overlap
	$: canSubmit =
		boardPieces.length > 0 &&
		!hasOrphans &&
		!runInfo.hasShortRun &&
		overlapViolations.badPairs.size === 0;

	function submit() {
		if (!canSubmit) return;
		alert(`Submitted!\n\nTiles: ${tilesPlaced}/100\nDensity: ${densityPct}%\n\nNext: encode + share a puzzle link.`);
	}

	// ---------- Selection / rotation ----------
	function selectPiece(id) {
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

	// ---------- Double-tap (touch) ----------
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

	// ---------- Board placement ----------
	function placeSelectedAt(x, y) {
		if (!selectedId) return;
		const p = pieces.find((z) => z.id === selectedId);
		if (!p || p.where !== 'bag') return;

		snapshot();

		const maxX = p.dir === 'h' ? GRID - p.len : GRID - 1;
		const maxY = p.dir === 'v' ? GRID - p.len : GRID - 1;

		p.where = 'board';
		p.x = clamp(x, 0, maxX);
		p.y = clamp(y, 0, maxY);

		hideCheatOnAction();
	}

	function clientToBoardCell(clientX, clientY) {
		const r = boardEl?.getBoundingClientRect();
		if (!r) return null;

		const localX = clientX - r.left - PAD;
		const localY = clientY - r.top - PAD;

		const step = cellSize + GAP;
		const x = Math.floor(localX / step);
		const y = Math.floor(localY / step);

		if (x < 0 || y < 0 || x >= GRID || y >= GRID) return null;

		return { x, y };
	}

	// ---------- Drag existing pieces on board ----------
	let drag = null; // { ids, startX, startY, startPos:Map, dx,dy }
	let holdTimer = null;
	let pointerDown = null;
	const HOLD_MS = 190;

	function clearHoldTimer() {
		if (holdTimer) {
			clearTimeout(holdTimer);
			holdTimer = null;
		}
	}

	function startBoardDrag(ids, clientX, clientY) {
		snapshot();
		const startPos = new Map();
		for (const id of ids) {
			const p = pieces.find((x) => x.id === id);
			if (p?.where === 'board') startPos.set(id, { x: p.x, y: p.y });
		}
		drag = { ids, startX: clientX, startY: clientY, startPos, dx: 0, dy: 0 };
		hideCheatOnAction();
	}

	function computeDragDelta(clientX, clientY) {
		if (!drag) return { dx: 0, dy: 0 };
		const dxPx = clientX - drag.startX;
		const dyPx = clientY - drag.startY;
		return { dx: Math.round(dxPx / cellSize), dy: Math.round(dyPx / cellSize) };
	}

	function endBoardDrag(commit = true) {
		if (!drag) return;

		if (commit) {
			for (const id of drag.ids) {
				const p = pieces.find((x) => x.id === id);
				const s = drag.startPos.get(id);
				if (!p || !s) continue;
				p.x = s.x + drag.dx;
				p.y = s.y + drag.dy;

				const maxX = p.dir === 'h' ? GRID - p.len : GRID - 1;
				const maxY = p.dir === 'v' ? GRID - p.len : GRID - 1;
				p.x = clamp(p.x, 0, maxX);
				p.y = clamp(p.y, 0, maxY);
			}
		}

		drag = null;
	}

	// ---------- Drag from bag to board (NEW) ----------
	let bagDrag = null; // { id, pointerId, startX, startY, x, y, active }
	const DRAG_THRESH = 8;

	function startBagDrag(e, id) {
		// ALWAYS select on down
		selectPiece(id);

		bagDrag = {
			id,
			pointerId: e.pointerId,
			startX: e.clientX,
			startY: e.clientY,
			x: e.clientX,
			y: e.clientY,
			active: false
		};

		// Capture so we keep receiving move/up even if finger leaves card
		e.currentTarget?.setPointerCapture?.(e.pointerId);
	}

	function moveBagDrag(e) {
		if (!bagDrag || e.pointerId !== bagDrag.pointerId) return;

		bagDrag.x = e.clientX;
		bagDrag.y = e.clientY;

		const dx = Math.abs(e.clientX - bagDrag.startX);
		const dy = Math.abs(e.clientY - bagDrag.startY);

		if (!bagDrag.active && dx + dy >= DRAG_THRESH) bagDrag.active = true;
	}

	function endBagDrag(e) {
		if (!bagDrag || e.pointerId !== bagDrag.pointerId) return;

		// If this was a real drag, drop onto board if over board
		if (bagDrag.active) {
			const cell = clientToBoardCell(bagDrag.x, bagDrag.y);
			if (cell) placeSelectedAt(cell.x, cell.y);
		} else {
			// Tap behavior: do nothing else (selection already happened)
			// If user taps board cell next, it will place.
		}

		bagDrag = null;
	}

	// ---------- Pointer handlers ----------
	function onBoardPointerDown(e, x, y) {
		e.preventDefault?.();
		hideCheatOnAction();
		clearHoldTimer();

		const arr = cellPieces(x, y);

		if (!arr.length) {
			pointerDown = { kind: 'empty', x, y };
			return;
		}

		const idsHere = [...new Set(arr.map((a) => a.id))];
		const isIntersection = idsHere.length > 1;
		pointerDown = { kind: isIntersection ? 'intersection' : 'piece', x, y, idsHere };

		holdTimer = setTimeout(() => {
			holdTimer = null;
			if (isIntersection) {
				const anyId = idsHere[0];
				const comp = comps.find((c) => c.includes(anyId)) ?? [anyId];
				startBoardDrag(comp, e.clientX, e.clientY);
			} else {
				startBoardDrag([idsHere[0]], e.clientX, e.clientY);
			}
		}, HOLD_MS);
	}

	function onBoardPointerMove(e) {
		if (!drag) return;
		e.preventDefault?.();
		const { dx, dy } = computeDragDelta(e.clientX, e.clientY);
		drag.dx = dx;
		drag.dy = dy;
	}

	function onBoardPointerUp(e, x, y) {
		e.preventDefault?.();
		clearHoldTimer();

		if (drag) {
			endBoardDrag(true);
			pointerDown = null;
			return;
		}

		if (!pointerDown) return;

		if (pointerDown.kind === 'empty') {
			placeSelectedAt(x, y);
			pointerDown = null;
			return;
		}

		if (pointerDown.kind === 'piece') {
			const id = pointerDown.idsHere[0];
			if (isDoubleTap('piece', id)) returnPieceToBag(id);
			pointerDown = null;
			return;
		}

		if (pointerDown.kind === 'intersection') {
			const ref = key(x, y);
			if (isDoubleTap('intersection', ref)) removeIntersectingSticksAtCell(x, y);
			pointerDown = null;
			return;
		}

		pointerDown = null;
	}

	// ---------- Rendering helpers ----------
	function letterAtCell(x, y) {
		const arr = cellPieces(x, y);
		if (!arr.length) return '';
		if (arr.length === 1) return arr[0].ch;

		// last-added wins
		const ids = arr.map((a) => a.id);
		for (let i = pieces.length - 1; i >= 0; i--) {
			if (ids.includes(pieces[i].id)) {
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

	function pieceTilesForDisplay(p) {
		return p.letters.split('');
	}

	// ---------- Window safety (cancel drag / holds) ----------
	function globalPointerUp() {
		if (drag) endBoardDrag(true);
		clearHoldTimer();
		pointerDown = null;
	}
</script>

<svelte:window on:pointermove={onBoardPointerMove} on:pointerup={globalPointerUp} />

<div class="app">
	<header class="top" bind:this={headerEl}>
		<div class="brandRow">
			<div class="title">
				CRUXWORD <span class="muted">(Bag {bagPieces.length})</span>
			</div>
			<!-- keep header clean; help lives in bag row -->
		</div>

		<div class="statsRow">
			<div class="pill">Tiles <b>{tilesPlaced}/100</b></div>
			<div class="pill">Density <b>{densityPct}%</b></div>

			<div class="actions">
				<button class="btn" on:click={reset}>Reset</button>
				<button class="btn primary" on:click={submit} disabled={!canSubmit}>Submit</button>
			</div>
		</div>
	</header>

	<main class="middle">
		<div class="boardWrap">
			<div
				class="board"
				bind:this={boardEl}
				style="
					width:{boardSize}px;
					height:{boardSize}px;
					padding:{PAD}px;
					gap:{GAP}px;
					grid-template-columns:repeat({GRID}, {cellSize}px);
					grid-template-rows:repeat({GRID}, {cellSize}px);
				"
			>
				{#each Array(GRID) as _, y}
					{#each Array(GRID) as __, x}
						<button
							class="cell {cellStateClass(x, y)}"
							style="width:{cellSize}px;height:{cellSize}px;"
							on:pointerdown={(e) => onBoardPointerDown(e, x, y)}
							on:pointerup={(e) => onBoardPointerUp(e, x, y)}
							aria-label={`Cell ${x + 1},${y + 1}`}
						>
							<span class="ch" style={`font-size:${Math.max(12, Math.floor(cellSize * 0.55))}px;`}>
								{letterAtCell(x, y)}
							</span>
							{#if cellPieces(x, y).length > 1}
								<span class="dot" title="Intersection"></span>
							{/if}
						</button>
					{/each}
				{/each}

				{#if showCheat}
					<div
						class="cheat"
						on:pointerdown|preventDefault={() => hideCheatOnAction()}
						on:pointerup|preventDefault={() => hideCheatOnAction()}
					>
						<div class="cheatCard">
							<div class="cheatTitle">Quick controls</div>
							<ul class="cheatList">
								<li><b>Drag</b> from the bag onto the board (snap)</li>
								<li><b>Tap</b> a stick to select, then <b>tap</b> a cell to place</li>
								<li><b>Hold</b> a stick tile to drag that stick</li>
								<li><b>Hold</b> an <b>intersection</b> to drag the whole cluster</li>
								<li><b>Double-tap</b> a stick tile to return that stick</li>
								<li><b>Double-tap</b> an intersection to return sticks intersecting there</li>
							</ul>
							<div class="cheatFine">
								Submit requires: one cluster • no short runs (&lt;3) • no multi-overlaps
							</div>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</main>

	<footer class="bag" bind:this={footerEl}>
		<div class="bagHead">
			<div class="bagTitle">Morphemes</div>

			<div class="bagTools">
				<!-- Undo moved here (icon), per your request -->
				<button class="iconBtn" aria-label="Undo" title="Undo" on:click={undo} disabled={history.length === 0}>
					↶
				</button>

				<button
					class="iconBtn"
					aria-label="Rotate selected"
					title="Rotate selected"
					on:click={rotateSelected}
					disabled={!selectedId}
				>
					↻
				</button>

				<button
					class="iconBtn"
					aria-label="Cheat sheet"
					title="Cheat sheet"
					on:click={() => {
						showCheat = !showCheat;
					}}
				>
					?
				</button>
			</div>
		</div>

		<!-- TWO-ROW BAG -->
		<div class="bagGrid" on:pointerdown={() => hideCheatOnAction()}>
			{#each bagPieces as p (p.id)}
				<button
					class="stickCard {selectedId === p.id ? 'sel' : ''} {p.dir === 'v' ? 'vert' : ''}"
					on:pointerdown={(e) => startBagDrag(e, p.id)}
					on:pointermove={moveBagDrag}
					on:pointerup={endBagDrag}
					aria-label={`Stick ${p.letters}`}
				>
					<div class="len">{p.len}</div>
					<div class="miniTiles {p.dir === 'v' ? 'miniVert' : ''}">
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
		-webkit-text-size-adjust: 100%;
	}

	:global(*) {
		-webkit-tap-highlight-color: transparent;
		box-sizing: border-box;
	}

	.app {
		height: 100svh;
		display: flex;
		flex-direction: column;
		overflow: hidden; /* no vertical scroll */
	}

	/* ---------- Header ---------- */
	.top {
		padding: 12px 14px 6px;
	}

	.brandRow {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.title {
		font-weight: 900;
		letter-spacing: 0.12em;
		font-size: 20px;
	}

	.muted {
		opacity: 0.65;
		font-weight: 800;
		letter-spacing: 0.06em;
		font-size: 13px;
	}

	.statsRow {
		margin-top: 10px;
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap; /* allow wrap so Submit never disappears */
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

	.actions {
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

	.btn:disabled {
		opacity: 0.45;
	}

	.btn.primary {
		border-color: rgba(92, 203, 255, 0.35);
		background: rgba(92, 203, 255, 0.12);
	}

	/* ---------- Board ---------- */
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

		/* critical for iOS pointer behavior */
		touch-action: none;
		user-select: none;
	}

	/* light grid outline feel */
	.cell:not(.filled) {
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
	}

	.cell.filled {
		background: rgba(255, 255, 255, 0.12);
		border-color: rgba(255, 255, 255, 0.1);
	}

	.cell.validRun {
		box-shadow: inset 0 0 0 1px rgba(92, 203, 255, 0.12);
	}

	.cell.shortRun {
		box-shadow: inset 0 0 0 1px rgba(255, 170, 80, 0.28);
	}

	.cell.overlapBad {
		box-shadow: inset 0 0 0 2px rgba(255, 90, 90, 0.55);
	}

	.ch {
		font-weight: 900;
		letter-spacing: 0.06em;
		color: rgba(255, 255, 255, 0.95);
		pointer-events: none;
	}

	.dot {
		position: absolute;
		right: 5px;
		bottom: 5px;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.65);
		opacity: 0.75;
		pointer-events: none;
	}

	/* ---------- Cheat overlay ---------- */
	.cheat {
		position: absolute;
		inset: 12px;
		border-radius: 18px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		background: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(8px);
		display: grid;
		place-items: center;
		padding: 10px;
	}

	.cheatCard {
		width: 100%;
		max-width: 440px;
	}

	.cheatTitle {
		font-weight: 900;
		letter-spacing: 0.06em;
		margin-bottom: 8px;
	}

	/* hanging-indent bullets */
	.cheatList {
		margin: 0;
		padding-left: 18px;
	}

	.cheatList li {
		margin: 6px 0;
		padding-left: 10px;
		text-indent: -10px;
		font-size: 12px;
		line-height: 1.25;
		opacity: 0.92;
	}

	.cheatFine {
		margin-top: 8px;
		font-size: 12px;
		opacity: 0.85;
	}

	/* ---------- Bag ---------- */
	.bag {
		padding: 10px 14px 10px;
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

	/* TWO-ROW bag grid with horizontal scroll */
	.bagGrid {
		display: grid;
		grid-auto-flow: column;
		grid-template-rows: repeat(2, auto);
		gap: 12px;
		overflow-x: auto;
		padding-bottom: 6px;
		scrollbar-width: none;
		touch-action: pan-x;
	}
	.bagGrid::-webkit-scrollbar {
		display: none;
	}

	.stickCard {
		position: relative;
		border-radius: 18px;
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(255, 255, 255, 0.03);
		padding: 10px 10px 12px;
		color: inherit;
		display: grid;
		gap: 8px;
		min-width: 150px;
		user-select: none;
		touch-action: none; /* so pointer events behave */
	}

	.stickCard.sel {
		border-color: rgba(92, 203, 255, 0.4);
		background: rgba(92, 203, 255, 0.08);
	}

	/* Rotated stick in bag: narrower, taller, spans 2 rows */
	.stickCard.vert {
		min-width: 92px;
		grid-row: span 2;
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
		background: rgba(0, 0, 0, 0.2);
		font-size: 13px;
	}

	.miniTiles {
		display: grid;
		grid-auto-flow: column;
		gap: 6px;
		justify-content: center;
		padding-top: 6px;
	}

	/* In vertical mode, stack tiles to suggest “tall” */
	.miniTiles.miniVert {
		grid-auto-flow: row;
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
		margin-top: 4px;
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
