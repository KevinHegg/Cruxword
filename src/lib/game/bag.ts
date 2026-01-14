import type { Stick, MorphemeBag } from './types';

export function bagToSticks(bag: MorphemeBag): Stick[] {
	return bag.sticks.map((s) => ({
		sid: s.sid,
		text: s.text === '*' ? '*' : s.text.toUpperCase(), // preserve wildcard
		orientation: 'H',
		placed: false
	}));
}

/** Hard guard: MVP only supports 1..5 chars per stick */
export function validateBagShape(bag: MorphemeBag): string[] {
	const issues: string[] = [];

	if (bag.constraints.grid.rows !== 11 || bag.constraints.grid.cols !== 12) {
		issues.push(`Bag ${bag.meta.id}: grid must be 12×11.`);
	}
	for (const s of bag.sticks) {
		const t = s.text ?? '';
		if (t === '*') {
			// Wildcard is allowed
			continue;
		}
		const tUpper = t.toUpperCase();
		if (tUpper.length < 1 || tUpper.length > 5) issues.push(`Stick ${s.sid} has invalid length ${tUpper.length}: "${t}"`);
		if (!/^[A-Z]+$/.test(tUpper)) issues.push(`Stick ${s.sid} has non-letters: "${t}"`);
	}

	// Optional: check distribution (len5=5, len4=6, len3=7, len2=8, len1=9, wildcard=1)
	const counts = new Map<number, number>();
	let wildcardCount = 0;
	for (const s of bag.sticks) {
		if (s.text === '*') {
			wildcardCount++;
		} else {
			counts.set(s.text.length, (counts.get(s.text.length) ?? 0) + 1);
		}
	}

	// We'll only warn (not block) if you tweak later
	const want: Record<number, number> = { 5: 5, 4: 6, 3: 7, 2: 8, 1: 9 };
	for (const k of Object.keys(want).map(Number)) {
		if ((counts.get(k) ?? 0) !== want[k]) {
			issues.push(
				`Bag ${bag.meta.id}: stick count length ${k} is ${(counts.get(k) ?? 0)} (expected ${want[k]}).`
			);
		}
	}
	if (wildcardCount !== 1) {
		issues.push(`Bag ${bag.meta.id}: wildcard count is ${wildcardCount} (expected 1).`);
	}

	return issues;
}
