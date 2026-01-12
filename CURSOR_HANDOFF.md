# Cruxword MVP Handoff (Cursor)

## Goal
Mobile-first MVP: build the densest constellation-crossword from a morpheme-stick bag.
Mystery layer is secondary.

## Current MVP features
- 10x10 board, always fits screen width (square aspect).
- Morpheme bank: 2-row, horizontal scroll, fixed slots.
- Interactions:
  - Tap stick to select
  - Tap board cell to place
  - Hold stick in bank to drag-drop to board
  - Tap a placed tile to select its stick
  - Toolbar: Return selected (⤺), Rotate selected (↻), Quickstart (? toggle)
- Clue bar: open on start, user can collapse/expand
- Submit: runs legality checks + scoring, shows modal
- Undo: simple state rollback

## Legality (enforced on Submit)
- single connected cluster (edge-adjacency)
- no short runs (length 1–2) in either direction
- horizontal/vertical word intersections: any H-word and V-word share <= 1 cell
- min scored word length: 3

## Known gaps / next steps
1) Dictionary validation (optional): currently any letter run counts as a word.
2) Better overlap constraints during placement (currently only letter mismatch is blocked).
3) Cluster/word highlighting & richer feedback.
4) Better “return cluster” / double-tap behaviors.
5) Wildcard tile support (allow '*' or '?').

## Files
- src/routes/+page.svelte : main UI + interactions
- src/lib/game/* : board engine + scoring
- src/lib/bags/*.json : golden bags
- src/lib/bags/index.ts : random bag loader

## Commands
- npm run dev
- git add .
- git commit -m "MVP: board + morpheme bank + submit validation"
- git push
