import React from 'react';
import { useAppStore } from '../store';

const ThemePanel: React.FC = () => {
  const {
    themeWords,
    placedThemeWords,
    addPlacedThemeWord,
  } = useAppStore();

  const handlePlaceWord = (word: string) => {
    addPlacedThemeWord(word);
    // In a full implementation, this would trigger auto-placement logic
    console.log(`Placing theme word: ${word}`);
  };

  return (
    <div>
      <h3>Theme Words</h3>
      
      <div className="status">
        <p>Available theme words: {themeWords.length}</p>
        <p>Placed theme words: {placedThemeWords.size}</p>
      </div>

      <div>
        <h4>Available Theme Words</h4>
        <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
          {themeWords.map((word, index) => (
            <div
              key={index}
              className="candidate-item"
              onClick={() => handlePlaceWord(word)}
              style={{
                opacity: placedThemeWords.has(word) ? 0.5 : 1,
                cursor: placedThemeWords.has(word) ? 'default' : 'pointer',
              }}
            >
              <span className="candidate-word">{word}</span>
              {placedThemeWords.has(word) && (
                <span style={{ color: 'green' }}>✓ Placed</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4>Auto-Placement</h4>
        <p>Click on theme words to place them in symmetric positions.</p>
        <p>Words will be placed in center rows/columns or mirrored positions.</p>
      </div>
    </div>
  );
};

export default ThemePanel;
