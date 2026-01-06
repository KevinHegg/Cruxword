import React, { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store';
import { computeSlots, assignNumbers, updateSlotPatterns } from './numbering';
import { getCandidates } from '../data/fillIndexer';
import { findTopSegmentChains } from '../segments/finder';
import { SHAPES } from '../pieces/shapes';

const Grid: React.FC = () => {
  const {
    grid,
    gridSize,
    focusedCell,
    fillIndex,
    setFocusedCell,
    toggleBlackCell,
    setCellLetter,
    setSlots,
    setCandidates,
    clearGrid,
    newGrid,
    draggingShapeId,
    placeShapeAt,
    setDraggingShape,
    segMap,
    segsByLength,
    segmentLifespans,
    setSegmentChains,
    setActiveTab,
  } = useAppStore();

  const [previewShapeId, setPreviewShapeId] = useState<string | null>(null);
  const [previewOrigin, setPreviewOrigin] = useState<{ row: number; col: number } | null>(null);

  // Update slots and candidates when grid changes
  useEffect(() => {
    const slots = computeSlots(grid);
    const numberedGrid = assignNumbers(grid, slots);
    const updatedSlots = updateSlotPatterns(numberedGrid, slots);
    setSlots(updatedSlots);

    // Auto-focus first ACROSS slot on initial mount
    if (!focusedCell && updatedSlots.length > 0) {
      const firstAcrossSlot = updatedSlots.find(s => s.direction === 'across');
      if (firstAcrossSlot && firstAcrossSlot.startRow !== undefined && firstAcrossSlot.startCol !== undefined) {
        setFocusedCell(firstAcrossSlot.startRow, firstAcrossSlot.startCol);
      }
    }

    // Update candidates and segment chains for focused slot
    if (focusedCell) {
      const focusedSlot = updatedSlots.find(slot => {
        return slot.cells.some(cell => cell.r === focusedCell.row && cell.c === focusedCell.col);
      });

      if (focusedSlot) {
        // Get word candidates
        if (fillIndex) {
          const candidates = getCandidates(focusedSlot, fillIndex, grid);
          setCandidates(candidates);
          
          // If no candidates or pattern is all ?, switch to Segment Chains tab
          if (candidates.length === 0 || focusedSlot.pattern.split('').every(c => c === '?')) {
            setActiveTab('segments');
          }
        } else {
          setCandidates([]);
        }
        
        // Get segment chains
        if (segMap && segsByLength && segmentLifespans) {
          const chains = findTopSegmentChains(focusedSlot.pattern, segsByLength, segmentLifespans, 50);
          setSegmentChains(chains);
        }
      } else {
        setCandidates([]);
        setSegmentChains([]);
      }
    } else {
      setCandidates([]);
      setSegmentChains([]);
    }
  }, [grid, focusedCell, fillIndex, segMap, segmentLifespans, setSlots, setCandidates, setSegmentChains, setFocusedCell, setActiveTab]);

  const handleCellClick = (row: number, col: number) => {
    setFocusedCell(row, col);
  };

  const handleCellKeyDown = (e: React.KeyboardEvent, row: number, col: number) => {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      setCellLetter(row, col, '');
    } else if (e.key === ' ') {
      e.preventDefault();
      toggleBlackCell(row, col);
    } else if (e.key.length === 1 && /[A-Za-z]/.test(e.key)) {
      setCellLetter(row, col, e.key);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (draggingShapeId) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDragEnterCell = (event: React.DragEvent<HTMLButtonElement>, row: number, col: number) => {
    if (!draggingShapeId) {
      return;
    }
    event.preventDefault();
    setPreviewShapeId(draggingShapeId);
    setPreviewOrigin({ row, col });
  };

  const handleDrop = (event: React.DragEvent<HTMLButtonElement>, row: number, col: number) => {
    event.preventDefault();
    const shapeId = draggingShapeId || event.dataTransfer.getData('text/plain');
    if (shapeId) {
      const success = placeShapeAt(shapeId, row, col);
      if (!success) {
        console.warn('Unable to place shape at target location.');
      }
    }
    setPreviewShapeId(null);
    setPreviewOrigin(null);
    setDraggingShape(null);
  };

  const handlePaletteDragLeave = () => {
    setPreviewShapeId(null);
    setPreviewOrigin(null);
  };

  const previewCells = useMemo(() => {
    if (!previewShapeId || !previewOrigin) {
      return new Set<string>();
    }
    const shape = SHAPES.find(s => s.id === previewShapeId);
    if (!shape) {
      return new Set<string>();
    }

    const coords = new Set<string>();
    shape.cells.forEach(cell => {
      const row = previewOrigin.row + cell.row;
      const col = previewOrigin.col + cell.col;
      if (row >= 0 && row < gridSize && col >= 0 && col < gridSize) {
        coords.add(`${row}-${col}`);
      }
    });
    return coords;
  }, [previewShapeId, previewOrigin, gridSize]);

  return (
    <div>
      <div className="controls">
        <button className="btn primary" onClick={newGrid}>
          New Grid
        </button>
        <button className="btn" onClick={clearGrid}>
          Clear
        </button>
      </div>

      <div 
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${gridSize}, 32px)`,
          gridTemplateRows: `repeat(${gridSize}, 32px)`,
        }}
        onDragOver={handleDragOver}
        onDragLeave={handlePaletteDragLeave}
      >
        {grid.map((row, rowIndex) =>
          row.map((cell, colIndex) => (
            <button
              key={`${rowIndex}-${colIndex}`}
              className={`grid-cell ${cell.isBlack ? 'black' : ''} ${
                focusedCell?.row === rowIndex && focusedCell?.col === colIndex ? 'focused' : ''
              } ${cell.number ? 'numbered' : ''} ${
                previewCells.has(`${rowIndex}-${colIndex}`) ? 'preview' : ''
              }`}
              data-number={cell.number}
              onClick={() => handleCellClick(rowIndex, colIndex)}
              onKeyDown={(e) => handleCellKeyDown(e, rowIndex, colIndex)}
              tabIndex={0}
              onDragEnter={(event) => handleDragEnterCell(event, rowIndex, colIndex)}
              onDrop={(event) => handleDrop(event, rowIndex, colIndex)}
            >
              {cell.letter}
            </button>
          ))
        )}
      </div>

      <div className="status">
        <p>Grid: {gridSize}×{gridSize}</p>
        <p>Click cells to focus, type letters, press Space for black squares</p>
      </div>
    </div>
  );
};

export default Grid;
