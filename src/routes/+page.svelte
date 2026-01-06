<script lang="ts">
  import { onMount } from "svelte";

  const GRID = 10;

  type Orientation = "H" | "V";

  type Piece = {
    id: string;
    text: string;          // e.g., "PLAY" or "ED"
    letters: string[];     // ["P","L","A","Y"]
    o: Orientation;
  };

  type Cell = string | null;

  const mkId = () => Math.random().toString(36).slice(2, 10);

  // --- Board ---
  let board: Cell[] = Array(GRID * GRID).fill(null);

  // --- Bag (sample morpheme-ish sticks) ---
  let bag: Piece[] = [];
  function seedBag() {
    const samples = [
      "PLAY", "ED", "ING", "RE", "UN", "TION", "MENT", "ABLE", "IZE",
      "PRE", "POST", "OVER", "UNDER", "SUB", "TRANS", "INTER",
      "S", "ES", "ER", "EST", "LY", "NESS", "FUL", "LESS",
      "LOG", "GRAPH", "CHRON", "BIO", "MICRO", "MACRO",
      "ARC", "CIV", "DATA", "CODE", "MIND", "NEUR",
      "STAR", "DUST", "CRUX", "WORD", "RUSH"
    ];

    // keep 1–5 length sticks only for MVP view; split longer chunks into 5s
    const exploded: string[] = [];
    for (const t of samples) {
      if (t.length <= 5) exploded.push(t);
      else {
        let s = t;
        while (s.length > 0) {
          exploded.push(s.slice(0, 5));
          s = s.slice(5);
        }
      }
    }

    // Make ~36 pieces
    const pick: string[] = [];
    while (pick.length < 36) {
      pick.push(exploded[Math.floor(Math.random() * exploded.length)]);
    }

    bag = pick.map((text) => ({
      id: mkId(),
      text,
      letters: text.split(""),
      o: "H"
    }));
  }

  // --- UI / drag state ---
  let boardEl: HTMLDivElement | null = null;
  let bagEl: HTMLDivElement | null = null;

  let active: Piece | null = null;
  let dragging = false;

  let pointerId: number | null = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragX = 0;
  let dragY = 0;

  let hoverRC: { r: number; c: number } | null = null;
  let hoverValid = false;
  let hoverReason = "";

  let lastTapTime = 0;

  // --- Helpers ---
  const idx = (r: number, c: number) => r * GRID + c;
  const inBounds = (r: number, c: number) => r >= 0 && r < GRID && c >= 0 && c < GRID;

  function boardHasAnyTiles() {
    return board.some((x) => x !== null);
  }

  function pieceCellsAt(piece: Piece, r0: number, c0: number) {
    // returns list of {r,c,letter} for the piece starting at (r0,c0) for its orientation
    const cells: { r: number; c: number; ch: string }[] = [];
    for (let i = 0; i < piece.letters.length; i++) {
      const r = piece.o === "H" ? r0 : r0 + i;
      const c = piece.o === "H" ? c0 + i : c0;
      cells.push({ r, c, ch: piece.letters[i] });
    }
    return cells;
  }

  function touchesExistingByAdjacency(cells: { r: number; c: number }[]) {
    // adjacency = shares an edge with any existing tile
    const dirs = [
      { dr: -1, dc: 0 },
      { dr: 1, dc: 0 },
      { dr: 0, dc: -1 },
      { dr: 0, dc: 1 }
    ];
    for (const { r, c } of cells) {
      for (const { dr, dc } of dirs) {
        const rr = r + dr;
        const cc = c + dc;
        if (!inBounds(rr, cc)) continue;
        if (board[idx(rr, cc)] !== null) return true;
      }
    }
    return false;
  }

  function validatePlacement(piece: Piece, r0: number, c0: number) {
    const cells = pieceCellsAt(piece, r0, c0);

    // bounds
    for (const { r, c } of cells) {
      if (!inBounds(r, c)) return { ok: false, reason: "Out of bounds" };
    }

    // overlap rules:
    // - you can overlap exactly matching letters
    // - at most 1 overlap cell
    // - cannot overwrite different letter
    let overlaps = 0;
    for (const { r, c, ch } of cells) {
      const cur = board[idx(r, c)];
      if (cur === null) continue;
      if (cur !== ch) return { ok: false, reason: "Conflicting letter" };
      overlaps++;
      if (overlaps > 1) return { ok: false, reason: "Too many overlaps (max 1)" };
    }

    // connectivity:
    // - if board empty, allow anywhere
    // - else must touch existing (adjacent) OR overlap (intersection)
    if (!boardHasAnyTiles()) return { ok: true, reason: "" };

    const coordsOnly = cells.map(({ r, c }) => ({ r, c }));
    const hasAdj = touchesExistingByAdjacency(coordsOnly);
    const hasOverlap = overlaps === 1;

    if (!hasAdj && !hasOverlap) return { ok: false, reason: "Must connect to existing tiles" };

    return { ok: true, reason: "" };
  }

  function placePiece(piece: Piece, r0: number, c0: number) {
    const cells = pieceCellsAt(piece, r0, c0);
    for (const { r, c, ch } of cells) {
      const i = idx(r, c);
      if (board[i] === null) board[i] = ch; // keep existing matching overlaps
    }
    bag = bag.filter((p) => p.id !== piece.id);
  }

  function rotatePiece(piece: Piece) {
    piece.o = piece.o === "H" ? "V" : "H";
    // force Svelte update
    bag = bag.map((p) => (p.id === piece.id ? { ...piece } : p));
    if (active?.id === piece.id) active = { ...piece };
  }

  function resetAll() {
    board = Array(GRID * GRID).fill(null);
    active = null;
    dragging = false;
    hoverRC = null;
    hoverValid = false;
    hoverReason = "";
    seedBag();
  }

  // --- Drag behavior ---
  function onPiecePointerDown(e: PointerEvent, piece: Piece) {
    // double-tap to rotate (mobile-friendly)
    const now = Date.now();
    if (now - lastTapTime < 280) {
      rotatePiece(piece);
      lastTapTime = 0;
      return;
    }
    lastTapTime = now;

    active = { ...piece };
    dragging = true;

    pointerId = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    dragStartX = e.clientX;
    dragStartY = e.clientY;

    dragX = e.clientX;
    dragY = e.clientY;

    hoverRC = null;
    hoverValid = false;
    hoverReason = "";

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { passive: false });
    window.addEventListener("pointercancel", onPointerUp, { passive: false });
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging || !active) return;
    dragX = e.clientX;
    dragY = e.clientY;

    // compute hover cell
    const rect = boardEl?.getBoundingClientRect();
    if (!rect) return;

    const inside =
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;

    if (!inside) {
      hoverRC = null;
      hoverValid = false;
      hoverReason = "Drop on the board";
      return;
    }

    const cellSize = rect.width / GRID;
    const c = Math.floor((e.clientX - rect.left) / cellSize);
    const r = Math.floor((e.clientY - rect.top) / cellSize);

    hoverRC = { r, c };
    const v = validatePlacement(active, r, c);
    hoverValid = v.ok;
    hoverReason = v.reason;
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging || !active) cleanupDrag();

    if (!dragging || !active) return;

    if (hoverRC && hoverValid) {
      placePiece(active, hoverRC.r, hoverRC.c);
    }

    cleanupDrag();
  }

  function cleanupDrag() {
    dragging = false;
    pointerId = null;
    active = null;
    hoverRC = null;
    hoverValid = false;
    hoverReason = "";

    window.removeEventListener("pointermove", onPointerMove as any);
    window.removeEventListener("pointerup", onPointerUp as any);
    window.removeEventListener("pointercancel", onPointerUp as any);
  }

  // --- Derived UI ---
  $: placedCount = board.filter(Boolean).length;
  $: density = Math.round((placedCount / (GRID * GRID)) * 100);

  onMount(() => {
    seedBag();
  });
</script>

<div class="wrap">
  <div class="topbar">
    <div class="titleRow">
      <div class="title">CRUXWORD</div>
      <div class="subtitle">Morpheme Rush, a daily workout for your brain.</div>
    </div>

    <div class="stats">
      <div class="pill"><span>Tiles</span><b>{placedCount}/100</b></div>
      <div class="pill"><span>Density</span><b>{density}%</b></div>
      <div class="pill"><span>Bag</span><b>{bag.length}</b></div>
      <button class="btn" on:click={resetAll}>Reset</button>
    </div>
  </div>

  <div class="main">
    <div class="boardCard">
      <div class="boardWrap">
        <div class="board" bind:this={boardEl} aria-label="10 by 10 board">
          {#each Array(GRID * GRID) as _, i}
            <div class="cell {board[i] ? 'filled' : ''}">
              {#if board[i]}
                {board[i]}
              {/if}
            </div>
          {/each}

          {#if dragging && active && hoverRC}
            <!-- Ghost overlay -->
            {#each pieceCellsAt(active, hoverRC.r, hoverRC.c) as ccell (ccell.r + '-' + ccell.c)}
              {#if inBounds(ccell.r, ccell.c)}
                <div
                  class="ghost {hoverValid ? 'ok' : 'bad'}"
                  style="
                    left: calc((100% / {GRID}) * {ccell.c});
                    top: calc((100% / {GRID}) * {ccell.r});
                    width: calc(100% / {GRID});
                    height: calc(100% / {GRID});
                  "
                >
                  {ccell.ch}
                </div>
              {/if}
            {/each}
          {/if}
        </div>
      </div>

      <div class="hint">
        <b>How to play:</b> Drag a stick onto the board. <b>Double-tap</b> a stick to rotate.
        {#if dragging && active}
          <span class="status">
            {#if hoverRC}
              {#if hoverValid}
                ✅ Place
              {:else}
                ⛔ {hoverReason}
              {/if}
            {:else}
              ⬇️ Drop on the board
            {/if}
          </span>
        {/if}
      </div>
    </div>

    <div class="bagCard">
      <div class="bagHeader">
        <div class="bagTitle">Morpheme Bag</div>
        <div class="bagNote">Scroll sideways. Double-tap to rotate.</div>
      </div>

      <div class="bag" bind:this={bagEl}>
        {#each bag as p (p.id)}
          <div
            class="stick"
            role="button"
            tabindex="0"
            on:pointerdown={(e) => onPiecePointerDown(e, p)}
          >
            <div class="stickMeta">
              <span class="len">{p.letters.length}</span>
              <span class="ori">{p.o}</span>
              <span class="text">{p.text}</span>
            </div>

            <div class="tiles {p.o === 'V' ? 'v' : 'h'}">
              {#each p.letters as ch, j (p.id + '-' + j)}
                <div class="tile">{ch}</div>
              {/each}
            </div>

            <div class="microHelp">Drag • Double-tap rotate</div>
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  :global(body){
    margin: 0;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    color: #eef1ff;

    /* constellation-ish background */
    background:
      radial-gradient(circle at 12% 18%, rgba(120,170,255,0.10), transparent 38%),
      radial-gradient(circle at 75% 35%, rgba(255,255,255,0.06), transparent 40%),
      radial-gradient(circle at 40% 85%, rgba(120,170,255,0.08), transparent 45%),
      linear-gradient(180deg, #070a12 0%, #0b1222 55%, #070a12 100%);
    overflow: hidden; /* prevents tiny accidental vertical scroll on iOS */
  }

  /* ---- iPhone-fit layout ---- */
  .wrap{
    max-width: 720px;
    margin: 0 auto;
    padding: 10px;
    box-sizing: border-box;

    height: 100svh;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .topbar{
    display: grid;
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .titleRow{
    display: grid;
    gap: 2px;
  }

  .title{
    font-weight: 900;
    letter-spacing: 0.12em;
    font-size: 1.05rem;
  }

  .subtitle{
    font-size: 0.90rem;
    opacity: 0.85;
    line-height: 1.15;
  }

  .stats{
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }

  .pill{
    display: inline-flex;
    gap: 6px;
    align-items: center;
    padding: 6px 10px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(0,0,0,0.18);
    font-size: 0.9rem;
  }

  .pill span{
    opacity: 0.85;
  }

  .pill b{
    font-weight: 900;
  }

  .btn{
    padding: 7px 12px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(255,255,255,0.10);
    color: #eef1ff;
    font-weight: 800;
  }

  .btn:active{
    transform: translateY(1px);
  }

  .main{
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
  }

  .boardCard{
    padding: 8px;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(0,0,0,0.14);
    flex: 0 0 auto;
  }

  .boardWrap{
    display: grid;
    place-items: center;
  }

  .board{
    --boardSize: min(calc(100vw - 20px), 52svh);
    --gap: clamp(2px, 0.6vw, 4px);

    width: var(--boardSize);
    height: var(--boardSize);
    margin: 0 auto;

    display: grid;
    grid-template-columns: repeat(10, 1fr);
    gap: var(--gap);

    position: relative;

    /* thin, barely-noticeable grid outline */
    outline: 1px solid rgba(255,255,255,0.10);
    outline-offset: 6px;
    border-radius: 14px;
  }

  .cell{
    border-radius: calc(var(--boardSize) / 10 * 0.22);
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.22);
    color: #f1f4ff;
    font-weight: 900;

    font-size: calc(var(--boardSize) / 10 * 0.56);

    display: grid;
    place-items: center;
    padding: 0;
    user-select: none;
  }

  .cell.filled{
    background: rgba(255, 255, 255, 0.11);
    border-color: rgba(255, 255, 255, 0.20);
  }

  .ghost{
    position: absolute;
    display: grid;
    place-items: center;
    border-radius: calc(var(--boardSize) / 10 * 0.22);
    font-weight: 900;
    font-size: calc(var(--boardSize) / 10 * 0.56);
    pointer-events: none;
    user-select: none;
    transform: translateZ(0);
  }

  .ghost.ok{
    background: rgba(90, 255, 170, 0.16);
    border: 1px solid rgba(90, 255, 170, 0.35);
    color: #eafff5;
  }

  .ghost.bad{
    background: rgba(255, 90, 120, 0.14);
    border: 1px solid rgba(255, 90, 120, 0.32);
    color: #fff0f4;
  }

  .hint{
    margin-top: 6px;
    font-size: 0.85rem;
    opacity: 0.92;
    line-height: 1.2;
  }

  .status{
    margin-left: 10px;
    font-weight: 800;
  }

  /* ---- Bag as bottom drawer ---- */
  .bagCard{
    padding: 8px;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(0,0,0,0.14);

    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .bagHeader{
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }

  .bagTitle{
    font-weight: 900;
    letter-spacing: 0.04em;
  }

  .bagNote{
    font-size: 0.85rem;
    opacity: 0.80;
    text-align: right;
  }

  .bag{
    flex: 1;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: max-content;
    gap: 8px;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 6px;
  }

  .stick{
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(0, 0, 0, 0.18);
    padding: 10px;
    min-width: 112px;
    touch-action: none; /* improves dragging on iOS */
    user-select: none;
  }

  .stick:active{
    transform: translateY(1px);
  }

  .stickMeta{
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 8px;
    opacity: 0.92;
    font-size: 0.9rem;
  }

  .len, .ori{
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.07);
    font-weight: 900;
  }

  .text{
    font-weight: 900;
    letter-spacing: 0.06em;
    opacity: 0.92;
  }

  .tiles{
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .tiles.v{
    flex-direction: column;
    align-items: flex-start;
  }

  .tile{
    width: 30px;
    height: 30px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.09);
    display: grid;
    place-items: center;
    font-weight: 900;
    font-size: 1.0rem;
    color: #f1f4ff;
  }

  .microHelp{
    margin-top: 8px;
    font-size: 0.78rem;
    opacity: 0.78;
  }

  @media (min-width: 480px){
    .board{
      --boardSize: min(520px, 58svh);
    }
  }
</style>
