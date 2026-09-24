import * as THREE from 'three';

type Angles = [number, number, number];

// A long reaching counterarm and a compact boxing-style guard. Both keep the
// elbow and fist on the wielder's own side of the chest.
const REACH: Record<'upperArmL' | 'forearmL', Angles> = {
  upperArmL: [-85, 20, 18], forearmL: [-20, -12, -12],
};
const GUARD: Record<'upperArmL' | 'forearmL', Angles> = {
  upperArmL: [-25, 20, 18], forearmL: [-105, -12, -12],
};

/** One-hand staff attacks: reach at windup, fold to guard at contact. */
const BEATS: Record<string, number[]> = {
  melee1: [0.75, 1, 0.1, 0.75], melee2: [0.75, 1, 0.1, 0.75], melee3: [0.75, 1, 0.1, 0.75],
  staff1: [0.75, 1, 0.1, 0.75], staff2: [0.75, 1, 0.1, 0.75], staff3: [0.75, 1, 0.1, 0.75],
  darksaber1: [0.75, 1, 0.1, 0.75], darksaber2: [0.75, 1, 0.1, 0.75], darksaber3: [0.75, 1, 0.1, 0.75],
  spearTest1Upper: [0.75, 1, 0.65, 0.1, 0.1, 0.75],
  spearTest2Upper: [0.75, 1, 0.65, 0.1, 0.1, 0.75],
  spearTest3Upper: [0.75, 1, 0.75, 0.45, 0.1, 0.1, 0.75],
  staffReturnUpper: [0.75, 1, 0.1, 0.1, 0.75],
  staffRiseUpper: [0.75, 1, 0.1, 0.1, 0.75],
  staffDropUpper: [0.75, 1, 0.1, 0.1, 0.75],
  staffDiagonalUpper: [0.75, 1, 0.1, 0.1, 0.75],
};

export const hasCounterweight = (name: string | null): boolean => !!name && name in BEATS;

/** The free arm's authored tracks, opposite a right-hand staff strike. */
export function counterweightTracks(name: string, times: number[], strength = 0.5): THREE.QuaternionKeyframeTrack[] {
  const reach = BEATS[name];
  if (!reach || times.length !== reach.length) throw new Error(`Counterweight beats mismatch: ${name}`);
  return (['upperArmL', 'forearmL'] as const).map((bone) => {
    const values = reach.flatMap((beat) => {
      const weight = beat * strength;
      const a = GUARD[bone], b = REACH[bone];
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        ...a.map((v, i) => (v + (b[i] - v) * weight) * Math.PI / 180) as Angles,
      ));
      return [q.x, q.y, q.z, q.w];
    });
    return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
  });
}

/** A workbench-only intensity choice, still stored as ordinary clip tracks. */
export function counterweightVariant(base: THREE.AnimationClip, strength: number): THREE.AnimationClip | null {
  if (!hasCounterweight(base.name)) return null;
  const arm = base.tracks.find((track) => track.name === 'upperArmL.quaternion');
  if (!arm) return null;
  const tracks = base.tracks.filter((track) =>
    track.name !== 'upperArmL.quaternion' && track.name !== 'forearmL.quaternion').map((track) => track.clone());
  tracks.push(...counterweightTracks(base.name, Array.from(arm.times), strength));
  return new THREE.AnimationClip(`${base.name}Offhand${Math.round(strength * 100)}`, base.duration, tracks);
}
