<script lang="ts">
  import { onMount } from "svelte";

  const GRID = 10;

  type Orientation = "H" | "V";

  type Piece = {
    id: string;
    text: string;
    letters: string[];
    o: Orientation;
  };

  type Cell = string | null;

  const mkId = () => Math.random().toString(36).slice(2, 10);

  // -----------------------------
  // Board state (with counts so we can UNDO safely)
  // -----------------------------
  let board: Cell[] = Array(GRID * GRID).fill(null);
  let counts: number[] = Array(GRID * GRID).fill(0); // how many placements cover this cell

  type Placement = { piece: Piece; r0: number; c0: number };
  let history: Placement[] = [];

  // -----------------------------
  // Bag
  // -----------------------------
  let bag: Piece[] = [];

  function seedBag() {
    const samples = [
      "PLAY",
      "ED",
      "ING",
      "RE",
      "UN",
      "TION",
      "MENT",
      "ABLE",
      "IZE",
      "PRE",
      "POST",
      "OVER",
      "UNDER",
      "SUB",
      "TRANS",
      "INTER",
      "S",
      "ES",
      "ER",
      "EST",
      "LY",
      "NESS",
      "FUL",
      "LESS",
      "LOG",
      "GRAPH",
      "CHRON",
      "BIO",
      "MICRO",
      "MACRO",
      "ARC",
      "CIV",
      "DATA",
      "CODE",
      "MIND",
      "NEUR",
      "STAR",
      "DUST",
      "CRUX",
      "WORD",
      "RUSH"
    ];

    // explode into 1–5 chunks for MVP
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

    const pick: string[] = [];
    while (pick.length < 36) pick.push(exploded[Math.floor(Math.random() * exploded.length)]);

    bag = pick.map((text) => ({
      id: mkId(),
      text,
      letters: text.split(""),
      o: "H"
    }));
  }

  // -----------------------------
  // Helpers
  // -----------------------------
  const idx = (r: number, c: number) => r * GRID + c;
  const inBounds = (r: number, c: number) => r >= 0 && r < GRID && c >= 0 && c < GRID;

  function boardHasAnyTiles() {
    return board.some((x) => x !== null);
  }

  function pieceCellsAt(piece: Piece, r0: number, c0: number) {
    const cells: { r: number; c: number; ch: string }[] = [];
    for (let i = 0; i < piece.letters.length; i++) {
      const r = piece.o === "H" ? r0 : r0 + i;
      const c = piece.o === "H" ? c0 + i : c0;
      cells.push({ r, c, ch: piece.letters[i] });
    }
    return cells;
  }

  function touchesExistingByAdjacency(cells: { r: number; c: number }[]) {
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

    for (const { r, c } of cells) {
      if (!inBounds(r, c)) return { ok: false, reason: "Out of bounds" };
    }

    // overlap rules:
    // - may overlap matching letters
    // - max 1 overlap cell
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
    // - if empty board, allow anywhere
    // - else must touch by adjacency OR overlap
    if (!boardHasAnyTiles()) return { ok: true, reason: "" };

    const coords = cells.map(({ r, c }) => ({ r, c }));
    const hasAdj = touchesExistingByAdjacency(coords);
    const hasOverlap = overlaps === 1;

    if (!hasAdj && !hasOverlap) return { ok: false, reason: "Must connect" };
    return { ok: true, reason: "" };
  }

  function placePiece(piece: Piece, r0: number, c0: number) {
    const v = validatePlacement(piece, r0, c0);
    if (!v.ok) return false;

    const cells = pieceCellsAt(piece, r0, c0);

    for (const { r, c, ch } of cells) {
      const i = idx(r, c);
      if (board[i] === null) board[i] = ch;
      counts[i] += 1;
    }

    history = [...history, { piece: { ...piece }, r0, c0 }];
    bag = bag.filter((p) => p.id !== piece.id);
    return true;
  }

  function undo() {
    const last = history[history.length - 1];
    if (!last) return;

    const cells = pieceCellsAt(last.piece, last.r0, last.c0);
    for (const { r, c } of cells) {
      const i = idx(r, c);
      counts[i] = Math.max(0, counts[i] - 1);
      if (counts[i] === 0) board[i] = null;
    }

    history = history.slice(0, -1);
    bag = [{ ...last.piece, id: mkId() }, ...bag]; // return to bag as a new instance
    // note: returning as new ID avoids keyed list weirdness
  }

  function rotatePiece(piece: Piece) {
    piece.o = piece.o === "H" ? "V" : "H";
    // update bag array immutably
    bag = bag.map((p) => (p.id === piece.id ? { ...piece } : p));
    if (selected?.id === piece.id) selected = { ...piece };
    if (activeDrag?.id === piece.id) activeDrag = { ...piece };
  }

  function resetAll() {
    board = Array(GRID * GRID).fill(null);
    counts = Array(GRID * GRID).fill(0);
    history = [];
    selected = null;
    closeHelp();
    seedBag();
  }

  // -----------------------------
  // UI state
  // -----------------------------
  let showHelp = false;
  function openHelp() {
    showHelp = true;
  }
  function closeHelp() {
    showHelp = false;
  }

  // Tap-to-pick / tap-to-place
  let selected: Piece | null = null;
  let toast = "";

  function setToast(msg: string) {
    toast = msg;
    window.setTimeout(() => {
      if (toast === msg) toast = "";
    }, 1100);
  }

  // Board tapping: if selected piece, place on tapped cell
  let boardEl: HTMLDivElement | null = null;

  function getBoardRCFromClientXY(x: number, y: number) {
    const rect = boardEl?.getBoundingClientRect();
    if (!rect) return null;

    const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    if (!inside) return null;

    const cellSize = rect.width / GRID;
    const c = Math.floor((x - rect.left) / cellSize);
    const r = Math.floor((y - rect.top) / cellSize);
    if (!inBounds(r, c)) return null;
    return { r, c };
  }

  function onBoardPointerDown(e: PointerEvent) {
    if (!selected) return;
    // ignore if currently dragging something
    if (dragging) return;

    const rc = getBoardRCFromClientXY(e.clientX, e.clientY);
    if (!rc) return;

    const ok = placePiece(selected, rc.r, rc.c);
    if (!ok) setToast("Illegal placement");
    else {
      setToast("Placed");
      selected = null;
    }
  }

  // -----------------------------
  // Long-press drag from bag (prevents iOS double-tap zoom problems)
  // -----------------------------
  let activeDrag: Piece | null = null;
  let dragging = false;

  let holdTimer: number | null = null;
  let holdArmed = false;

  let startX = 0;
  let startY = 0;
  let curX = 0;
  let curY = 0;

  let hoverRC: { r: number; c: number } | null = null;
  let hoverValid = false;
  let hoverReason = "";

  function beginHold(e: PointerEvent, piece: Piece) {
    // quick tap selects; press+hold starts drag
    startX = e.clientX;
    startY = e.clientY;
    curX = e.clientX;
    curY = e.clientY;

    holdArmed = true;
    activeDrag = { ...piece };

    holdTimer = window.setTimeout(() => {
      if (!holdArmed || !activeDrag) return;
      dragging = true;
      // once dragging, prevent page gestures
      hoverRC = null;
      hoverValid = false;
      hoverReason = "";
    }, 220);

    window.addEventListener("pointermove", onHoldMove, { passive: false });
    window.addEventListener("pointerup", onHoldUp, { passive: false });
    window.addEventListener("pointercancel", onHoldUp, { passive: false });
  }

  function onHoldMove(e: PointerEvent) {
    curX = e.clientX;
    curY = e.clientY;

    // if finger moved a lot before drag begins, cancel hold (so it's a scroll)
    const dx = Math.abs(curX - startX);
    const dy = Math.abs(curY - startY);
    if (!dragging && holdArmed && (dx > 10 || dy > 10)) {
      // allow bag scrolling without accidentally starting drag
      cancelHold();
      return;
    }

    if (!dragging || !activeDrag) return;

    e.preventDefault();

    const rc = getBoardRCFromClientXY(e.clientX, e.clientY);
    if (!rc) {
      hoverRC = null;
      hoverValid = false;
      hoverReason = "Drop on board";
      return;
    }
    hoverRC = rc;

    const v = validatePlacement(activeDrag, rc.r, rc.c);
    hoverValid = v.ok;
    hoverReason = v.reason;
  }

  function onHoldUp(e: PointerEvent) {
    if (dragging && activeDrag && hoverRC && hoverValid) {
      placePiece(activeDrag, hoverRC.r, hoverRC.c);
      setToast("Placed");
      selected = null;
    } else if (!dragging && activeDrag) {
      // it was a tap (not a long-press): select/deselect
      if (selected?.id === activeDrag.id) selected = null;
      else selected = { ...activeDrag };
    }

    cancelHold();
  }

  function cancelHold() {
    holdArmed = false;

    if (holdTimer) window.clearTimeout(holdTimer);
    holdTimer = null;

    dragging = false;
    activeDrag = null;

    hoverRC = null;
    hoverValid = false;
    hoverReason = "";

    window.removeEventListener("pointermove", onHoldMove as any);
    window.removeEventListener("pointerup", onHoldUp as any);
    window.removeEventListener("pointercancel", onHoldUp as any);
  }

  // -----------------------------
  // Derived
  // -----------------------------
  $: placedCount = board.filter(Boolean).length;
  $: density = Math.round((placedCount / (GRID * GRID)) * 100);

  onMount(() => {
    seedBag();
  });
</script>

<div class="wrap">
  <!-- Compact header: keep everything tight so the 10x10 can fit -->
  <header class="topbar">
    <div class="brandRow">
      <div class="brandLeft">
        <div class="brand">CRUXWORD</div>
        <div class="tagline">Morpheme Rush, a daily workout for your brain.</div>
      </div>

      <div class="brandRight">
        <button class="iconBtn" on:click={openHelp} aria-label="Help">?</button>
      </div>
    </div>

    <div class="statsRow">
      <div class="pill"><span>Tiles</span><b>{placedCount}/100</b></div>
      <div class="pill"><span>Density</span><b>{density}%</b></div>
      <div class="pill"><span>Bag</span><b>{bag.length}</b></div>

      <div class="actions">
        <button class="btn" on:click={undo} disabled={history.length === 0}>Undo</button>
        <button class="btn" on:click={resetAll}>Reset</button>
      </div>
    </div>
  </header>

  <!-- Board takes remaining height (no vertical scroll) -->
  <main class="main">
    <section class="boardCard">
      <div class="boardWrap">
        <div
          class="board"
          bind:this={boardEl}
          on:pointerdown={onBoardPointerDown}
          aria-label="10 by 10 board"
        >
          {#each Array(GRID * GRID) as _, i}
            <div class="cell {board[i] ? 'filled' : ''}">
              {#if board[i]}{board[i]}{/if}
            </div>
          {/each}

          {#if dragging && activeDrag && hoverRC}
            {#each pieceCellsAt(activeDrag, hoverRC.r, hoverRC.c) as ccell (ccell.r + '-' + ccell.c)}
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

      <!-- tiny status line only when needed -->
      <div class="microStatus">
        {#if selected}
          <span class="sel">Selected: <b>{selected.text}</b> ({selected.o})</span>
          <span class="sep">•</span>
          <span>Tap board to place, or press+hold a bag piece to drag.</span>
        {:else if dragging && activeDrag}
          {#if hoverRC}
            {#if hoverValid}
              ✅ Release to place
            {:else}
              ⛔ {hoverReason}
            {/if}
          {:else}
            ⬇️ Drop on board
          {/if}
        {:else}
          <span class="dim">Tap a bag stick to select. Press+hold to drag.</span>
        {/if}
      </div>
    </section>

    <!-- Bag: fixed-height drawer, horizontal scroll only -->
    <section class="bagCard">
      <div class="bagHeader">
        <div class="bagTitle">Morpheme Bag</div>
        <div class="bagNote">Tap selects • Hold drags • Rotate button</div>
      </div>

      <div class="bag">
        {#each bag as p (p.id)}
          <div class="stick {selected?.id === p.id ? 'selected' : ''}">
            <div class="stickTop">
              <div class="meta">
                <span class="badge">{p.letters.length}</span>
                <span class="badge">{p.o}</span>
                <span class="text">{p.text}</span>
              </div>

              <button class="rotBtn" on:click={() => rotatePiece({ ...p })} aria-label="Rotate">
                ↻
              </button>
            </div>

            <div
              class="tiles {p.o === 'V' ? 'v' : 'h'}"
              on:pointerdown={(e) => beginHold(e, p)}
              role="button"
              tabindex="0"
              aria-label={"Stick " + p.text}
            >
              {#each p.letters as ch, j (p.id + '-' + j)}
                <div class="tile">{ch}</div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </section>
  </main>

  {#if toast}
    <div class="toast" aria-live="polite">{toast}</div>
  {/if}

  {#if showHelp}
    <div class="modalBackdrop" on:click={closeHelp}>
      <div class="modal" on:click|stopPropagation>
        <div class="modalTitle">How to play</div>
        <ul class="modalList">
          <li><b>Tap</b> a stick in the bag to select it, then <b>tap the board</b> to place.</li>
          <li><b>Press + hold</b> a stick to drag it, release to drop.</li>
          <li>Rotate with the ↻ button (no double-tap zoom headaches).</li>
          <li>After the first placement, every stick must <b>connect</b> (touch or overlap 1 matching letter).</li>
          <li>Overlap allowed only if the letter matches, and max <b>1 overlap</b> per stick.</li>
        </ul>
        <div class="modalActions">
          <button class="btn" on:click={closeHelp}>Close</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  :global(html, body) {
    height: 100%;
  }

  :global(body) {
    margin: 0;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    color: #eef1ff;

    background:
      radial-gradient(circle at 12% 18%, rgba(120,170,255,0.10), transparent 38%),
      radial-gradient(circle at 75% 35%, rgba(255,255,255,0.06), transparent 40%),
      radial-gradient(circle at 40% 85%, rgba(120,170,255,0.08), transparent 45%),
      linear-gradient(180deg, #070a12 0%, #0b1222 55%, #070a12 100%);

    overflow: hidden; /* no vertical scrolling */
    -webkit-text-size-adjust: 100%;
  }

  /* Reduce iOS gesture weirdness */
  :global(*) {
    -webkit-tap-highlight-color: transparent;
  }

  .wrap {
    height: 100svh;
    max-width: 720px;
    margin: 0 auto;
    padding: 10px;
    box-sizing: border-box;

    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* ---------------- Header (tight) ---------------- */
  .topbar {
    flex: 0 0 auto;
    display: grid;
    gap: 6px;
  }

  .brandRow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .brandLeft {
    min-width: 0;
  }

  .brand {
    font-weight: 950;
    letter-spacing: 0.14em;
    font-size: 1.02rem;
    line-height: 1.05;
    white-space: nowrap;
  }

  .tagline {
    font-size: 0.92rem;
    opacity: 0.85;
    line-height: 1.1;
    margin-top: 2px;
  }

  /* Hide tagline on short screens to fit board */
  @media (max-height: 760px) {
    .tagline { display: none; }
  }

  .brandRight {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .iconBtn {
    width: 38px;
    height: 38px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(255,255,255,0.10);
    color: #eef1ff;
    font-weight: 950;
    font-size: 1.05rem;
    touch-action: manipulation;
  }

  .statsRow {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .pill {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    padding: 6px 10px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(0,0,0,0.18);
    font-size: 0.90rem;
  }

  .pill span { opacity: 0.85; }
  .pill b { font-weight: 950; }

  .actions {
    margin-left: auto;
    display: flex;
    gap: 8px;
  }

  .btn {
    padding: 7px 12px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(255,255,255,0.10);
    color: #eef1ff;
    font-weight: 900;
    touch-action: manipulation;
  }

  .btn:disabled {
    opacity: 0.45;
  }

  /* ---------------- Main layout ---------------- */
  .main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Board card takes most of the height */
  .boardCard {
    flex: 1;
    min-height: 0;

    padding: 8px;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(0,0,0,0.14);

    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .boardWrap {
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
  }

  /* Square board that fits available height AND width */
  .board {
    width: 100%;
    max-width: min(calc(100vw - 20px), 560px);
    height: 100%;
    max-height: 100%;
    aspect-ratio: 1 / 1;

    display: grid;
    grid-template-columns: repeat(10, 1fr);
    gap: clamp(2px, 0.6vw, 4px);

    position: relative;
    border-radius: 14px;

    /* subtle frame + "grid outline" */
    outline: 1px solid rgba(255,255,255,0.10);
    outline-offset: 6px;
    touch-action: manipulation;
  }

  /* Make tiles SQUARE, not tall */
  .cell {
    aspect-ratio: 1 / 1;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(0,0,0,0.22);
    color: #f1f4ff;
    font-weight: 950;

    /* Scale font to tile size */
    font-size: clamp(14px, 3.7vw, 26px);

    display: grid;
    place-items: center;
    user-select: none;
  }

  .cell.filled {
    background: rgba(255,255,255,0.11);
    border-color: rgba(255,255,255,0.20);
  }

  .ghost {
    position: absolute;
    display: grid;
    place-items: center;
    border-radius: 12px;
    font-weight: 950;
    font-size: clamp(14px, 3.7vw, 26px);
    pointer-events: none;
    user-select: none;
  }

  .ghost.ok {
    background: rgba(90,255,170,0.16);
    border: 1px solid rgba(90,255,170,0.35);
    color: #eafff5;
  }

  .ghost.bad {
    background: rgba(255,90,120,0.14);
    border: 1px solid rgba(255,90,120,0.32);
    color: #fff0f4;
  }

  .microStatus {
    flex: 0 0 auto;
    font-size: 0.84rem;
    opacity: 0.90;
    line-height: 1.15;
    padding: 2px 2px 0;
  }

  .dim { opacity: 0.72; }
  .sel b { font-weight: 950; }
  .sep { opacity: 0.6; margin: 0 6px; }

  /* ---------------- Bag drawer (compact) ---------------- */
  .bagCard {
    flex: 0 0 auto;

    padding: 8px;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(0,0,0,0.14);

    /* keep it short so board can fit */
    max-height: 22svh;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .bagHeader {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }

  .bagTitle {
    font-weight: 950;
    letter-spacing: 0.04em;
  }

  .bagNote {
    font-size: 0.84rem;
    opacity: 0.80;
    text-align: right;
  }

  .bag {
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;

    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: max-content;
    gap: 8px;

    padding-bottom: 2px;
  }

  .stick {
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(0,0,0,0.18);
    padding: 8px;
    min-width: 116px;
  }

  .stick.selected {
    border-color: rgba(120,170,255,0.6);
    box-shadow: 0 0 0 2px rgba(120,170,255,0.18) inset;
  }

  .stickTop {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }

  .meta {
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
  }

  .badge {
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.07);
    font-weight: 950;
    font-size: 0.86rem;
  }

  .text {
    font-weight: 950;
    letter-spacing: 0.06em;
    opacity: 0.92;
    white-space: nowrap;
  }

  .rotBtn {
    width: 34px;
    height: 34px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(255,255,255,0.10);
    color: #eef1ff;
    font-weight: 950;
    touch-action: manipulation;
  }

  .tiles {
    display: flex;
    gap: 6px;
    align-items: center;
    user-select: none;

    /* critical: prevents iOS zoom/scroll fight while holding */
    touch-action: none;
  }

  .tiles.v {
    flex-direction: column;
    align-items: flex-start;
  }

  .tile {
    width: 30px;
    height: 30px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.16);
    background: rgba(255,255,255,0.09);
    display: grid;
    place-items: center;
    font-weight: 950;
    font-size: 1.0rem;
    color: #f1f4ff;
  }

  /* ---------------- Toast ---------------- */
  .toast {
    position: fixed;
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(0,0,0,0.70);
    color: #eef1ff;
    font-weight: 900;
    z-index: 50;
    pointer-events: none;
  }

  /* ---------------- Help modal ---------------- */
  .modalBackdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.55);
    display: grid;
    place-items: center;
    padding: 14px;
    z-index: 100;
  }

  .modal {
    width: min(520px, 100%);
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(10,16,30,0.96);
    padding: 14px;
  }

  .modalTitle {
    font-weight: 950;
    font-size: 1.05rem;
    margin-bottom: 10px;
  }

  .modalList {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 8px;
    opacity: 0.92;
    line-height: 1.2;
  }

  .modalActions {
    margin-top: 12px;
    display: flex;
    justify-content: flex-end;
  }
</style>
