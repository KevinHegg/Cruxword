import { create } from 'zustand';
import type { GridCell, Slot, Candidate } from './data/types';
import type { FillWordIndex } from './data/fillIndexer';
import { SHAPES } from './pieces/shapes';
import type { Segment, SegmentChain } from './segments/types';

interface AppState {
  // Grid state
  grid: GridCell[][];
  gridSize: number;
  focusedCell: { row: number; col: number } | null;

  // Data state
  fillIndex: FillWordIndex | null;
  candidates: Candidate[];
  slots: Slot[];
  
  // Segment state
  segMap: Map<string, Segment> | null;
  segsByLength: Map<number, Segment[]>;
  segmentLifespans: Map<string, number>;
  segmentChains: SegmentChain[];

  // UI state
  activeTab: 'candidates' | 'segments' | 'wordlists' | 'theme';
  filters: {
    preferClueable: boolean;
    preferLowFrequency: boolean;
    allowProperNouns: boolean;
  };
  draggingShapeId: string | null;

  // Theme state
  themeWords: string[];
  placedThemeWords: Set<string>;

  // Actions
  setGridSize: (size: number) => void;
  setFocusedCell: (row: number, col: number) => void;
  toggleBlackCell: (row: number, col: number) => void;
  setCellLetter: (row: number, col: number, letter: string) => void;
  setFillIndex: (index: FillWordIndex) => void;
  setCandidates: (candidates: Candidate[]) => void;
  setSlots: (slots: Slot[]) => void;
  setActiveTab: (tab: 'candidates' | 'segments' | 'wordlists' | 'theme') => void;
  setFilters: (filters: Partial<AppState['filters']>) => void;
  setThemeWords: (words: string[]) => void;
  addPlacedThemeWord: (word: string) => void;
  clearGrid: () => void;
  newGrid: () => void;
  setDraggingShape: (shapeId: string | null) => void;
  placeShapeAt: (shapeId: string, originRow: number, originCol: number) => boolean;
  
  // Segment actions
  setSegMap: (segMap: Map<string, Segment>) => void;
  setSegsByLength: (segsByLength: Map<number, Segment[]>) => void;
  setSegmentLifespans: (lifespans: Map<string, number>) => void;
  setSegmentChains: (chains: SegmentChain[]) => void;
  commitSegmentChain: (chain: SegmentChain, slot: Slot) => void;
}

const createEmptyGrid = (size: number): GridCell[][] => {
  return Array(size)
    .fill(null)
    .map(() =>
      Array(size)
        .fill(null)
        .map(() => ({
          letter: '',
          isBlack: false,
        }))
    );
};

const DEFAULT_GRID_SIZE = 11;

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  grid: createEmptyGrid(DEFAULT_GRID_SIZE),
  gridSize: DEFAULT_GRID_SIZE,
  focusedCell: null,
  fillIndex: null,
  candidates: [],
  slots: [],
  segMap: null,
  segsByLength: new Map(),
  segmentLifespans: new Map(),
  segmentChains: [],
  activeTab: 'candidates',
  filters: {
    preferClueable: true,
    preferLowFrequency: false,
    allowProperNouns: false,
  },
  draggingShapeId: null,
  themeWords: [],
  placedThemeWords: new Set(),

  // Actions
  setGridSize: (size: number) =>
    set({
      gridSize: size,
      grid: createEmptyGrid(size),
      focusedCell: null,
      slots: [],
    }),

  setFocusedCell: (row: number, col: number) => set({ focusedCell: { row, col } }),

  toggleBlackCell: (row: number, col: number) => {
    const { grid } = get();
    const newGrid = grid.map(r => r.map(cell => ({ ...cell })));

    newGrid[row][col].isBlack = !newGrid[row][col].isBlack;
    newGrid[row][col].letter = '';

    set({ grid: newGrid });
  },

  setCellLetter: (row: number, col: number, letter: string) => {
    const { grid } = get();
    const newGrid = grid.map(r => r.map(cell => ({ ...cell })));

    newGrid[row][col].letter = letter.toUpperCase();

    set({ grid: newGrid });
  },

  setFillIndex: (fillIndex: FillWordIndex) => set({ fillIndex }),
  setCandidates: (candidates: Candidate[]) => set({ candidates }),
  setSlots: (slots: Slot[]) => set({ slots }),
  setActiveTab: activeTab => set({ activeTab }),
  setFilters: newFilters =>
    set(state => ({
      filters: { ...state.filters, ...newFilters },
    })),
  setThemeWords: (themeWords: string[]) => set({ themeWords }),
  addPlacedThemeWord: (word: string) =>
    set(state => ({
      placedThemeWords: new Set([...state.placedThemeWords, word]),
    })),

  clearGrid: () =>
    set({
      grid: createEmptyGrid(get().gridSize),
      focusedCell: null,
      slots: [],
    }),

  newGrid: () =>
    set({
      grid: createEmptyGrid(DEFAULT_GRID_SIZE),
      gridSize: DEFAULT_GRID_SIZE,
      focusedCell: null,
      slots: [],
      themeWords: [],
      placedThemeWords: new Set(),
      draggingShapeId: null,
    }),

  setDraggingShape: (shapeId: string | null) => set({ draggingShapeId: shapeId }),

  placeShapeAt: (shapeId: string, originRow: number, originCol: number) => {
    const { grid, gridSize } = get();
    const shape = SHAPES.find(s => s.id === shapeId);

    if (!shape) {
      console.warn(`Shape ${shapeId} not found.`);
      return false;
    }

    if (originRow < 0 || originCol < 0) {
      return false;
    }

    if (originRow + shape.height > gridSize || originCol + shape.width > gridSize) {
      return false;
    }

    const newGrid = grid.map(r => r.map(cell => ({ ...cell })));

    const validateCell = (row: number, col: number, letter?: string, isBlack?: boolean) => {
      if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) {
        return false;
      }

      const targetCell = newGrid[row][col];

      if (isBlack) {
        return !targetCell.letter;
      }

      if (letter) {
        if (targetCell.isBlack) {
          return false;
        }
        if (targetCell.letter && targetCell.letter !== letter.toUpperCase()) {
          return false;
        }
      }

      return true;
    };

    for (const cell of shape.cells) {
      const targetRow = originRow + cell.row;
      const targetCol = originCol + cell.col;

      if (!validateCell(targetRow, targetCol, cell.letter, cell.isBlack)) {
        return false;
      }
    }

    const applyCell = (row: number, col: number, letter?: string, isBlack?: boolean) => {
      if (letter) {
        newGrid[row][col].letter = letter.toUpperCase();
        newGrid[row][col].isBlack = false;
      } else if (isBlack) {
        newGrid[row][col].isBlack = true;
        newGrid[row][col].letter = '';
      }
    };

    for (const cell of shape.cells) {
      const targetRow = originRow + cell.row;
      const targetCol = originCol + cell.col;

      applyCell(targetRow, targetCol, cell.letter, cell.isBlack);
    }

    set({ grid: newGrid, draggingShapeId: null });
    return true;
  },

  // Segment actions
  setSegMap: (segMap: Map<string, Segment>) => set({ segMap }),
  setSegsByLength: (segsByLength: Map<number, Segment[]>) => set({ segsByLength }),
  setSegmentLifespans: (segmentLifespans: Map<string, number>) => set({ segmentLifespans }),
  setSegmentChains: (segmentChains: SegmentChain[]) => set({ segmentChains }),
  
  commitSegmentChain: (chain: SegmentChain, slot: Slot) => {
    const { grid, segmentLifespans } = get();
    const newGrid = grid.map(r => r.map(cell => ({ ...cell })));
    const newLifespans = new Map(segmentLifespans);

    if (slot.startRow === undefined || slot.startCol === undefined) {
      return;
    }

    // Fill the slot with the chain letters
    for (let i = 0; i < chain.letters.length; i++) {
      const row = slot.direction === 'across' ? slot.startRow : slot.startRow + i;
      const col = slot.direction === 'across' ? slot.startCol + i : slot.startCol;
      newGrid[row][col].letter = chain.letters[i];
    }

    // Decrement lifespans for each segment in the chain
    for (const segText of chain.chain) {
      const key = segText.toLowerCase();
      const current = newLifespans.get(key) || 0;
      if (current > 0) {
        newLifespans.set(key, current - 1);
      }
    }

    set({ grid: newGrid, segmentLifespans: newLifespans });
  },
}));
