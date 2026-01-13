<script lang="ts">
	import { onMount } from 'svelte';
	import { pickRandomBag } from '$lib/bags';
	import { bagToSticks, validateBagShape } from '$lib/game/bag';
	import { canPlaceStick, createEmptyBoard, moveStick, placeStick, removeStick, rotateOrientation } from '$lib/game/board';
	import { validateAndScore } from '$lib/game/scoring';
	import { loadDictionary, isValidWord } from '$lib/game/dictionary';
	import type { BoardState, MorphemeBag, Stick } from '$lib/game/types';

	let bag: MorphemeBag = pickRandomBag();
	let bagIssues: string[] = [];
	let sticks: Stick[] = [];
	let board: BoardState = createEmptyBoard(12, 12);

	let selectedSid: string | null = null;
	let showCheat = true;
	let showClue = true;
	let showClueDetails = false; // toggle between question and metadata
	
	// Fixed board size (calculated once on mount)
	let boardSize = 'min(calc(100vw - 40px), calc(100vh - 420px))';
	
	// Dictionary for word validation
	let dictionary: Set<string> = new Set();
	let dictionaryLoaded = false;

	// Simple history for undo/redo
	let history: BoardState[] = [];
	let redoHistory: BoardState[] = [];

	// Shadow preview state (when stick is selected)
	let hoverCell: { r: number; c: number } | null = null; // cell being hovered over (mouse)
	let touchCell: { r: number; c: number } | null = null; // cell being touched (touch screens)

	// Board selection
	let selectedPlacedSid: string | null = null;
	
	// Double-tap detection
	let lastTapTime = 0;
	let lastTapCell: { r: number; c: number } | null = null;
	const DOUBLE_TAP_DELAY = 300; // ms

	// UI computed
	$: filledCells = countFilled(board);
	$: densityPct = Math.round((filledCells / 144) * 100);
	$: remainingCount = sticks.filter((s) => !s.placed).length;

	$: selectedStick = selectedSid ? sticks.find((s) => s.sid === selectedSid) ?? null : null;
	
	// Computed: disable submit button when structure is invalid
	$: submitValidation = validateAndScore(board, bag.constraints.min_word_len, bag.constraints.submit_requires_single_cluster, bag.constraints.max_intersections_per_wordpair, dictionary);
	$: submitDisabled = !submitValidation.ok;
	
	// Computed: get invalid words for highlighting
	$: invalidWordCells = new Set<string>();
	$: {
		invalidWordCells.clear();
		if (dictionary && dictionary.size > 0) {
			// Get all words from validation result
			for (const word of submitValidation.words) {
				if (word.len < bag.constraints.min_word_len) continue;
				if (word.text.includes('*')) continue; // Wildcard words allowed
				if (!dictionary.has(word.text)) {
					// Mark all cells of this invalid word
					const dr = word.dir === 'V' ? 1 : 0;
					const dc = word.dir === 'H' ? 1 : 0;
					for (let i = 0; i < word.len; i++) {
						const r = word.row + dr * i;
						const c = word.col + dc * i;
						invalidWordCells.add(`${r},${c}`);
					}
				}
			}
		}
	}

	// ---- lifecycle
	onMount(() => {
		// Load dictionary asynchronously
		loadDictionary().then((dict) => {
			dictionary = dict;
			dictionaryLoaded = true;
		});
		
		// Calculate and lock board size once - size to fill vertical canvas space
		const calculateBoardSize = () => {
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			const isDesktop = vw > 768;
			
			// Reserve space for UI elements (more accurate for 12x12 board)
			// Header: ~120px, Clue bar: ~40px, Bank: ~200px, Padding: ~40px
			const reservedHeight = isDesktop ? 400 : 360;
			const availableHeight = Math.max(0, vh - reservedHeight);
			
			// Reserve space for side padding - reduce to prevent clipping
			const reservedWidth = isDesktop ? 40 : 10; // Reduced padding to prevent clipping
			const availableWidth = Math.max(0, vw - reservedWidth);
			
			// Size board to fill available vertical space (height-based, as requested)
			// Board is square, so use the smaller of available height or width
			// But prioritize filling the width on mobile to prevent clipping
			let boardDimension: number;
			if (isDesktop) {
				boardDimension = Math.min(availableHeight, availableWidth);
			} else {
				// On mobile, use width to fill display, but don't exceed height
				boardDimension = Math.min(availableWidth, availableHeight);
			}
			
			// Ensure minimum size and reasonable maximum for mobile
			// For 12x12, we need slightly larger minimums
			const minSize = isDesktop ? 400 : 280;
			const maxSize = isDesktop ? 700 : 600; // Increased max for iPhone 17 Pro
			boardSize = `${Math.max(minSize, Math.min(maxSize, boardDimension))}px`;
		};
		calculateBoardSize();
		
		startNewGame();
		// any first user action hides cheat sheet
		const hide = () => {
			if (showCheat) showCheat = false;
			window.removeEventListener('pointerdown', hide, { capture: true } as any);
		};
		window.addEventListener('pointerdown', hide, { capture: true } as any);
		
		// Keyboard shortcuts for browser dev tools
		const handleKeyDown = (e: KeyboardEvent) => {
			// Don't trigger if typing in an input/textarea
			if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') {
				return;
			}
			
			const ctrl = e.ctrlKey || e.metaKey;
			
			// Ctrl+Z / Cmd+Z: Undo
			if (ctrl && e.key === 'z' && !e.shiftKey) {
				e.preventDefault();
				undo();
				return;
			}
			
			// Ctrl+Y / Cmd+Y or Ctrl+Shift+Z: Redo
			if ((ctrl && e.key === 'y') || (ctrl && e.shiftKey && e.key === 'z')) {
				e.preventDefault();
				redo();
				return;
			}
			
			// Single key shortcuts (no modifier)
			if (!ctrl && !e.altKey && !e.shiftKey) {
				switch (e.key.toLowerCase()) {
					case 'r':
						e.preventDefault();
						if (selectedSid) toggleStickOrientation(selectedSid);
						break;
					case 'u':
						e.preventDefault();
						undo();
						break;
					case 's':
						e.preventDefault();
						submit();
						break;
					case 'n':
						e.preventDefault();
						startNewGame();
						break;
					case '?':
					case 'h':
						e.preventDefault();
						showCheat = !showCheat;
						break;
				}
			}
		};
		
		window.addEventListener('keydown', handleKeyDown);
		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	});

	// Muted color palette for sticks (dark theme friendly)
	const stickColors = [
		'rgba(100, 150, 200, 0.3)',   // muted blue
		'rgba(150, 100, 200, 0.3)',   // muted purple
		'rgba(200, 100, 150, 0.3)',   // muted pink
		'rgba(100, 200, 150, 0.3)',   // muted green
		'rgba(200, 150, 100, 0.3)',   // muted orange
		'rgba(150, 200, 200, 0.3)',   // muted cyan
		'rgba(200, 200, 100, 0.3)',   // muted yellow
		'rgba(200, 100, 100, 0.3)',   // muted red
		'rgba(100, 200, 200, 0.3)',   // muted teal
		'rgba(150, 150, 200, 0.3)'    // muted lavender
	];
	
	function getStickColor(sid: string): string {
		// Hash sid to get consistent color
		let hash = 0;
		for (let i = 0; i < sid.length; i++) {
			hash = ((hash << 5) - hash) + sid.charCodeAt(i);
			hash = hash & hash; // Convert to 32bit integer
		}
		return stickColors[Math.abs(hash) % stickColors.length];
	}

	function startNewGame() {
		bag = pickRandomBag();
		bagIssues = validateBagShape(bag);
		let newSticks = bagToSticks(bag);
		// Sort sticks by length descending (5, 4, 3, 2, 1)
		newSticks.sort((a, b) => {
			const lenA = a.text.length;
			const lenB = b.text.length;
			return lenB - lenA; // Descending order
		});
		sticks = newSticks;
		board = createEmptyBoard(12, 12);
		history = [];
		redoHistory = [];
		selectedSid = null;
		selectedPlacedSid = null;
		showCheat = false; // Don't show quickstart on reset
		showClue = true;
	}

	function countFilled(b: BoardState) {
		let n = 0;
		for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) if (b.cells[r][c]) n++;
		return n;
	}

	function pushHistory() {
		// Keep it small, clear redo when new action
		history = [structuredClone(board), ...history].slice(0, 20);
		redoHistory = []; // clear redo on new action
	}

	function undo() {
		const prev = board;
		const next = history[0];
		if (!next) return;
		history = history.slice(1);
		redoHistory = [prev, ...redoHistory].slice(0, 20);
		board = next;
		// update stick placed flags from board.placed
		const placedSet = new Set(Object.keys(board.placed));
		sticks = sticks.map((s) => ({ ...s, placed: placedSet.has(s.sid) }));
		selectedPlacedSid = null;
	}

	function redo() {
		const next = redoHistory[0];
		if (!next) return;
		redoHistory = redoHistory.slice(1);
		history = [structuredClone(board), ...history].slice(0, 20);
		board = next;
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
	
	function toggleAllStickOrientations() {
		// Toggle orientation for all unplaced sticks
		sticks = sticks.map((s) => (!s.placed ? { ...s, orientation: rotateOrientation(s.orientation) } : s));
	}
	
	// Computed: check if any unplaced stick is horizontal
	$: hasHorizontalSticks = sticks.some((s) => !s.placed && s.orientation === 'H');
	
	function sortSticksByLength() {
		// Sort by length descending (5, 4, 3, 2, 1)
		sticks = [...sticks].sort((a, b) => {
			const lenA = a.text.length;
			const lenB = b.text.length;
			return lenB - lenA; // Descending order
		});
	}

	// ---- placing via tap
	function tapPlace(r: number, c: number): boolean {
		if (!selectedSid) return false;
		const stick = sticks.find((s) => s.sid === selectedSid);
		if (!stick || stick.placed) return false;
		
		// Bounds check
		if (r < 0 || r >= board.rows || c < 0 || c >= board.cols) return false;

		// Calculate placement position: clicked tile is where FIRST letter goes
		// For horizontal: first letter at (r, c), rest extends right
		// For vertical: first letter at (r, c), rest extends down
		// So placement row/col is just (r, c)
		const ok = canPlaceStick(board, stick, r, c, bag.constraints.max_intersections_per_wordpair);
		if (!ok.ok) {
			// Silently fail - user will see invalid shadow preview
			return false;
		}

		pushHistory();
		board = placeStick(board, stick, r, c);
		sticks = sticks.map((s) => (s.sid === stick.sid ? { ...s, placed: true } : s));
		selectedSid = null;
		hoverCell = null; // Clear hover on placement
		return true;
	}

	// ---- board stick selection + move/return
	function tapCellSelect(r: number, c: number) {
		// Bounds check
		if (r < 0 || r >= board.rows || c < 0 || c >= board.cols) return;
		
		const cell = board.cells[r][c];
		if (!cell || cell.stickIds.length === 0) {
			selectedPlacedSid = null;
			return;
		}
		// Prefer last stick id (more recent overlaps)
		selectedPlacedSid = cell.stickIds[cell.stickIds.length - 1];
		selectedSid = null;
	}
	
	function handleCellClick(r: number, c: number) {
		// Handle click: if stick is selected, try to place first (even on settled sticks)
		// If no stick selected or placement fails, then select the cell's stick
		if (selectedSid) {
			// Try to place the selected stick
			const placed = tapPlace(r, c);
			// If placement succeeded, we're done. If not, fall through to select.
			if (placed) return;
		}
		// If cell has content, select its stick
		if (board.cells[r][c]) {
			tapCellSelect(r, c);
		}
	}
	
	function handleCellMouseEnter(r: number, c: number) {
		// Track hover for shadow preview
		if (selectedSid) {
			hoverCell = { r, c };
		}
	}
	
	function handleCellMouseLeave() {
		hoverCell = null;
	}
	
	function handleCellDoubleClick(r: number, c: number, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		const cell = board.cells[r][c];
		if (cell && cell.stickIds.length > 0) {
			if (cell.stickIds.length === 1) {
				const sid = cell.stickIds[0];
				selectedPlacedSid = sid;
				returnSelectedPlaced();
			} else {
				disassembleCluster(r, c);
			}
		}
	}
	
	function handleCellTouchStart(r: number, c: number, e: TouchEvent) {
		e.preventDefault();
		e.stopPropagation();
		
		// Track touch position for shadow preview
		if (selectedSid) {
			touchCell = { r, c };
		}
	}
	
	function handleCellTouchEnd(r: number, c: number, e: TouchEvent) {
		e.preventDefault();
		e.stopPropagation();
		
		// Clear touch tracking
		touchCell = null;
		
		// For touch events, use double-tap detection
		const now = Date.now();
		const isDoubleTap = 
			now - lastTapTime < DOUBLE_TAP_DELAY && 
			lastTapCell?.r === r && 
			lastTapCell?.c === c;
		
		if (isDoubleTap) {
			// Double tap: return stick or disassemble cluster
			const cell = board.cells[r][c];
			if (cell && cell.stickIds.length > 0) {
				if (cell.stickIds.length === 1) {
					const sid = cell.stickIds[0];
					selectedPlacedSid = sid;
					returnSelectedPlaced();
				} else {
					disassembleCluster(r, c);
				}
			}
			lastTapTime = 0;
			lastTapCell = null;
		} else {
			// Single tap: if stick selected, try to place first (even on settled sticks)
			// If no stick selected or placement fails, then select the cell's stick
			if (selectedSid) {
				const placed = tapPlace(r, c);
				if (placed) {
					lastTapTime = 0;
					lastTapCell = null;
					return;
				}
			}
			
			// If cell has content, select its stick
			if (board.cells[r][c]) {
				tapCellSelect(r, c);
			}
			
			lastTapTime = now;
			lastTapCell = { r, c };
		}
	}
	
	// moveCluster function removed - drag functionality removed
	function disassembleCluster(r: number, c: number) {
		const cell = board.cells[r][c];
		if (!cell || cell.stickIds.length === 0) return;
		
		// Get all sticks at this intersection
		const stickIdsToCheck = [...cell.stickIds];
		
		pushHistory();
		
		// For each stick, check if it's only connected at this intersection
		// If so, remove it; if it has other connections, keep it
		for (const sid of stickIdsToCheck) {
			const placed = board.placed[sid];
			if (!placed) continue;
			
			// Check if this stick has other cells (not just this intersection)
			const dr = placed.orientation === 'V' ? 1 : 0;
			const dc = placed.orientation === 'H' ? 1 : 0;
			let hasOtherCells = false;
			
			for (let i = 0; i < placed.text.length; i++) {
				const rr = placed.row + dr * i;
				const cc = placed.col + dc * i;
				if (rr === r && cc === c) continue; // skip the intersection
				if (board.cells[rr]?.[cc]) {
					hasOtherCells = true;
					break;
				}
			}
			
			// If stick has no other cells, remove it
			if (!hasOtherCells) {
				board = removeStick(board, sid);
				sticks = sticks.map((s) => (s.sid === sid ? { ...s, placed: false } : s));
			}
		}
		
		selectedPlacedSid = null;
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

	// All drag functions removed - using click-based placement only

	// ---- submit
	let submitResult: { ok: boolean; issues: string[]; score: number; densityPct: number; wordCount: number } | null = null;

	function submit() {
		// Always allow submit to show validation results, even if not valid
		if (!dictionaryLoaded) {
			// Show a message that dictionary is still loading
			submitResult = {
				ok: false,
				issues: ['Dictionary is still loading. Please wait a moment and try again.'],
				score: 0,
				densityPct: 0,
				wordCount: 0
			};
			return;
		}
		
		const res = validateAndScore(board, bag.constraints.min_word_len, bag.constraints.submit_requires_single_cluster, bag.constraints.max_intersections_per_wordpair, dictionary);

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

<!-- Window event handlers removed - using click-based placement only -->

<div class="screen" style="padding: env(safe-area-inset-top) 10px env(safe-area-inset-bottom) 10px;">
	<header class="top">
		<div class="titleRow">
			<div class="title">
				<div class="h1">Cruxword <span class="bagId">({bag.meta.id})</span></div>
				<div class="tagline">A daily <strong>morpheme rush</strong> for your brain.</div>
			</div>

			<button class="btnPrimary" on:click={startNewGame} aria-label="Reset">Reset</button>
		</div>

		<div class="statsRow">
			<div class="stat">Tiles {filledCells}/144</div>
			<div class="stat">Density {densityPct}%</div>
			<div class="stat">Bag {remainingCount} left</div>

			<div class="spacer"></div>

			<button class="btnPrimary" on:click={submit} aria-label="Submit" class:disabled={submitDisabled || !dictionaryLoaded} title={submitDisabled || !dictionaryLoaded ? 'Complete the puzzle to submit' : 'Submit your solution'}>Submit</button>
		</div>

		<!-- clue bar (fixed height, toggles between two lines of metadata) -->
		<div class="clueBar" aria-live="polite">
			<div class="clueText">
				{#if showClueDetails}
					<div class="clueDetailRow"><span class="clueLabel">Title:</span> {bag.meta.title}</div>
				{:else}
					<span class="clueLabel">{bag.meta.category}:</span>
					<span class="clueQ">{bag.meta.mystery_question}</span>
				{/if}
			</div>
			<button class="iconBtn" on:click={() => (showClueDetails = !showClueDetails)} aria-label="Toggle clue details" title="Toggle clue details">
				⇄
			</button>
		</div>
	</header>

	<main class="main">
		<!-- Board wrapper ensures no horizontal cutoff on iPhone -->
		<div class="boardWrap">
			<div class="board" style="--rows: 12; --cols: 12; width: {boardSize}; height: {boardSize};" aria-label="12 by 12 board">
				{#each Array(12) as _, r}
					{#each Array(12) as __, c}
						<!-- data-r/data-c used by elementFromPoint drag placement -->
						{@const cell = board.cells[r][c]}
						{@const cellStickIds = cell ? cell.stickIds : []}
						{@const cellColor = cellStickIds.length > 0 ? getStickColor(cellStickIds[0]) : 'transparent'}
						{@const cellColor2 = cellStickIds.length > 1 ? getStickColor(cellStickIds[1]) : null}
						{@const isInvalidWord = invalidWordCells.has(`${r},${c}`)}
						<div
							class="cell {cell ? 'filled' : ''} {cellStickIds.length > 1 ? 'intersection' : ''} {isInvalidWord ? 'invalidWord' : ''}"
							data-r={r}
							data-c={c}
							on:click={() => handleCellClick(r, c)}
							on:dblclick={(e) => {
								e.stopPropagation();
								handleCellDoubleClick(r, c, e);
							}}
							on:touchstart={(e) => handleCellTouchStart(r, c, e)}
							on:touchend={(e) => handleCellTouchEnd(r, c, e)}
							on:mouseenter={() => handleCellMouseEnter(r, c)}
							on:mouseleave={handleCellMouseLeave}
							style="background: {cellStickIds.length > 1 ? `linear-gradient(135deg, ${cellColor} 0%, ${cellColor} 50%, ${cellColor2} 50%, ${cellColor2} 100%)` : cellColor};"
						>
							{#if cell}
								<span class="letter">{cell.letter}</span>
							{/if}
						</div>
					{/each}
				{/each}

				<!-- Shadow preview when stick is selected and hovering/touching over board -->
				{#if selectedSid && (hoverCell || touchCell)}
					{@const previewCell = hoverCell || touchCell}
					{@const selectedStick = sticks.find((s) => s.sid === selectedSid)}
					{#if selectedStick && !selectedStick.placed && previewCell}
						{@const dr = selectedStick.orientation === 'V' ? 1 : 0}
						{@const dc = selectedStick.orientation === 'H' ? 1 : 0}
						{@const placementCheck = canPlaceStick(board, selectedStick, previewCell.r, previewCell.c, bag.constraints.max_intersections_per_wordpair)}
						{#each Array(selectedStick.text.length) as _, i}
							{@const shadowR = previewCell.r + dr * i}
							{@const shadowC = previewCell.c + dc * i}
							{#if shadowR >= 0 && shadowR < 12 && shadowC >= 0 && shadowC < 12}
								<div 
									class="cell shadow {placementCheck.ok ? 'shadowValid' : 'shadowInvalid'}"
									style="grid-row: {shadowR + 1}; grid-column: {shadowC + 1};"
								>
									<span class="letter shadowLetter">{selectedStick.text[i]}</span>
								</div>
							{/if}
						{/each}
					{/if}
				{/if}

				{#if showCheat}
					<div class="cheat" on:click|self={(e) => {
						if ((e.target as HTMLElement).classList.contains('cheat')) {
							showCheat = false;
						}
					}}>
						<div class="cheatCard" on:click|stopPropagation>
							<div class="cheatHeader">
								<div class="cheatTitle">Quickstart</div>
								<button class="cheatClose" on:click={() => (showCheat = false)} aria-label="Close help">×</button>
							</div>
							<div class="cheatContent">
								<div class="cheatSection">
									<div class="cheatSectionTitle">Smartphone Touch/Tap Controls</div>
									<ul class="cheatList">
										<li><span class="hang">Tap</span> a morpheme stick to select it</li>
										<li><span class="hang">Tap</span> an empty board cell to place selected stick</li>
										<li><span class="hang">Tap</span> a placed tile to select its stick</li>
										<li><span class="hang">Double-tap</span> a placed stick to return it to bank</li>
										<li><span class="hang">Double-tap</span> an intersection to disassemble cluster</li>
										<li><span class="hang">⟷</span> button rotates all unplaced sticks</li>
										<li><span class="hang">⇊</span> button sorts sticks by length</li>
										<li><span class="hang">Submit</span> checks legality + scores density/words</li>
									</ul>
								</div>
								
								<div class="cheatSection">
									<div class="cheatSectionTitle">Mouse/Keyboard Controls</div>
									<ul class="cheatList">
										<li><span class="hang">Click</span> board cells to place selected stick</li>
										<li><span class="hang">Click</span> placed tiles to select stick</li>
										<li><span class="hang">Double-click</span> placed stick to return it</li>
										<li><span class="hang">Double-click</span> intersection to disassemble</li>
										<li><span class="hang">Ctrl+Z</span> undo last action</li>
										<li><span class="hang">Ctrl+Y</span> redo last undone action</li>
										<li><span class="hang">R</span> rotate selected stick</li>
										<li><span class="hang">U</span> undo</li>
										<li><span class="hang">S</span> submit solution</li>
										<li><span class="hang">N</span> new game</li>
										<li><span class="hang">?</span> toggle this help</li>
									</ul>
								</div>
							</div>
						</div>
					</div>
				{/if}
			</div>

		</div>

		<!-- Bank: 2-row horizontal scrolling -->
		<section class="bank">
			<div class="bankHeader">
				<div class="bankLabel">Morphemes</div>
				<div class="bankActions">
					<button class="iconBtn" disabled={history.length === 0} on:click={undo} aria-label="Undo" title="Undo (Ctrl+Z)">↶</button>
					<button class="iconBtn" disabled={redoHistory.length === 0} on:click={redo} aria-label="Redo" title="Redo (Ctrl+Y)">↷</button>
					<button class="iconBtn" on:click={toggleAllStickOrientations} title="Rotate all stick orientations" style="transform: {hasHorizontalSticks ? 'rotate(0deg)' : 'rotate(90deg)'};">⟷</button>
					<button class="iconBtn" on:click={sortSticksByLength} title="Sort sticks by length">⤴</button>
					<button class="iconBtn" on:click={() => (showCheat = !showCheat)} title="Help & Dev Tools">?</button>
				</div>
			</div>

			<div class="bankScroller" aria-label="Morpheme bank (scroll sideways)">
				<div class="bankGrid">
					{#each sticks as s (s.sid)}
						<div
							class="stick {s.placed ? 'ghost' : ''} {selectedSid === s.sid ? 'selected' : ''}"
							on:click={() => {
								// Direct click handler - always works
								if (!s.placed) {
									selectStick(s.sid);
								}
							}}
							style="cursor: {s.placed ? 'not-allowed' : 'pointer'}; background: {getStickColor(s.sid)};"
						>
							<div class="stickTiles">
								{#each s.text.split('') as ch}
									<div class="tile">{ch}</div>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			</div>
		</section>
	</main>

	<!-- Drag ghost elements removed - using shadow preview on board instead -->

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
		padding: 0;
		background: #070b18;
		color: #e9ecff;
		font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
		overscroll-behavior: none;
		overflow-x: hidden;
		height: 100vh;
		height: 100dvh;
	}

	.screen {
		max-width: 100vw;
		width: 100%;
		margin: 0 auto;
		touch-action: manipulation; /* helps prevent double-tap zoom */
		overflow-x: hidden; /* prevent horizontal scroll */
		height: 100vh;
		height: 100dvh; /* dynamic viewport height for mobile */
		display: flex;
		flex-direction: column;
	}
	
	/* On desktop, center and size to iPhone 17 Pro */
	@media (min-width: 769px) {
		.screen {
			max-width: 393px; /* iPhone 17 Pro width */
			box-shadow: 0 0 20px rgba(0,0,0,0.3);
		}
	}

	.top {
		position: sticky;
		top: 0;
		background: linear-gradient(180deg, rgba(7, 11, 24, 0.98), rgba(7, 11, 24, 0.85));
		backdrop-filter: blur(8px);
		z-index: 20;
		padding: 6px 10px 6px 10px;
		flex-shrink: 0;
	}

	.titleRow {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
	}

	.h1 {
		font-size: 16px;
		font-weight: 750;
		letter-spacing: 0.2px;
		line-height: 1.1;
	}

	.bagId {
		opacity: 0.75;
		font-weight: 600;
	}

	.tagline {
		font-size: 10px;
		opacity: 0.8;
		margin-top: 1px;
	}
	
	.tagline strong {
		font-weight: 700;
		opacity: 1;
	}

	.statsRow {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 4px;
		flex-wrap: nowrap;
		overflow: hidden;
	}

	.stat {
		font-size: 11px;
		opacity: 0.9;
		white-space: nowrap;
	}

	.spacer { flex: 1; }

	.btn, .btnPrimary, .iconBtn {
		border: 1px solid rgba(255,255,255,0.15);
		background: rgba(255,255,255,0.06);
		color: #e9ecff;
		border-radius: 8px;
		padding: 6px 12px;
		font-weight: 650;
		font-size: 12px;
		cursor: pointer;
		user-select: none;
	}

	.btnPrimary {
		background: rgba(132, 160, 255, 0.20);
		border-color: rgba(132, 160, 255, 0.45);
	}
	
	.btn:hover, .btnPrimary:hover {
		opacity: 0.9;
		transform: translateY(-1px);
	}
	
	.btn:active, .btnPrimary:active {
		transform: translateY(0);
		opacity: 0.8;
	}
	
	.btnPrimary.disabled, .btnPrimary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	
	.btnPrimary.disabled:hover, .btnPrimary:disabled:hover {
		transform: none;
		opacity: 0.5;
	}

	.iconBtn {
		width: 34px;
		display: grid;
		place-items: center;
		padding: 6px 0;
	}

	.iconBtn:disabled {
		opacity: 0.35;
	}

	.clueBar {
		margin-top: 4px;
		border-radius: 10px;
		border: 1px solid rgba(255,255,255,0.12);
		background: rgba(255,255,255,0.05);
		padding: 4px 8px;
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
		height: 28px; /* shorter height */
		min-height: 28px;
		max-height: 28px;
	}

	.clueText {
		flex: 1;
		font-size: 11px;
		line-height: 1.3;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.clueDetailRow {
		font-size: 11px;
		line-height: 1.3;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.clueLabel {
		opacity: 0.85;
		font-weight: 700;
		margin-right: 6px;
	}
	
	.clueQ {
		opacity: 0.9;
	}

	.main {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		overflow-x: hidden;
		padding: 0;
		min-height: 0;
	}

	.boardWrap {
		position: relative;
		display: flex;
		flex-direction: column;
		padding: 0;
		align-items: center;
		justify-content: flex-start;
		margin: 0 auto;
		width: 100%;
		overflow: visible; /* Allow board to extend to edges */
	}

	.board {
		position: relative;
		aspect-ratio: 1 / 1; /* square board */
		display: grid;
		grid-template-columns: repeat(12, 1fr);
		grid-template-rows: repeat(12, 1fr);
		gap: 0; /* no padding between cells */
		border-radius: 16px;
		overflow: hidden; /* clip shadows that go outside */
		border: 1px solid rgba(255,255,255,0.12);
		background:
			radial-gradient(circle at 25% 30%, rgba(80, 120, 255, 0.15), transparent 45%),
			radial-gradient(circle at 70% 75%, rgba(200, 140, 255, 0.12), transparent 50%),
			linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
		margin: 0 auto;
		flex-shrink: 0; /* prevent resizing */
		/* Size is set inline via style attribute, calculated once on mount */
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
		cursor: pointer; /* show it's clickable */
		aspect-ratio: 1 / 1; /* ensure square tiles */
		position: relative;
		z-index: 1; /* Base z-index for regular cells */
		transition: opacity 0.1s ease, transform 0.1s ease;
		-webkit-tap-highlight-color: transparent; /* Remove default tap highlight */
	}
	
	.cell:active {
		opacity: 0.7;
		transform: scale(0.95);
	}

	/* remove outer extra lines look */
	.cell:nth-child(12n) { border-right: none; }
	.board > .cell:nth-last-child(-n + 12) { border-bottom: none; }

	.cell.filled {
		background: rgba(255,255,255,0.05);
	}
	
	.cell.invalidWord {
		outline: 1px solid rgba(255, 100, 100, 0.6);
		outline-offset: -1px;
	}

	/* Removed .cell.sel - no blue stroke around settled sticks */

	.letter {
		font-weight: 800;
		font-size: clamp(12px, 2.8vw, 20px);
		letter-spacing: 0.6px;
	}

	/* Shadow preview for drag placement - rendered as grid children that overlay */
	.cell.shadow {
		position: relative;
		z-index: 50; /* Higher than regular cells to overlay */
		pointer-events: none;
		opacity: 0.85;
		margin: 0;
		border-right: 1px solid rgba(255,255,255,0.06);
		border-bottom: 1px solid rgba(255,255,255,0.06);
		/* Shadows are rendered after regular cells, so they overlay with z-index */
	}

	.cell.shadowValid {
		outline: 1px solid rgba(132, 255, 160, 0.8);
		outline-offset: -1px;
		background: rgba(132, 255, 160, 0.15);
	}

	.cell.shadowInvalid {
		outline: 1px dashed rgba(255, 132, 132, 0.8);
		outline-offset: -1px;
		background: rgba(255, 132, 132, 0.15);
	}

	.shadowLetter {
		color: rgba(233, 236, 255, 0.9);
	}

	.bankActions .iconBtn {
		width: 32px;
		padding: 5px 0;
		font-size: 14px;
	}

	.cheat {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 20px 20px 20px 20px;
		padding-top: 20px;
		justify-content: flex-start;
		z-index: 3000;
		background: rgba(0,0,0,0.5);
		backdrop-filter: blur(4px);
	}

	.cheatCard {
		width: min(92%, 340px);
		max-height: calc(100vh - 280px); /* Leave room for headers and morpheme bank */
		max-height: calc(100dvh - 280px); /* Use dynamic viewport height on mobile */
		border-radius: 16px;
		border: 1px solid rgba(255,255,255,0.14);
		background: rgba(10, 14, 30, 0.98);
		backdrop-filter: blur(10px);
		padding: 16px 12px 12px 12px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		box-shadow: 0 8px 32px rgba(0,0,0,0.4);
	}

	.cheatHeader {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 12px;
		flex-shrink: 0;
		padding-top: 0;
	}

	.cheatTitle {
		font-weight: 800;
	}

	.cheatClose {
		background: transparent;
		border: none;
		color: #e9ecff;
		font-size: 24px;
		line-height: 1;
		padding: 0;
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		border-radius: 6px;
		cursor: pointer;
		opacity: 0.8;
	}

	.cheatClose:hover {
		background: rgba(255,255,255,0.1);
		opacity: 1;
	}

	.cheatContent {
		overflow-y: auto;
		overflow-x: hidden;
		flex: 1;
		padding-right: 4px;
		-webkit-overflow-scrolling: touch;
		max-height: calc(100vh - 350px); /* Constrain to not extend beyond morpheme scroller */
		max-height: calc(100dvh - 350px); /* Use dynamic viewport height on mobile */
		min-height: 200px;
	}

	.cheatContent::-webkit-scrollbar {
		width: 6px;
	}

	.cheatContent::-webkit-scrollbar-track {
		background: rgba(255,255,255,0.05);
		border-radius: 3px;
	}

	.cheatContent::-webkit-scrollbar-thumb {
		background: rgba(255,255,255,0.2);
		border-radius: 3px;
	}

	.cheatContent::-webkit-scrollbar-thumb:hover {
		background: rgba(255,255,255,0.3);
	}

	.cheatSection {
		margin-bottom: 16px;
	}

	.cheatSection:last-child {
		margin-bottom: 0;
	}

	.cheatSectionTitle {
		font-weight: 800;
		font-size: 13px;
		margin-bottom: 8px;
		opacity: 0.95;
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
		flex-shrink: 0;
		padding: 0 10px 6px 10px; /* reduced bottom padding */
		display: flex;
		flex-direction: column;
		min-height: 160px; /* ensure three rows visible */
		max-height: 180px; /* allow some growth if needed */
	}

	.bankHeader {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin: 4px 0 4px 0;
		gap: 8px;
	}
	
	.bankActions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.bankLabel {
		font-weight: 800;
		opacity: 0.95;
		font-size: 13px;
	}

	.bankScroller {
		overflow-x: auto;
		overflow-y: hidden;
		-webkit-overflow-scrolling: touch;
		border-radius: 14px;
		border: 1px solid rgba(255,255,255,0.12);
		background: rgba(255,255,255,0.04);
		padding: 6px; /* reduced padding */
		flex: 1;
		min-height: 150px; /* ensure three rows visible */
		max-height: 170px;
		/* Custom scrollbar */
		scrollbar-width: thin;
		scrollbar-color: rgba(255,255,255,0.3) rgba(255,255,255,0.05);
	}
	
	.bankScroller::-webkit-scrollbar {
		height: 8px;
	}
	
	.bankScroller::-webkit-scrollbar-track {
		background: rgba(255,255,255,0.05);
		border-radius: 4px;
	}
	
	.bankScroller::-webkit-scrollbar-thumb {
		background: rgba(255,255,255,0.3);
		border-radius: 4px;
	}
	
	.bankScroller::-webkit-scrollbar-thumb:hover {
		background: rgba(255,255,255,0.4);
	}

	/* 3-row pack, scroll together */
	.bankGrid {
		display: grid;
		grid-auto-flow: column;
		grid-template-rows: repeat(3, 1fr); /* three equal height rows */
		gap: 6px; /* reduced gap */
		align-content: start;
		min-height: 150px; /* ensure three rows have space */
	}

	.stick {
		display: flex;
		align-items: center;
		gap: 6px;
		border-radius: 12px;
		border: 1px solid rgba(255,255,255,0.12);
		background: rgba(255,255,255,0.06);
		padding: 0px 6px; /* reduced by 5px top and bottom (was 2px, now 0px) */
		user-select: none;
		-webkit-user-select: none;
		touch-action: manipulation; /* optimized for touch */
		min-height: 22px; /* shorter height */
		transition: opacity 0.15s ease, transform 0.15s ease;
		-webkit-tap-highlight-color: transparent; /* Remove default tap highlight */
	}
	
	.stick:active {
		opacity: 0.8;
		transform: scale(0.97);
	}

	.stick.selected {
		outline: 2px solid rgba(132, 160, 255, 0.8);
		outline-offset: 0;
	}

	.stick.ghost {
		opacity: 0.25;
		filter: grayscale(0.5);
		position: relative;
	}
	
	.stick.ghost::after {
		content: '';
		position: absolute;
		inset: 0;
		border: 1px dashed rgba(255,255,255,0.2);
		border-radius: 12px;
		pointer-events: none;
	}

	.stickTiles {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.tile {
		width: 20px;
		height: 20px; /* one-tile tall holders */
		border-radius: 6px;
		display: grid;
		place-items: center;
		font-weight: 900;
		font-size: 12px;
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
		position: relative;
		cursor: pointer;
		width: 36px; /* fixed width */
		height: 36px; /* fixed height */
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}

	.rotIcon:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.rotIconBg {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: rgba(255,255,255,0.3);
		font-size: 18px; /* larger background icon */
		pointer-events: none;
		width: 100%;
		height: 100%;
	}

	.rotIconFg {
		position: relative;
		z-index: 1;
		font-size: 16px; /* larger foreground symbol */
		font-weight: 900;
		line-height: 1;
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
		width: min(calc(100vw - 20px), 373px); /* Match clue bar width */
		margin: 0 auto; /* Center the modal */
		border-radius: 18px;
		border: 1px solid rgba(255,255,255,0.14);
		background: rgba(10, 14, 30, 0.96);
		backdrop-filter: blur(12px);
		padding: 14px;
		margin: 0 auto; /* Center horizontally */
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
