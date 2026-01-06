import type { GridCell, Slot } from '../data/types';

export function buildPattern(grid: GridCell[][], slot: Slot): string {
  let pattern = '';
  
  for (let i = 0; i < slot.length; i++) {
    const row = slot.direction === 'across' ? slot.startRow : slot.startRow + i;
    const col = slot.direction === 'across' ? slot.startCol + i : slot.startCol;
    
    if (grid[row][col].letter) {
      pattern += grid[row][col].letter;
    } else {
      pattern += '?';
    }
  }
  
  return pattern;
}

export function getCrossConstraints(grid: GridCell[][], slot: Slot): Map<number, string> {
  const constraints = new Map<number, string>();
  
  for (let i = 0; i < slot.length; i++) {
    const row = slot.direction === 'across' ? slot.startRow : slot.startRow + i;
    const col = slot.direction === 'across' ? slot.startCol + i : slot.startCol;
    
    // Find crossing slot
    const crossingSlot = findCrossingSlot(grid, row, col, slot.direction);
    if (crossingSlot) {
      const crossIndex = getCrossIndex(crossingSlot, row, col);
      if (crossIndex >= 0 && grid[row][col].letter) {
        constraints.set(i, grid[row][col].letter);
      }
    }
  }
  
  return constraints;
}

function findCrossingSlot(
  _grid: GridCell[][], 
  _row: number, 
  _col: number, 
  _direction: 'across' | 'down'
): Slot | null {
  // This is a simplified version - in a full implementation,
  // you'd need to track all slots and find the one that crosses at this position
  return null;
}

function getCrossIndex(slot: Slot, row: number, col: number): number {
  if (slot.direction === 'across') {
    return col - slot.startCol;
  } else {
    return row - slot.startRow;
  }
}
