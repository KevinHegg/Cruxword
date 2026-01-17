<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { pickRandomBag } from '$lib/bags';
	import { bagToSticks, validateBagShape } from '$lib/game/bag';
	import { canPlaceStick, createEmptyBoard, moveStick, placeStick, removeStick, rotateOrientation } from '$lib/game/board';
	import { validateAndScore } from '$lib/game/scoring';
	import { loadDictionary, isValidWord } from '$lib/game/dictionary';
	import type { BoardState, MorphemeBag, Stick } from '$lib/game/types';

	let bag: MorphemeBag = pickRandomBag();
	let bagIssues: string[] = [];
	let sticks: Stick[] = [];
	let board: BoardState = createEmptyBoard(12, 11);

	let selectedSid: string | null = null;
	// Use sessionStorage to remember if user dismissed quickstart
	let showCheat = typeof sessionStorage !== 'undefined' 
		? sessionStorage.getItem('cruxword-quickstart-dismissed') !== 'true'
		: true;
	let showClue = true;
	let showClueDetails = false; // toggle between question and metadata
	
	// Board size calculated dynamically based on actual element heights
	let boardSize = '400px'; // fallback
	let cellSize = 0; // Actual pixel size of each cell (for shadow positioning)
	let boardElement: HTMLElement | null = null; // Reference to board element
	
	// Dictionary for word validation
	let dictionary: Set<string> = new Set();
	let dictionaryLoaded = false;

	// Simple history for undo/redo
	let history: BoardState[] = [];
	let redoHistory: BoardState[] = [];

	// Shadow preview state (when stick is selected)
	let hoverCell: { r: number; c: number } | null = null; // cell being hovered over (mouse)
	let touchCell: { r: number; c: number } | null = null; // cell being touched (touch screens)
	let lastHoverCell: { r: number; c: number } | null = null; // last cell that showed shadow (to prevent flicker)
	let lastTouchCell: { r: number; c: number } | null = null; // last cell touched (to prevent flicker on touch)
	
	// Two-tap placement model: shadow state
	let shadowCell: { r: number; c: number } | null = null; // cell where shadow is shown (for two-tap placement)
	let shadowTimer: ReturnType<typeof setTimeout> | null = null; // timer to auto-remove shadow after 5 seconds
	const SHADOW_TIMEOUT = 5000; // 5 seconds
	
	// Scrolling detection for morpheme bank
	let bankScrollState: {
		isScrolling: boolean;
		scrollStartX: number;
		scrollStartY: number;
		touchStartTime: number;
	} = {
		isScrolling: false,
		scrollStartX: 0,
		scrollStartY: 0,
		touchStartTime: 0
	};
	const SCROLL_THRESHOLD = 10; // pixels
	const TAP_MAX_TIME = 200; // ms
	
	// Custom cursor for dragging stick
	let dragCursor: string | null = null; // First letter of selected stick for cursor
	let mouseX = 0;
	let mouseY = 0;

	// Board selection
	let selectedPlacedSid: string | null = null;
	
	// Highlight returned stick holder
	let highlightedSid: string | null = null;
	
	// Double-tap detection
	let lastTapTime = 0;
	let lastTapCell: { r: number; c: number } | null = null;
	const DOUBLE_TAP_DELAY = 300; // ms
	
	// Drag state for press-and-hold drag
	let dragState: {
		isDragging: boolean;
		dragSid: string | null; // stick being dragged (from bag or placed)
		dragStartCell: { r: number; c: number } | null;
		dragCluster: string[]; // all stick IDs in cluster if dragging placed stick
	} = {
		isDragging: false,
		dragSid: null,
		dragStartCell: null,
		dragCluster: []
	};
	let holdTimer: ReturnType<typeof setTimeout> | null = null;
	const HOLD_DELAY = 200; // ms to hold before drag starts
	
	// Lock viewport during drag to prevent board shifting
	let viewportLocked = false;

	// UI computed
	$: filledCells = countFilled(board);
	$: densityPct = Math.round((filledCells / 132) * 100);
	$: remainingCount = sticks.filter((s) => !s.placed).length;

	$: selectedStick = selectedSid ? sticks.find((s) => s.sid === selectedSid) ?? null : null;
	$: dragCursor = selectedStick && !selectedStick.placed ? selectedStick.text[0] : null;
	
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
		
		// Calculate board size using ResizeObserver for accurate measurements
		const calculateBoardSize = () => {
			// Don't recalculate during drag - freeze board position
			if (viewportLocked || dragState.isDragging) return;
			
			// Wait for DOM to be ready
			requestAnimationFrame(() => {
				// Double-check we're not in drag state
				if (viewportLocked || dragState.isDragging) return;
				
				const headerEl = document.querySelector('.top') as HTMLElement;
				const bankEl = document.querySelector('.bank') as HTMLElement;
				const boardEl = document.querySelector('.board') as HTMLElement;
				
				if (!headerEl || !bankEl || !boardEl) return;
				
				// Measure actual heights
				const headerHeight = headerEl.offsetHeight;
				const bankHeight = bankEl.offsetHeight;
				const screenPadding = 20; // 10px top + 10px bottom
				
				// Available space - use visual viewport for mobile accuracy
				const vh = window.visualViewport?.height || window.innerHeight;
				const vw = window.visualViewport?.width || window.innerWidth;
				
				// Calculate available space more accurately
				const availableHeight = vh - headerHeight - bankHeight - screenPadding;
				const availableWidth = vw - 20; // 10px padding each side
				
				// Board aspect ratio is 12:11 (width:height)
				// Calculate what size fits both constraints
				const widthBasedHeight = availableWidth * (11 / 12);
				const heightBasedWidth = availableHeight * (12 / 11);
				
				// Use the smaller dimension to ensure it fits, but be more generous
				let boardWidth: number;
				if (widthBasedHeight <= availableHeight) {
					// Width is the limiting factor - use 98% to ensure no clipping
					boardWidth = availableWidth * 0.98;
				} else {
					// Height is the limiting factor
					boardWidth = heightBasedWidth * 0.98;
				}
				
				// Ensure minimum size
				boardWidth = Math.max(boardWidth, 300);
				
				// Set the size
				boardSize = `${boardWidth}px`;
				boardElement = boardEl;
				
				// Calculate actual cell size after board is sized
				requestAnimationFrame(() => {
					if (boardEl) {
						const boardRect = boardEl.getBoundingClientRect();
						// Account for 1px border on each side
						cellSize = (boardRect.width - 2) / 12; // 12 columns
					}
				});
			});
		};
		
		calculateBoardSize();
		
		// Recalculate on resize - but not during drag
		const handleResize = () => {
			if (!viewportLocked && !dragState.isDragging) {
				calculateBoardSize();
			}
		};
		window.addEventListener('resize', handleResize);
		if (window.visualViewport) {
			window.visualViewport.addEventListener('resize', handleResize);
		}
		
		// Use ResizeObserver for more accurate board sizing
		let resizeObserver: ResizeObserver | null = null;
		setTimeout(() => {
			resizeObserver = new ResizeObserver(() => {
				if (!viewportLocked && !dragState.isDragging) {
					calculateBoardSize();
				}
			});
			
			// Observe header and bank for size changes
			const headerEl = document.querySelector('.top') as HTMLElement;
			const bankEl = document.querySelector('.bank') as HTMLElement;
			if (headerEl) resizeObserver!.observe(headerEl);
			if (bankEl) resizeObserver!.observe(bankEl);
		}, 200);
		
		// Store resizeObserver for cleanup
		const cleanupResizeObserver = () => {
			if (resizeObserver) {
				resizeObserver.disconnect();
			}
		};
		
		startNewGame();
		// Hide cheat sheet on first interaction
		const hideCheat = () => {
			if (showCheat) {
				showCheat = false;
				if (typeof sessionStorage !== 'undefined') {
					sessionStorage.setItem('cruxword-quickstart-dismissed', 'true');
				}
			}
			window.removeEventListener('pointerdown', hideCheat, { capture: true } as any);
			window.removeEventListener('touchstart', hideCheat, { capture: true } as any);
		};
		window.addEventListener('pointerdown', hideCheat, { capture: true } as any);
		window.addEventListener('touchstart', hideCheat, { capture: true } as any);
		
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
		
		// Track mouse position globally for custom cursor
		const handleMouseMove = (e: MouseEvent) => {
			mouseX = e.clientX;
			mouseY = e.clientY;
			// Also handle global drag tracking
			handleGlobalMouseMove(e);
		};
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleGlobalMouseUp);
		
		return () => {
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleGlobalMouseUp);
			window.removeEventListener('resize', handleResize);
			if (window.visualViewport) {
				window.visualViewport.removeEventListener('resize', handleResize);
			}
			if (holdTimer) {
				clearTimeout(holdTimer);
			}
			if (shadowTimer) {
				clearTimeout(shadowTimer);
			}
			// ResizeObserver cleanup
			cleanupResizeObserver();
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
		board = createEmptyBoard(12, 11);
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
		// Clear shadow when selecting new stick
		clearShadow();
	}
	
	// Clear shadow and timer
	function clearShadow() {
		if (shadowTimer) {
			clearTimeout(shadowTimer);
			shadowTimer = null;
		}
		shadowCell = null;
	}
	
	// Show shadow at cell and start auto-remove timer
	function showShadow(r: number, c: number) {
		// Clear existing timer
		if (shadowTimer) {
			clearTimeout(shadowTimer);
		}
		// Set new shadow cell
		shadowCell = { r, c };
		// Start timer to auto-remove after 5 seconds
		shadowTimer = setTimeout(() => {
			clearShadow();
		}, SHADOW_TIMEOUT);
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
		// Reverse sticks around vertical axis (mirror horizontally - reverse array order)
		sticks = [...sticks].reverse();
	}

	// ---- placing via tap
	async function tapPlace(r: number, c: number): Promise<boolean> {
		if (!selectedSid) return false;
		const stick = sticks.find((s) => s.sid === selectedSid);
		if (!stick || stick.placed) return false;
		
		// CRITICAL: Never place if we're dragging a placed stick
		if (dragState.isDragging) return false;
		
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

		// CRITICAL: Use tick() to batch the update and prevent intermediate re-renders
		await tick();
		
		// Lock viewport during placement to prevent board shift
		viewportLocked = true;
		
		pushHistory();
		
		// Create new board state without touching existing sticks
		const newBoard = placeStick(board, stick, r, c);
		
		// Batch all updates together
		board = newBoard;
		sticks = sticks.map((s) => (s.sid === stick.sid ? { ...s, placed: true } : s));
		selectedSid = null;
		hoverCell = null;
		lastHoverCell = null;
		clearShadow(); // Clear shadow after successful placement
		
		// Wait for DOM update
		await tick();
		
		// Unlock viewport after DOM settles
		setTimeout(() => {
			viewportLocked = false;
		}, 100);
		
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
	
	async function handleCellClick(r: number, c: number, e?: MouseEvent) {
		// Prevent default to avoid text selection
		if (e) {
			e.preventDefault();
			e.stopPropagation();
		}
		
		// Don't handle click if we just finished a drag
		if (dragState.isDragging) {
			return;
		}
		
		// Two-tap placement model: if stick is selected
		if (selectedSid) {
			const selectedStick = sticks.find(s => s.sid === selectedSid);
			if (selectedStick && !selectedStick.placed) {
				// Check if this is second tap on same cell
				if (shadowCell && shadowCell.r === r && shadowCell.c === c) {
					// Second tap on same cell: place the stick
					const placed = await tapPlace(r, c);
					if (placed) {
						clearShadow();
						return;
					}
				} else {
					// First tap or tap on different cell: show/move shadow
					showShadow(r, c);
					return;
				}
			}
		}
		
		// If cell has content, select its stick
		if (board.cells[r][c]) {
			tapCellSelect(r, c);
		}
	}
	
	function handleCellMouseEnter(r: number, c: number) {
		// Track hover for shadow preview - only update if cell changed (prevents flicker)
		if (dragState.isDragging) {
			// Update drag position
			hoverCell = { r, c };
			lastHoverCell = { r, c };
		} else if (selectedSid) {
			// Only update if moving to a different cell
			if (!lastHoverCell || lastHoverCell.r !== r || lastHoverCell.c !== c) {
				hoverCell = { r, c };
				lastHoverCell = { r, c };
			}
		}
	}
	
	function handleCellMouseMove(r: number, c: number) {
		// Update cursor position for shadow preview - only if cell changed
		if (dragState.isDragging) {
			// Update drag position
			hoverCell = { r, c };
			lastHoverCell = { r, c };
		} else if (selectedSid) {
			if (!lastHoverCell || lastHoverCell.r !== r || lastHoverCell.c !== c) {
				hoverCell = { r, c };
				lastHoverCell = { r, c };
			}
		}
	}
	
	function handleCellMouseLeave() {
		// Don't clear hoverCell if we're dragging - we need to track position globally
		if (!dragState.isDragging) {
			hoverCell = null;
			lastHoverCell = null;
		}
	}
	
	function handleCellMouseDown(r: number, c: number, e: MouseEvent) {
		// Prevent default to avoid text selection
		e.preventDefault();
		e.stopPropagation();
		
		// CRITICAL: Don't start drag if we have a new stick selected from bag
		// Only allow dragging of PLACED sticks, not new sticks being placed
		if (selectedSid) {
			// User is trying to place a new stick - don't start drag
			return;
		}
		
		// Clear any existing drag state
		if (dragState.isDragging) {
			dragState = { isDragging: false, dragSid: null, dragStartCell: null, dragCluster: [] };
		}
		
		// Check if there's a placed stick at this cell
		const cell = board.cells[r][c];
		if (cell && cell.stickIds.length > 0) {
			// Verify this stick is actually placed (not just selected from bag)
			const sidToDrag = cell.stickIds[cell.stickIds.length - 1];
			const stick = sticks.find(s => s.sid === sidToDrag);
			if (stick && stick.placed) {
				// Start hold timer for drag
				holdTimer = setTimeout(() => {
					// Hold completed - start drag
					const cluster = findCluster(sidToDrag);
					dragState = {
						isDragging: true,
						dragSid: sidToDrag,
						dragStartCell: { r, c },
						dragCluster: cluster
					};
					selectedPlacedSid = sidToDrag;
					selectedSid = null; // Clear bag selection
					hoverCell = { r, c }; // Initialize hover cell
					lastHoverCell = { r, c };
					holdTimer = null;
					// Lock viewport during drag to prevent board shifting
					viewportLocked = true;
				}, HOLD_DELAY);
			}
		}
	}
	
	function handleCellMouseUp(r: number, c: number, e: MouseEvent) {
		e.preventDefault();
		
		// Clear hold timer if it exists
		if (holdTimer) {
			clearTimeout(holdTimer);
			holdTimer = null;
		}
		
		// Handle drag end - use current hoverCell or this cell
		if (dragState.isDragging) {
			const targetCell = hoverCell || { r, c };
			// Calculate offset from drag start
			if (dragState.dragStartCell && dragState.dragCluster.length > 0) {
				const offsetR = targetCell.r - dragState.dragStartCell.r;
				const offsetC = targetCell.c - dragState.dragStartCell.c;
				
				// Get first stick's position
				const firstSid = dragState.dragCluster[0];
				const firstPlaced = board.placed[firstSid];
				if (firstPlaced) {
					const newR = firstPlaced.row + offsetR;
					const newC = firstPlaced.col + offsetC;
					
					// Try to move the cluster
					if (moveCluster(dragState.dragCluster, newR, newC)) {
						// Success - clear drag state
						dragState = { isDragging: false, dragSid: null, dragStartCell: null, dragCluster: [] };
						hoverCell = null;
						lastHoverCell = null;
						selectedPlacedSid = null;
						return;
					}
				}
			}
			
			// Drag failed or cancelled - clear drag state
			dragState = { isDragging: false, dragSid: null, dragStartCell: null, dragCluster: [] };
			hoverCell = null;
			lastHoverCell = null;
		}
	}
	
	// Global mouseup handler to catch drag end even if mouse leaves board
	function handleGlobalMouseUp(e: MouseEvent) {
		if (dragState.isDragging) {
			// Find which cell the mouse is over
			const element = document.elementFromPoint(e.clientX, e.clientY);
			if (element) {
				const cellEl = element.closest('[data-r][data-c]') as HTMLElement;
				if (cellEl) {
					const r = parseInt(cellEl.dataset.r || '0');
					const c = parseInt(cellEl.dataset.c || '0');
					if (r >= 0 && r < board.rows && c >= 0 && c < board.cols) {
						handleCellMouseUp(r, c, e);
						return;
					}
				}
			}
			// Mouse not over a cell - cancel drag
			if (holdTimer) {
				clearTimeout(holdTimer);
				holdTimer = null;
			}
			dragState = { isDragging: false, dragSid: null, dragStartCell: null, dragCluster: [] };
			hoverCell = null;
			lastHoverCell = null;
		}
	}
	
	// Global mousemove handler to track drag position even outside cells
	function handleGlobalMouseMove(e: MouseEvent) {
		if (dragState.isDragging) {
			// Find which cell the mouse is over
			const element = document.elementFromPoint(e.clientX, e.clientY);
			if (element) {
				const cellEl = element.closest('[data-r][data-c]') as HTMLElement;
				if (cellEl) {
					const r = parseInt(cellEl.dataset.r || '0');
					const c = parseInt(cellEl.dataset.c || '0');
					if (r >= 0 && r < board.rows && c >= 0 && c < board.cols) {
						if (!hoverCell || hoverCell.r !== r || hoverCell.c !== c) {
							hoverCell = { r, c };
							lastHoverCell = { r, c };
						}
					}
				}
			}
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
	
	function handleCellTouchStart(r: number, c: number, e: TouchEvent) {
		e.preventDefault();
		e.stopPropagation();
		
		// CRITICAL: Don't start drag if we have a new stick selected from bag
		// Only allow dragging of PLACED sticks, not new sticks being placed
		if (selectedSid) {
			// User is trying to place a new stick - just track position for preview
			touchCell = { r, c };
			lastTouchCell = { r, c };
			return;
		}
		
		// Clear any existing hold timer
		if (holdTimer) {
			clearTimeout(holdTimer);
			holdTimer = null;
		}
		
		// Clear any existing drag state
		if (dragState.isDragging) {
			dragState = { isDragging: false, dragSid: null, dragStartCell: null, dragCluster: [] };
		}
		
		// Check if there's a placed stick at this cell
		const cell = board.cells[r][c];
		if (cell && cell.stickIds.length > 0) {
			// Verify this stick is actually placed (not just selected from bag)
			const sidToDrag = cell.stickIds[cell.stickIds.length - 1];
			const stick = sticks.find(s => s.sid === sidToDrag);
			if (stick && stick.placed) {
				// Start hold timer for drag
					holdTimer = setTimeout(() => {
						// Hold completed - start drag
						const cluster = findCluster(sidToDrag);
						dragState = {
							isDragging: true,
							dragSid: sidToDrag,
							dragStartCell: { r, c },
							dragCluster: cluster
						};
						selectedPlacedSid = sidToDrag;
						selectedSid = null; // Clear bag selection
						touchCell = { r, c }; // Initialize touch cell
						lastTouchCell = { r, c };
						holdTimer = null;
						// Lock viewport during drag to prevent board shifting
						viewportLocked = true;
					}, HOLD_DELAY);
			}
		}
	}
	
	function handleCellTouchMove(r: number, c: number, e: TouchEvent) {
		// CRITICAL: Always prevent default to stop zoom/scroll
		e.preventDefault();
		e.stopPropagation();
		
		// If dragging a placed stick, cancel hold timer and update drag position
		if (holdTimer) {
			// Moved too much - cancel hold timer
			clearTimeout(holdTimer);
			holdTimer = null;
		}
		
		if (dragState.isDragging) {
			// Update drag position
			if (e.touches.length > 0) {
				const touch = e.touches[0];
				const element = document.elementFromPoint(touch.clientX, touch.clientY);
				if (element) {
					const cellEl = element.closest('[data-r][data-c]') as HTMLElement;
					if (cellEl) {
						const newR = parseInt(cellEl.dataset.r || '0');
						const newC = parseInt(cellEl.dataset.c || '0');
						if (newR >= 0 && newR < board.rows && newC >= 0 && newC < board.cols) {
							touchCell = { r: newR, c: newC };
							lastTouchCell = { r: newR, c: newC };
						}
					}
				}
			}
		} else if (selectedSid) {
			// Update touch position while moving finger - only if cell changed (prevents flicker)
			if (e.touches.length > 0) {
				const touch = e.touches[0];
				const element = document.elementFromPoint(touch.clientX, touch.clientY);
				if (element) {
					const cellEl = element.closest('[data-r][data-c]') as HTMLElement;
					if (cellEl) {
						const newR = parseInt(cellEl.dataset.r || '0');
						const newC = parseInt(cellEl.dataset.c || '0');
						if (newR >= 0 && newR < board.rows && newC >= 0 && newC < board.cols) {
							// Only update if moving to a different cell
							if (!lastTouchCell || lastTouchCell.r !== newR || lastTouchCell.c !== newC) {
								touchCell = { r: newR, c: newC };
								lastTouchCell = { r: newR, c: newC };
							}
						}
					}
				}
			}
		}
	}
	
	function handleCellTouchEnd(r: number, c: number, e: TouchEvent) {
		e.preventDefault();
		e.stopPropagation();
		
		// Clear hold timer if it exists
		if (holdTimer) {
			clearTimeout(holdTimer);
			holdTimer = null;
		}
		
		// CRITICAL FIX: Get the actual cell where touch ended, not where it started
		// Use changedTouches[0] for the touch that ended
		let endCell = { r, c };
		if (e.changedTouches && e.changedTouches.length > 0) {
			const touch = e.changedTouches[0];
			const element = document.elementFromPoint(touch.clientX, touch.clientY);
			if (element) {
				const cellEl = element.closest('[data-r][data-c]') as HTMLElement;
				if (cellEl) {
					const endR = parseInt(cellEl.dataset.r || '0');
					const endC = parseInt(cellEl.dataset.c || '0');
					if (endR >= 0 && endR < board.rows && endC >= 0 && endC < board.cols) {
						endCell = { r: endR, c: endC };
					}
				}
			}
		}
		
		// Use touchCell if available (most recent tracked position), otherwise use endCell
		const finalCell = touchCell || endCell;
		
		// Handle drag end - ONLY if actually dragging a PLACED stick
		if (dragState.isDragging && finalCell && dragState.dragSid) {
			// Verify we're dragging a placed stick, not placing a new one
			const draggedStick = sticks.find(s => s.sid === dragState.dragSid);
			if (draggedStick && draggedStick.placed) {
				// Calculate offset from drag start
				if (dragState.dragStartCell && dragState.dragCluster.length > 0) {
					const offsetR = finalCell.r - dragState.dragStartCell.r;
					const offsetC = finalCell.c - dragState.dragStartCell.c;
					
					// Get first stick's position
					const firstSid = dragState.dragCluster[0];
					const firstPlaced = board.placed[firstSid];
					if (firstPlaced) {
						const newR = firstPlaced.row + offsetR;
						const newC = firstPlaced.col + offsetC;
						
						// Try to move the cluster (will return true if offset is 0, preventing unnecessary moves)
						moveCluster(dragState.dragCluster, newR, newC).then((success) => {
							if (success) {
								// Success - clear drag state
								dragState = { isDragging: false, dragSid: null, dragStartCell: null, dragCluster: [] };
								touchCell = null;
								lastTouchCell = null;
								selectedPlacedSid = null;
								// Unlock viewport after drag
								viewportLocked = false;
							} else {
								// Failed - unlock anyway
								viewportLocked = false;
							}
						});
						return;
					}
				}
			}
			
			// Drag failed or cancelled - clear drag state
			dragState = { isDragging: false, dragSid: null, dragStartCell: null, dragCluster: [] };
			viewportLocked = false;
		}
		
		// Clear touch tracking
		touchCell = null;
		lastTouchCell = null;
		
		// For touch events, use double-tap detection
		const now = Date.now();
		const isDoubleTap = 
			now - lastTapTime < DOUBLE_TAP_DELAY && 
			lastTapCell?.r === finalCell.r && 
			lastTapCell?.c === finalCell.c;
		
		if (isDoubleTap) {
			// Double tap: return stick or disassemble cluster
			const cell = board.cells[finalCell.r][finalCell.c];
			if (cell && cell.stickIds.length > 0) {
				if (cell.stickIds.length === 1) {
					const sid = cell.stickIds[0];
					selectedPlacedSid = sid;
					returnSelectedPlaced();
				} else {
					disassembleCluster(finalCell.r, finalCell.c);
				}
			}
			lastTapTime = 0;
			lastTapCell = null;
		} else {
			// Single tap: two-tap placement model
			if (selectedSid && !dragState.isDragging) {
				const selectedStick = sticks.find(s => s.sid === selectedSid);
				// Only handle if it's an unplaced stick from the bag
				if (selectedStick && !selectedStick.placed) {
					// Check if this is second tap on same cell
					if (shadowCell && shadowCell.r === finalCell.r && shadowCell.c === finalCell.c) {
						// Second tap on same cell: place the stick
						tapPlace(finalCell.r, finalCell.c).then((placed) => {
							if (placed) {
								clearShadow();
								lastTapTime = 0;
								lastTapCell = null;
							}
						});
						return;
					} else {
						// First tap or tap on different cell: show/move shadow
						showShadow(finalCell.r, finalCell.c);
						lastTapTime = now;
						lastTapCell = { r: finalCell.r, c: finalCell.c };
						return;
					}
				}
			}
			
			// If cell has content, select its stick (only if not dragging)
			if (!dragState.isDragging && board.cells[finalCell.r][finalCell.c]) {
				tapCellSelect(finalCell.r, finalCell.c);
			}
			
			lastTapTime = now;
			lastTapCell = { r: finalCell.r, c: finalCell.c };
		}
	}
	
	// Find all sticks in a cluster (connected via intersections)
	function findCluster(sid: string): string[] {
		const visited = new Set<string>();
		const cluster: string[] = [];
		const queue: string[] = [sid];
		
		while (queue.length > 0) {
			const currentSid = queue.shift()!;
			if (visited.has(currentSid)) continue;
			visited.add(currentSid);
			cluster.push(currentSid);
			
			const placed = board.placed[currentSid];
			if (!placed) continue;
			
			// Find all cells this stick occupies
			const dr = placed.orientation === 'V' ? 1 : 0;
			const dc = placed.orientation === 'H' ? 1 : 0;
			
			for (let i = 0; i < placed.text.length; i++) {
				const r = placed.row + dr * i;
				const c = placed.col + dc * i;
				const cell = board.cells[r]?.[c];
				if (!cell) continue;
				
				// Add all other sticks at this cell to the cluster
				for (const otherSid of cell.stickIds) {
					if (otherSid !== currentSid && !visited.has(otherSid)) {
						queue.push(otherSid);
					}
				}
			}
		}
		
		return cluster;
	}
	
	// Move a cluster of sticks to a new position
	// CRITICAL: This function should ONLY be called when dragging PLACED sticks
	// It should NEVER be called when placing NEW sticks from the bag
	async function moveCluster(clusterSids: string[], newRow: number, newCol: number): Promise<boolean> {
		if (clusterSids.length === 0) return false;
		
		// CRITICAL: Verify all sticks in cluster are actually placed
		for (const sid of clusterSids) {
			const stick = sticks.find(s => s.sid === sid);
			if (!stick || !stick.placed) {
				// Can't move unplaced sticks - this should never happen
				return false;
			}
		}
		
		// Get the first stick's original position to calculate offset
		const firstSid = clusterSids[0];
		const firstPlaced = board.placed[firstSid];
		if (!firstPlaced) return false;
		
		const rowOffset = newRow - firstPlaced.row;
		const colOffset = newCol - firstPlaced.col;
		
		// CRITICAL: If offset is zero, don't move anything - sticks are already in place
		if (rowOffset === 0 && colOffset === 0) {
			return true; // Already in correct position - no movement needed
		}
		
		// Check if all sticks can be moved
		let tempBoard = structuredClone(board);
		for (const sid of clusterSids) {
			const placed = tempBoard.placed[sid];
			if (!placed) continue;
			
			const newR = placed.row + rowOffset;
			const newC = placed.col + colOffset;
			
			// Remove from temp board
			tempBoard = removeStick(tempBoard, sid);
			
			// Check if can place at new position
			const tempStick: Stick = { sid, text: placed.text, orientation: placed.orientation, placed: true };
			const ok = canPlaceStick(tempBoard, tempStick, newR, newC, bag.constraints.max_intersections_per_wordpair);
			if (!ok.ok) {
				return false; // Can't move cluster
			}
			
			// Place in temp board
			tempBoard = placeStick(tempBoard, tempStick, newR, newC);
		}
		
		// All checks passed, apply the move in a single batch
		await tick();
		
		pushHistory();
		
		// Apply all moves in one go to prevent intermediate re-renders
		let newBoard = board;
		for (const sid of clusterSids) {
			const placed = newBoard.placed[sid];
			if (!placed) continue;
			const newR = placed.row + rowOffset;
			const newC = placed.col + colOffset;
			newBoard = moveStick(newBoard, sid, newR, newC);
		}
		
		// Single state update
		board = newBoard;
		
		await tick();
		
		return true;
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
		const returnedSid = selectedPlacedSid;
		pushHistory();
		board = removeStick(board, returnedSid);
		sticks = sticks.map((s) => (s.sid === returnedSid ? { ...s, placed: false } : s));
		selectedPlacedSid = null;
		
		// Highlight the returned stick holder
		highlightedSid = returnedSid;
		setTimeout(() => {
			highlightedSid = null;
		}, 1500); // Highlight for 1.5 seconds
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

<div 
	class="screen has-drag-cursor={dragCursor !== null}" 
	style="padding: env(safe-area-inset-top) 10px env(safe-area-inset-bottom) 10px;"
	on:click={(e) => {
		// If clicking outside board, clear shadow
		const target = e.target as HTMLElement;
		if (!target.closest('.board') && !target.closest('.bank')) {
			clearShadow();
		}
	}}
>
	<header class="top">
		<div class="titleRow">
			<div class="title">
				<div class="h1">Cruxword <span class="bagId">(v0.19 - {bag.meta.id})</span></div>
				<div class="tagline">A daily <strong>morpheme rush</strong> for your brain.</div>
			</div>

			<button class="btnPrimary" on:click={startNewGame} aria-label="Reset">Reset</button>
		</div>

		<div class="statsRow">
			<div class="stat">Tiles {filledCells}/132</div>
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
			<div 
				class="board" 
				style="--rows: 11; --cols: 12; width: {boardSize};" 
				aria-label="12 by 11 board"
				on:touchmove={(e) => {
					// CRITICAL: Always prevent default to stop zoom
					e.preventDefault();
					// Handle touchmove on board to track finger movement across cells - only if cell changed
					if (selectedSid && e.touches.length > 0) {
						const touch = e.touches[0];
						const element = document.elementFromPoint(touch.clientX, touch.clientY);
						if (element) {
							const cellEl = element.closest('[data-r][data-c]') as HTMLElement;
							if (cellEl) {
								const r = parseInt(cellEl.dataset.r || '0');
								const c = parseInt(cellEl.dataset.c || '0');
								if (r >= 0 && r < board.rows && c >= 0 && c < board.cols) {
									// Only update if moving to a different cell
									if (!lastTouchCell || lastTouchCell.r !== r || lastTouchCell.c !== c) {
										touchCell = { r, c };
										lastTouchCell = { r, c };
									}
								}
							}
						}
					}
				}}
			>
				{#each Array(11) as _, r}
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
							on:click={(e) => handleCellClick(r, c, e)}
							on:mousedown={(e) => {
								// Prevent text selection on click
								e.preventDefault();
								handleCellMouseDown(r, c, e);
							}}
							on:mouseup={(e) => {
								e.preventDefault();
								handleCellMouseUp(r, c, e);
							}}
							on:dblclick={(e) => {
								e.stopPropagation();
								handleCellDoubleClick(r, c, e);
							}}
							on:touchstart={(e) => handleCellTouchStart(r, c, e)}
							on:touchmove={(e) => handleCellTouchMove(r, c, e)}
							on:touchend={(e) => handleCellTouchEnd(r, c, e)}
							on:mouseenter={() => handleCellMouseEnter(r, c)}
							on:mousemove={() => handleCellMouseMove(r, c)}
							on:mouseleave={handleCellMouseLeave}
							style="background: {cellStickIds.length > 1 ? `linear-gradient(135deg, ${cellColor} 0%, ${cellColor} 50%, ${cellColor2} 50%, ${cellColor2} 100%)` : cellColor};"
						>
							{#if cell}
								<span class="letter">{cell.letter}</span>
							{/if}
						</div>
					{/each}
				{/each}

				<!-- Shadow preview when stick is selected - two-tap placement model -->
				<!-- CRITICAL: Shadows are absolutely positioned overlays, NOT grid children -->
				{#if selectedSid && shadowCell}
					{@const previewCell = shadowCell}
					{@const selectedStick = sticks.find((s) => s.sid === selectedSid)}
					{#if selectedStick && !selectedStick.placed && previewCell}
						{@const dr = selectedStick.orientation === 'V' ? 1 : 0}
						{@const dc = selectedStick.orientation === 'H' ? 1 : 0}
						{@const placementCheck = canPlaceStick(board, selectedStick, previewCell.r, previewCell.c, bag.constraints.max_intersections_per_wordpair)}
						{#each Array(selectedStick.text.length) as _, i}
							{@const shadowR = previewCell.r + dr * i}
							{@const shadowC = previewCell.c + dc * i}
							{#if shadowR >= 0 && shadowR < 11 && shadowC >= 0 && shadowC < 12}
								{@const cellEl = boardElement?.querySelector(`[data-r="${shadowR}"][data-c="${shadowC}"]`) as HTMLElement}
								{@const cellRect = cellEl?.getBoundingClientRect()}
								{@const boardRect = boardElement?.getBoundingClientRect()}
								{@const topPos = cellRect && boardRect ? cellRect.top - boardRect.top : null}
								{@const leftPos = cellRect && boardRect ? cellRect.left - boardRect.left : null}
								{@const size = cellSize || null}
								<div 
									class="shadowOverlay {placementCheck.ok ? 'shadowValid' : 'shadowInvalid'}"
									style="--row: {shadowR}; --col: {shadowC}; {topPos !== null ? `top: ${topPos}px;` : `top: calc(1px + var(--row) * ((100% - 2px) / 11));`} {leftPos !== null ? `left: ${leftPos}px;` : `left: calc(1px + var(--col) * ((100% - 2px) / 12));`} {size !== null ? `width: ${size}px; height: ${size}px;` : `width: calc((100% - 2px) / 12); height: calc((100% - 2px) / 11);`}"
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
							if (typeof sessionStorage !== 'undefined') {
								sessionStorage.setItem('cruxword-quickstart-dismissed', 'true');
							}
						}
					}}>
						<div class="cheatCard" on:click|stopPropagation>
							<div class="cheatHeader">
								<div class="cheatTitle">Quickstart</div>
								<button class="cheatClose" on:click={() => {
									showCheat = false;
									if (typeof sessionStorage !== 'undefined') {
										sessionStorage.setItem('cruxword-quickstart-dismissed', 'true');
									}
								}} aria-label="Close help">×</button>
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
										<li><span class="hang">⇅</span> button reverses stick order (mirror horizontally)</li>
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
				<div class="bankLabel" on:contextmenu={(e) => e.preventDefault()}>Morphemes</div>
				<div class="bankActions">
					<button class="iconBtn thickStroke" disabled={history.length === 0} on:click={undo} aria-label="Undo" title="Undo (Ctrl+Z)">↶</button>
					<button class="iconBtn thickStroke" disabled={redoHistory.length === 0} on:click={redo} aria-label="Redo" title="Redo (Ctrl+Y)">↷</button>
					<button class="iconBtn thickStroke rotateBtn" on:click={toggleAllStickOrientations} title="Rotate all stick orientations" style="transform: {hasHorizontalSticks ? 'rotate(0deg)' : 'rotate(90deg)'};">⟷</button>
					<button class="iconBtn thickStroke" on:click={sortSticksByLength} title="Reverse stick order (mirror horizontally)">⇅</button>
					<button class="iconBtn" on:click={() => {
						showCheat = !showCheat;
						if (!showCheat && typeof sessionStorage !== 'undefined') {
							sessionStorage.setItem('cruxword-quickstart-dismissed', 'true');
						}
					}} title="Help & Dev Tools">?</button>
				</div>
			</div>

			<div 
				class="bankScroller" 
				aria-label="Morpheme bank (scroll sideways)"
				on:scroll={() => {
					// Mark as scrolling when scroll event fires
					bankScrollState.isScrolling = true;
					// Clear scroll flag after scroll ends
					clearTimeout(bankScrollState.touchStartTime as any);
					bankScrollState.touchStartTime = setTimeout(() => {
						bankScrollState.isScrolling = false;
					}, 150) as any;
				}}
			>
				<div class="bankGrid">
					{#each sticks as s (s.sid)}
						<div
							class="stick {s.placed ? 'ghost' : ''} {selectedSid === s.sid ? 'selected' : ''} {highlightedSid === s.sid ? 'highlighted' : ''}"
							on:touchstart={(e) => {
								// Track touch start for swipe detection
								const touch = e.touches[0];
								bankScrollState.scrollStartX = touch.clientX;
								bankScrollState.scrollStartY = touch.clientY;
								bankScrollState.touchStartTime = Date.now() as any;
								bankScrollState.isScrolling = false;
							}}
							on:touchmove={(e) => {
								// If moving horizontally more than threshold, mark as scrolling
								const touch = e.touches[0];
								const deltaX = Math.abs(touch.clientX - bankScrollState.scrollStartX);
								const deltaY = Math.abs(touch.clientY - bankScrollState.scrollStartY);
								// If horizontal movement > vertical and > threshold, it's a scroll
								if (deltaX > deltaY && deltaX > SCROLL_THRESHOLD) {
									bankScrollState.isScrolling = true;
								}
							}}
							on:touchend={(e) => {
								// Only select if not scrolling and was a quick tap
								const touchDuration = Date.now() - (bankScrollState.touchStartTime as any);
								if (!bankScrollState.isScrolling && touchDuration < TAP_MAX_TIME && !s.placed) {
									// Small delay to allow scroll to be detected
									setTimeout(() => {
										if (!bankScrollState.isScrolling) {
											selectStick(s.sid);
										}
									}, 50);
								}
								bankScrollState.isScrolling = false;
							}}
							on:click={(e) => {
								// Desktop: always select on click
								if (!s.placed && !bankScrollState.isScrolling) {
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
	
	<!-- Custom cursor showing first letter when dragging stick (desktop only) -->
	{#if dragCursor}
		<div class="dragCursorPreview" style="left: {mouseX}px; top: {mouseY}px;">
			{dragCursor}
		</div>
	{/if}

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
		overflow-x: visible; /* Changed from hidden to visible to prevent board clipping */
		height: 100vh;
		height: 100dvh;
	}
	
	/* Custom cursor showing first letter when dragging stick (desktop only) */
	:global(body:has(.has-drag-cursor)) {
		cursor: none !important;
	}
	
	.dragCursorPreview {
		position: fixed;
		pointer-events: none;
		z-index: 10000;
		font-size: 24px;
		font-weight: 900;
		color: rgba(132, 255, 160, 1);
		text-shadow: 0 0 4px rgba(132, 255, 160, 0.8);
		background: rgba(0, 0, 0, 0.7);
		border-radius: 8px;
		padding: 4px 8px;
		border: 2px solid rgba(132, 255, 160, 1);
		transform: translate(-50%, -50%);
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 40px;
		min-height: 40px;
	}
	
	/* Only show cursor on desktop */
	@media (max-width: 768px) {
		.dragCursorPreview {
			display: none;
		}
	}

	.screen {
		max-width: 100vw;
		width: 100%;
		margin: 0 auto;
		touch-action: none; /* Prevent all touch gestures including zoom/pan */
		overflow-x: visible;
		height: 100vh;
		height: 100dvh; /* dynamic viewport height for mobile */
		display: flex;
		flex-direction: column;
	}
	
	/* On desktop, remove width constraint to allow full board width */
	@media (min-width: 769px) {
		.screen {
			max-width: 100vw; /* Remove iPhone constraint - allow full width */
			box-shadow: none; /* Remove shadow since not centered */
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
		font-size: 20px;
		font-weight: 700;
	}

	.iconBtn.thickStroke {
		/* Make undo/redo and orientation icons thicker to match other icons */
		font-weight: 900;
		text-shadow: 0 0 2px rgba(233, 236, 255, 0.3);
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
		overflow: hidden;
		padding: 0;
		min-height: 0;
	}

	.boardWrap {
		position: relative;
		display: flex;
		flex-direction: column;
		padding: 0;
		align-items: center;
		justify-content: center;
		margin: 0 auto;
		flex: 1 1 0;
		min-width: 0;
		min-height: 0;
		width: 100%;
		overflow: visible;
		box-sizing: border-box;
		/* Freeze position - prevent any layout shifts */
		contain: layout style paint; /* Isolate layout calculations */
		transform: translateZ(0); /* Force GPU layer */
		backface-visibility: hidden; /* Prevent visual glitches */
	}

	.board {
		position: relative;
		aspect-ratio: 12 / 11; /* 12 wide by 11 tall - MUST maintain this */
		display: grid;
		grid-template-columns: repeat(12, 1fr); /* All 12 columns visible */
		grid-template-rows: repeat(11, 1fr); /* All 11 rows visible */
		gap: 0;
		border-radius: 16px;
		overflow: visible; /* Allow board to be fully visible */
		border: 1px solid rgba(255,255,255,0.12);
		background:
			radial-gradient(circle at 25% 30%, rgba(80, 120, 255, 0.15), transparent 45%),
			radial-gradient(circle at 70% 75%, rgba(200, 140, 255, 0.12), transparent 50%),
			linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
		margin: 0 auto;
		box-sizing: border-box;
		/* Size is set by JavaScript based on actual measurements */
		/* CRITICAL: Isolate board from layout changes */
		contain: layout style paint; /* Prevent layout shifts from affecting board */
		transform: translateZ(0); /* Force GPU layer - prevents reflows */
		backface-visibility: hidden; /* Prevent visual glitches */
		isolation: isolate; /* Create new stacking context */
	}

	/* subtle grid lines */
	.cell {
		display: grid;
		place-items: center;
		border-right: 1px solid rgba(255,255,255,0.06);
		border-bottom: 1px solid rgba(255,255,255,0.06);
		user-select: none;
		-webkit-user-select: none;
		touch-action: none; /* Prevent zoom/pan on cells */
		cursor: pointer; /* show it's clickable */
		aspect-ratio: 1 / 1; /* ensure square tiles */
		position: relative;
		z-index: 1; /* Base z-index for regular cells */
		transition: opacity 0.1s ease, transform 0.1s ease;
		-webkit-tap-highlight-color: transparent; /* Remove default tap highlight */
		/* Prevent cell from causing layout shifts */
		contain: layout style; /* Isolate cell layout */
	}
	
	.cell:active {
		opacity: 0.7;
		transform: scale(0.95);
	}

	/* remove outer extra lines look */
	/* Remove outer borders for 12x11 board */
	.cell:nth-child(12n) { border-right: none; } /* Remove right border on last column */
	.board > .cell:nth-child(n + 121) { border-bottom: none; } /* Remove bottom border on last row (11 rows * 12 cols = 132 cells, last row starts at cell 121) */

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
		font-size: clamp(14px, 3.2vw, 24px); /* Increased from 12-20px to 14-24px for better visibility */
		letter-spacing: 0.7px;
	}

	/* Shadow preview for drag placement - CRITICAL: Absolutely positioned overlays, NOT grid children */
	/* This prevents shadows from affecting grid layout and causing tile movement */
	.shadowOverlay {
		position: absolute;
		/* Position can be set via inline style (pixels) or CSS calc (fallback) */
		/* JavaScript sets pixel positions for perfect alignment */
		z-index: 50; /* Higher than regular cells to overlay */
		pointer-events: none; /* Don't block interactions */
		opacity: 0.6; /* More subtle */
		display: grid;
		place-items: center;
		border-right: 1px solid rgba(255,255,255,0.06);
		border-bottom: 1px solid rgba(255,255,255,0.06);
		box-sizing: border-box;
		/* CRITICAL: Shadows don't affect layout */
		contain: layout style paint; /* Isolate from layout */
		/* Ensure perfect alignment with grid cells */
		margin: 0;
		padding: 0;
	}

	.shadowOverlay.shadowValid {
		outline: 1px solid rgba(132, 255, 160, 0.5); /* More subtle - reduced opacity */
		outline-offset: -1px;
		background: rgba(132, 255, 160, 0.1); /* More subtle background */
		box-shadow: 0 0 2px rgba(132, 255, 160, 0.3); /* Subtle glow */
	}

	.shadowOverlay.shadowInvalid {
		outline: 1px solid rgba(255, 100, 100, 0.5); /* More subtle red */
		outline-offset: -1px;
		background: rgba(255, 100, 100, 0.15); /* More subtle red background */
		box-shadow: 0 0 2px rgba(255, 100, 100, 0.4); /* Subtle red glow */
	}

	.shadowLetter {
		color: rgba(233, 236, 255, 0.85); /* Slightly transparent for subtlety */
		font-weight: 800; /* Slightly less bold */
		text-shadow: none; /* Remove glow for subtlety */
	}

	.bankActions .iconBtn {
		width: 32px;
		padding: 5px 0;
		font-size: 14px;
	}
	
	.thickStroke {
		font-weight: 900; /* Thicker stroke for icons */
		-webkit-text-stroke: 0.5px currentColor;
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
		padding-top: 6px !important;
		padding-bottom: 6px !important;
		padding-left: 10px;
		padding-right: 10px;
		margin: 0;
		display: flex;
		flex-direction: column;
		height: auto;
		min-height: 0;
	}

	.bankHeader {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin: 0;
		padding-top: 6px !important;
		padding-bottom: 6px !important;
		padding-left: 0;
		padding-right: 0;
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
		user-select: none;
		-webkit-user-select: none;
		-moz-user-select: none;
		-ms-user-select: none;
		cursor: default;
	}

	.bankScroller {
		overflow-x: auto;
		overflow-y: hidden;
		-webkit-overflow-scrolling: touch;
		border-radius: 14px;
		border: 1px solid rgba(255,255,255,0.12);
		background: rgba(255,255,255,0.04);
		padding-top: 4px !important;
		padding-bottom: 4px !important;
		padding-left: 2px;
		padding-right: 2px;
		margin: 0;
		flex: 1;
		min-height: 0;
		height: auto;
		/* Allow scrolling on touch */
		touch-action: pan-x;
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
		grid-template-rows: repeat(3, auto); /* Auto height rows - no min-height */
		gap: 3px;
		align-content: start;
		margin: 0;
		padding: 0;
	}

	.stick {
		display: flex;
		align-items: center;
		gap: 6px;
		border-radius: 12px;
		border: 1px solid rgba(255,255,255,0.12);
		background: rgba(255,255,255,0.06);
		padding-top: 4px !important;
		padding-bottom: 4px !important;
		padding-left: 6px;
		padding-right: 6px;
		margin: 0;
		user-select: none;
		-webkit-user-select: none;
		touch-action: pan-x; /* Allow horizontal scrolling while preserving tap */
		height: auto;
		transition: opacity 0.15s ease, transform 0.15s ease, outline 0.3s ease;
		-webkit-tap-highlight-color: transparent;
	}
	
	.stick:active {
		opacity: 0.8;
		transform: scale(0.97);
	}
	
	.stick.highlighted {
		outline: 3px solid rgba(132, 255, 160, 0.9);
		outline-offset: 2px;
		animation: highlightPulse 1.5s ease-out;
	}
	
	@keyframes highlightPulse {
		0% {
			outline-width: 3px;
			outline-color: rgba(132, 255, 160, 0.9);
		}
		50% {
			outline-width: 4px;
			outline-color: rgba(132, 255, 160, 0.7);
		}
		100% {
			outline-width: 3px;
			outline-color: rgba(132, 255, 160, 0.3);
		}
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
		margin: 0; /* Remove any default margins */
		padding: 0; /* Remove any default padding */
	}

	.tile {
		width: 24px; /* Keep original size - user said keep text blocks same size */
		height: 24px; /* Keep original size */
		border-radius: 6px;
		display: grid;
		place-items: center;
		font-weight: 900;
		font-size: 13px; /* Keep original font size */
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
