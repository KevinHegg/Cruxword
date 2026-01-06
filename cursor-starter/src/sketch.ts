import p5 from 'p5';
import { loadBasellex, loadPlayDict, loadSegments } from './game/data/loaders';

const GRID_COLS = 10;
const GRID_ROWS = 20;
const CELL = 28;

let ready = false;

new p5((s: p5) => {
  s.setup = async () => {
    const canvas = s.createCanvas(GRID_COLS * CELL, GRID_ROWS * CELL);
    const parent = document.getElementById('app'); if (parent) canvas.parent(parent);

    const [basellex, playdict, segments] = await Promise.all([
      loadBasellex(),
      loadPlayDict(),
      loadSegments(),
    ]);
    console.log('basellex rows:', basellex.length);
    console.log('playdict rows:', playdict.length);
    console.log('segments rows:', segments.length);

    ready = true;
  };

  s.draw = () => {
    s.background(250);
    s.stroke(220);
    for (let c = 0; c <= GRID_COLS; c++) s.line(c * CELL, 0, c * CELL, GRID_ROWS * CELL);
    for (let r = 0; r <= GRID_ROWS; r++) s.line(0, r * CELL, GRID_COLS * CELL, r * CELL);

    if (ready) {
      s.noStroke();
      s.fill(60);
      for (let i = 0; i < 4; i++) {
        s.rect((3 + i) * CELL + 1, 2 * CELL + 1, CELL - 2, CELL - 2, 4);
      }
    }
  };
});
