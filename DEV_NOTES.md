Totally get it. Here’s a single, copy-paste **system brief** for Cursor (works well with Claude Sonnet 4.5) that encodes the *entire* CruxWord concept and rules so it stops “freehand drawing” and starts doing **segment-first puzzle building** exactly as intended.



---



# SYSTEM BRIEF — CruxWord (Segment-First Crossword Builder)



> You are coding a constructor tool where users **compose words from curated letter-segments** (2–5 letters) to build novel crux/crossword puzzles. The UI must **never** allow freehand drawing. All interaction is per-cell: click to focus, type letters A–Z, Space toggles black squares, Enter toggles direction, Arrow keys move.



If any prior code or comments conflict with this brief, **prefer this brief**.



---



## What this app is (and is not)



* **IS:** a *segment-first* constructor. The right panel suggests **segment chains** that tile the active slot; users pick chains to fill the grid. Whole-word lists are optional sugar.

* **IS NOT:** a paint app. No drag drawing, no brush tools, no arbitrary marks.

* **IS:** American-style crossword defaults (180° symmetry toggle, connectivity warnings, min slot length 3).

* **IS:** deterministically driven by three CSVs loaded at startup—no hallucinated segments, no invented wordlists.



---



## Data files (already present)



* `/mnt/data/segments.csv`

  Columns: `text,len,combo_count,start_combo_count,is_syntactic,morph_prefix,morph_suffix,pos_start,pos_end,atomic_slice,semantic_weight,game_weight`



* `/mnt/data/playdict.csv` (optional overlay, do **not** block on it)

  Column: `word`



* `/mnt/data/basellex_v0.1.csv` (optional frequency/theme nudging)

  Columns: `word, pos, zipf, flags, theme_tags`



> Normalize everything to **lowercase** internally; render uppercase on the board.



---



## Core objects



```ts

type Cell = { r:number; c:number; ch?:string; black?:boolean };

type SlotDir = "A"|"D";

type Slot = {

  id: string;         // e.g., "r1c1-A"

  dir: SlotDir;

  length: number;

  cells: Cell[];

  pattern: string;    // letters or '?', length == cells.length

  crossings: Array<{index:number; otherSlotId:string; otherIndex:number}>;

};



type Seg = {

  text: string; len: 2|3|4|5;

  combo_count: number; start_combo_count: number;

  is_syntactic: boolean;

  morph_prefix: boolean; morph_suffix: boolean;

  pos_start: boolean; pos_end: boolean;

  atomic_slice: boolean;

  semantic_weight: number; game_weight: number;

};



type Chain = { letters:string; chain:string[]; score:number; usesOK:boolean };

```



---



## Grid & gameplay rules



1. **Cell editing only.** Click to focus. Type A–Z to set a letter. **Space** toggles black. **Enter** flips A/D. **Arrows** move within active slot.



2. **Symmetry toggle (180°).** When ON, black toggles mirror about center.



3. **Slots:** Maximal runs of non-black cells horizontally (ACROSS) and vertically (DOWN). Recompute on every edit.



4. **Minimum slot length:** 3. Keep visually; solver/chain finder **ignores** length<3.



5. **Connectivity warning:** Non-black cells should remain one connected component (soft warning only).



6. **Always show suggestions:** Focusing a valid slot must populate the right panel with **Segment Chains** (and optionally Word Candidates). No blank states after focus.



---



## Segment chains (the heart of the app)



* **Segments are 2–5 letters only. No 1-letter pieces.**

* A **segment chain** must **tile the entire slot** end-to-end and **match fixed letters**.

* Chain length bounds for a slot of length **L**:



  ```

  minSegs = ceil(L / 5)

  maxSegs = floor(L / 2)

  ```



  (Ex: L=11 ⟹ 3..5 segments)



### Lifespan / inventory (global per puzzle)



Each segment text (`s.text`) has a small usage budget:



```

remaining(s.text) = clamp( round( log1p(combo_count) / 2 ), 1, 3 )

```



Decrement **only** when a chain is **committed** to the grid. Do **not** decrement on hover/preview. When a segment hits 0, it must no longer be offered in future chains.



### Join compatibility (tuning)



Adjacent segments are “tuned” if their ends/starts align morphologically:



* **Join bonus per boundary:**



  * +0.08 if left piece has `(morph_suffix || pos_end)`

  * +0.08 if right piece has `(morph_prefix || pos_start)`

  * −0.06 if **neither** side has those



### Edges & atomic



* First piece bonus: +0.08 if `(pos_start || morph_prefix)`

* Last  piece bonus: +0.08 if `(pos_end   || morph_suffix)`

* `atomic_slice==true` means keep that segment intact; never simulate splitting it.



### Chain scoring



```

piece_score = seg.game_weight

            + 0.05 * norm(combo_count + start_combo_count)

            + edge_bonus



chain_score = sum(piece_score) + sum(join_bonus)

            + 0.10 * norm(zipf(concat))    # optional if concat in basellex

```



**Do not require dictionary membership.** Whole-word presence only adds a small nudge.



---



## Candidate words (optional overlay)



* If `playdict.csv` has matches for the slot’s **pattern** and crossings, list them (scored primarily by **best segmentation score** of the word per above; then tie-break with `zipf` and crossing coverage).

* If the Word tab is empty **or** pattern is all `?`, **auto-show Segment Chains**.



---



## Required UI behavior



* Tabs: **Candidates** (default), **Wordlists**, **Theme**. Inside Candidates: **Word Candidates** and **Segment Chains** sub-tabs.

* On grid mount and on every slot focus:



  * Compute/recompute the active **Slot**.

  * Generate **Segment Chains** via DP (below).

  * If “Word Candidates” has 0 results, switch to “Segment Chains”.

* Each chain row shows: **LETTERS** (concat), chain visualization `ab | alo | ne`, **score**, and per-segment lifespan dots (`●●○`).

* Clicking a chain commits its letters, decrements segment lifespans, updates all affected slots, and refreshes suggestions.



---



## Segment chain finder (DP outline)



```ts

function findTopSegmentChains(pattern: string, maxK=50): Chain[] {

  const L = pattern.length;

  const minSegs = Math.ceil(L/5), maxSegs = Math.floor(L/2);



  // Pre: segMap: Map<string,Seg>, remaining: Map<string,number>

  // Build a 2–5 depth trie for segs to speed lookups (optional).



  type State = `${number}:${number}:${string|""}`; // i:segCount:lastSegText

  const memo = new Map<State, Array<{score:number; tails:string[][]}>>();



  function* dfs(i:number, segCount:number, last?:Seg, accScore=0, chain:string[]=[]) {

    if (i===L) {

      if (segCount>=minSegs && segCount<=maxSegs) {

        const letters = chain.join('').toUpperCase();

        const usesOK = chain.every(p => (remaining.get(p.toLowerCase()) ?? 1) > 0);

        yield { letters, chain:[...chain], score:accScore, usesOK };

      }

      return;

    }

    for (let len=2; len<=5; len++) {

      const j = i+len; if (j>L) break;

      if (!matchesFixed(pattern, i, j)) continue;       // letter mask check

      const piece = pattern.slice(i,j).toLowerCase();

      const seg = segMap.get(piece); if (!seg) continue;



      // segment/edge score

      let s = seg.game_weight + 0.05*norm(seg.combo_count + seg.start_combo_count);

      if (i===0 && (seg.pos_start||seg.morph_prefix)) s += 0.08;

      if (j===L && (seg.pos_end||seg.morph_suffix))   s += 0.08;



      // join tuning

      if (last){

        const Lok = last.morph_suffix||last.pos_end;

        const Rok = seg.morph_prefix||seg.pos_start;

        if (Lok) s += 0.08;

        if (Rok) s += 0.08;

        if (!Lok && !Rok) s -= 0.06;

      }



      // segCount feasibility pruning

      const remain = L - j;

      const minLeft = Math.ceil(remain/5);

      const maxLeft = Math.floor(remain/2);

      const nextCount = segCount+1;

      if (nextCount+minLeft>maxSegs || nextCount+maxLeft<minSegs) continue;



      yield* dfs(j, nextCount, seg, accScore+s, [...chain, piece]);

    }

  }



  const results: Chain[] = [];

  for (const res of dfs(0, 0, undefined, 0, [])) pushTopK(results, res, maxK);

  return results.sort((a,b)=>b.score-a.score);

}

```



---



## Auto-fill (optional, CSP)



* Variables = slots; domain = candidate words or **top chains’ concat**.

* Order: **MRV** (fewest remaining values); tie-break by degree.

* Try values in **score-descending** order; forward-check neighbors; backtrack on dead ends.

* Keep an undo stack of cell deltas and pruned domain diffs.



---



## Prohibitions / Guardrails



* ❌ No freehand drawing, brushes, drag-to-paint, or line tools.

* ❌ Don’t invent segments; use only `segments.csv`.

* ❌ Don’t require dictionary membership; never return “0 suggestions” if a slot is valid.

* ✅ On slot focus, **always** show Segment Chains.



---



## Minimal acceptance checklist



1. **Focus a fresh 11×11 slot (all `?`).** Segment Chains tab shows ≥25 chains; words tab may be empty.

2. **Type fixed letters** (e.g., `A??E??????R`). Chains respect them; no conflicts shown.

3. **Commit a chain.** Letters fill; segment lifespans decrement globally; overused segments stop appearing.

4. **Symmetry ON.** Toggling black mirrors correctly.

5. **Min slot length 3.** Chains never offered for 1–2 cell slots.

6. **Never** see a blank right panel after focusing a valid slot.



---



## Implementation checklist (do these in this order)



1. Remove/disable any freehand drawing handlers.

2. Load CSVs once; build `segMap` and (optional) a 2–5 depth trie.

3. Maintain global `remaining(text)` inventory + reset on “New Grid”.

4. Slot detection and `pattern` computation on each edit/focus.

5. Implement `findTopSegmentChains(pattern)`; wire to UI tab.

6. Auto-switch to Segment Chains when Word tab is empty or pattern is all `?`.

7. Commit flow: fill letters, decrement `remaining`, recompute neighbors.

8. Status bar: `Grid: NxN | Symmetry: ON|OFF` + hint text.



---



### If Claude keeps drifting…



Sonnet 4.5 can do this, but it sometimes invents UX. Pin this brief as a **system prompt** in Cursor and re-issue your request. If it still wanders, switch the model to **GPT-5 Thinking** for stricter adherence to specs.



---



Paste the entire brief above into a pinned note or your `DEV_NOTES.md` in Cursor and say: “Implement exactly this behavior.”


