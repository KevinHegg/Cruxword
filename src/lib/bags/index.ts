import bag1 from './mbag_0001.json';
import bag2 from './mbag_0002.json';
import bag3 from './mbag_0003.json';
import type { MorphemeBag } from '$lib/game/types';

export const BAGS: MorphemeBag[] = [bag1, bag2, bag3] as unknown as MorphemeBag[];

export function pickRandomBag(): MorphemeBag {
	return BAGS[Math.floor(Math.random() * BAGS.length)];
}
