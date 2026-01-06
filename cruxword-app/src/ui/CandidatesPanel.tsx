import React, { useState } from 'react';
import { useAppStore } from '../store';

const CandidatesPanel: React.FC = () => {
  const {
    candidates,
    focusedCell,
    slots,
    setCellLetter,
  } = useAppStore();
  
  const [localActiveTab, setLocalActiveTab] = useState<'candidates' | 'shapes'>('candidates');
  const [selectedCandidate, setSelectedCandidate] = useState<typeof candidates[0] | null>(null);

  const handleCandidateClick = (candidate: typeof candidates[0]) => {
    if (!focusedCell) return;

    // Find the slot that contains the focused cell
    const slot = slots.find(s => {
      return s.cells.some(cell => cell.r === focusedCell.row && cell.c === focusedCell.col);
    });

    if (!slot) return;

    // Fill the entire slot with the word
    const word = candidate.word.toLowerCase();
    for (let i = 0; i < Math.min(word.length, slot.cells.length); i++) {
      const cell = slot.cells[i];
      setCellLetter(cell.r, cell.c, word[i]);
    }
    
    // Show segment shapes for this candidate
    setSelectedCandidate(candidate);
    setLocalActiveTab('shapes');
  };

  const focusedSlot = focusedCell ? slots.find(s => {
    return s.cells.some(cell => cell.r === focusedCell.row && cell.c === focusedCell.col);
  }) : null;

  return (
    <div>
      <h3>Candidates</h3>
      
      <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
        <button 
          className={`btn ${localActiveTab === 'candidates' ? 'primary' : ''}`}
          onClick={() => setLocalActiveTab('candidates')}
        >
          Word Candidates
        </button>
        <button 
          className={`btn ${localActiveTab === 'shapes' ? 'primary' : ''}`}
          onClick={() => setLocalActiveTab('shapes')}
        >
          Segment Shapes
        </button>
      </div>

      {localActiveTab === 'candidates' ? (
        !focusedCell ? (
          <p>Click on a cell to see word candidates</p>
        ) : !focusedSlot ? (
          <p>No valid slot at this position</p>
        ) : (
          <div>
            <p>
              <strong>Slot:</strong> {focusedSlot.dir === 'A' ? 'ACROSS' : 'DOWN'} {focusedSlot.length} letters
            </p>
            <p>
              <strong>Pattern:</strong> {focusedSlot.pattern.toUpperCase()}
            </p>
            <p>
              <strong>Candidates:</strong> {candidates.length}
            </p>
            
            <div className="candidates-list">
              {candidates.map((candidate, index) => (
                <div
                  key={index}
                  className="candidate-item"
                  onClick={() => handleCandidateClick(candidate)}
                  style={{ cursor: 'pointer' }}
                >
                  <div>
                    <span className="candidate-word">{candidate.word}</span>
                    <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
                      Seg: {candidate.segScore.toFixed(2)} | 
                      Zipf: {candidate.zipf.toFixed(2)} | 
                      Cross: {(candidate.crossingBonus * 100).toFixed(0)}% | 
                      Total: {candidate.score.toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      ) : (
        <div>
          {selectedCandidate ? (
            <div>
              <p>
                <strong>Word:</strong> {selectedCandidate.word}
              </p>
              <p>
                <strong>Segmentation:</strong> {selectedCandidate.bestSegments.join(' | ')}
              </p>
              <p>
                <strong>Segment Score:</strong> {selectedCandidate.segScore.toFixed(2)}
              </p>
              <p>
                <strong>Zipf:</strong> {selectedCandidate.zipf.toFixed(2)}
              </p>
              <p>
                <strong>Crossing Bonus:</strong> {(selectedCandidate.crossingBonus * 100).toFixed(0)}%
              </p>
              <p>
                <strong>Total Score:</strong> {selectedCandidate.score.toFixed(2)}
              </p>
              <button 
                className="btn"
                onClick={() => {
                  setSelectedCandidate(null);
                  setLocalActiveTab('candidates');
                }}
                style={{ marginTop: '10px' }}
              >
                Back to Candidates
              </button>
            </div>
          ) : (
            <p>Click a candidate to see its segment shape</p>
          )}
        </div>
      )}
    </div>
  );
};

export default CandidatesPanel;
