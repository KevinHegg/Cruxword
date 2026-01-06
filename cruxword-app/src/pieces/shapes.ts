export interface ShapeCell {
  row: number;
  col: number;
  letter?: string;
  isBlack?: boolean;
}

export interface ShapeDefinition {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  cells: ShapeCell[];
  sampleWord?: string;
  tags?: string[];
}

export const SHAPES: ShapeDefinition[] = [
  {
    id: 'shape-abalone-arc',
    name: 'Abalone Sweep',
    description: 'Across sweep inspired by the segmentation ab | alo | ne.',
    width: 7,
    height: 1,
    sampleWord: 'abalone',
    tags: ['across', 'segment'],
    cells: [
      { row: 0, col: 0, letter: 'A' },
      { row: 0, col: 1, letter: 'B' },
      { row: 0, col: 2, letter: 'A' },
      { row: 0, col: 3, letter: 'L' },
      { row: 0, col: 4, letter: 'O' },
      { row: 0, col: 5, letter: 'N' },
      { row: 0, col: 6, letter: 'E' },
    ],
  },
  {
    id: 'shape-corner-lock',
    name: 'Corner Lock',
    description: 'An L-shaped frame that drops a black corner and two crossing words.',
    width: 3,
    height: 3,
    tags: ['corner', 'black-square'],
    cells: [
      { row: 0, col: 0, isBlack: true },
      { row: 0, col: 1, letter: 'A' },
      { row: 0, col: 2, letter: 'R' },
      { row: 1, col: 0, letter: 'T' },
      { row: 1, col: 1, letter: 'I' },
      { row: 1, col: 2, letter: 'S' },
      { row: 2, col: 0, letter: 'T' },
      { row: 2, col: 1, letter: 'S' },
    ],
  },
  {
    id: 'shape-cross-plus',
    name: 'Cross Stitch',
    description: 'A plus-shaped stitch that drops a symmetric set of theme letters.',
    width: 3,
    height: 3,
    sampleWord: 'plus',
    tags: ['symmetric', 'theme'],
    cells: [
      { row: 0, col: 1, letter: 'C' },
      { row: 1, col: 0, letter: 'R' },
      { row: 1, col: 1, letter: 'O' },
      { row: 1, col: 2, letter: 'S' },
      { row: 2, col: 1, letter: 'S' },
    ],
  },
  {
    id: 'shape-block-pair',
    name: 'Block Pair',
    description: 'Twin black squares flanked by entry points for mirrored fill.',
    width: 4,
    height: 2,
    tags: ['black-square'],
    cells: [
      { row: 0, col: 1, isBlack: true },
      { row: 0, col: 2, isBlack: true },
      { row: 1, col: 0, letter: 'I' },
      { row: 1, col: 1, letter: 'N' },
      { row: 1, col: 2, letter: 'K' },
      { row: 1, col: 3, letter: 'Y' },
    ],
  },
];


