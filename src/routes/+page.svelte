<script lang="ts">
	type Orientation = 'H' | 'V';

	type Stick = {
		id: string;
		tiles: string[]; // each cell label (letter or word-part chunk)
		orientation: Orientation;
	};

	type Cell = null | { label: string; stickId: string };

	const SIZE = 10;

	// 10x10 board
	let board: Cell[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));

	// Sample “morpheme sticks” bag (mixed lengths). Tune later.
	let bag: Stick[] = [
		{ id: 's1', tiles: ['P', 'L', 'A', 'Y'], orientation: 'H' },
		{ id: 's2', tiles: ['E', 'D'], orientation: 'H' },
		{ id: 's3', tiles: ['R', 'E'], orientation: 'H' },
		{ id: 's4', tiles: ['W', 'O', 'R', 'K'], orientation: 'H' },
		{ id: 's5', tiles: ['I', 'N', 'G'], orientation: 'H' },
		{ id: 's6', tiles: ['S'], orientation: 'H' },
		{ id: 's7', tiles: ['U', 'N'], orientation: 'H' },
		{ id: 's8', tiles: ['P', 'R', 'E'], orientation: 'H' },
		{ id: 's9', tiles: ['F', 'I', 'X'], orientation: 'H' },
		{ id: 's10', tiles: ['A', 'T'], orientation: 'H' },
		{ id: 's11', tiles: ['I', 'O', 'N'], orientation: 'H' },
		{ id: 's12', tiles: ['T', 'R', 'I'], orientation: 'H' },
		{ id: 's13', tiles: ['C', 'R', 'U', 'X'], orientation: 'H' },
		{ id: 's14', tiles: ['M', 'O', 'R', 'P', 'H'], orientation: 'H' },
		{ id: 's15', tiles: ['E', 'M', 'E'], orientation: 'H' }
	];

	// UI refs
	let boardEl: HTMLDivElement | null = null;

	// Drag state
	let dragging: {
		stickId: string;
		startX: number;
		startY: number;
		x: number;
		y: number;
		offsetX: number;
		offsetY: number;
		moved: boolean;
	} | null = null;

	let activeStickId: string | null = null;

	// Stats / monitors (simple for now)
	$: tilesPlaced = board.flat().filter(Boolean).length;
	$: densityPct = Math.round((tilesPlaced / (SIZE * SIZE)) * 100);
	$: ghostsUsed = 0; // placeholder for later
	$: score = tilesPlaced; // placeholder scoring for now

	function boardIsEmpty() {
		return tilesPlaced === 0;
	}

	function getStick(id: string) {
		return bag.find((s) => s.id === id) ?? null;
	}

	function rotateStick(id: string) {
		bag = bag.map((s) => (s.id === id ? { ...s, orientation: s.orientation === 'H' ? 'V' : 'H' } : s));
	}

	function clearSelection() {
		activeStickId = null;
	}

	function pointerDownOnStick(e: PointerEvent, stickId: string) {
		// allow tap-to-rotate vs drag-to-place
		activeStickId = stickId;

		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();

		dragging = {
			stickId,
			startX: e.clientX,
			startY: e.clientY,
			x: e.clientX,
			y: e.clientY,
			offsetX: e.clientX - rect.left,
			offsetY: e.clientY - rect.top,
			moved: false
		};

		target.setPointerCapture(e.pointerId);
	}

	function pointerMoveOnStick(e: PointerEvent) {
		if (!dragging) return;

		const dx = Math.abs(e.clientX - dragging.startX);
		const dy = Math.abs(e.clientY - dragging.startY);
		const movedNow = dx + dy > 6; // tiny threshold

		dragging = {
			...dragging,
			x: e.clientX,
			y: e.clientY,
			moved: dragging.moved || movedNow
		};
	}

	function pointerUpOnStick(e: PointerEvent) {
		if (!dragging) return;

		const stickId = dragging.stickId;

		// If it was basically a tap (not a drag), rotate the stick.
		if (!dragging.moved) {
			rotateStick(stickId);
			dragging = null;
			return;
		}

		// Drag ended: try to place onto the board.
		tryPlace(stickId, dragging.x, dragging.y);

		dragging = null;
	}

	function getCellFromClientXY(clientX: number, clientY: number) {
		if (!boardEl) return null;
		const rect = boardEl.getBoundingClientRect();
		const inside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
		if (!inside) return null;

		const cellSize = rect.width / SIZE;
		const col = Math.floor((clientX - rect.left) / cellSize);
		const row = Math.floor((clientY - rect.top) / cellSize);

		if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return null;
		return { row, col };
	}

	function coordsForStickPlacement(stick: Stick, anchorRow: number, anchorCol: number) {
		// Anchor is the stick’s first tile (top/left)
		const coords: { r: number; c: number; label: string }[] = [];
		for (let i = 0; i < stick.tiles.length; i++) {
			const r = stick.orientation === 'V' ? anchorRow + i : anchorRow;
			const c = stick.orientation === 'H' ? anchorCol + i : anchorCol;
			coords.push({ r, c, label: stick.tiles[i] });
		}
		return coords;
	}

	function inBounds(r: number, c: number) {
		return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
	}

	function hasAdjacentExisting(coords: { r: number; c: number }[]) {
		// At least one tile must touch an existing tile (edge-adjacent), unless it’s the first stick.
		for (const { r, c } of coords) {
			const neighbors = [
				{ r: r - 1, c },
				{ r: r + 1, c },
				{ r, c: c - 1 },
				{ r, c: c + 1 }
			];

			for (const n of neighbors) {
				if (inBounds(n.r, n.c) && board[n.r][n.c]) return true;
			}
		}
		return false;
	}

	function isLegalPlacement(stick: Stick, anchorRow: number, anchorCol: number) {
		const coords = coordsForStickPlacement(stick, anchorRow, anchorCol);

		// bounds + no overlap
		for (const { r, c } of coords) {
			if (!inBounds(r, c)) return { ok: false, reason: 'Out of bounds' as const };
			if (board[r][c]) return { ok: false, reason: 'Overlaps existing tile' as const };
		}

		// Must touch something unless board empty
		if (!boardIsEmpty()) {
			const touching = hasAdjacentExisting(coords.map(({ r, c }) => ({ r, c })));
			if (!touching) return { ok: false, reason: 'Must connect to existing tiles' as const };
		}

		return { ok: true as const, coords };
	}

	function placeStick(stick: Stick, anchorRow: number, anchorCol: number) {
		const check = isLegalPlacement(stick, anchorRow, anchorCol);
		if (!check.ok) return false;

		const next = board.map((row) => row.slice());
		for (const { r, c, label } of check.coords) {
			next[r][c] = { label, stickId: stick.id };
		}
		board = next;

		// remove from bag after placement
		bag = bag.filter((s) => s.id !== stick.id);
		clearSelection();
		return true;
	}

	function tryPlace(stickId: string, clientX: number, clientY: number) {
		const stick = getStick(stickId);
		if (!stick) return;

		const cell = getCellFromClientXY(clientX, clientY);
		if (!cell) return; // dropped outside board -> cancel silently

		placeStick(stick, cell.row, cell.col);
	}

	function resetBoard() {
		board = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
		// NOTE: for now, refresh page to restore the bag; later we’ll store initial bag and reset it.
		location.reload();
	}

	// Visual preview for the floating stick while dragging (computed from cursor location)
	$: dragPreview = (() => {
		if (!dragging) return null;
		const stick = getStick(dragging.stickId);
		if (!stick) return null;
		const cell = getCellFromClientXY(dragging.x, dragging.y);
		if (!cell) return { stick, cell: null, legal: null };
		const legality = isLegalPlacement(stick, cell.row, cell.col);
		return { stick, cell, legal: legality.ok };
	})();
</script>

<svelte:window
	on:pointermove={pointerMoveOnStick}
	on:pointerup={pointerUpOnStick}
	on:pointercancel={() => (dragging = null)}
/>

<div class="app">
	<header class="topbar">
		<div class="title">
			<div class="name">Cruxword</div>
			<div class="tagline">Morpheme Rush, a daily workout for your brain.</div>
		</div>

		<div class="monitors">
			<div class="chip"><span>Density</span><b>{densityPct}%</b></div>
			<div class="chip"><span>Tiles</span><b>{tilesPlaced}</b></div>
			<div class="chip"><span>Ghosts</span><b>{ghostsUsed}</b></div>
			<div class="chip"><span>Score</span><b>{score}</b></div>
			<button class="btn" on:click={resetBoard} title="Reset (temporary reload)">Reset</button>
		</div>
	</header>

	<main class="main">
		<section class="boardWrap">
			<div class="boardHeader">
				<div class="hint">
					Drag a stick to the board. Tap a stick in the bag to rotate it. After the first move, new sticks must
					touch existing tiles.
				</div>
				{#if activeStickId}
					<button class="btn subtle" on:click={() => rotateStick(activeStickId)} title="Rotate selected stick">
						Rotate selected
					</button>
				{/if}
			</div>

			<div class="board" bind:this={boardEl} aria-label="10 by 10 board">
				{#each board as row, r}
					{#each row as cell, c}
						<div class="cell">
							{#if cell}
								<div class="tile">{cell.label}</div>
							{:else}
								<!-- empty -->
							{/if}
						</div>
					{/each}
				{/each}

				{#if dragPreview && dragPreview.cell}
					<!-- simple “drop hint” outline on the anchor cell -->
					<div
						class="dropHint {dragPreview.legal ? 'ok' : 'bad'}"
						style="
							--hint-row: {dragPreview.cell.row};
							--hint-col: {dragPreview.cell.col};
						"
					/>
				{/if}
			</div>
		</section>

		<section class="bagWrap" aria-label="Morpheme bag">
			<div class="bagHeader">
				<div class="bagTitle">Morpheme bag</div>
				<div class="bagMeta">{bag.length} sticks left</div>
			</div>

			<div class="bag">
				{#each bag as stick (stick.id)}
					<div
						class="stickCard {stick.orientation === 'V' ? 'v' : 'h'} {activeStickId === stick.id ? 'active' : ''}"
						role="button"
						tabindex="0"
						on:pointerdown={(e) => pointerDownOnStick(e, stick.id)}
						aria-label="stick"
					>
						<div class="tiles">
							{#each stick.tiles as t}
								<div class="t">{t}</div>
							{/each}
						</div>
						<div class="meta">
							<span>{stick.tiles.length}</span>
							<span>{stick.orientation}</span>
						</div>
					</div>
				{/each}
			</div>
		</section>
	</main>

	{#if dragging}
		<!-- Floating “picked up” stick (visual only) -->
		{#if getStick(dragging.stickId) as ds}
			<div
				class="floating {ds.orientation === 'V' ? 'v' : 'h'}"
				style="left:{dragging.x - dragging.offsetX}px; top:{dragging.y - dragging.offsetY}px;"
			>
				{#each ds.tiles as t}
					<div class="t">{t}</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	:global(html, body) {
		height: 100%;
		margin: 0;
	}

	:global(body) {
		overflow: hidden; /* NO vertical scroll */
		background: radial-gradient(1200px 600px at 20% 0%, rgba(140, 170, 255, 0.18), transparent 55%),
			radial-gradient(900px 500px at 90% 30%, rgba(190, 140, 255, 0.16), transparent 60%),
			radial-gradient(700px 500px at 50% 100%, rgba(120, 220, 180, 0.12), transparent 60%),
			#070a12;
		color: rgba(255, 255, 255, 0.9);
		font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji",
			"Segoe UI Emoji";
	}

	.app {
		height: 100vh;
		display: flex;
		flex-direction: column;
	}

	.topbar {
		padding: 10px 12px 8px;
		display: flex;
		gap: 10px;
		align-items: flex-end;
		justify-content: space-between;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		backdrop-filter: blur(6px);
	}

	.title .name {
		font-weight: 750;
		letter-spacing: 0.3px;
		font-size: 18px;
	}

	.title .tagline {
		font-size: 12px;
		opacity: 0.75;
		margin-top: 2px;
	}

	.monitors {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
	}

	.chip {
		display: flex;
		gap: 6px;
		align-items: baseline;
		padding: 6px 8px;
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.09);
		font-size: 12px;
	}

	.chip span {
		opacity: 0.75;
	}

	.chip b {
		font-size: 13px;
	}

	.btn {
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(255, 255, 255, 0.06);
		color: rgba(255, 255, 255, 0.9);
		padding: 8px 10px;
		border-radius: 10px;
		font-size: 12px;
	}

	.btn.subtle {
		padding: 6px 10px;
		opacity: 0.9;
	}

	.main {
		flex: 1;
		display: grid;
		grid-template-rows: 1fr auto;
		min-height: 0; /* important for overflow children */
	}

	.boardWrap {
		padding: 10px 12px 6px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-height: 0;
	}

	.boardHeader {
		display: flex;
		gap: 10px;
		align-items: center;
		justify-content: space-between;
	}

	.hint {
		font-size: 12px;
		opacity: 0.78;
		line-height: 1.2;
	}

	/* 10x10 board square, width-driven */
	.board {
		width: min(100vw - 24px, 520px);
		aspect-ratio: 1 / 1;
		margin: 0 auto;
		border-radius: 14px;
		padding: 6px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.10);
		position: relative;

		display: grid;
		grid-template-columns: repeat(10, 1fr);
		grid-template-rows: repeat(10, 1fr);
		gap: 3px;
	}

	.cell {
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.025);
		border: 1px solid rgba(255, 255, 255, 0.06); /* thin grid outline */
		display: grid;
		place-items: center;
		user-select: none;
	}

	.tile {
		width: 100%;
		height: 100%;
		border-radius: 9px;
		display: grid;
		place-items: center;
		font-weight: 800;
		font-size: clamp(10px, 2.6vw, 16px);
		letter-spacing: 0.3px;
		background: rgba(255, 255, 255, 0.10);
		border: 1px solid rgba(255, 255, 255, 0.12);
	}

	.dropHint {
		position: absolute;
		--pad: 6px;
		left: calc(var(--pad) + (100% - 2 * var(--pad)) * (var(--hint-col) / 10));
		top: calc(var(--pad) + (100% - 2 * var(--pad)) * (var(--hint-row) / 10));
		width: calc((100% - 2 * var(--pad)) / 10);
		height: calc((100% - 2 * var(--pad)) / 10);
		border-radius: 10px;
		pointer-events: none;
		outline: 2px solid rgba(255, 255, 255, 0.20);
	}

	.dropHint.ok {
		outline-color: rgba(120, 255, 200, 0.55);
	}

	.dropHint.bad {
		outline-color: rgba(255, 120, 120, 0.55);
	}

	.bagWrap {
		padding: 8px 12px 12px;
		border-top: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(0, 0, 0, 0.12);
		backdrop-filter: blur(6px);
		min-height: 0;
	}

	.bagHeader {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 8px;
	}

	.bagTitle {
		font-weight: 750;
		letter-spacing: 0.2px;
	}

	.bagMeta {
		font-size: 12px;
		opacity: 0.75;
	}

	/* horizontal scroll bag */
	.bag {
		display: flex;
		gap: 10px;
		overflow-x: auto;
		overflow-y: hidden;
		padding-bottom: 6px;
		-webkit-overflow-scrolling: touch;
	}

	.stickCard {
		flex: 0 0 auto;
		min-width: 96px;
		padding: 10px;
		border-radius: 14px;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.10);
		user-select: none;
		touch-action: none; /* keeps pointer events smooth */
	}

	.stickCard.active {
		border-color: rgba(170, 190, 255, 0.55);
		box-shadow: 0 0 0 2px rgba(170, 190, 255, 0.18);
	}

	.tiles {
		display: flex;
		gap: 6px;
		align-items: center;
		justify-content: center;
	}

	.stickCard.v .tiles {
		flex-direction: column;
	}

	.t {
		width: 28px;
		height: 28px;
		border-radius: 10px;
		display: grid;
		place-items: center;
		font-weight: 850;
		font-size: 13px;
		background: rgba(255, 255, 255, 0.11);
		border: 1px solid rgba(255, 255, 255, 0.12);
	}

	.meta {
		margin-top: 8px;
		display: flex;
		justify-content: space-between;
		font-size: 11px;
		opacity: 0.75;
	}

	/* floating dragged stick */
	.floating {
		position: fixed;
		z-index: 1000;
		display: flex;
		gap: 6px;
		padding: 10px;
		border-radius: 14px;
		background: rgba(10, 12, 20, 0.75);
		border: 1px solid rgba(255, 255, 255, 0.14);
		backdrop-filter: blur(10px);
		pointer-events: none;
	}

	.floating.v {
		flex-direction: column;
	}

	@media (max-width: 420px) {
		.topbar {
			align-items: flex-start;
		}
		.monitors {
			justify-content: flex-start;
		}
	}
</style>
