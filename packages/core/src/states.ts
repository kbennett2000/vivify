// State→animation selection + movement/gesture direction (pure). The
// CharacterModel.states map keys are the well-known MS Agent state names
// (Showing, Hiding, Speaking, IdlingLevel1..3, Moving<Dir>, Gesturing<Dir>, …).

export type Rng = () => number;

/** Pick an animation name assigned to `state`, or undefined if the state is unmapped/empty. */
export function animationForState(
  states: Record<string, string[]>,
  state: string,
  rng: Rng = Math.random,
): string | undefined {
  const list = states[state];
  if (!list || list.length === 0) return undefined;
  if (list.length === 1) return list[0];
  return list[Math.floor(rng() * list.length)] ?? list[0];
}

export type Direction = 'Left' | 'Right' | 'Up' | 'Down';

/** Cardinal direction from (fromX,fromY) toward (toX,toY); horizontal wins ties. */
export function directionTo(fromX: number, fromY: number, toX: number, toY: number): Direction {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'Right' : 'Left';
  return dy >= 0 ? 'Down' : 'Up';
}

export function moveState(dir: Direction): string {
  return `Moving${dir}`;
}

export function gestureState(dir: Direction): string {
  return `Gesturing${dir}`;
}
