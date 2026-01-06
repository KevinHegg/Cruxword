import React from 'react';
import { useAppStore } from '../store';

const WordlistsPanel: React.FC = () => {
  const {
    fillIndex,
    filters,
    setFilters,
  } = useAppStore();

  if (!fillIndex) {
    return (
      <div>
        <h3>Wordlists</h3>
        <p>Loading canonical dictionary...</p>
      </div>
    );
  }

  const totalWords = fillIndex.words.length;
  const clueableWords = Array.from(fillIndex.basellex.values()).filter((w) => {
    const isClueable = String(w.flags || '').includes('clueable');
    return isClueable;
  }).length;
  const themeWords = Array.from(fillIndex.basellex.values()).filter((w) => {
    const isTheme = String(w.theme_tags || '').length > 0;
    return isTheme;
  }).length;
  const bannedWords = Array.from(fillIndex.basellex.values()).filter((w) => {
    const isBanned = String(w.flags || '').includes('banned');
    return isBanned;
  }).length;

  return (
    <div>
      <h3>Wordlists</h3>
      
      <div className="status">
        <h4>Canonical Dictionary</h4>
        <p>Total words: {totalWords.toLocaleString()}</p>
        <p>Clueable words: {clueableWords.toLocaleString()}</p>
        <p>Theme words: {themeWords.toLocaleString()}</p>
        <p>Banned words: {bannedWords.toLocaleString()}</p>
      </div>

      <div>
        <h4>Filters</h4>
        <label>
          <input
            type="checkbox"
            checked={filters.preferClueable}
            onChange={(e) => setFilters({ preferClueable: e.target.checked })}
          />
          Prefer clueable words
        </label>
        <br />
        <label>
          <input
            type="checkbox"
            checked={filters.preferLowFrequency}
            onChange={(e) => setFilters({ preferLowFrequency: e.target.checked })}
          />
          Prefer low-frequency words
        </label>
        <br />
        <label>
          <input
            type="checkbox"
            checked={filters.allowProperNouns}
            onChange={(e) => setFilters({ allowProperNouns: e.target.checked })}
          />
          Allow proper nouns
        </label>
      </div>

      <div>
        <h4>Word Length Distribution</h4>
        {Array.from(fillIndex.wordsByLen.entries())
          .sort(([a], [b]) => a - b)
          .map(([length, words]) => (
            <p key={length}>
              {length} letters: {words.length.toLocaleString()} words
            </p>
          ))}
      </div>
    </div>
  );
};

export default WordlistsPanel;
