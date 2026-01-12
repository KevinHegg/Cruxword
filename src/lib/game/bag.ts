import type { Stick, MorphemeBag } from './types';

export function bagToSticks(bag: MorphemeBag): Stick[] {
	return bag.sticks.map((s) => ({
		sid: s.sid,
		text: s.text.toUpperCase(),
		orientation: 'H',
		placed: false
	}));
}

/** Hard guard: MVP only supports 1..5 chars per stick */
export function validateBagShape(bag: MorphemeBag): string[] {
	const issues: string[] = [];

	if (bag.constraints.grid.rows !== 10 || bag.constraints.grid.cols !== 10) {
		issues.push(`Bag ${bag.meta.id}: grid must be 10×10.`);
	}
	for (const s of bag.sticks) {
		const t = (s.text ?? '').toUpperCase();
		if (t.length < 1 || t.length > 5) issues.push(`Stick ${s.sid} has invalid length ${t.length}: "${t}"`);
		if (!/^[A-Z]+$/.test(t)) issues.push(`Stick ${s.sid} has non-letters: "${t}"`);
	}

	// Optional: check distribution (len5=5, len4=6, len3=7, len2=8, len1=15, wildcard=1)
	const counts = new Map<number, number>();
	for (const s of bag.sticks) counts.set(s.text.length, (counts.get(s.text.length) ?? 0) + 1);

	// We’ll only warn (not block) if you tweak later
	const want: Record<number, number> = { 5: 5, 4: 6, 3: 7, 2: 8, 1: 16 }; // 15 singlets + 1 wildcard-like singlet
	for (const k of Object.keys(want).map(Number)) {
		if ((counts.get(k) ?? 0) !== want[k]) {
			issues.push(
				`Bag ${bag.meta.id}: stick count length ${k} is ${(counts.get(k) ?? 0)} (expected ${want[k]}).`
			);
		}
	}

	return issues;
}
