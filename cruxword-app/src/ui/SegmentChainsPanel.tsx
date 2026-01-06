import { useAppStore } from '../store';
import type { SegmentChain } from '../segments/types';

const SegmentChainsPanel: React.FC = () => {
  const { segmentChains, focusedCell, slots, commitSegmentChain } = useAppStore();

  const focusedSlot = focusedCell
    ? slots.find(s => {
        if (s.direction === 'across') {
          return (
            s.startRow === focusedCell.row &&
            s.startCol !== undefined &&
            focusedCell.col >= s.startCol &&
            focusedCell.col < s.startCol + s.length
          );
        } else {
          return (
            s.startCol === focusedCell.col &&
            s.startRow !== undefined &&
            focusedCell.row >= s.startRow &&
            focusedCell.row < s.startRow + s.length
          );
        }
      })
    : null;

  const handleChainClick = (chain: SegmentChain) => {
    if (!focusedSlot) return;
    commitSegmentChain(chain, focusedSlot);
  };

  const renderLifespanDots = (lifespans: number[]) => {
    return lifespans.map((count, idx) => {
      const dots = [];
      for (let i = 0; i < 3; i++) {
        dots.push(
          <span
            key={`${idx}-${i}`}
            style={{
              color: i < count ? '#4caf50' : '#ddd',
              fontSize: '12px',
              marginRight: '2px',
            }}
          >
            ●
          </span>
        );
      }
      return (
        <span key={idx} style={{ marginRight: '6px', whiteSpace: 'nowrap' }}>
          {dots}
        </span>
      );
    });
  };

  if (!focusedCell) {
    return (
      <div>
        <h3>Segment Chains</h3>
        <p>Click on a cell to see segment-based fill suggestions.</p>
      </div>
    );
  }

  if (!focusedSlot) {
    return (
      <div>
        <h3>Segment Chains</h3>
        <p>No valid slot at this position.</p>
      </div>
    );
  }

  return (
    <div>
      <h3>Segment Chains</h3>
      <div style={{ marginBottom: '12px' }}>
        <p style={{ fontSize: '13px', color: '#555' }}>
          <strong>Slot:</strong> {focusedSlot.direction} {focusedSlot.length} letters
        </p>
        <p style={{ fontSize: '13px', color: '#555' }}>
          <strong>Pattern:</strong> {focusedSlot.pattern}
        </p>
        <p style={{ fontSize: '13px', color: '#555' }}>
          <strong>Chains:</strong> {segmentChains.length}
        </p>
      </div>

      <div style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>
        Lifespan: <span style={{ color: '#4caf50' }}>●●● = 3 uses</span>,{' '}
        <span style={{ color: '#ddd' }}>○○○ = 0 (unavailable)</span>
      </div>

      <div className="segment-chains-list" style={{ maxHeight: '500px', overflowY: 'auto' }}>
        {segmentChains.map((chain, index) => (
          <div
            key={index}
            className="segment-chain-item"
            onClick={() => handleChainClick(chain)}
            style={{
              padding: '10px',
              borderBottom: '1px solid #eee',
              cursor: chain.usesOK ? 'pointer' : 'not-allowed',
              background: chain.usesOK ? 'transparent' : '#f9f9f9',
              opacity: chain.usesOK ? 1 : 0.6,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontWeight: 'bold', fontSize: '16px', letterSpacing: '1px' }}>
                {chain.letters}
              </span>
              <span style={{ fontSize: '13px', color: '#666' }}>
                {chain.score.toFixed(2)}
              </span>
            </div>

            <div style={{ fontSize: '13px', color: '#555', marginBottom: '6px' }}>
              {chain.chain.join(' | ')}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {renderLifespanDots(chain.perSegmentLifespan)}
            </div>

            {!chain.usesOK && (
              <div style={{ fontSize: '11px', color: '#d32f2f', marginTop: '4px' }}>
                Some segments are out of stock
              </div>
            )}
          </div>
        ))}

        {segmentChains.length === 0 && (
          <p style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
            No segment chains found for this pattern.
          </p>
        )}
      </div>
    </div>
  );
};

export default SegmentChainsPanel;

