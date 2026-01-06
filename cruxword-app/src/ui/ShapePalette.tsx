import React from 'react';
import { SHAPES, ShapeDefinition } from '../pieces/shapes';
import { useAppStore } from '../store';

const ShapePreview: React.FC<{ shape: ShapeDefinition }> = ({ shape }) => {
  const grid: Array<Array<{ letter?: string; isBlack?: boolean }>> = Array(shape.height)
    .fill(null)
    .map(() => Array(shape.width).fill(null).map(() => ({})));

  shape.cells.forEach(cell => {
    if (!grid[cell.row] || !grid[cell.row][cell.col]) {
      return;
    }
    grid[cell.row][cell.col] = { letter: cell.letter, isBlack: cell.isBlack };
  });

  return (
    <div
      className="shape-preview"
      style={{ gridTemplateColumns: `repeat(${shape.width}, 18px)` }}
    >
      {grid.map((row, rowIndex) =>
        row.map((cell, colIndex) => (
          <div
            key={`${rowIndex}-${colIndex}`}
            className={`shape-preview-cell ${cell.isBlack ? 'black' : ''}`}
          >
            {cell.letter && <span>{cell.letter}</span>}
          </div>
        ))
      )}
    </div>
  );
};

const ShapePalette: React.FC = () => {
  const setDraggingShape = useAppStore(state => state.setDraggingShape);

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>, shapeId: string) => {
    event.dataTransfer.setData('text/plain', shapeId);
    event.dataTransfer.effectAllowed = 'copy';
    setDraggingShape(shapeId);
  };

  const handleDragEnd = () => {
    setDraggingShape(null);
  };

  return (
    <div className="shape-palette">
      <header className="shape-palette__header">
        <h2>Shape Palette</h2>
        <p>Drag a shape onto the grid to place a pre-built segment or block pattern.</p>
      </header>

      <div className="shape-palette__list">
        {SHAPES.map(shape => (
          <div
            key={shape.id}
            className="shape-card"
            draggable
            onDragStart={event => handleDragStart(event, shape.id)}
            onDragEnd={handleDragEnd}
          >
            <div className="shape-card__heading">
              <h3>{shape.name}</h3>
              {shape.sampleWord && <span className="shape-card__tag">{shape.sampleWord}</span>}
            </div>
            <ShapePreview shape={shape} />
            <p className="shape-card__description">{shape.description}</p>
            {shape.tags && shape.tags.length > 0 && (
              <div className="shape-card__tags">
                {shape.tags.map(tag => (
                  <span key={tag} className="shape-card__badge">{tag}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ShapePalette;


