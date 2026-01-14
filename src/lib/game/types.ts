export type Orientation = 'H' | 'V';

export type Stick = {
	sid: string;          // unique per bag
	text: string;         // 1..5 chars (letters only)
	orientation: Orientation; // current orientation in UI
	placed: boolean;      // whether it has been placed on board
};

export type BagMeta = {
	id: string;                  // "mbag_0001"
	title: string;               // optional
	category: string;            // e.g. "Detective"
	mystery_question: string;
	choices: string[];           // length 10 recommended
	answer_index: number;        // 0..9 (kept for later scoring)
};

export type BagConstraints = {
	grid: { rows: 11; cols: 12 };
	min_word_len: number; // 3
	submit_requires_single_cluster: boolean;
	max_intersections_per_wordpair: number; // 1
};

export type MorphemeBag = {
	meta: BagMeta;
	constraints: BagConstraints;
	sticks: Array<{ sid: string; text: string }>;
	bonus?: {
		target_words?: string[];
		target_morphemes?: string[];
		red_herrings?: string[];
	};
};

export type Cell = {
	letter: string;        // single uppercase letter
	stickIds: string[];    // one or more if overlapped (allowed only when letters match)
};

export type PlacedStick = {
	sid: string;
	text: string;
	orientation: Orientation;
	row: number; // 0..9
	col: number; // 0..9
};

export type BoardState = {
	rows: number;
	cols: number;
	cells: (Cell | null)[][];
	placed: Record<string, PlacedStick>;
};

export type ValidationResult = {
	ok: boolean;
	issues: string[];
	density: number; // 0..1
	filledCells: number;
	wordCount: number;
	score: number;
	words: { text: string; dir: 'H' | 'V'; row: number; col: number; len: number }[];
};
