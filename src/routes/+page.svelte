<script lang="ts">
	import { onMount } from 'svelte';

	type Dir = 'H' | 'V';

	type Slot = {
		id: string;
		text: string;
		dir: Dir;
		used: boolean; // placed on board?
		placed: boolean;
		x: number;
		y: number;
		illegal: boolean; // overlaps > 1, conflicts, out of bounds
		overlaps: number;
	};

	const W = 10;
	const H = 10;

	// Shows you if you’re seeing the latest deploy on your phone.
	const BUILD = new Date().toISOString();

	// Sample bag (edit later / load JSON)
	const BAG: string[] = [
		'TRACE',
		'CLUES',
		'SHARE',
		'PRUNE',
		'CRUX',
		'WORD',
		'LOGS',
		'ARC',
		'OVER',
		'UNDER',
		'MICRO',
		'NESS',
		'BIO',
		'ED',
		'ING',
		'RE',
		'UN',
		'ABLE',
		'ION',
		'S',
		'S',
		'MENT',
		'ANTI',
		'POST',
		'PRE',
		'SUB',
		'INTER',
		'TRANS',
		'PRO',
		'NEUR'
	].map((s) => s.toUpperCase());

	function makeSlots(): Slot[] {
		return BAG.map((text, i) => ({
			id: `slot_${i}_${text}`,
			text,
			dir: 'H',
			used: false,
			placed: false,
			x: 0,
			y: 0,
			illegal: false,
			overlaps: 0
		}));
	}

	let slots: Slot[] = makeSlots();
	let selectedId: string | null = null;

	// Undo history
	let history: Slot[][] = [];
	function pushHistory() {
		history.push(structuredClone(slots));
		if (history.length > 60) history.shift();
	}
	function undo() {
		const prev = history.pop();
		if (!prev) return;
		slots = prev;
		if (selectedId && !slots.some((s) => s.id === selectedId)) selectedId = null;
		recompute();
	}
	function reset() {
		history = [];
		selectedId = null;
		slots = makeSlots();
		recompute();
	}

	// Board derived from placed slots
	type Cell = { letter: string | null; owners: string[] };
	let board: Cell[][] = Array.from({ length: H }, () =>
		Array.from({ length: W }, () => ({ letter: null, owners: [] }))
	);

	function inBounds(x: number, y: number) {
		return x >= 0 && x < W && y >= 0 && y < H;
	}

	function tilesFor(s: Slot) {
		const chars = s.text.split('');
		return chars.map((ch, i) => ({
			x: s.dir === 'H' ? s.x + i : s.x,
			y: s.dir === 'V' ? s.y + i : s.y,
			ch
		}));
	}

	function clearBoard() {
		board = Array.from({ length: H }, () =>
			Array.from({ length: W }, () => ({ letter: null, owners: [] }))
		);
	}

	function recompute() {
		clearBoard();

		// build board owners + letters
		for (const s of slots) {
			if (!s.placed) continue;
			for (const t of tilesFor(s)) {
				if (!inBounds(t.x, t.y)) continue;
				const c = board[t.y][t.x];
				if (c.letter === null) c.letter = t.ch;
				c.owners.push(s.id);
			}
		}

		// legality checks
		for (const s of slots) {
			if (!s.placed) {
				s.illegal = false;
				s.overlaps = 0;
				continue;
			}

			let out = false;
			let conflicts = 0;
			let overlaps = 0;

			for (const t of tilesFor(s)) {
				if (!inBounds(t.x, t.y)) {
					out = true;
					continue;
				}
				const c = board[t.y][t.x];
				if (c.letter !== null && c.letter !== t.ch) conflicts++;
				const otherOwners = c.owners.filter((id) => id !== s.id);
				if (otherOwners.length > 0) overlaps++;
			}

			s.overlaps = overlaps;

			// Your core rule: overlap/intersection at ONLY ONE tile
			const overlapRuleViolated = overlaps > 1;

			s.illegal = out || conflicts > 0 || overlapRuleViolated;
		}
	}

	recompute();

	$: tilesUsed = board.flat().filter((c) => c.letter).length;
	$: density = Math.round((tilesUsed / 100) * 100);
	$: bagCount = slots.length;

	function selectSlot(id: string) {
		selectedId = id;
	}

	function rotateSlot(id: string) {
		const s = slots.find((x) => x.id === id);
		if (!s) return;
		pushHistory();
		s.dir = s.dir === 'H' ? 'V' : 'H';
		recompute();
	}

	function placeSelectedAt(x: number, y: number) {
		if (!selectedId) return;
		const s = slots.find((z) => z.id === selectedId);
		if (!s) return;
		pushHistory();
		s.placed = true;
		s.used = true;
		s.x = x;
		s.y = y;
		recompute();
	}

	function sendBackToSlot(id: string) {
		const s = slots.find((z) => z.id === id);
		if (!s) return;
		pushHistory();
		s.placed = false;
		s.used = false;
		s.x = 0;
		s.y = 0;
		s.illegal = false;
		s.overlaps = 0;
		selectedId = id;
		recompute();
	}

	function topOwnerAt(x: number, y: number): string | null {
		const c = board[y][x];
		if (!c.owners.length) return null;
		// most recently placed approx = last in slots list
		for (let i = slots.length - 1; i >= 0; i--) {
			if (c.owners.includes(slots[i].id)) return slots[i].id;
		}
		return c.owners[0] ?? null;
	}

	// ---- iOS: hard-disable double-tap zoom, and implement OUR double-tap ----
	let lastTapAt = 0;
	let lastTapOwner: string | null = null;

	function handleBoardTap(x: number, y: number) {
		const owner = topOwnerAt(x, y);

		// If user tapped a placed stick: select it; double-tap => send back
		if (owner) {
			const now = Date.now();
			const isDouble = lastTapOwner === owner && now - lastTapAt < 300;

			lastTapAt = now;
			lastTapOwner = owner;

			if (isDouble) {
				sendBackToSlot(owner);
				return;
			}

			selectedId = owner;
			return;
		}

		// Empty cell: place selected
		lastTapOwner = null;
		lastTapAt = Date.now();
		if (selectedId) placeSelectedAt(x, y);
	}

	onMount(() => {
		// 1) Prevent Safari double-tap zoom globally.
		// Needs passive:false or preventDefault won’t work.
		let lastTouchEnd = 0;
		const stopDoubleTapZoom = (e: TouchEvent) => {
			const now = Date.now();
			if (now - lastTouchEnd <= 300) e.preventDefault();
			lastTouchEnd = now;
		};

		document.addEventListener('touchend', stopDoubleTapZoom, { passive: false });

		// 2) Also prevent pinch zoom as much as possible (won’t block OS-level gestures)
		const preventGesture = (e: Event) => e.preventDefault();
		document.addEventListener('gesturestart', preventGesture as any, { passive: false });
		document.addEventListener('gesturechange', preventGesture as any, { passive: false });
		document.addEventListener('gestureend', preventGesture as any, { passive: false });

		return () => {
			document.removeEventListener('touchend', stopDoubleTapZoom as any);
			document.removeEventListener('gesturestart', preventGesture as any);
			document.removeEventListener('gesturechange', preventGesture as any);
			document.removeEventListener('gestureend', preventGesture as any);
		};
	});

	function canSubmit() {
		return slots.some((s) => s.placed) && slots.filter((s) => s.placed).every((s) => !s.illegal);
	}

	function submit() {
		if (!canSubmit()) return;
		alert('MVP Submit: next step is cluster validation + scoring.');
	}
</script>

<svelte:head>
	<style>
		html,
		body {
			height: 100%;
			width: 100%;
			margin: 0;
			overflow: hidden; /* prevents the “right 1/3 cut off” + sideways scroll */
			background: #070b14;
		}
		* {
			box-sizing: border-box;
			-webkit-tap-highlight-color: transparent;
		}
	</style>
</svelte:head>

<main class="app">
	<header class="top">
		<div class="titleRow">
			<div class="title">CRUXWORD</div>
			<div class="bagPill">Bag {bagCount}</div>
		</div>

		<div class="statsRow">
			<div class="pill">Tiles <b>{tilesUsed}/100</b></div>
			<div class="pill">Density <b>{density}%</b></div>

			<div class="btnRow">
				<button class="btn" on:click={undo} disabled={history.length === 0} aria-label="Undo" title="Undo">
					↶
				</button>
				<button class="btn" on:click={reset} aria-label="Reset" title="Reset">
					⟲
				</button>
				<button class="btn primary" on:click={submit} disabled={!canSubmit()} aria-label="Submit" title="Submit">
					✓
				</button>
			</div>
		</div>
	</header>

	<section class="boardWrap">
		<div class="board" aria-label="10x10 board">
			{#each Array(H) as _, y}
				{#each Array(W) as __, x}
					<!-- Use BUTTON so taps reliably fire on iOS -->
					<button
						type="button"
						class="cell {board[y][x].letter ? 'filled' : ''} {board[y][x].owners.length > 1 ? 'overlap' : ''}"
						on:click={() => handleBoardTap(x, y)}
						on:touchend|preventDefault={() => handleBoardTap(x, y)}
						aria-label={`cell ${x + 1},${y + 1}`}
					>
						{#if board[y][x].letter}
							<span class="cellLetter">{board[y][x].letter}</span>
						{/if}
					</button>
				{/each}
			{/each}
		</div>
	</section>

	<footer class="bagWrap">
		<div class="bagHeader">
			<div class="bagTitle">Morphemes</div>
			<div class="buildTag">Build {BUILD.slice(11, 19)}</div>
		</div>

		<!-- One-line, one-tile-tall holders -->
		<div class="bagRow" aria-label="Morpheme bag">
			{#each slots as s (s.id)}
				<button
					type="button"
					class="slot {selectedId === s.id ? 'selected' : ''} {s.used ? 'used' : ''} {s.placed && s.illegal ? 'illegal' : ''}"
					on:click={() => selectSlot(s.id)}
					on:touchend|preventDefault={() => selectSlot(s.id)}
					aria-label={`slot ${s.text}`}
				>
					<div class="tiles">
						{#each s.text.split('') as ch}
							<div class="t">{ch}</div>
						{/each}
					</div>

					<!-- Rotate icon in the SAME ROW (right side) -->
					<button
						type="button"
						class="rot"
						aria-label="Rotate"
						title="Rotate 90°"
						disabled={selectedId !== s.id}
						on:click|stopPropagation={() => rotateSlot(s.id)}
						on:touchend|preventDefault|stopPropagation={() => rotateSlot(s.id)}
					>
						<span class="rotGlyph">⦿</span>
						<span class="rotBar">{s.dir === 'H' ? '—' : '|'}</span>
					</button>
				</button>
			{/each}
		</div>
	</footer>
</main>

<style>
	:global(body) {
		font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
		color: rgba(255, 255, 255, 0.92);
	}

	.app {
		height: 100dvh;
		width: 100vw;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		overflow: hidden;
	}

	/* Header */
	.top {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.titleRow {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.title {
		font-weight: 900;
		letter-spacing: 0.08em;
		font-size: 22px;
	}

	.bagPill {
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(255, 255, 255, 0.06);
		border-radius: 999px;
		padding: 10px 12px;
		font-weight: 800;
		opacity: 0.9;
	}

	.statsRow {
		display: grid;
		grid-template-columns: 1fr 1fr auto;
		gap: 10px;
		align-items: center;
	}

	.pill {
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(255, 255, 255, 0.05);
		border-radius: 999px;
		padding: 10px 12px;
		font-size: 15px;
		white-space: nowrap;
	}

	.btnRow {
		display: flex;
		gap: 8px;
	}

	.btn {
		height: 44px;
		min-width: 44px;
		padding: 0 12px;
		border-radius: 14px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(255, 255, 255, 0.06);
		color: rgba(255, 255, 255, 0.92);
		font-weight: 900;
		touch-action: manipulation;
	}

	.btn:disabled {
		opacity: 0.35;
	}

	.btn.primary {
		border-color: rgba(110, 231, 183, 0.35);
		background: rgba(110, 231, 183, 0.12);
	}

	/* Board */
	.boardWrap {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.board {
		width: calc(100vw - 24px);
		max-width: 520px;
		aspect-ratio: 1 / 1;
		display: grid;
		grid-template-columns: repeat(10, 1fr);
		grid-template-rows: repeat(10, 1fr);
		gap: 2px; /* tighter = shorter board */
		padding: 8px;
		border-radius: 18px;
		border: 1px solid rgba(255, 255, 255, 0.10);
		background:
			radial-gradient(1200px 600px at 50% 0%, rgba(99, 102, 241, 0.10), transparent 60%),
			rgba(255, 255, 255, 0.02);
	}

	.cell {
		border-radius: 10px;
		border: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(0, 0, 0, 0.18);
		display: grid;
		place-items: center;
		padding: 0; /* no internal padding */
		margin: 0;
		touch-action: manipulation;
		-webkit-user-select: none;
		user-select: none;
	}

	.cell.filled {
		background: rgba(255, 255, 255, 0.08);
		border-color: rgba(255, 255, 255, 0.14);
	}

	.cell.overlap {
		outline: 2px solid rgba(250, 204, 21, 0.50);
	}

	.cellLetter {
		font-weight: 900;
		letter-spacing: 0.06em;
		font-size: clamp(14px, 4.3vw, 20px);
	}

	/* Bag */
	.bagWrap {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.bagHeader {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}

	.bagTitle {
		font-weight: 900;
		font-size: 18px;
		letter-spacing: 0.03em;
	}

	.buildTag {
		font-size: 12px;
		opacity: 0.55;
	}

	.bagRow {
		display: flex;
		gap: 10px;
		overflow-x: auto;
		overflow-y: hidden;
		padding-bottom: env(safe-area-inset-bottom);
		-webkit-overflow-scrolling: touch;
		touch-action: pan-x;
	}

	/* One-tile-tall holder */
	.slot {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 10px 10px;
		border-radius: 16px;
		border: 1px solid rgba(255, 255, 255, 0.10);
		background: rgba(255, 255, 255, 0.06);
		min-height: 52px;
		touch-action: manipulation;
	}

	.slot.selected {
		outline: 2px solid rgba(96, 165, 250, 0.55);
		background: rgba(96, 165, 250, 0.14);
	}

	/* Shadow/ghost when used (empty slot but keep faint letters) */
	.slot.used .t {
		opacity: 0.22;
	}

	.slot.illegal {
		outline: 2px solid rgba(248, 113, 113, 0.55);
	}

	.tiles {
		display: inline-flex;
		gap: 6px;
	}

	.t {
		width: 34px;
		height: 34px;
		border-radius: 12px;
		display: grid;
		place-items: center;
		border: 1px solid rgba(255, 255, 255, 0.10);
		background: rgba(0, 0, 0, 0.18);
		font-weight: 900;
		letter-spacing: 0.06em;
	}

	/* Rotate icon in same row, right side */
	.rot {
		width: 44px;
		height: 44px;
		border-radius: 14px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(0, 0, 0, 0.18);
		color: rgba(255, 255, 255, 0.9);
		position: relative;
		display: grid;
		place-items: center;
		touch-action: manipulation;
	}

	.rot:disabled {
		opacity: 0.28;
	}

	.rotGlyph {
		font-size: 18px;
		line-height: 1;
		opacity: 0.85;
	}

	.rotBar {
		position: absolute;
		font-weight: 900;
		opacity: 0.9;
	}

	@media (max-width: 390px) {
		.title {
			font-size: 20px;
		}
		.t {
			width: 32px;
			height: 32px;
			border-radius: 11px;
		}
		.slot {
			min-height: 50px;
		}
	}
</style>
