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
	let board: BoardState = createEmptyBoard(10, 10);

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

	// Pointer/drag state (bank -> board)
	let draggingSid: string | null = null;
	let dragX = 0;
	let dragY = 0;
	let dragOverCell: { r: number; c: number } | null = null;
	let dragPlacementValid: boolean = false; // for shadow preview
	
	// Board drag state (placed stick/cluster -> new position)
	let draggingPlacedSid: string | null = null;
	let dragStartCell: { r: number; c: number } | null = null;
	let dragHoldTimer: ReturnType<typeof setTimeout> | null = null;
	let dragPlacementValidCluster: boolean = false; // for cluster drag shadow

	// Board selection
	let selectedPlacedSid: string | null = null;
	
	// Double-tap detection
	let lastTapTime = 0;
	let lastTapCell: { r: number; c: number } | null = null;
	const DOUBLE_TAP_DELAY = 300; // ms

	// UI computed
	$: filledCells = countFilled(board);
	$: densityPct = Math.round((filledCells / 100) * 100);
	$: remainingCount = sticks.filter((s) => !s.placed).length;

	$: selectedStick = selectedSid ? sticks.find((s) => s.sid === selectedSid) ?? null : null;

	// ---- lifecycle
	onMount(() => {
		// Load dictionary asynchronously
		loadDictionary().then((dict) => {
			dictionary = dict;
			dictionaryLoaded = true;
		});
		
		// Calculate and lock board size once - ensure it fits without clipping
		const calculateBoardSize = () => {
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			// For desktop (wider screens), size to match iPhone 17 Pro (393x852)
			const isDesktop = vw > 768;
			if (isDesktop) {
				// iPhone 17 Pro dimensions: 393x852 (portrait)
				// Scale to fit but maintain aspect ratio, leave more room for headers/bank
				const targetWidth = 393;
				const targetHeight = 852;
				// Reserve space: ~200px for headers/clue bar, ~250px for morpheme bank
				const availableHeight = vh - 450;
				const availableWidth = vw - 60; // padding + margins
				const scale = Math.min(availableWidth / targetWidth, availableHeight / targetHeight);
				const scaledWidth = targetWidth * scale;
				boardSize = `${Math.max(300, Math.min(500, scaledWidth))}px`;
			} else {
				// Mobile: use viewport, reserve space for headers (~180px) and bank (~220px)
				const availableHeight = vh - 400;
				const availableWidth = vw - 40; // 20px padding each side
				const baseSize = Math.min(availableWidth, availableHeight);
				boardSize = `${Math.max(200, Math.min(450, baseSize))}px`;
			}
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
						if (selectedPlacedSid) rotateSelectedPlaced();
						else if (selectedSid) toggleStickOrientation(selectedSid);
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

	function startNewGame() {
		bag = pickRandomBag();
		bagIssues = validateBagShape(bag);
		sticks = bagToSticks(bag);
		board = createEmptyBoard(10, 10);
		history = [];
		redoHistory = [];
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

	// ---- placing via tap
	function tapPlace(r: number, c: number) {
		if (!selectedSid) return;
		const stick = sticks.find((s) => s.sid === selectedSid);
		if (!stick || stick.placed) return;

		const ok = canPlaceStick(board, stick, r, c, bag.constraints.max_intersections_per_wordpair);
		if (!ok.ok) {
			console.warn('Cannot place stick:', ok.reason);
			return;
		}

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
	
	function handleCellClick(r: number, c: number) {
		// Simple click handler - no event parameter needed
		// Don't handle if currently dragging
		if (draggingSid || draggingPlacedSid) {
			return;
		}
		
		// Clear any pending drag hold timer
		if (dragHoldTimer) {
			clearTimeout(dragHoldTimer);
			dragHoldTimer = null;
		}
		
		// Handle click: select or place
		if (board.cells[r][c]) {
			tapCellSelect(r, c);
		} else {
			tapPlace(r, c);
		}
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
	
	function handleCellTouch(r: number, c: number, e: TouchEvent) {
		// Clear any pending drag hold timer
		if (dragHoldTimer) {
			clearTimeout(dragHoldTimer);
			dragHoldTimer = null;
		}
		
		e.preventDefault();
		e.stopPropagation();
		
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
			// Single tap: select or place
			lastTapTime = now;
			lastTapCell = { r, c };
			
			if (board.cells[r][c]) {
				tapCellSelect(r, c);
			} else {
				tapPlace(r, c);
			}
		}
	}
	
	function handleCellPointerDown(r: number, c: number, e: MouseEvent | PointerEvent) {
		const cell = board.cells[r][c];
		if (!cell || cell.stickIds.length === 0) return;
		
		// Start hold timer for drag
		dragStartCell = { r, c };
		dragHoldTimer = setTimeout(() => {
			// Hold detected: start dragging
			const sid = cell.stickIds[cell.stickIds.length - 1]; // use most recent
			draggingPlacedSid = sid;
			selectedPlacedSid = sid;
			dragX = e.clientX;
			dragY = e.clientY;
			if ('pointerId' in e && (e.target as HTMLElement)?.setPointerCapture) {
				(e.target as HTMLElement).setPointerCapture(e.pointerId);
			}
			e.preventDefault();
		}, 200); // 200ms hold to start drag
	}
	
	function handleCellPointerUp(r: number, c: number, e: MouseEvent | PointerEvent) {
		if (dragHoldTimer) {
			clearTimeout(dragHoldTimer);
			dragHoldTimer = null;
		}
		
		if (draggingPlacedSid && dragOverCell && dragStartCell && dragPlacementValidCluster) {
			// Move the stick/cluster
			const placed = board.placed[draggingPlacedSid];
			if (placed) {
				// Calculate offset from original position
				const dr = dragOverCell.r - dragStartCell.r;
				const dc = dragOverCell.c - dragStartCell.c;
				const newRow = placed.row + dr;
				const newCol = placed.col + dc;
				
				// If it's a cluster (intersection), we need to move all connected sticks
				const startCell = board.cells[dragStartCell.r]?.[dragStartCell.c];
				if (startCell && startCell.stickIds.length > 1) {
					moveCluster(dragStartCell.r, dragStartCell.c, dr, dc);
				} else {
					// Single stick
					pushHistory();
					board = moveStick(board, draggingPlacedSid, newRow, newCol);
				}
			}
		}
		// If placement was invalid, stick/cluster stays in original position
		
		draggingPlacedSid = null;
		dragStartCell = null;
		dragOverCell = null;
		dragPlacementValidCluster = false;
		e.preventDefault();
	}
	
	function moveCluster(startR: number, startC: number, dr: number, dc: number) {
		const cell = board.cells[startR][startC];
		if (!cell) return;
		
		// Get all sticks in the cluster (connected via this intersection)
		// Use BFS to find all connected cells, then get ALL sticks that pass through any of those cells
		const clusterSticks = new Set<string>();
		const visited = new Set<string>();
		const queue: [number, number][] = [[startR, startC]];
		
		// BFS to find all connected cells
		while (queue.length > 0) {
			const [r, c] = queue.shift()!;
			const key = `${r},${c}`;
			if (visited.has(key)) continue;
			visited.add(key);
			
			const cell = board.cells[r][c];
			if (!cell) continue;
			
			// Add all sticks that pass through this cell
			for (const sid of cell.stickIds) {
				clusterSticks.add(sid);
			}
			
			// Add neighbors (adjacent cells in the same cluster)
			const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
			for (const [dr2, dc2] of dirs) {
				const rr = r + dr2;
				const cc = c + dc2;
				if (rr >= 0 && rr < board.rows && cc >= 0 && cc < board.cols && board.cells[rr][cc]) {
					queue.push([rr, cc]);
				}
			}
		}
		
		// Now ensure we have ALL cells of each stick in the cluster
		// For each stick, add all its cells to visited set and expand cluster
		const allClusterCells = new Set<string>();
		for (const sid of clusterSticks) {
			const placed = board.placed[sid];
			if (!placed) continue;
			
			const stickDr = placed.orientation === 'V' ? 1 : 0;
			const stickDc = placed.orientation === 'H' ? 1 : 0;
			
			// Add all cells of this stick
			for (let i = 0; i < placed.text.length; i++) {
				const r = placed.row + stickDr * i;
				const c = placed.col + stickDc * i;
				allClusterCells.add(`${r},${c}`);
			}
		}
		
		// Expand cluster to include all connected cells
		const finalClusterSticks = new Set<string>(clusterSticks);
		for (const cellKey of allClusterCells) {
			const [r, c] = cellKey.split(',').map(Number);
			const cell = board.cells[r]?.[c];
			if (cell) {
				for (const sid of cell.stickIds) {
					finalClusterSticks.add(sid);
				}
			}
		}
		
		// Move all sticks in cluster
		pushHistory();
		for (const sid of finalClusterSticks) {
			const placed = board.placed[sid];
			if (placed) {
				const newRow = placed.row + dr;
				const newCol = placed.col + dc;
				board = moveStick(board, sid, newRow, newCol);
			}
		}
	}
	
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

	// ---- drag from bank to board (simple pointer-based)
	let dragStartPos: { x: number; y: number; sid: string; time: number } | null = null;
	
	function bankPointerDown(e: MouseEvent | PointerEvent, sid: string) {
		const s = sticks.find((x) => x.sid === sid);
		if (!s || s.placed) return;
		
		// Store start position and time for drag detection
		dragStartPos = { x: e.clientX, y: e.clientY, sid, time: Date.now() };
	}

	function bankPointerMove(e: MouseEvent | PointerEvent) {
		// Check if we should start dragging from bank
		if (dragStartPos && !draggingSid) {
			const timeSinceStart = Date.now() - dragStartPos.time;
			const moved = Math.abs(e.clientX - dragStartPos.x) > 5 || Math.abs(e.clientY - dragStartPos.y) > 5;
			// Only start drag if moved AND enough time has passed (prevents click interference)
			if (moved && timeSinceStart > 50) {
				draggingSid = dragStartPos.sid;
				dragStartPos = null;
			}
		}
		
		if (draggingSid) {
			dragX = e.clientX;
			dragY = e.clientY;

			// find board cell under pointer
			const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
			if (!el) {
				dragOverCell = null;
				dragPlacementValid = false;
				return;
			}
			const rr = el.getAttribute('data-r');
			const cc = el.getAttribute('data-c');
			if (rr !== null && cc !== null) {
				dragOverCell = { r: Number(rr), c: Number(cc) };
				// Check if placement would be valid
				const stick = sticks.find((s) => s.sid === draggingSid);
				if (stick && !stick.placed) {
					const ok = canPlaceStick(board, stick, dragOverCell.r, dragOverCell.c, bag.constraints.max_intersections_per_wordpair);
					dragPlacementValid = ok.ok;
				} else {
					dragPlacementValid = false;
				}
			} else {
				dragOverCell = null;
				dragPlacementValid = false;
			}
		} else if (draggingPlacedSid) {
			dragX = e.clientX;
			dragY = e.clientY;
			
			// find board cell under pointer
			const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
			if (!el) {
				dragOverCell = null;
				dragPlacementValidCluster = false;
				return;
			}
			const rr = el.getAttribute('data-r');
			const cc = el.getAttribute('data-c');
			if (rr !== null && cc !== null && dragStartCell) {
				dragOverCell = { r: Number(rr), c: Number(cc) };
				// Check if cluster move would be valid
				const placed = board.placed[draggingPlacedSid];
				if (placed) {
					const dr = dragOverCell.r - dragStartCell.r;
					const dc = dragOverCell.c - dragStartCell.c;
					const newRow = placed.row + dr;
					const newCol = placed.col + dc;
					
					// For cluster, check if ALL sticks can be moved to new position
					const startCell = board.cells[dragStartCell.r]?.[dragStartCell.c];
					if (startCell && startCell.stickIds.length > 1) {
						// Check each stick in cluster
						const clusterSticks = new Set<string>();
						const visited = new Set<string>();
						const queue: [number, number][] = [[dragStartCell.r, dragStartCell.c]];
						
						while (queue.length > 0) {
							const [r, c] = queue.shift()!;
							const key = `${r},${c}`;
							if (visited.has(key)) continue;
							visited.add(key);
							
							const cell = board.cells[r][c];
							if (!cell) continue;
							
							for (const sid of cell.stickIds) {
								clusterSticks.add(sid);
							}
							
							const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
							for (const [dr2, dc2] of dirs) {
								const rr = r + dr2;
								const cc = c + dc2;
								if (rr >= 0 && rr < board.rows && cc >= 0 && cc < board.cols && board.cells[rr][cc]) {
									queue.push([rr, cc]);
								}
							}
						}
						
						// Check if all sticks can move
						let allValid = true;
						for (const sid of clusterSticks) {
							const p = board.placed[sid];
							if (!p) continue;
							const nr = p.row + dr;
							const nc = p.col + dc;
							const endR = nr + (p.orientation === 'V' ? p.text.length - 1 : 0);
							const endC = nc + (p.orientation === 'H' ? p.text.length - 1 : 0);
							if (nr < 0 || nc < 0 || endR >= board.rows || endC >= board.cols) {
								allValid = false;
								break;
							}
						}
						dragPlacementValidCluster = allValid;
					} else {
						// Single stick
						const endR = newRow + (placed.orientation === 'V' ? placed.text.length - 1 : 0);
						const endC = newCol + (placed.orientation === 'H' ? placed.text.length - 1 : 0);
						dragPlacementValidCluster = newRow >= 0 && newCol >= 0 && endR < board.rows && endC < board.cols;
					}
				} else {
					dragPlacementValidCluster = false;
				}
			} else {
				dragOverCell = null;
				dragPlacementValidCluster = false;
			}
		}
	}

	function bankPointerUp(e: MouseEvent | PointerEvent) {
		// If we were just clicking (not dragging), handle click
		if (dragStartPos && !draggingSid) {
			const timeSinceStart = Date.now() - dragStartPos.time;
			// If it was a quick click (< 200ms and no movement), select the stick
			if (timeSinceStart < 200) {
				selectStick(dragStartPos.sid);
			}
			dragStartPos = null;
			return;
		}
		
		if (draggingSid) {
			const sid = draggingSid;
			draggingSid = null;

			if (dragOverCell && dragPlacementValid) {
				const stick = sticks.find((s) => s.sid === sid);
				if (stick && !stick.placed) {
					const ok = canPlaceStick(board, stick, dragOverCell.r, dragOverCell.c, bag.constraints.max_intersections_per_wordpair);
					if (ok.ok) {
						pushHistory();
						board = placeStick(board, stick, dragOverCell.r, dragOverCell.c);
						sticks = sticks.map((s) => (s.sid === stick.sid ? { ...s, placed: true } : s));
						selectedSid = null;
					}
				}
			}
			// If placement was invalid, stick stays in bank (already there)

			dragOverCell = null;
			dragPlacementValid = false;
		}
		
		dragStartPos = null;
	}

	// ---- submit
	let submitResult: { ok: boolean; issues: string[]; score: number; densityPct: number; wordCount: number } | null = null;

	function submit() {
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

<svelte:window
	on:mousemove={bankPointerMove}
	on:mouseup={(e) => {
		bankPointerUp(e);
		if (draggingPlacedSid) {
			// Handle window-level mouse up for board drags
			if (dragHoldTimer) {
				clearTimeout(dragHoldTimer);
				dragHoldTimer = null;
			}
			draggingPlacedSid = null;
			dragStartCell = null;
			dragOverCell = null;
			dragPlacementValidCluster = false;
		}
	}}
	on:pointermove={bankPointerMove}
	on:pointerup={(e) => {
		bankPointerUp(e);
		if (draggingPlacedSid) {
			// Handle window-level pointer up for board drags
			if (dragHoldTimer) {
				clearTimeout(dragHoldTimer);
				dragHoldTimer = null;
			}
			draggingPlacedSid = null;
			dragStartCell = null;
			dragOverCell = null;
			dragPlacementValidCluster = false;
		}
	}}
/>

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
			<div class="stat">Tiles {filledCells}/100</div>
			<div class="stat">Density {densityPct}%</div>
			<div class="stat">Bag {remainingCount} left</div>

			<div class="spacer"></div>

			<button class="btnPrimary" on:click={submit} aria-label="Submit">Submit</button>
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
			<div class="board" style="--rows: 10; --cols: 10; width: {boardSize}; height: {boardSize};" aria-label="10 by 10 board">
				{#each Array(10) as _, r}
					{#each Array(10) as __, c}
						<!-- data-r/data-c used by elementFromPoint drag placement -->
						<div
							class="cell {board.cells[r][c] ? 'filled' : ''} {selectedPlacedSid && board.cells[r][c]?.stickIds?.includes(selectedPlacedSid) ? 'sel' : ''}"
							data-r={r}
							data-c={c}
							on:click={() => handleCellClick(r, c)}
							on:dblclick={(e) => {
								e.stopPropagation();
								handleCellDoubleClick(r, c, e);
							}}
							on:touchend={(e) => handleCellTouch(r, c, e)}
							on:mousedown={(e) => {
								// Only start drag hold timer for placed cells
								if (e.button === 0 && board.cells[r][c]) {
									handleCellPointerDown(r, c, e);
								}
							}}
							on:mouseup={(e) => {
								if (draggingPlacedSid) {
									handleCellPointerUp(r, c, e);
								}
							}}
						>
							{#if board.cells[r][c]}
								<span class="letter">{board.cells[r][c]!.letter}</span>
							{/if}
						</div>
					{/each}
				{/each}

				<!-- Shadow preview for dragging stick from bank -->
				{#if draggingSid && dragOverCell}
					{@const draggedStick = sticks.find((s) => s.sid === draggingSid)}
					{#if draggedStick}
						{#each Array(draggedStick.text.length) as _, i}
							{@const dr = draggedStick.orientation === 'V' ? 1 : 0}
							{@const dc = draggedStick.orientation === 'H' ? 1 : 0}
							{@const shadowR = dragOverCell.r + dr * i}
							{@const shadowC = dragOverCell.c + dc * i}
							{#if shadowR >= 0 && shadowR < 10 && shadowC >= 0 && shadowC < 10}
								<div 
									class="cell shadow {dragPlacementValid ? 'shadowValid' : 'shadowInvalid'}"
									style="grid-row: {shadowR + 1}; grid-column: {shadowC + 1};"
								>
									<span class="letter shadowLetter">{draggedStick.text[i]}</span>
								</div>
							{/if}
						{/each}
					{/if}
				{/if}

				<!-- Shadow preview for dragging placed stick/cluster -->
				{#if draggingPlacedSid && dragOverCell && dragStartCell}
					{@const placed = board.placed[draggingPlacedSid]}
					{#if placed}
						{@const dr = dragOverCell.r - dragStartCell.r}
						{@const dc = dragOverCell.c - dragStartCell.c}
						{@const newRow = placed.row + dr}
						{@const newCol = placed.col + dc}
						{#each Array(placed.text.length) as _, i}
							{@const stickDr = placed.orientation === 'V' ? 1 : 0}
							{@const stickDc = placed.orientation === 'H' ? 1 : 0}
							{@const shadowR = newRow + stickDr * i}
							{@const shadowC = newCol + stickDc * i}
							{#if shadowR >= 0 && shadowR < 10 && shadowC >= 0 && shadowC < 10}
								<div 
									class="cell shadow {dragPlacementValidCluster ? 'shadowValid' : 'shadowInvalid'}"
									style="grid-row: {shadowR + 1}; grid-column: {shadowC + 1};"
								>
									<span class="letter shadowLetter">{placed.text[i]}</span>
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
										<li><span class="hang">Tap</span> a board cell to place</li>
										<li><span class="hang">Hold</span> a stick in the bank to drag-drop onto the board</li>
										<li><span class="hang">Tap</span> a placed tile to select its stick</li>
										<li><span class="hang">Double-tap</span> a placed stick to return it</li>
										<li><span class="hang">Double-tap</span> an intersection to disassemble cluster</li>
										<li><span class="hang">Hold</span> a placed stick to drag it</li>
										<li><span class="hang">↻</span> rotates a selected stick (90° only)</li>
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
										<li><span class="hang">Drag</span> stick from bank to board to place</li>
										<li><span class="hang">Drag</span> placed stick to move it</li>
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
					<button class="iconBtn" disabled={!selectedPlacedSid && !selectedSid} on:click={() => {
						if (selectedPlacedSid) rotateSelectedPlaced();
						else if (selectedSid) toggleStickOrientation(selectedSid);
					}} title="Rotate selected stick">↻</button>
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
							on:mousedown={(e) => {
								// For drag support
								if (!s.placed && e.button === 0) {
									bankPointerDown(e, s.sid);
								}
							}}
							on:mouseup={(e) => {
								// For drag support
								if (!s.placed && e.button === 0) {
									bankPointerUp(e);
								}
							}}
							on:pointerdown={(e) => {
								// For touch drag support
								if (!s.placed) {
									bankPointerDown(e, s.sid);
								}
							}}
							style="cursor: {s.placed ? 'not-allowed' : 'pointer'};"
						>
							<div class="stickTiles">
								{#each s.text.split('') as ch}
									<div class="tile">{ch}</div>
								{/each}
							</div>

							<!-- per-stick rotate icon (shows direction, rotates orientation value) -->
							<button
								class="rotIcon"
								disabled={s.placed}
								on:click|stopPropagation={(e) => {
									e.preventDefault();
									e.stopPropagation();
									if (!s.placed) {
										toggleStickOrientation(s.sid);
									}
								}}
								on:mousedown|stopPropagation={(e) => {
									e.preventDefault();
									e.stopPropagation();
								}}
								aria-label="Rotate stick orientation"
								title="Click to change orientation (H ↔ V)"
							>
								<span class="rotIconBg">↻</span>
								<span class="rotIconFg">
									{#if s.orientation === 'H'} ⟷ {:else} ↕ {/if}
								</span>
							</button>
						</div>
					{/each}
				</div>
			</div>
		</section>
	</main>

	<!-- drag ghost -->
	{#if draggingSid}
		{@const draggedStick = sticks.find((s) => s.sid === draggingSid)}
		{#if draggedStick}
			<div class="dragGhost" style="left:{dragX}px; top:{dragY}px;">
				<div class="stickTiles">
					{#each draggedStick.text.split('') as ch}
						<div class="tile">{ch}</div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
	
	<!-- drag ghost for placed stick -->
	{#if draggingPlacedSid}
		{@const placedStick = board.placed[draggingPlacedSid]}
		{#if placedStick}
			<div class="dragGhost" style="left:{dragX}px; top:{dragY}px;">
				<div class="stickTiles">
					{#each placedStick.text.split('') as ch}
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
		padding: 0 10px;
		align-items: center;
		justify-content: flex-start;
		margin: 0 auto;
	}

	.board {
		position: relative;
		aspect-ratio: 1 / 1; /* square board */
		display: grid;
		grid-template-columns: repeat(10, 1fr);
		grid-template-rows: repeat(10, 1fr);
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
		font-size: clamp(14px, 3.5vw, 24px);
		letter-spacing: 0.8px;
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
		outline: 2px solid rgba(132, 255, 160, 0.8);
		outline-offset: -2px;
		background: rgba(132, 255, 160, 0.15);
	}

	.cell.shadowInvalid {
		outline: 2px dashed rgba(255, 132, 132, 0.8);
		outline-offset: -2px;
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
		display: grid;
		place-items: center;
		padding: 20px;
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
		padding: 0 10px 8px 10px;
		display: flex;
		flex-direction: column;
		min-height: 160px; /* ensure both rows visible */
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
		padding: 8px;
		flex: 1;
		min-height: 140px; /* ensure both rows visible */
		max-height: 160px;
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

	/* 2-row pack, scroll together */
	.bankGrid {
		display: grid;
		grid-auto-flow: column;
		grid-template-rows: repeat(2, 1fr); /* equal height rows */
		gap: 8px;
		align-content: start;
		min-height: 120px; /* ensure both rows have space */
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
