import { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { loadPlaydict, loadBasellex, loadSegments } from './data/csvLoaders';
import { buildFillIndex } from './data/fillIndexer';
import { initializeLifespans } from './segments/loader';
import type { Segment } from './segments/types';
import Grid from './grid/Grid';
import CandidatesPanel from './ui/CandidatesPanel';
import WordlistsPanel from './ui/WordlistsPanel';
import ThemePanel from './ui/ThemePanel';
import ShapePalette from './ui/ShapePalette';
import SegmentChainsPanel from './ui/SegmentChainsPanel';

function App() {
  const { 
    setFillIndex, 
    setActiveTab, 
    activeTab,
    setThemeWords,
    setSegMap,
    setSegsByLength,
    setSegmentLifespans,
  } = useAppStore();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        
        console.log('Loading CSVs...');
        const [words, basellex, segMap] = await Promise.all([
          loadPlaydict(),
          loadBasellex(),
          loadSegments(),
        ]);
        
        console.log('playdict.csv words loaded:', words.length);
        console.log('basellex_v0.1.csv rows loaded:', basellex.size);
        console.log('segments.csv segments loaded:', segMap.size);
        
        const fillIndex = buildFillIndex(words, basellex, segMap);
        setFillIndex(fillIndex);
        
        // Initialize segment system
        setSegMap(segMap);
        
        // Build segsByLength index for efficient lookup
        const segsByLength = new Map<number, Segment[]>();
        for (const [text, seg] of segMap) {
          const len = text.length;
          if (!segsByLength.has(len)) {
            segsByLength.set(len, []);
          }
          segsByLength.get(len)!.push(seg);
        }
        setSegsByLength(segsByLength);
        
        const lifespans = initializeLifespans(segMap);
        setSegmentLifespans(lifespans);
        
        // Extract theme words from basellex
        const themeWords: string[] = [];
        basellex.forEach((row, word) => {
          if (row.theme_tags && row.theme_tags.trim()) {
            themeWords.push(word);
          }
        });
        setThemeWords(themeWords);
        
        console.log('Fill index built successfully');
        console.log('Theme words found:', themeWords.length);
      } catch (err) {
        console.error('Error loading data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }
    
    loadData();
    }, [setFillIndex, setThemeWords, setSegMap, setSegmentLifespans]);

  if (loading) {
    return (
      <div className="app">
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <h2>Loading CruxWord...</h2>
          <p>Loading wordlists and building index...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app">
        <div style={{ padding: '20px', textAlign: 'center', color: 'red' }}>
          <h2>Error</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="workspace">
        <div className="palette-container">
          <ShapePalette />
        </div>
        <div className="grid-container">
          <Grid />
        </div>
      </div>

      <div className="panel-container">
        <div className="panel-tabs">
          <button 
            className={`panel-tab ${activeTab === 'candidates' ? 'active' : ''}`}
            onClick={() => setActiveTab('candidates')}
          >
            Word Candidates
          </button>
          <button 
            className={`panel-tab ${activeTab === 'segments' ? 'active' : ''}`}
            onClick={() => setActiveTab('segments')}
          >
            Segment Chains
          </button>
          <button 
            className={`panel-tab ${activeTab === 'wordlists' ? 'active' : ''}`}
            onClick={() => setActiveTab('wordlists')}
          >
            Wordlists
          </button>
          <button 
            className={`panel-tab ${activeTab === 'theme' ? 'active' : ''}`}
            onClick={() => setActiveTab('theme')}
          >
            Theme
          </button>
        </div>
        
        <div className="panel-content">
          {activeTab === 'candidates' && <CandidatesPanel />}
          {activeTab === 'segments' && <SegmentChainsPanel />}
          {activeTab === 'wordlists' && <WordlistsPanel />}
          {activeTab === 'theme' && <ThemePanel />}
        </div>
      </div>
    </div>
  );
}

export default App;
