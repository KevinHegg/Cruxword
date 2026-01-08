<script lang="ts">
  import { onMount } from "svelte";

  type Ori = "H" | "V";

  type Stick = {
    id: string;
    text: string; // morpheme/word-part (1–5 chars)
    ori: Ori; // placement orientation, never reverses letters
    used: boolean;
  };

  type Cell = string | null;

  const SIZE = 10;

  // ---------- Board ----------
  let board: Cell[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  let placedCount = 0;

  // ---------- Bag ----------
  // Replace these with your real bag generator later; keep 1–5 chars.
  const START_BAG: string[] = [
    "CRUX", "BIO", "OVER", "ARC", "LOGS", "WORD", "MIND", "NEUR", "UN", "RE",
    "MICRO", "META", "ION", "NESS", "ABLE", "ER", "ED", "ING", "ANTI", "PRO",
    "SUB", "HYPER", "LUX", "GIST", "CORE", "PIVOT", "CLUE", "KEY", "S", "T",
    "R", "D", "C", "A", "O", "U", "X"
  ]
    // ensure max length 5 for now (so it fits your 1–5 stick rule)
    .map(s => s.toUpperCase())
    .filter(s => s.length >= 1 && s.length <= 5);

  let bag: Stick[] = START_BAG.map((t, i) => ({
    id: `s${i}-${t}`,
    text: t,
    ori: "H",
    used: false
  }));

  // ---------- UI State ----------
  let selectedId: string | null = null;

  // board DOM + geometry
  let boardEl: HTMLDivElement | null = null;
  let boardRect: DOMRect | null = null;

  // drag state (press+hold on a bag stick)
  let dragging = false;
  let dragPointerId: number | null = null;
  let dragStickId: string | null = null;
  let ghostX = 0;
  let ghostY = 0;
  let ghostRow: number | null = null;
  let ghostCol: number | null = null;
  let ghostValid = false;
  let longPressTimer: any = null;
  let suppressTap = false;

  // ---------- Helpers ----------
  function densityPct() {
    return Math.round((placedCount / (SIZE * SIZE)) * 100);
  }

  function getStick(id: string | null) {
    if (!id) return null;
    return bag.find(b => b.id === id) ?? null;
  }

  function lettersFor(stick: Stick) {
    return stick.text.split("");
  }

  function boardIsEmpty() {
    return placedCount === 0;
  }

  function inBounds(r: number, c: number) {
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  }

  function computePlacement(stick: Stick, startR: number, startC: number) {
    const letters = lettersFor(stick);
    const coords: Array<{ r: number; c: number; ch: string }> = [];

    for (let i = 0; i < letters.length; i++) {
      const r = stick.ori === "H" ? startR : startR + i;
      const c = stick.ori === "H" ? startC + i : startC;
      if (!inBounds(r, c)) return null;
      coords.push({ r, c, ch: letters[i] });
    }
    return coords;
  }

  // Rules (MVP):
  // - Must fit in bounds
  // - Cells can be empty OR same letter
  // - If board not empty, placement must TOUCH existing tiles (adjacent) OR overlap (same letter)
  // - Overlap count must be <= 1 (your “one intersection tile” rule)
  function isLegalPlacement(stick: Stick, startR: number, startC: number) {
    const coords = computePlacement(stick, startR, startC);
    if (!coords) return { ok: false, coords: null };

    let overlapCount = 0;
    let touches = false;

    for (const { r, c, ch } of coords) {
      const existing = board[r][c];
      if (existing) {
        if (existing !== ch) return { ok: false, coords: null };
        overlapCount++;
      } else {
        // adjacency check (orthogonal neighbors)
        const nbrs = [
          [r - 1, c],
          [r + 1, c],
          [r, c - 1],
          [r, c + 1]
        ];
        for (const [rr, cc] of nbrs) {
          if (inBounds(rr, cc) && board[rr][cc]) {
            touches = true;
            break;
          }
        }
      }
    }

    if (overlapCount > 1) return { ok: false, coords: null };

    if (!boardIsEmpty()) {
      // must connect by touch or overlap
      if (!touches && overlapCount === 0) return { ok: false, coords: null };
    }

    return { ok: true, coords };
  }

  function placeStick(stick: Stick, startR: number, startC: number) {
    const res = isLegalPlacement(stick, startR, startC);
    if (!res.ok || !res.coords) return false;

    // apply
    let newlyFilled = 0;
    const next = board.map(row => row.slice());

    for (const { r, c, ch } of res.coords) {
      if (!next[r][c]) newlyFilled++;
      next[r][c] = ch;
    }

    board = next;
    placedCount += newlyFilled;

    // mark used (so it disappears / greys out in bag)
    bag = bag.map(s => (s.id === stick.id ? { ...s, used: true } : s));
    if (selectedId === stick.id) selectedId = null;

    return true;
  }

  function rotateStick(id: string) {
    bag = bag.map(s => (s.id === id ? { ...s, ori: s.ori === "H" ? "V" : "H" } : s));
  }

  function resetGame() {
    board = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
    placedCount = 0;
    selectedId = null;
    dragging = false;
    dragStickId = null;
    ghostRow = ghostCol = null;

    bag = START_BAG.map((t, i) => ({
      id: `s${i}-${t}`,
      text: t,
      ori: "H",
      used: false
    }));
  }

  function refreshBoardRect() {
    if (!boardEl) return;
    boardRect = boardEl.getBoundingClientRect();
  }

  function pointerToCell(x: number, y: number) {
    if (!boardRect) return { r: null, c: null };

    const px = x - boardRect.left;
    const py = y - boardRect.top;

    if (px < 0 || py < 0 || px > boardRect.width || py > boardRect.height) return { r: null, c: null };

    // board is 10x10, no internal padding, tiny gap
    const cellW = boardRect.width / SIZE;
    const cellH = boardRect.height / SIZE;

    const c = Math.floor(px / cellW);
    const r = Math.floor(py / cellH);

    if (!inBounds(r, c)) return { r: null, c: null };
    return { r, c };
  }

  // ---------- Bag interactions ----------
  function onBagStickPointerDown(e: PointerEvent, id: string) {
    const stick = bag.find(s => s.id === id);
    if (!stick || stick.used) return;

    suppressTap = false;

    // long-press starts drag (prevents Safari double-tap zoom behavior)
    longPressTimer = setTimeout(() => {
      suppressTap = true;
      startDrag(e, id);
    }, 140);
  }

  function onBagStickPointerUp(e: PointerEvent, id: string) {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;

    // if we didn't start a drag, treat as tap select
    if (!suppressTap && !dragging) {
      const stick = bag.find(s => s.id === id);
      if (!stick || stick.used) return;
      selectedId = selectedId === id ? null : id;
    }
  }

  function startDrag(e: PointerEvent, id: string) {
    const stick = bag.find(s => s.id === id);
    if (!stick || stick.used) return;

    dragging = true;
    dragPointerId = e.pointerId;
    dragStickId = id;

    refreshBoardRect();

    ghostX = e.clientX;
    ghostY = e.clientY;

    const { r, c } = pointerToCell(e.clientX, e.clientY);
    ghostRow = r;
    ghostCol = c;
    ghostValid = r !== null && c !== null ? isLegalPlacement(stick, r, c).ok : false;

    // capture pointer so move/up keep firing
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onGlobalPointerMove(e: PointerEvent) {
    if (!dragging || dragPointerId !== e.pointerId) return;
    refreshBoardRect();

    ghostX = e.clientX;
    ghostY = e.clientY;

    const stick = getStick(dragStickId);
    const { r, c } = pointerToCell(e.clientX, e.clientY);
    ghostRow = r;
    ghostCol = c;
    ghostValid = !!stick && r !== null && c !== null ? isLegalPlacement(stick, r, c).ok : false;
  }

  function onGlobalPointerUp(e: PointerEvent) {
    if (!dragging || dragPointerId !== e.pointerId) return;

    const stick = getStick(dragStickId);
    if (stick && ghostRow !== null && ghostCol !== null) {
      placeStick(stick, ghostRow, ghostCol);
    }

    dragging = false;
    dragPointerId = null;
    dragStickId = null;
    ghostRow = ghostCol = null;
    ghostValid = false;
  }

  // ---------- Board tap-to-place ----------
  function onBoardCellTap(r: number, c: number) {
    const stick = getStick(selectedId);
    if (!stick || stick.used) return;
    placeStick(stick, r, c);
  }

  onMount(() => {
    refreshBoardRect();
    window.addEventListener("resize", refreshBoardRect, { passive: true });

    // global pointer listeners for drag
    window.addEventListener("pointermove", onGlobalPointerMove, { passive: false });
    window.addEventListener("pointerup", onGlobalPointerUp, { passive: false });

    return () => {
      window.removeEventListener("resize", refreshBoardRect);
      window.removeEventListener("pointermove", onGlobalPointerMove);
      window.removeEventListener("pointerup", onGlobalPointerUp);
    };
  });
</script>

<svelte:window on:contextmenu|preventDefault />

<div class="app">
  <header class="top">
    <div class="titleRow">
      <div class="title">CRUXWORD <span class="bagCount">(Bag {bag.filter(b => !b.used).length})</span></div>
      <button class="iconBtn" aria-label="Help" title="Help">?</button>
    </div>

    <div class="statsRow">
      <div class="pill">Tiles <strong>{placedCount}/100</strong></div>
      <div class="pill">Density <strong>{densityPct()}%</strong></div>

      <div class="spacer"></div>

      <button class="btn" on:click={resetGame}>Reset</button>
    </div>
  </header>

  <main class="main">
    <!-- Board -->
    <section class="boardWrap">
      <div class="board" bind:this={boardEl}>
        {#each board as row, r}
          {#each row as cell, c}
            <button
              class="cell {cell ? 'filled' : ''}"
              style="--r:{r};--c:{c}"
              on:click={() => onBoardCellTap(r, c)}
              aria-label={`Cell ${r + 1}, ${c + 1}`}
            >
              {#if cell}{cell}{/if}
            </button>
          {/each}
        {/each}

        <!-- Ghost preview while dragging -->
        {#if dragging}
          {#each (getStick(dragStickId) ? lettersFor(getStick(dragStickId)!) : []) as ch, i}
            {#if ghostRow !== null && ghostCol !== null}
              <div
                class="ghostCell {ghostValid ? 'ok' : 'bad'}"
                style="
                  --gr:{ghostRow + (getStick(dragStickId)!.ori === 'V' ? i : 0)};
                  --gc:{ghostCol + (getStick(dragStickId)!.ori === 'H' ? i : 0)};
                "
              >
                {ch}
              </div>
            {/if}
          {/each}
        {/if}
      </div>
    </section>

    <!-- Bag -->
    <section class="bag">
      <div class="bagHeader">
        <div class="bagTitle">Morphemes</div>
        <div class="bagHint">Tap selects • Press+hold drags</div>
      </div>

      <div class="bagGrid" aria-label="Morpheme bag (scroll sideways)">
        {#each bag as stick (stick.id)}
          <div class="stickCard {stick.used ? 'used' : ''} {selectedId === stick.id ? 'selected' : ''}">
            <button
              class="stickBtn"
              disabled={stick.used}
              on:pointerdown={(e) => onBagStickPointerDown(e, stick.id)}
              on:pointerup={(e) => onBagStickPointerUp(e, stick.id)}
              on:pointercancel={() => { if (longPressTimer) clearTimeout(longPressTimer); longPressTimer = null; }}
              aria-label={`Stick ${stick.text}`}
            >
              <div class="tiles">
                {#each lettersFor(stick) as ch}
                  <span class="t">{ch}</span>
                {/each}
              </div>

              <!-- Rotate icon inline with tiles; 90° toggle only -->
              <button
                class="rotBtn"
                disabled={stick.used}
                on:click|stopPropagation={() => rotateStick(stick.id)}
                aria-label="Rotate"
                title="Rotate 90°"
              >
                ⟳
              </button>
            </button>

            <div class="oriBadge" aria-label="Orientation">{stick.ori}</div>
          </div>
        {/each}
      </div>
    </section>
  </main>
</div>

<style>
  /* -------- iPhone sizing + no vertical scroll goal -------- */
  :global(html),
  :global(body) {
    height: 100%;
    margin: 0;
    background: radial-gradient(1200px 800px at 30% 10%, #0b1a33, #060a12);
    color: #e9eef7;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
    -webkit-text-size-adjust: 100%;
  }

  /* Helps reduce annoying tap behavior; we avoid double-tap handlers entirely */
  :global(*) {
    -webkit-tap-highlight-color: transparent;
  }

  .app {
    height: 100svh; /* iOS safe viewport */
    padding: calc(12px + env(safe-area-inset-top)) 12px calc(12px + env(safe-area-inset-bottom));
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .top {
    flex: 0 0 auto;
  }

  .titleRow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .title {
    font-weight: 800;
    letter-spacing: 0.12em;
    font-size: 22px;
    line-height: 1.1;
  }

  .bagCount {
    font-weight: 700;
    letter-spacing: 0.04em;
    opacity: 0.75;
    margin-left: 6px;
    font-size: 14px;
  }

  .iconBtn {
    width: 42px;
    height: 42px;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.06);
    color: #e9eef7;
    font-size: 18px;
    touch-action: manipulation;
  }

  .statsRow {
    margin-top: 10px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: nowrap;
  }

  .pill {
    padding: 10px 12px;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.10);
    background: rgba(255,255,255,0.04);
    font-size: 14px;
    white-space: nowrap;
  }
  .pill strong {
    font-size: 18px;
    margin-left: 6px;
  }

  .spacer {
    flex: 1;
  }

  .btn {
    padding: 10px 14px;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.06);
    color: #e9eef7;
    font-weight: 700;
    touch-action: manipulation;
    white-space: nowrap;
  }

  .main {
    flex: 1 1 auto;
    display: grid;
    grid-template-rows: 1fr auto;
    gap: 10px;
    min-height: 0; /* critical for iOS layout */
  }

  /* -------- Board -------- */
  .boardWrap {
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .board {
    /* Square board that fits screen */
    --board: min(94vw, 560px);
    width: var(--board);
    aspect-ratio: 1 / 1;

    /* tight grid (no padding inside cells) */
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    grid-template-rows: repeat(10, 1fr);
    gap: 2px;

    border-radius: 22px;
    padding: 10px;
    box-sizing: border-box;

    border: 1px solid rgba(255,255,255,0.10);
    background:
      radial-gradient(1000px 800px at 25% 20%, rgba(71, 137, 255, 0.14), rgba(0,0,0,0)),
      rgba(255,255,255,0.03);
    position: relative;
    overflow: hidden;
  }

  .cell {
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.06);
    background: rgba(0,0,0,0.18);
    color: #e9eef7;

    display: grid;
    place-items: center;

    /* BIGGER letters */
    font-weight: 900;
    font-size: clamp(16px, 3.2vw, 22px);
    letter-spacing: 0.08em;

    /* Avoid iOS zoom-on-tap weirdness */
    touch-action: manipulation;
    user-select: none;
  }

  .cell.filled {
    background: rgba(255,255,255,0.10);
    border-color: rgba(255,255,255,0.12);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06);
  }

  .ghostCell {
    position: absolute;
    width: calc((100% - 20px - 9 * 2px) / 10); /* board padding + gap math */
    height: calc((100% - 20px - 9 * 2px) / 10);
    left: calc(10px + var(--gc) * ( (100% - 20px - 9 * 2px) / 10 + 2px ));
    top:  calc(10px + var(--gr) * ( (100% - 20px - 9 * 2px) / 10 + 2px ));

    border-radius: 14px;
    display: grid;
    place-items: center;
    font-weight: 900;
    font-size: clamp(16px, 3.2vw, 22px);
    letter-spacing: 0.08em;
    pointer-events: none;

    background: rgba(255,255,255,0.12);
    border: 1px dashed rgba(255,255,255,0.35);
    opacity: 0.85;
  }
  .ghostCell.ok { outline: 2px solid rgba(110, 255, 182, 0.45); }
  .ghostCell.bad { outline: 2px solid rgba(255, 120, 120, 0.45); }

  /* -------- Bag (3 visible rows) -------- */
  .bag {
    flex: 0 0 auto;
    min-height: 0;
  }

  .bagHeader {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
  }

  .bagTitle {
    font-size: 18px;
    font-weight: 900;
    letter-spacing: 0.06em;
  }

  .bagHint {
    font-size: 12px;
    opacity: 0.7;
    white-space: nowrap;
  }

  .bagGrid {
    /* 3 rows visible, scroll sideways */
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(3, auto);
    gap: 10px;
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 6px;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-x;

    border-radius: 18px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03);
    padding: 10px;
  }

  .stickCard {
    position: relative;
    border-radius: 18px;
    border: 1px solid rgba(255,255,255,0.10);
    background: rgba(255,255,255,0.04);
  }

  .stickCard.selected {
    border-color: rgba(135, 199, 255, 0.55);
    box-shadow: 0 0 0 2px rgba(135, 199, 255, 0.18);
  }

  .stickCard.used {
    opacity: 0.45;
    filter: grayscale(0.2);
  }

  .stickBtn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    user-select: none;

    /* allow horizontal scrolling while still supporting long-press drag */
    touch-action: manipulation;
  }

  .tiles {
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }

  .t {
    width: 34px;
    height: 34px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: rgba(0,0,0,0.22);
    border: 1px solid rgba(255,255,255,0.10);
    font-weight: 900;
    font-size: 16px;
    letter-spacing: 0.08em;
  }

  .rotBtn {
    width: 38px;
    height: 38px;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.06);
    color: #e9eef7;
    font-size: 18px;
    cursor: pointer;
    touch-action: manipulation;
  }
  .rotBtn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .oriBadge {
    position: absolute;
    top: 6px;
    right: 8px;
    font-size: 11px;
    opacity: 0.75;
    padding: 3px 7px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.10);
    background: rgba(0,0,0,0.16);
    pointer-events: none;
  }
</style>
