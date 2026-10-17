import * as buddhist from './buddhist';
import * as christian from './christian';
import * as hindu from './hindu';
import * as jain from './jain';
import * as jewish from './jewish';
import * as muslim from './muslim';
import * as sikh from './sikh';
import * as zoroastrian from './zoroastrian';

/**
 * Religions in the order their lists are concatenated into the combined
 * 1,000-name pools. Changing this order changes the combined id → name mapping.
 */
export const RELIGIONS = [
  'hindu',
  'muslim',
  'christian',
  'sikh',
  'buddhist',
  'jain',
  'zoroastrian',
  'jewish',
] as const;

export type Religion = (typeof RELIGIONS)[number];

export interface NamePool {
  readonly firstNames: readonly string[];
  readonly lastNames: readonly string[];
}

export const NAME_POOLS: Readonly<Record<Religion, NamePool>> = {
  hindu,
  muslim,
  christian,
  sikh,
  buddhist,
  jain,
  zoroastrian,
  jewish,
};

export function isReligion(value: string): value is Religion {
  return (RELIGIONS as readonly string[]).includes(value);
}
