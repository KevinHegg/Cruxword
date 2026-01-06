# Cursor Starter Instructions

1) Create a Vite TS project:
   npm create vite@latest tetrad-word-game -- --template vanilla-ts
   cd tetrad-word-game
   npm i p5 papaparse zod
   npm i -D @types/p5

2) Copy these files into the project:
   - Move **data/** into **tetrad-word-game/public/data/**
   - Copy **cursor-starter/index.html** to project root (or merge)
   - Copy **cursor-starter/src/** into project **src/** (merge as needed)

3) Run:
   npm run dev

Expected:
- Console logs row counts for basellex, playdict, segments.
- A grid and a placeholder tetrad renders without TS errors.
