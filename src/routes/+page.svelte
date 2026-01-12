<script lang="ts">
	import { onMount } from 'svelte';
	import { pickRandomBag } from '$lib/bags';
	import { bagToSticks, validateBagShape } from '$lib/game/bag';
	import { canPlaceStick, createEmptyBoard, moveStick, placeStick, removeStick, rotateOrientation } from '$lib/game/board';
	import { validateAndScore } from '$lib/game/scoring';
	import type { BoardState, MorphemeBag, Stick } from '$lib/game/types';

	let bag: MorphemeBag = pickRandomBag();
	let bagIssues: string[] = [];
	let sticks: Stick[] = [];
	let board: BoardState = createEmptyBoard(10, 10);

	let selectedSid: string | null = null;
	let showCheat = true;
	let showClue = true;

	// Simple history for undo
	let history: BoardState[] = [];

	// Pointer/drag state (bank -> board)
	let draggingSid: string | null = null;
	let dragX = 0;
	let dragY = 0;
	let dragOverCell: { r: number; c: number } | null = null;

	// Board selection
	let selectedPlacedSid: string | null = null;

	// UI computed
	$: filledCells = countFilled(board);
	$: densityPct = Math.round((filledCells / 100) * 100);
	$: remainingCount = sticks.filter((s) => !s.placed).length;

	$: selectedStick = selectedSid ? sticks.find((s) => s.sid === selectedSid) ?? null : null;

	// ---- lifecycle
	onMount(() => {
		startNewGame();
		// any first user action hides cheat sheet
		const hide = () => {
			if (showCheat) showCheat = false;
			window.removeEventListener('pointerdown', hide, { capture: true } as any);
		};
		window.addEventListener('pointerdown', hide, { capture: true } as any);
	});

	function startNewGame() {
		bag = pickRandomBag();
		bagIssues = validateBagShape(bag);
		sticks = bagToSticks(bag);
		board = createEmptyBoard(10, 10);
		history = [];
		selectedSid = null;
		selectedPlacedSid = null;
		showCheat = true;
		showClue = true;
	}

	function countFilled(b: BoardState) {
		let n = 0;
		for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) if (b.cells[r][c]) n++;
		return n;
	}

	function pushHistory() {
		// Keep it small
		history = [structuredClone(board), ...history].slice(0, 20);
	}

	function undo() {
		const prev = history[0];
		if (!prev) return;
		history = history.slice(1);
		board = prev;
		// update stick placed flags from board.placed
		const placedSet = new Set(Object.keys(board.placed));
		sticks = sticks.map((s) => ({ ...s, placed: placedSet.has(s.sid) }));
		selectedPlacedSid = null;
	}

	// ---- bank interactions
	function selectStick(sid: string) {
		selectedPlacedSid = null;
		selectedSid = sid;
	}

	function toggleStickOrientation(sid: string) {
		sticks = sticks.map((s) => (s.sid === sid ? { ...s, orientation: rotateOrientation(s.orientation) } : s));
	}

	// ---- placing via tap
	function tapPlace(r: number, c: number) {
		if (!selectedSid) return;
		const stick = sticks.find((s) => s.sid === selectedSid);
		if (!stick || stick.placed) return;

		const ok = canPlaceStick(board, stick, r, c);
		if (!ok.ok) return;

		pushHistory();
		board = placeStick(board, stick, r, c);
		sticks = sticks.map((s) => (s.sid === stick.sid ? { ...s, placed: true } : s));
		selectedSid = null;
	}

	// ---- board stick selection + move/return
	function tapCellSelect(r: number, c: number) {
		const cell = board.cells[r][c];
		if (!cell || cell.stickIds.length === 0) {
			selectedPlacedSid = null;
			return;
		}
		// Prefer last stick id (more recent overlaps)
		selectedPlacedSid = cell.stickIds[cell.stickIds.length - 1];
		selectedSid = null;
	}

	function returnSelectedPlaced() {
		if (!selectedPlacedSid) return;
		pushHistory();
		board = removeStick(board, selectedPlacedSid);
		sticks = sticks.map((s) => (s.sid === selectedPlacedSid ? { ...s, placed: false } : s));
		selectedPlacedSid = null;
	}

	function rotateSelectedPlaced() {
		if (!selectedPlacedSid) return;
		const ps = board.placed[selectedPlacedSid];
		if (!ps) return;

		// remove then place rotated at same anchor if possible
		const stickTemp: Stick = { sid: ps.sid, text: ps.text, orientation: ps.orientation, placed: true };
		const rotated: Stick = { ...stickTemp, orientation: rotateOrientation(stickTemp.orientation) };

		// remove
		const removed = removeStick(board, ps.sid);
		const ok = canPlaceStick(removed, rotated, ps.row, ps.col);
		if (!ok.ok) return; // fail silently MVP

		pushHistory();
		const replaced = placeStick(removed, rotated, ps.row, ps.col);
		board = replaced;

		// keep bank orientation in sync for that stick
		sticks = sticks.map((s) => (s.sid === ps.sid ? { ...s, orientation: rotated.orientation, placed: true } : s));
	}

	// ---- drag from bank to board (simple pointer-based)
	function bankPointerDown(e: PointerEvent, sid: string) {
		const s = sticks.find((x) => x.sid === sid);
		if (!s || s.placed) return;

		draggingSid = sid;
		dragX = e.clientX;
		dragY = e.clientY;
		dragOverCell = null;

		(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
		e.preventDefault();
	}

	function bankPointerMove(e: PointerEvent) {
		if (!draggingSid) return;
		dragX = e.clientX;
		dragY = e.clientY;

		// find board cell under pointer
		const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
		if (!el) {
			dragOverCell = null;
			return;
		}
		const rr = el.getAttribute('data-r');
		const cc = el.getAttribute('data-c');
		if (rr !== null && cc !== null) {
			dragOverCell = { r: Number(rr), c: Number(cc) };
		} else {
			dragOverCell = null;
		}

		e.preventDefault();
	}

	function bankPointerUp(e: PointerEvent) {
		if (!draggingSid) return;

		const sid = draggingSid;
		draggingSid = null;

		if (dragOverCell) {
			const stick = sticks.find((s) => s.sid === sid);
			if (stick && !stick.placed) {
				const ok = canPlaceStick(board, stick, dragOverCell.r, dragOverCell.c);
				if (ok.ok) {
					pushHistory();
					board = placeStick(board, stick, dragOverCell.r, dragOverCell.c);
					sticks = sticks.map((s) => (s.sid === stick.sid ? { ...s, placed: true } : s));
					selectedSid = null;
				}
			}
		}

		dragOverCell = null;
		e.preventDefault();
	}

	// ---- submit
	let submitResult: { ok: boolean; issues: string[]; score: number; densityPct: number; wordCount: number } | null = null;

	function submit() {
		const res = validateAndScore(board, bag.constraints.min_word_len, bag.constraints.submit_requires_single_cluster, bag.constraints.max_intersections_per_wordpair);

		submitResult = {
			ok: res.ok,
			issues: res.issues,
			score: res.score,
			densityPct: Math.round(res.density * 100),
			wordCount: res.wordCount
		};
	}

	function closeSubmitModal() {
		submitResult = null;
	}
</script>

<svelte:window
	on:pointermove={bankPointerMove}
	on:pointerup={bankPointerUp}
/>

<div class="screen" style="padding: env(safe-area-inset-top) 10px env(safe-area-inset-bottom) 10px;">
	<header class="top">
		<div class="titleRow">
			<div class="title">
				<div class="h1">Cruxword <span class="bagId">({bag.meta.id})</span></div>
				<div class="tagline">Morpheme Rush, a daily workout for your brain.</div>
			</div>

			<button class="btn" on:click={startNewGame} aria-label="Reset">Reset</button>
		</div>

		<div class="statsRow">
			<div class="stat">Tiles {filledCells}/100</div>
			<div class="stat">Density {densityPct}%</div>
			<div class="stat">Bag {remainingCount} left</div>

			<div class="spacer"></div>

			<button class="iconBtn" on:click={undo} aria-label="Undo" title="Undo">↶</button>
			<button class="btnPrimary" on:click={submit} aria-label="Submit">Submit</button>
		</div>

		<!-- clue bar (opens by default and overlays board until closed) -->
		<div class="clueBar {showClue ? 'open' : 'closed'}" aria-live="polite">
			<div class="clueText">
				<span class="clueLabel">{bag.meta.category}:</span>
				<span class="clueQ">{bag.meta.mystery_question}</span>
			</div>
			<button class="iconBtn" on:click={() => (showClue = !showClue)} aria-label="Toggle clue" title="Toggle clue">
				{showClue ? '▾' : '▸'}
			</button>
		</div>
	</header>

	<main class="main">
		<!-- Board wrapper ensures no horizontal cutoff on iPhone -->
		<div class="boardWrap">
			<div class="board" style="--rows: 10; --cols: 10;" aria-label="10 by 10 board">
				{#each Array(10) as _, r}
					{#each Array(10) as __, c}
						<!-- data-r/data-c used by elementFromPoint drag placement -->
						<div
							class="cell {board.cells[r][c] ? 'filled' : ''} {selectedPlacedSid && board.cells[r][c]?.stickIds?.includes(selectedPlacedSid) ? 'sel' : ''}"
							data-r={r}
							data-c={c}
							on:click={() => {
								// If cell has letters, select placed stick; else place selected stick
								if (board.cells[r][c]) tapCellSelect(r, c);
								else tapPlace(r, c);
							}}
						>
							{#if board.cells[r][c]}
								<span class="letter">{board.cells[r][c]!.letter}</span>
							{/if}
						</div>
					{/each}
				{/each}

				{#if showCheat}
					<div class="cheat">
						<div class="cheatCard">
							<div class="cheatTitle">Quickstart</div>
							<ul class="cheatList">
								<li><span class="hang">Tap</span> a morpheme stick to select it</li>
								<li><span class="hang">Tap</span> a board cell to place</li>
								<li><span class="hang">Hold</span> a stick in the bank to drag-drop onto the board</li>
								<li><span class="hang">Tap</span> a placed tile to select its stick</li>
								<li><span class="hang">↻</span> rotates a selected stick (90° only)</li>
								<li><span class="hang">Submit</span> checks legality + scores density/words</li>
							</ul>
						</div>
					</div>
				{/if}
			</div>

			<!-- board selection toolbar -->
			<div class="boardTools">
				<button class="iconBtn" disabled={!selectedPlacedSid} on:click={returnSelectedPlaced} title="Return stick">⤺</button>
				<button class="iconBtn" disabled={!selectedPlacedSid} on:click={rotateSelectedPlaced} title="Rotate selected stick">↻</button>
				<button class="iconBtn" on:click={() => (showCheat = !showCheat)} title="Toggle quickstart">?</button>
			</div>
		</div>

		<!-- Bank: 2-row horizontal scrolling -->
		<section class="bank">
			<div class="bankHeader">
				<div class="bankLabel">Morphemes</div>
			</div>

			<div class="bankScroller" aria-label="Morpheme bank (scroll sideways)">
				<div class="bankGrid">
					{#each sticks as s (s.sid)}
						<div
							class="stick {s.placed ? 'ghost' : ''} {selectedSid === s.sid ? 'selected' : ''}"
							on:click={() => !s.placed && selectStick(s.sid)}
							on:pointerdown={(e) => bankPointerDown(e, s.sid)}
						>
							<div class="stickTiles">
								{#each s.text.split('') as ch}
									<div class="tile">{ch}</div>
								{/each}
							</div>

							<!-- per-stick rotate icon -->
							<button
								class="rotIcon"
								disabled={s.placed}
								on:click|stopPropagation={() => toggleStickOrientation(s.sid)}
								aria-label="Rotate stick"
								title="Rotate (90°)"
							>
								{#if s.orientation === 'H'} ⟷ {:else} ↕ {/if}
							</button>
						</div>
					{/each}
				</div>
			</div>
		</section>
	</main>

	<!-- drag ghost -->
	{#if draggingSid}
		{#if sticks.find((s) => s.sid === draggingSid) as ds}
			<div class="dragGhost" style="left:{dragX}px; top:{dragY}px;">
				<div class="stickTiles">
					{#each ds.text.split('') as ch}
						<div class="tile">{ch}</div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}

	<!-- submit modal -->
	{#if submitResult}
		<div class="modalBackdrop" on:click={closeSubmitModal}>
			<div class="modal" on:click|stopPropagation>
				<div class="modalTitle">{submitResult.ok ? '✅ Valid Cruxword' : '❌ Not Submittable Yet'}</div>
				<div class="modalStats">
					<div>Score: <b>{submitResult.score}</b></div>
					<div>Density: <b>{submitResult.densityPct}%</b></div>
					<div>Words (≥3): <b>{submitResult.wordCount}</b></div>
				</div>

				{#if submitResult.issues.length}
					<div class="issues">
						{#each submitResult.issues as i}
							<div class="issue">• {i}</div>
						{/each}
					</div>
				{/if}

				<button class="btnPrimary" on:click={closeSubmitModal}>Close</button>
			</div>
		</div>
	{/if}

	{#if bagIssues.length}
		<div class="bagWarn">
			<div class="bagWarnTitle">Bag warnings (safe to ignore for MVP):</div>
			{#each bagIssues as w}
				<div class="bagWarnItem">• {w}</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	/* --- Mobile-first sizing: board must fit screen width without cutoff --- */
	:global(html, body) {
		margin: 0;
		background: #070b18;
		color: #e9ecff;
		font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
		overscroll-behavior: none;
	}

	.screen {
		max-width: 520px;
		margin: 0 auto;
		touch-action: manipulation; /* helps prevent double-tap zoom */
	}

	.top {
		position: sticky;
		top: 0;
		background: linear-gradient(180deg, rgba(7, 11, 24, 0.98), rgba(7, 11, 24, 0.85));
		backdrop-filter: blur(8px);
		z-index: 20;
		padding-bottom: 6px;
	}

	.titleRow {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
	}

	.h1 {
		font-size: 18px;
		font-weight: 750;
		letter-spacing: 0.2px;
		line-height: 1.1;
	}

	.bagId {
		opacity: 0.75;
		font-weight: 600;
	}

	.tagline {
		font-size: 12px;
		opacity: 0.8;
		margin-top: 2px;
	}

	.statsRow {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 6px;
		flex-wrap: nowrap;
		overflow: hidden;
	}

	.stat {
		font-size: 12px;
		opacity: 0.9;
		white-space: nowrap;
	}

	.spacer { flex: 1; }

	.btn, .btnPrimary, .iconBtn {
		border: 1px solid rgba(255,255,255,0.15);
		background: rgba(255,255,255,0.06);
		color: #e9ecff;
		border-radius: 10px;
		padding: 8px 10px;
		font-weight: 650;
		font-size: 13px;
	}

	.btnPrimary {
		background: rgba(132, 160, 255, 0.20);
		border-color: rgba(132, 160, 255, 0.45);
	}

	.iconBtn {
		width: 38px;
		display: grid;
		place-items: center;
		padding: 8px 0;
	}

	.iconBtn:disabled {
		opacity: 0.35;
	}

	.clueBar {
		margin-top: 6px;
		border-radius: 12px;
		border: 1px solid rgba(255,255,255,0.12);
		background: rgba(255,255,255,0.05);
		padding: 8px 10px;
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.clueBar.closed .clueText {
		display: none;
	}

	.clueText {
		flex: 1;
		font-size: 12px;
		line-height: 1.2;
	}

	.clueLabel {
		opacity: 0.85;
		font-weight: 700;
		margin-right: 6px;
	}

	.main {
		padding: 10px 0 14px 0;
	}

	.boardWrap {
		position: relative;
	}

	.board {
		position: relative;
		width: 100%;
		aspect-ratio: 1 / 1; /* square board */
		display: grid;
		grid-template-columns: repeat(10, 1fr);
		grid-template-rows: repeat(10, 1fr);
		gap: 0; /* no padding between cells to reduce height */
		border-radius: 16px;
		overflow: hidden;
		border: 1px solid rgba(255,255,255,0.12);
		background:
			radial-gradient(circle at 25% 30%, rgba(80, 120, 255, 0.15), transparent 45%),
			radial-gradient(circle at 70% 75%, rgba(200, 140, 255, 0.12), transparent 50%),
			linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
	}

	/* subtle grid lines */
	.cell {
		display: grid;
		place-items: center;
		border-right: 1px solid rgba(255,255,255,0.06);
		border-bottom: 1px solid rgba(255,255,255,0.06);
		user-select: none;
		-webkit-user-select: none;
		touch-action: manipulation;
	}

	/* remove outer extra lines look */
	.cell:nth-child(10n) { border-right: none; }
	.board > .cell:nth-last-child(-n + 10) { border-bottom: none; }

	.cell.filled {
		background: rgba(255,255,255,0.05);
	}

	.cell.sel {
		outline: 2px solid rgba(132, 160, 255, 0.75);
		outline-offset: -2px;
	}

	.letter {
		font-weight: 800;
		font-size: clamp(10px, 2.2vw, 16px);
		letter-spacing: 0.6px;
	}

	.boardTools {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 8px;
	}

	.cheat {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 10px;
	}

	.cheatCard {
		width: min(92%, 340px);
		border-radius: 16px;
		border: 1px solid rgba(255,255,255,0.14);
		background: rgba(10, 14, 30, 0.92);
		backdrop-filter: blur(10px);
		padding: 12px 12px 10px 12px;
	}

	.cheatTitle {
		font-weight: 800;
		margin-bottom: 8px;
	}

	.cheatList {
		margin: 0;
		padding-left: 0;
		list-style: none;
		font-size: 12px;
		line-height: 1.35;
		opacity: 0.92;
	}

	.cheatList li {
		display: grid;
		grid-template-columns: 48px 1fr;
		gap: 8px;
		margin: 6px 0;
	}

	.hang {
		font-weight: 800;
		opacity: 0.95;
	}

	.bank {
		margin-top: 10px;
	}

	.bankHeader {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin: 8px 0 6px 0;
	}

	.bankLabel {
		font-weight: 800;
		opacity: 0.95;
	}

	.bankScroller {
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
		border-radius: 14px;
		border: 1px solid rgba(255,255,255,0.12);
		background: rgba(255,255,255,0.04);
		padding: 8px;
	}

	/* 2-row pack, scroll together */
	.bankGrid {
		display: grid;
		grid-auto-flow: column;
		grid-template-rows: repeat(2, auto);
		gap: 8px;
		align-content: start;
	}

	.stick {
		display: flex;
		align-items: center;
		gap: 6px;
		border-radius: 12px;
		border: 1px solid rgba(255,255,255,0.12);
		background: rgba(255,255,255,0.06);
		padding: 6px 6px;
		user-select: none;
		-webkit-user-select: none;
		touch-action: none; /* allows pointer-based drag */
	}

	.stick.selected {
		outline: 2px solid rgba(132, 160, 255, 0.8);
		outline-offset: 0;
	}

	.stick.ghost {
		opacity: 0.35;
		filter: grayscale(0.35);
	}

	.stickTiles {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.tile {
		width: 22px;
		height: 22px; /* one-tile tall holders */
		border-radius: 7px;
		display: grid;
		place-items: center;
		font-weight: 900;
		font-size: 13px;
		background: rgba(255,255,255,0.08);
		border: 1px solid rgba(255,255,255,0.10);
	}

	.rotIcon {
		border-radius: 10px;
		border: 1px solid rgba(255,255,255,0.12);
		background: rgba(255,255,255,0.06);
		color: #e9ecff;
		font-weight: 900;
		padding: 6px 8px;
		font-size: 12px;
	}

	.rotIcon:disabled {
		opacity: 0.3;
	}

	.dragGhost {
		position: fixed;
		transform: translate(-50%, -50%);
		pointer-events: none;
		z-index: 1000;
		filter: drop-shadow(0 10px 20px rgba(0,0,0,0.4));
	}

	.modalBackdrop {
		position: fixed;
		inset: 0;
		background: rgba(0,0,0,0.55);
		display: grid;
		place-items: center;
		z-index: 2000;
		padding: 16px;
	}

	.modal {
		width: min(92vw, 420px);
		border-radius: 18px;
		border: 1px solid rgba(255,255,255,0.14);
		background: rgba(10, 14, 30, 0.96);
		backdrop-filter: blur(12px);
		padding: 14px;
	}

	.modalTitle {
		font-weight: 900;
		font-size: 16px;
		margin-bottom: 8px;
	}

	.modalStats {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		font-size: 13px;
		opacity: 0.95;
		margin-bottom: 10px;
	}

	.issues {
		border-radius: 14px;
		border: 1px solid rgba(255,255,255,0.10);
		background: rgba(255,255,255,0.05);
		padding: 10px;
		margin-bottom: 10px;
	}

	.issue {
		font-size: 12px;
		line-height: 1.35;
		opacity: 0.92;
		margin: 4px 0;
	}

	.bagWarn {
		margin-top: 10px;
		font-size: 12px;
		opacity: 0.85;
		border: 1px dashed rgba(255,255,255,0.18);
		border-radius: 14px;
		padding: 10px;
	}

	.bagWarnTitle {
		font-weight: 800;
		margin-bottom: 6px;
	}
</style>
