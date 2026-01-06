<script lang="ts">
  type Orientation = "H" | "V";

  type Stick = {
    id: string;
    text: string; // letters/word-part on the stick
    orientation: Orientation;
    used: boolean;
  };

  const BOARD = 10;

  // --- Board state ---
  let board: (string | null)[][] = Array.from({ length: BOARD }, () =>
    Array.from({ length: BOARD }, () => null)
  );

  // --- Demo bag (swap with your JSON later) ---
  // Mix of morphemes + helpful singles; feel free to tune lengths/counts.
  let bag: Stick[] = [
    { id: "s1", text: "PLAY", orientation: "H", used: false },
    { id: "s2", text: "ED", orientation: "H", used: false },
    { id: "s3", text: "ING", orientation: "H", used: false },
    { id: "s4", text: "RE", orientation: "H", used: false },
    { id: "s5", text: "TION", orientation: "H", used: false },
    { id: "s6", text: "MENT", orientation: "H", used: false },
    { id: "s7", text: "PRE", orientation: "H", used: false },
    { id: "s8", text: "UN", orientation: "H", used: false },
    { id: "s9", text: "S", orientation: "H", used: false },
    { id: "s10", text: "E", orientation: "H", used: false },
    { id: "s11", text: "A", orientation: "H", used: false },
    { id: "s12", text: "STAR", orientation: "H", used: false },
    { id: "s13", text: "ORBIT", orientation: "H", used: false },
    { id: "s14", text: "NOVA", orientation: "H", used: false }
  ];

  let selectedId: string | null = null;

  $: selected = bag.find((s) => s.id === selectedId) ?? null;

  function tilesPlacedCount(): number {
    let n = 0;
    for (let r = 0; r < BOARD; r++) {
      for (let c = 0; c < BOARD; c++) if (board[r][c]) n++;
    }
    return n;
  }

  function hasAnyTile(): boolean {
    return tilesPlacedCount() > 0;
  }

  function resetGame() {
    board = Array.from({ length: BOARD }, () =>
      Array.from({ length: BOARD }, () => null)
    );
    bag = bag.map((s) => ({ ...s, used: false, orientation: "H" }));
    selectedId = null;
  }

  function rotateSelected() {
    if (!selected) return;
    // Keep 5-letter sticks horizontal if you want that constraint:
    if (selected.text.length === 5) return;

    bag = bag.map((s) =>
      s.id === selected.id
        ? { ...s, orientation: s.orientation === "H" ? "V" : "H" }
        : s
    );
  }

  function selectStick(id: string) {
    const stick = bag.find((s) => s.id === id);
    if (!stick || stick.used) return;

    if (selectedId === id) {
      // tap again -> rotate
      rotateSelected();
    } else {
      selectedId = id;
    }
  }

  function cancelSelection() {
    selectedId = null;
  }

  function inBounds(r: number, c: number) {
    return r >= 0 && r < BOARD && c >= 0 && c < BOARD;
  }

  function placementCells(
    baseR: number,
    baseC: number,
    stick: Stick
  ): { r: number; c: number; ch: string }[] {
    const letters = stick.text.split("");
    return letters.map((ch, i) => {
      const r = stick.orientation === "H" ? baseR : baseR + i;
      const c = stick.orientation === "H" ? baseC + i : baseC;
      return { r, c, ch };
    });
  }

  function touchesExistingByEdge(
    cells: { r: number; c: number }[],
    existingSet: Set<string>
  ): boolean {
    // edge-neighbor offsets
    const dirs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1]
    ];

    const newSet = new Set(cells.map((p) => `${p.r},${p.c}`));

    for (const p of cells) {
      for (const [dr, dc] of dirs) {
        const nr = p.r + dr;
        const nc = p.c + dc;
        const key = `${nr},${nc}`;
        // must touch an *existing* tile that is not part of the new placement
        if (existingSet.has(key) && !newSet.has(key)) return true;
      }
    }
    return false;
  }

  function canPlaceAt(baseR: number, baseC: number, stick: Stick): { ok: boolean; reason?: string } {
    const cells = placementCells(baseR, baseC, stick);

    // bounds + overlap check
    for (const p of cells) {
      if (!inBounds(p.r, p.c)) return { ok: false, reason: "Out of bounds" };
      if (board[p.r][p.c]) return { ok: false, reason: "Overlaps existing" };
    }

    // build existing set
    const existing = new Set<string>();
    for (let r = 0; r < BOARD; r++) {
      for (let c = 0; c < BOARD; c++) {
        if (board[r][c]) existing.add(`${r},${c}`);
      }
    }

    // first move can be anywhere
    if (existing.size === 0) return { ok: true };

    // later moves must touch existing by an edge
    const touches = touchesExistingByEdge(
      cells.map(({ r, c }) => ({ r, c })),
      existing
    );
    if (!touches) return { ok: false, reason: "Must touch existing tiles" };

    return { ok: true };
  }

  function placeSelectedAt(r: number, c: number) {
    if (!selected) return;

    const check = canPlaceAt(r, c, selected);
    if (!check.ok) return;

    const cells = placementCells(r, c, selected);

    // apply to board
    const next = board.map((row) => row.slice());
    for (const p of cells) next[p.r][p.c] = p.ch;
    board = next;

    // mark stick used
    bag = bag.map((s) => (s.id === selected.id ? { ...s, used: true } : s));
    selectedId = null;
  }

  // Simple “percent filled” monitor
  $: filled = tilesPlacedCount();
  $: percent = Math.round((filled / (BOARD * BOARD)) * 100);
</script>

<svelte:head>
  <title>Cruxword (MVP)</title>
</svelte:head>

<div class="wrap">
  <header class="topbar">
    <div class="title">
      <div class="name">CRUXWORD</div>
      <div class="tag">Morpheme Rush — a daily workout for your brain</div>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="label">Filled</div>
        <div class="value">{filled}/100 ({percent}%)</div>
      </div>
      <div class="stat">
        <div class="label">Selected</div>
        <div class="value">{selected ? `${selected.text} (${selected.orientation})` : "—"}</div>
      </div>
    </div>
  </header>

  <main class="main">
    <!-- Board -->
    <section class="boardCard">
      <div class="board" aria-label="10 by 10 board">
        {#each board as row, r}
          {#each row as cell, c}
            <button
              class="cell {cell ? 'filled' : ''} {selected ? 'placeable' : ''}"
              on:click={() => placeSelectedAt(r, c)}
              aria-label={"Cell " + (r + 1) + "," + (c + 1)}
            >
              {cell ?? ""}
            </button>
          {/each}
        {/each}
      </div>

      <div class="hint">
        {#if !selected}
          Tap a stick below to select it. Tap it again to rotate. Then tap a board cell to place.
        {:else}
          Tap a board cell to place <b>{selected.text}</b>. (Must touch existing tiles after the first move.)
        {/if}
      </div>
    </section>

    <!-- Actions -->
    <section class="actions">
      <button class="btn" on:click={rotateSelected} disabled={!selected}>
        Rotate
      </button>
      <button class="btn" on:click={cancelSelection} disabled={!selected}>
        Cancel
      </button>
      <button class="btn danger" on:click={resetGame}>
        Reset
      </button>
    </section>

    <!-- Bag -->
    <section class="bagCard">
      <div class="bagTitle">Morpheme Bag</div>
      <div class="bag">
        {#each bag as s}
          <button
            class="stick {s.used ? 'used' : ''} {selectedId === s.id ? 'selected' : ''}"
            on:click={() => selectStick(s.id)}
            disabled={s.used}
            aria-label={"Stick " + s.text}
          >
            <div class="stickInner {s.orientation === 'V' ? 'v' : 'h'}">
              {#each s.text.split('') as ch}
                <span class="tile">{ch}</span>
              {/each}
            </div>
          </button>
        {/each}
      </div>

      <div class="bagNote">
        MVP rule: after the first placement, every new stick must touch the existing build by an edge.
      </div>
    </section>
  </main>
</div>

<style>
  :global(body) {
    margin: 0;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    background: radial-gradient(circle at 20% 0%, rgba(120, 120, 255, 0.18), transparent 45%),
      radial-gradient(circle at 80% 10%, rgba(255, 120, 220, 0.14), transparent 50%),
      radial-gradient(circle at 50% 90%, rgba(120, 255, 220, 0.10), transparent 55%),
      #060816;
    color: #e8ecff;
  }

  .wrap {
    max-width: 720px;
    margin: 0 auto;
    padding: 12px;
    box-sizing: border-box;
  }

  .topbar {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
    margin-bottom: 10px;
  }

  .name {
    font-weight: 800;
    letter-spacing: 0.12em;
  }
  .tag {
    opacity: 0.8;
    font-size: 0.92rem;
    margin-top: 4px;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .stat {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 12px;
    padding: 8px 10px;
    backdrop-filter: blur(8px);
  }
  .label {
    font-size: 0.75rem;
    opacity: 0.75;
  }
  .value {
    font-weight: 700;
    margin-top: 2px;
  }

  .main {
    display: grid;
    gap: 10px;
  }

  .boardCard,
  .bagCard {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 16px;
    padding: 10px;
    backdrop-filter: blur(8px);
  }

  .board {
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    width: 100%;
    aspect-ratio: 1 / 1;
    gap: 3px;
  }

  .cell {
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.10);
    background: rgba(0, 0, 0, 0.20);
    color: #f1f4ff;
    font-weight: 800;
    font-size: clamp(12px, 3.2vw, 18px);
    display: grid;
    place-items: center;
    padding: 0;
    touch-action: manipulation;
  }

  .cell.filled {
    background: rgba(255, 255, 255, 0.10);
    border-color: rgba(255, 255, 255, 0.18);
  }

  .cell.placeable:active {
    transform: scale(0.98);
  }

  .hint {
    margin-top: 8px;
    font-size: 0.9rem;
    opacity: 0.9;
  }

  .actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .btn {
    border-radius: 14px;
    padding: 12px 10px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.07);
    color: #eef2ff;
    font-weight: 800;
    letter-spacing: 0.02em;
    touch-action: manipulation;
  }
  .btn:disabled {
    opacity: 0.45;
  }
  .btn.danger {
    border-color: rgba(255, 90, 90, 0.35);
  }

  .bagTitle {
    font-weight: 800;
    margin-bottom: 8px;
    letter-spacing: 0.06em;
  }

  .bag {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: max-content;
    gap: 10px;
    overflow-x: auto;
    padding-bottom: 6px;
    -webkit-overflow-scrolling: touch;
  }

  .stick {
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(0, 0, 0, 0.18);
    padding: 10px;
    min-width: 86px;
    touch-action: manipulation;
  }

  .stick.selected {
    outline: 2px solid rgba(170, 200, 255, 0.7);
  }

  .stick.used {
    opacity: 0.35;
  }

  .stickInner {
    display: grid;
    gap: 4px;
    justify-content: start;
  }
  .stickInner.h {
    grid-auto-flow: column;
    grid-auto-columns: 22px;
  }
  .stickInner.v {
    grid-auto-flow: row;
    grid-auto-rows: 22px;
  }

  .tile {
    width: 22px;
    height: 22px;
    border-radius: 7px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.08);
    display: grid;
    place-items: center;
    font-weight: 900;
    font-size: 0.85rem;
  }

  .bagNote {
    margin-top: 8px;
    font-size: 0.85rem;
    opacity: 0.8;
  }
</style>
