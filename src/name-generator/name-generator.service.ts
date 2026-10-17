import { Injectable } from '@nestjs/common';
import { isReligion, NAME_POOLS, NamePool, Religion, RELIGIONS } from './names';

/**
 * Deterministic Indian name generation.
 *
 * Each religion has N first names and N last names, so it yields N² distinct
 * full names, addressed by ids 1..N². All religions together hold 1,000 first
 * and 1,000 last names; without a religion, ids 1..1,000,000 address every
 * pairing across the combined lists (which can mix religions).
 *
 * The id → name mapping depends on the exact contents and order of the lists
 * in ./names — any edit there reassigns names.
 */

export interface GeneratedName {
  id: number;
  firstName: string;
  lastName: string;
  fullName: string;
}

const COMBINED: NamePool = {
  firstNames: RELIGIONS.flatMap((r) => NAME_POOLS[r].firstNames),
  lastNames: RELIGIONS.flatMap((r) => NAME_POOLS[r].lastNames),
};

// Fail at startup, not with a silently wrong mapping, if the lists are edited
// into a shape the generator can't handle.
for (const religion of RELIGIONS) {
  const { firstNames, lastNames } = NAME_POOLS[religion];
  if (firstNames.length !== lastNames.length) {
    throw new Error(
      `Name generator: ${religion} has ${firstNames.length} first names but ` +
        `${lastNames.length} last names; the counts must match.`,
    );
  }
}
for (const list of [COMBINED.firstNames, COMBINED.lastNames]) {
  if (new Set(list).size !== list.length) {
    throw new Error('Name generator: a name appears in more than one list.');
  }
}

/** Highest valid id, for one religion or for the combined pool. */
export function maxNameId(religion?: Religion): number {
  return poolFor(religion).firstNames.length ** 2;
}

/** The name for `id` (1-based), optionally drawn from a single religion. */
export function generateName(id: number, religion?: Religion): GeneratedName {
  const pool = poolFor(religion);
  const size = pool.firstNames.length;
  if (!Number.isInteger(id) || id < 1 || id > size * size) {
    throw new RangeError(
      `Name id must be an integer from 1 to ${size * size}` +
        `${religion ? ` for ${religion}` : ''}; got ${id}.`,
    );
  }
  const [first, last] = permute(id - 1, size);
  const firstName = pool.firstNames[first];
  const lastName = pool.lastNames[last];
  return { id, firstName, lastName, fullName: `${firstName} ${lastName}` };
}

function poolFor(religion?: Religion): NamePool {
  if (religion === undefined) {
    return COMBINED;
  }
  if (!isReligion(religion)) {
    throw new RangeError(
      `Unknown religion "${religion}"; expected one of ${RELIGIONS.join(', ')}.`,
    );
  }
  return NAME_POOLS[religion];
}

const FEISTEL_ROUNDS = 4;

/**
 * Bijectively shuffle 0..size²-1 into a (first, last) index pair with a small
 * Feistel network. A plain div/mod split would give neighbouring ids the same
 * surname (Aarav Sharma, Aditya Sharma, …); every Feistel network is a
 * permutation, so each id still gets a distinct pair.
 */
function permute(index: number, size: number): [number, number] {
  let left = Math.floor(index / size);
  let right = index % size;
  for (let round = 0; round < FEISTEL_ROUNDS; round++) {
    [left, right] = [right, (left + roundHash(right, round, size)) % size];
  }
  return [left, right];
}

/** murmur3's 32-bit finaliser over (value, round); integer-only, so stable across JS engines. */
function roundHash(value: number, round: number, size: number): number {
  let h = Math.imul(value + 1, 0x9e3779b1) ^ Math.imul(round + 1, 0x85ebca77);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) % size;
}

@Injectable()
export class NameGeneratorService {
  generate(id: number, religion?: Religion): GeneratedName {
    return generateName(id, religion);
  }

  maxId(religion?: Religion): number {
    return maxNameId(religion);
  }
}
