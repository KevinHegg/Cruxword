import type { GridCell, Slot } from '../data/types';

export function computeSlots(grid: GridCell[][]): Slot[] {
  const slots: Slot[] = [];
  const size = grid.length;
  
  // Find across slots
  for (let row = 0; row < size; row++) {
    let startCol = -1;
    const cells: Array<{ r: number; c: number }> = [];
    
    for (let col = 0; col <= size; col++) {
      const isWhite = col < size && !grid[row][col].isBlack;
      
      if (isWhite) {
        if (startCol === -1) {
          startCol = col;
        }
        cells.push({ r: row, c: col });
      } else {
        if (cells.length >= 3) { // Minimum word length is 3
          const id = `r${row}c${startCol}-A`;
          slots.push({
            id,
            dir: 'A',
            length: cells.length,
            cells: [...cells],
            pattern: '',
            crossings: [],
            // Legacy fields
            startRow: row,
            startCol,
            direction: 'across',
            crosses: [],
          });
        }
        startCol = -1;
        cells.length = 0;
      }
    }
  }
  
  // Find down slots
  for (let col = 0; col < size; col++) {
    let startRow = -1;
    const cells: Array<{ r: number; c: number }> = [];
    
    for (let row = 0; row <= size; row++) {
      const isWhite = row < size && !grid[row][col].isBlack;
      
      if (isWhite) {
        if (startRow === -1) {
          startRow = row;
        }
        cells.push({ r: row, c: col });
      } else {
        if (cells.length >= 3) { // Minimum word length is 3
          const id = `r${startRow}c${col}-D`;
          slots.push({
            id,
            dir: 'D',
            length: cells.length,
            cells: [...cells],
            pattern: '',
            crossings: [],
            // Legacy fields
            startRow,
            startCol: col,
            direction: 'down',
            crosses: [],
          });
        }
        startRow = -1;
        cells.length = 0;
      }
    }
  }
  
  // Compute crossings
  slots.forEach(slot => {
    slot.crossings = [];
    slot.cells.forEach((cell, index) => {
      const crossingSlots = slots.filter(otherSlot => {
        if (otherSlot.id === slot.id) return false;
        if (otherSlot.dir === slot.dir) return false;
        
        return otherSlot.cells.some(c => c.r === cell.r && c.c === cell.c);
      });
      
      crossingSlots.forEach(crossingSlot => {
        const crossIndex = crossingSlot.cells.findIndex(
          c => c.r === cell.r && c.c === cell.c
        );
        if (crossIndex !== -1) {
          slot.crossings.push({
            index,
            otherSlotId: crossingSlot.id,
          });
        }
      });
    });
  });
  
  return slots;
}

export function assignNumbers(grid: GridCell[][], slots: Slot[]): GridCell[][] {
  const newGrid = grid.map(row =>
    row.map(cell => {
      const newCell: GridCell = { ...cell };
      delete newCell.number;
      return newCell;
    })
  );
  
  // Sort slots by position (top to bottom, left to right)
  const sortedSlots = [...slots].sort((a, b) => {
    const aRow = a.cells[0]?.r ?? a.startRow ?? 0;
    const bRow = b.cells[0]?.r ?? b.startRow ?? 0;
    const aCol = a.cells[0]?.c ?? a.startCol ?? 0;
    const bCol = b.cells[0]?.c ?? b.startCol ?? 0;
    
    if (aRow !== bRow) {
      return aRow - bRow;
    }
    return aCol - bCol;
  });
  
  let number = 1;
  const usedPositions = new Set<string>();
  
  sortedSlots.forEach(slot => {
    const firstCell = slot.cells[0];
    const row = firstCell?.r ?? slot.startRow ?? 0;
    const col = firstCell?.c ?? slot.startCol ?? 0;
    const posKey = `${row}-${col}`;
    
    if (!usedPositions.has(posKey) && 
        row >= 0 && row < newGrid.length &&
        col >= 0 && col < newGrid[0].length) {
      newGrid[row][col].number = number;
      usedPositions.add(posKey);
      number++;
    }
  });
  
  return newGrid;
}

export function updateSlotPatterns(grid: GridCell[][], slots: Slot[]): Slot[] {
  return slots.map(slot => {
    let pattern = '';
    
    slot.cells.forEach(cell => {
      const gridCell = grid[cell.r]?.[cell.c];
      if (gridCell && gridCell.letter) {
        pattern += gridCell.letter.toLowerCase();
      } else {
        pattern += '?';
      }
    });
    
    // Update legacy fields
    const legacyCrosses = Array.from(new Set(slot.crossings.map(c => c.otherSlotId)));
    
    return {
      ...slot,
      pattern,
      crossings: slot.crossings, // Keep crossings as computed
      crosses: legacyCrosses, // Legacy field
    };
  });
}
