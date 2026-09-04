import * as THREE from 'three';
import { flightClips, flightPose, travelClip, type Animator, type FlightPose } from '../anim/animator';
import {
  MELEE_NAMES, RANGED_NAMES,
  type MeleeKind, type PlayerCharacter, type RangedKind,
} from '../characters/mandalorians';
import { playableDef, type PlayableId, type PlayerProfile } from '../characters/roster';
import { ThirdPersonCamera } from '../core/camera';
import { nodeCount, visibleBounds } from '../core/bounds';
import type { FrameInput } from '../core/input';
import { clamp, damp, dampAngle, yawBasis } from '../core/math';
import { audio } from '../core/audio';
import { gravityScale, hazardAt, type Board } from '../world/board';
import { GRAVITY, applyGravity, applyKnockback, newBurnState, tickHazards } from '../core/body';
import type { Game } from '../game/game';
import type { Combatant, Enemy } from '../enemies/enemy';
import type { StaticBox } from '../core/physics';
import type { DeflectSphere } from '../fx/projectiles';
import type { Vehicle } from '../game/vehicles';
import { markOwned } from '../core/dispose';
import { BROOD_EGG_RACK } from '../characters/enemies';
import { ThrownSaber } from './saberthrow';

/** scratch for measuring the body the camera is framing */
const _bodyBox = new THREE.Box3();
const _bodySize = new THREE.Vector3();
/** how often the body is re-measured for the camera, seconds */
const FRAME_RECHECK = 0.5;
/** how long RT must be held before a blade leaves the hand, seconds */
const THROW_HOLD = 0.22;
/** wind-up before the blade leaves the hand, seconds — the arm's cock-back */
const THROW_WINDUP = 0.18;
/** what a hit washes the body toward */
const _knock = new THREE.Vector3();
const HURT_TINT = new THREE.Color(0xd41f14);
/** the cold pulse a body wears while it cannot be hit */
const GUARD_TINT = new THREE.Color(0x4fc8ff);
/**
 * Untouchable for this long after a hit lands.
 *
 * Third person against a firing line, every bolt landing the instant it
 * arrives reads as no hits at all and then death: the flashes stack into one
 * smear and nothing separates them. A short window per hit turns that into a
 * countable sequence — flash, shove, breath, flash — which is the whole point.
 * Continuous damage (fire, hazards, drips) is exempt at both ends: it neither
 * checks the window nor opens one, so a lava field still kills.
 */
const HIT_IFRAMES = 0.3;
/** how long an X press during a swing waits for the swing to clear */
const MELEE_BUFFER = 0.25;
/**
 * How much of a hit aimed at a mounted rider carries into the ride under them.
 * The rider takes the hit in full — they are the one in the open — and this is
 * the splash off it: enough that a firefight fought from the saddle wears the
 * ride down, nowhere near enough to make the hull a health bar again.
 */
const RIDER_HIT_BLEED = 0.25;
/** and a fresh body gets a moment to find its feet before it can be shot */
const RESPAWN_IFRAMES = 1.6;
/** shove per hit, m/s, before the damage scale */
const HIT_KNOCKBACK = 5;
/** scratch for the block's facing test */
const _facing = new THREE.Vector3();

// scratch vectors for the per-frame jetpack emission
const _jetPos = new THREE.Vector3();
const _jetDir = new THREE.Vector3();
const _flipPivot = new THREE.Vector3();
const _flipSwung = new THREE.Vector3();
const _flipAxis = new THREE.Vector3();
const _jetRot = new THREE.Quaternion();
// scratch for where a returning saber is caught
const _catch = new THREE.Vector3();

const RUN_SPEED = 9.2;
const AIR_CONTROL = 7.5;
/** below this much of a g there is nothing to lean on: you drift (waystation.ts) */
const ZERO_G = 0.02;
const JUMP_VEL = 10;
const JET_ACCEL = 34;
const JET_MAX_UP = 11.5;
const FUEL_SECONDS = 3.4;
const DASH_SPEED = 19;
/**
 * Swimming, and what being built for it is worth.
 *
 * A fighter at home in the water — a Trandoshan, a Quarren, a massiff — swims
 * half again as fast, answers the stick harder (the damping and the turn rate
 * are the "manoeuvrability" half of it), kicks further off the dash and comes
 * out of a breach higher.
 */
const SWIM_SPEED = 5.4;
const SWIM_STEER = 3.5;
const SWIM_TURN = 8;
const SWIM_KICK = 8;
/** upward speed a jump near the surface throws you out with, m/s */
const BREACH_VEL = 8.5;
/** what all of the above are multiplied by for an amphibian */
const AMPHIB = 1.5;
/** super jump: sustained climb speed while A stays held from the leap, m/s */
const SUPERJUMP_RISE = 9;
/** super jump: gravity multiplier while feathering the fall with A held */
const SUPERJUMP_GLIDE = 0.35;
/** super jump: terminal fall speed while feathering, m/s */
const SUPERJUMP_FALL = 5.2;
/**
 * Grace window after walking off a ledge in which a jump still counts — and,
 * since it is the freshest record the mover keeps of the ground, how long a
 * body still feels what the ground is doing (see `groundShake`).
 */
const COYOTE_TIME = 0.12;
/** a jetpack A-tap released within this many seconds reads as a toggle, not a thrust hold */
const JET_TAP = 0.22;
/**
 * The acrobat's air somersault (`airFlip` in the profile).
 *
 * SPIN is how fast the tuck turns once it is up to speed, in radians a second
 * — a little over a turn and a half, which is quick enough to read as a
 * tumble and slow enough to follow. Letting go does not stop the turn dead:
 * the body carries on to the next whole revolution and unwinds into it, never
 * slower than SETTLE_MIN so it always arrives, easing in over the last of it.
 */
const FLIP_SPIN = 11;
const FLIP_SPIN_UP = 9;
const FLIP_SETTLE_MIN = 5;
const FLIP_SETTLE_EASE = 4.5;
/** eased jetpack descent: gravity multiplier while the pack idles against the fall */
const JET_DESCENT_GRAV = 0.3;
/** eased jetpack descent: terminal fall speed, m/s */
const JET_DESCENT_FALL = 4.5;
const SPRINT_SPEED = 14.4;      // vs RUN_SPEED 9.2
const SPRINT_SECONDS = 6;       // full gauge held down
const SPRINT_REFILL = 4.5;      // seconds to refill from empty
const DASH_ENERGY = 0.22;
/** the forward block pane's radius, and the closed bubble's (IG-11) */
const SHIELD_PANE_R = 0.78;
const SHIELD_BUBBLE_R = 1.25;

/**
 * Blaster heat, charged per shot rather than per second: a fast gun fills the
 * barrel sooner, which is the same curve the hostiles run on. At the carbine's
 * 0.24 s cycle that is a hair over four seconds of holding the trigger down
 * before the gas seals let go — long enough that a firefight is never about
 * counting shots, short enough that leaning on the trigger through a whole
 * wave is not the answer.
 */
const HEAT_PER_SHOT = 0.055;
/** heat shed per second, once the barrel has had a moment */
const HEAT_COOL = 0.45;
/** the barrel only starts shedding this long after the last shot */
const HEAT_COOL_DELAY = 0.35;
/** an overheated blaster stays locked until it has vented back down to here */
const HEAT_RESET = 0.15;
/** seconds of no swinging and no deflecting before the blades stow themselves */
const SABER_STOW_DELAY = 4;
/** seconds of block on a full gauge */
const BLOCK_SECONDS = 5;
/** you can shuffle behind the shield, but not run */
const BLOCK_SPEED = 3.2;
/** extra downward pull while blocking in the air, m/s² */
const BLOCK_SINK = 16;
/**
 * Outer space, as the *vertical* has to decide it: the gravity scale at or
 * under which the pull where you are standing counts as none at all.
 *
 * The Spice Run is the board this is for. Its field is a real 0.45 g directly
 * over a deck and nothing at all out in the open, blending across the
 * eighteen metres between — so this threshold is a *place* on that board
 * rather than the whole of it: true out among the platforms and under the
 * void plane, false again about ten metres above something you could land
 * on, which is exactly where the pull should take over and set you down.
 *
 * Deliberately looser than `ZERO_G`, which is the horizontal's line (see
 * `coasting`). The two axes want different answers: momentum should be kept
 * only where there is genuinely nothing to push against, while altitude
 * should stop drifting as soon as there is nothing to fall towards. Between
 * the two — roughly ten to fifteen metres over a deck — you hold your height
 * and still steer against the deck below, which is the reading that keeps a
 * platform fight feeling like a platform fight.
 */
const SPACE_GRAVITY = 0.15;
/** how fast a vertical drift bleeds to nothing out there (per second) */
const SPACE_STOP = 4;
/** the descent B settles at in the vacuum, m/s, and how briskly it gets there */
const SPACE_SINK = 6;
const SPACE_SINK_CATCH = 4.5;
/**
 * Landing, by the speed the ground was met at (m/s).
 *
 * A plain jump tops out at JUMP_VEL and comes back down at it, so the floor
 * sits just under that: step off a kerb and you keep running, land a jump and
 * the knees take it. Past HEAVY the legs have to be put back under you before
 * you can run again, which is the beat a rooftop drop is supposed to cost.
 */
const LAND_ABSORB = 9.5;
const LAND_HEAVY = 17;
/** how long a heavy landing keeps you from simply running off */
const LAND_RECOVER = 0.3;

/**
 * Cross-fade between two jetpack poses, seconds.
 *
 * Longer than a locomotion change (0.15-0.18): the flight poses are held
 * shapes rather than cycles, so the fade between them *is* the movement — the
 * legs swinging from trailing to plumb to reaching under. Cut short it reads
 * as a twitch; much longer and the brace is still arriving as the boots do.
 */
const FLY_FADE = 0.26;
/**
 * How far down the flight code looks for the ground, metres.
 *
 * Only the last few metres change the pose (`BRACE_CEIL` in animator.ts is
 * 7 m), so anything past this is "no ground" as far as the brace is concerned
 * and the probe can stop early.
 */
const GROUND_PROBE = 12;
/**
 * Per-pose shaping of the flight lean: [how much of the velocity lean to
 * keep, degrees of extra pitch].
 *
 * The lean is otherwise pure horizontal velocity, which is right for the
 * cruise and wrong everywhere else — it tipped a body hovering on the spot
 * flat when it drifted, and left one dropping onto a roof still nosed over.
 * The climb and the descent keep only a third of it and stand up; the brace
 * takes a couple of degrees the other way, so the boots lead the chest into
 * the ground.
 */
const FLY_LEAN: Record<FlightPose, [number, number]> = {
  fly: [1, 0],
  // a lateral drift is carried by the legs and the arms; the body stays
  // upright over them, and what forward component the travel has still leans
  flyDrift: [0.8, 0],
  flyDriftL: [0.8, 0],
  flyRise: [0.35, -1.5],
  flyFall: [0.3, -3],
  flyBrace: [0.25, -5],
};

/**
 * Fade from the flight brace into the landing crouch, seconds.
 *
 * Every other landing is all but a cut (0.05) because the body arrives out of
 * a fall in a shape that has nothing to do with a crouch. Out of the brace it
 * arrives in most of one, so this can be a real blend — the touchdown reads as
 * the reach continuing into the give rather than as a change of pose.
 */
const LAND_BRACE_FADE = 0.12;
/** how long the firing arm's recoil kick lasts, seconds */
const ARM_KICK = 0.06;
/** the kick's peak, radians — the shoulder rolls the muzzle up and rides it down */
const ARM_KICK_ANGLE = 0.16;
/** how much of the camera pitch the chest takes when aiming; the rest is the arms' fixed pose */
const AIM_PITCH_SHARE = 0.6;
/** the chest will not fold further than this either way, radians */
const AIM_PITCH_MAX = 0.55;

/**
 * The aim-glide: sighting a shot on the way down.
 *
 * Falling is 18 m/s of the ground rushing up, which is no place to line
 * anything up — so aiming in the air, with the jetpack off, has the boosters
 * catch you instead. You do not hover (that is what the jetpack is for) and
 * you do not stop; you sink slowly enough to shoot, on fuel, which is the
 * cost. It reads as slow motion and is nothing of the kind: the world runs at
 * full speed and only you are being held up.
 */
const GLIDE_FALL = -1.9;
/** seconds of glide on a full tank — cheaper than thrust, not free */
const GLIDE_SECONDS = 7;
/** the tank has to have this much in it to catch you at all */
const GLIDE_RESERVE = 0.04;
/** how fast the fall is caught, and how much the drift bleeds off with it */
const GLIDE_CATCH = 5;
const GLIDE_DRAG = 1.1;
const ROCKET_CD = 12;
/**
 * The death-to-respawn performance (docs/MODES.md): the death animation plays,
 * the pose freezes, and the body disintegrates into drifting motes; on the
 * respawn it re-forms at the new spot, motes converging as it fades back in.
 * The timers are the whole respawn wait — the player watches the cycle rather
 * than a countdown.
 */
const DEATH_ANIM_TIME = 1.1;
/** seconds the disintegration takes — and the re-form on the other side */
const DISSOLVE_TIME = 1.3;

export class Player {
  char: PlayerCharacter;
  cam: ThirdPersonCamera;
  /** stats and identity for whoever is being played — Mandalorian or NPC */
  profile: PlayerProfile;
  position = new THREE.Vector3();
  velocity = new THREE.Vector3();
  radius = 0.45;
  height = 1.75;
  /**
   * Standing in a transport door's pocket, waiting on the rest of the party
   * (docs/MISSIONS_OUTDOOR.md §1.9). Going back through a door needs everyone
   * aboard, so a player who steps in stops taking input and stops taking
   * damage until the others join them — or until they cancel back out.
   */
  exited = false;
  /** they pressed cancel this frame; the campaign walks them back out */
  cancelExit = false;
  hp = 100;
  maxHp = 100;
  /** PvP: respawns left; other modes never read it */
  lives = 0;
  /** who last hurt this player (their slot), for PvP kill credit */
  lastHitBy = -1;
  /** set by Game once a PvP death has been scored */
  deathCounted = false;
  fuel = 1;
  /**
   * Seconds left of a heavy landing's recovery: the legs are absorbing the
   * drop and there is no running out of it yet.
   */
  private landRecovery = 0;
  /** seconds left of the landing crouch, so leaving the ground can release it */
  private landTimer = 0;
  /**
   * Nobody is holding this one's controller: its input comes from a `BotBrain`
   * rather than a pad. It is a player in every other respect — same body, same
   * weapons, same rules — and only the split-screen and the HUD care.
   */
  isBot = false;
  /** sprint gauge, separate from jetpack fuel: 1 = full */
  energy = 1;
  /** riding the boosters down on the sights: slow descent, fuel burning */
  gliding = false;
  /** blaster heat, 0..1; at 1 the weapon locks out until it has vented */
  heat = 0;
  /** true while the blaster is locked out and venting */
  overheated = false;
  /** counts down from the last shot; the barrel sheds nothing until it hits 0 */
  private heatHold = 0;
  sprinting = false;
  /** shield up: drains the same gauge sprinting does */
  blocking = false;
  /** scratch for the shield collider handed to the projectile system */
  private shieldSphere = {
    center: new THREE.Vector3(), radius: SHIELD_PANE_R, normal: new THREE.Vector3(),
    minDot: 0,
  };
  /** 0..1 raise animation for the shield pane */
  private blockRaise = 0;
  /**
   * RB pressed with the stick centred arms a dash instead of a sprint; the
   * next direction pushed spends it. See the dash block below.
   */
  private dashArmed = false;
  /** RB was pressed while already moving, so this hold is a sprint */
  private sprintLatched = false;
  /**
   * What is in the hands. `none` is empty-handed, which only a melee-only
   * fighter reaches: for everyone else 'blaster' is the stowed-melee state.
   * Everything gated on 'blaster' — aiming, firing, lock-on, peek-fire —
   * therefore switches itself off for a character who carries no gun.
   */
  weapon: 'blaster' | 'gaffi' | 'none' = 'blaster';
  /** which of the carried weapons is in each slot; the D-pad moves these */
  private rangedIdx = 0;
  private meleeIdx = 0;
  /**
   * Seconds of no swinging and no deflecting before the blades go away again.
   * A saber fighter walks the board with empty hands and lights up the moment
   * she needs to, rather than jogging around lit like a road flare.
   */
  private saberIdle = 0;
  /** scratch for the saber deflect collider */
  private saberSphere = {
    center: new THREE.Vector3(), radius: 0.95, normal: new THREE.Vector3(),
    // Past the shoulders, short of the back. The old ±69° cone measured out as
    // a real gap: fire from three quarters on landed while the blades were
    // plainly working, which is what "some attacks get through" was.
    kind: 'saber' as const, minDot: -0.2,
    aim: null as THREE.Vector3 | null,
    consume: () => this.consumeDeflect(),
  };
  private deflectAim = new THREE.Vector3();
  // ---- saber throw (RT, saber fighters only) ----
  /** the blades in flight, one slot per hand (0 = main, 1 = off) */
  private thrownSabers: [ThrownSaber | null, ThrownSaber | null] = [null, null];
  /** seconds RT has been held since the pull, or -1 when not tracking one */
  private throwHold = -1;
  /** seconds left of the wind-up before the blade leaves the hand, or -1 */
  private throwWind = -1;
  private throwHand: 0 | 1 = 0;
  /** a tap that ended before the hold matured, waiting to become a swing */
  private pendingMelee = false;
  /** scene-level container for the flying blades and their trails */
  private throwFx: THREE.Group | null = null;
  /** last frame's RT, for press-edge detection independent of the masks */
  private prevThrowHeld = false;
  /** reach of the current swing — bare hands are shorter than a blade */
  private meleeRange = 3;
  /** the current swing is bare-handed (both blades thrown away) */
  private meleeBare = false;
  alive = true;
  kills = 0;
  team = 0;
  /** netted: legs bound for a moment — walk it off slowly, or cut free with melee */
  snareTimer = 0;
  /** burn-zone damage accrues and lands in ticks so the hurt feedback isn't a buzz (src/core/body.ts) */
  private burn = newBurnState();
  // ---- water ----
  /** chest-deep with the bottom in standing reach: slow, exposed, but walking */
  wading = false;
  /** head under, no bottom in reach: free 3D swimming */
  swimming = false;
  private wasInWater = false;
  /** seconds spent in the water since last touching dry ground (boards read this — the mamacore hunts by it) */
  waterTime = 0;

  grounded = false;
  // ---- jetpack eased descent (flight: 'jetpack') ----
  /**
   * A quick airborne A tap toggles this: the pack idles against gravity so
   * the fall becomes a slow, steerable drop. Off by default, off again on
   * landing — falling normally is always the state you take off from.
   */
  slowDescent = false;
  /** seconds since an airborne A press being classified; -1 = none pending */
  private airTap = -1;
  /** easing the fall this frame (the gravity block reads it) */
  private jetEasing = false;
  // ---- super jump (flight: 'superjump') ----
  /** the A hold from the take-off is still unbroken: the climb is live */
  private riseHold = false;
  /** climbing under the hold this frame (gravity stands aside) */
  private superRising = false;
  /** feathering the fall with A held (reduced gravity, capped fall) */
  private superGliding = false;
  // ---- air somersault (profile.airFlip) ----
  /** the button is down and the tuck is turning */
  private flipping = false;
  /** how far through the somersault, radians; 0 when upright and idle */
  private flipAngle = 0;
  /** current turn rate, radians a second */
  private flipSpin = 0;
  /** where the unwind is heading: the next whole revolution, radians */
  private flipTarget = 0;
  /** the body lean the flight code asks for, kept apart from the somersault */
  private leanX = 0;
  /**
   * Which jetpack pose is on the body — hover/climb, cruise, descent or the
   * brace for the ground. Kept from frame to frame because `flightPose` uses
   * it for hysteresis: sitting on a threshold would otherwise strobe.
   */
  private flyPose: FlightPose = 'fly';
  /** true while the flight poses own the body, so the lean can be shaped to them */
  private flying = false;
  private coyote = 0;
  private fireCd = 0;
  private thrusting = 0;
  private dashTimer = 0;
  private dashCd = 0;
  private dashDir = new THREE.Vector3();
  private slamming = false;
  private meleeStep = 0;
  private meleeTimer = 0;
  private meleeComboWindow = 0;
  private meleeHitPending = 0;
  /** seconds a swing press is remembered while the current swing plays out */
  private meleeBuffer = 0;
  private meleeDamage = 0;
  /** seconds of animation freeze left after a landed melee hit */
  private hitStop = 0;
  /** seconds left of the arm's recoil kick after a shot (see ARM_KICK) */
  private armKick = 0;
  /** the chest's current aim pitch, radians, eased toward the camera's */
  private aimPitch = 0;
  /** the post-combo saber flourish has played (or nothing to flourish) */
  private flourished = true;
  /** keeps the blade trail alive through the flourish, which isn't a swing */
  private trailTimer = 0;
  rocketCd = 0;
  private regenDelay = 0;
  respawnTimer = 0;
  /** seconds since death — drives the death-anim → freeze → disintegrate timeline */
  private deadT = 0;
  /** re-form countdown after a respawn; while > 0 the body is assembling: no input, no damage */
  formT = 0;
  /** original materials, swapped out for the dissolve's transparent clones */
  private savedMats: Map<THREE.Mesh, THREE.Material | THREE.Material[]> | null = null;
  /** set by death: the next spawnAt plays the re-form (a takeover cancels it) */
  private rebirth = false;
  /** the fighter picked on the select screen — what a respawn morphs back into */
  readonly baseCharacterId: PlayableId;
  /** the brood-queen loop: what this body grows back into once growT runs out */
  growInto: PlayableId | null = null;
  private growT = 0;
  /**
   * The broodmother's clutch: eggs charged and ready on her back. Starts
   * empty (every sac shaded dark) and gains one every three seconds — the
   * sac flashes blue as it finishes, then holds white until spent. Y lays
   * one behind her; RT lobs one at the aim. Capacity is exactly the sacs
   * the model shows (BROOD_EGG_RACK).
   */
  private eggsReady = 0;
  private eggCharge = 0;
  private eggStates: number[] = new Array(BROOD_EGG_RACK).fill(-1);
  /** ready eggs on the broodmother's back, for the HUD */
  get eggClutch(): number { return this.eggsReady; }
  private hurtFlash = 0;
  /** counts down the window in which nothing discrete can land (see HIT_IFRAMES) */
  private hitGuard = 0;
  /** true while that window came from respawning rather than from a hit */
  private freshBody = false;
  private facingYaw = Math.PI;
  /** which way the body is pointed, for anything outside that needs the arc */
  get yaw(): number { return this.facingYaw; }
  /**
   * What this fighter is shot at as. `height` is the clamped collider — the
   * level-fit capsule a playable war beast walks the boards in — so anything
   * aiming or registering a hit reads this instead. See PlayerProfile.
   */
  get hitHeight(): number { return this.profile.hitHeight; }
  private wasGrounded = true;
  private footTimer = 0;
  private sprintRefillDelay = 0;
  private wasThrusting = false;
  private wasAiming = false;
  /** true while ADS — the HUD only draws a crosshair when this is set */
  aiming = false;
  lastDamageDir = new THREE.Vector3();
  // ---- cover (RDR2 snap-to-cover) ----
  /** the box being hugged, plus the outward normal of the face we're on */
  cover: { box: StaticBox; nx: number; nz: number } | null = null;
  /** a face is close enough to snap to right now (drives the HUD prompt) */
  nearCover = false;
  /** currently leaning out past the corner to shoot */
  peeking = false;
  // ---- vehicles (PLAN.md §17) ----
  /** the ride being driven; while set, hits on the rider land on the hull */
  vehicle: Vehicle | null = null;
  /** a parked ride in mounting range (drives the HUD prompt) */
  nearVehicle: Vehicle | null = null;
  /** which corner this peek leans around: -1/+1 along the face tangent, 0 = unset */
  private peekSide = 0;
  private peekRecheck = 0;
  private pushAwayTime = 0;
  /** subtree size the camera framing was last measured against (see frameCamera) */
  private framedNodes = -1;
  /** how long until the body is measured again, seconds */
  private frameCheck = 0;
  /**
   * Per-instance copies of this fighter's materials, with the colour they
   * started at. Cloned rather than tinted in place: an authored sculpt hands
   * every instance the same material objects, so reddening a hit player would
   * redden every other body wearing that model — the rest of the party, and
   * every hostile of the same kind.
   */
  private tintMats: { m: THREE.MeshStandardMaterial; base: THREE.Color }[] = [];
  private tintNodes = -1;
  /** last tint written, so an unhurt fighter costs nothing per frame */
  private tintAt = -1;
  private guardAt = -1;

  constructor(public slot: number, aspect: number, public characterId: PlayableId = 'din') {
    this.baseCharacterId = characterId;
    const def = playableDef(characterId);
    this.profile = def.profile;
    this.char = def.build();
    this.maxHp = this.profile.maxHp;
    this.hp = this.maxHp;
    this.radius = this.profile.radius;
    this.height = this.profile.height;
    if (this.meleeOnly) this.weapon = 'none';
    this.cam = new ThirdPersonCamera(aspect);
    this.frameCamera();
  }

  /**
   * Tell the chase rig how big this fighter actually is.
   *
   * It has to be measured rather than read off the profile: a playable NPC's
   * collider is clamped so a war beast still fits the cover and doorways the
   * boards were built around, which leaves `radius`/`height` describing a
   * capsule that a massiff is four metres longer than. The camera framed by
   * those numbers sits inside the animal.
   *
   * Re-measured when the subtree changes shape, because a character is born as
   * a procedural stand-in and its authored model swaps in seconds later at its
   * own size — a frame computed once is a frame of the wrong body.
   */
  private frameCamera(): void {
    const nodes = nodeCount(this.char.root);
    if (nodes === this.framedNodes) return;
    visibleBounds(this.char.root, _bodyBox);
    if (_bodyBox.isEmpty()) return;
    this.framedNodes = nodes;
    _bodyBox.getSize(_bodySize);
    this.cam.setSubject(_bodySize.y, Math.max(_bodySize.x, _bodySize.z) / 2);
  }

  /** the gun currently drawn (or the one a trigger pull would draw) */
  get rangedKind(): RangedKind | null {
    return this.profile.rangedOptions[this.rangedIdx] ?? null;
  }
  /** the blade currently drawn (or the one a swing would draw) */
  get meleeKind(): MeleeKind {
    return this.profile.meleeOptions[this.meleeIdx] ?? this.profile.meleeKind;
  }

  /**
   * Take private copies of the body's materials, once per shape change.
   *
   * Same trigger as `frameCamera`: a character is born a procedural stand-in
   * and swaps to its authored .glb seconds later, and the new body arrives
   * wearing the shared materials this has to replace.
   */
  private adoptTintMats(): void {
    const nodes = nodeCount(this.char.root);
    if (nodes === this.tintNodes) return;
    this.tintNodes = nodes;
    this.tintMats = [];
    this.tintAt = -1;
    this.char.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.material) return;
      // a readout (the broodmother's egg rack) says what it says: the flash
      // would overwrite the clutch with the colour of being hit
      if (mesh.userData.readout) return;
      const many = Array.isArray(mesh.material);
      const list = (many ? mesh.material : [mesh.material]) as THREE.Material[];
      const mine = list.map((src) => {
        if (!(src as THREE.MeshStandardMaterial).color) return src;
        const m = src.clone() as THREE.MeshStandardMaterial;
        this.tintMats.push({ m, base: m.color.clone() });
        return m;
      });
      mesh.material = many ? mine : mine[0];
    });
  }

  /**
   * Flash the body red on a hit.
   *
   * Third person means the shooter's hit marker is no use to the person being
   * shot: you are looking at your own back, and in split-screen at your
   * squad's. Reddening the whole fighter is the one cue that reads at any
   * range and any camera angle. Colour rather than emissive, so it does not
   * fight `setHeroLight`, which owns the emissive channel on these same
   * materials.
   */
  private applyHurtTint(): void {
    const t = Math.min(1, this.hurtFlash * 0.9);
    // A body that just re-formed pulses cold instead, so the moment where it
    // cannot be shot is visible to the person holding the pad and to everyone
    // shooting at them. A hit always wins the colour — there is never both.
    const guard = t > 0.01 || !this.freshBody || this.hitGuard <= 0
      ? 0 : 0.3 + Math.sin(this.hitGuard * 24) * 0.22;
    if (t === this.tintAt && guard === this.guardAt) return;
    this.tintAt = t;
    this.guardAt = guard;
    for (const e of this.tintMats) {
      e.m.color.copy(e.base);
      if (t > 0.01) e.m.color.lerp(HURT_TINT, t);
      else if (guard > 0) e.m.color.lerp(GUARD_TINT, guard);
    }
  }

  /**
   * What the HUD calls the weapon currently in hand.
   *
   * The signature slot keeps the name the character sheet gave it — a beast's
   * "Claws & Steel", a trooper's "<kind> Blaster" — and anything cycled to
   * from there is named for what it is.
   */
  weaponLabel(): string {
    const melee = this.meleeIdx === 0 ? this.profile.meleeName : MELEE_NAMES[this.meleeKind];
    if (this.weapon === 'none') return `${melee} · stowed`;
    if (this.weapon === 'gaffi') {
      if (this.meleeKind === 'sabers' && this.sabersHeld < 2) return `${melee} · thrown`;
      return melee;
    }
    const gun = this.rangedKind;
    if (!gun) return melee;
    return this.rangedIdx === 0 ? this.profile.rangedName ?? RANGED_NAMES[gun] : RANGED_NAMES[gun];
  }

  /**
   * Shed barrel heat, once the trigger has been off it for a moment.
   *
   * The hold is the whole mechanic: without it a weapon cooling every frame
   * nets out against its own fire rate and never heats at all, so sustained
   * fire has to out-pace a cooling that is simply not running.
   */
  private coolBlaster(dt: number): void {
    this.heatHold = Math.max(0, this.heatHold - dt);
    if (this.heatHold > 0) return;
    this.heat = Math.max(0, this.heat - HEAT_COOL * dt);
    if (this.overheated && this.heat <= HEAT_RESET) this.overheated = false;
  }

  /** One shot's worth of heat, and the lockout when the barrel has had enough. */
  private addHeat(): void {
    this.heat = Math.min(1, this.heat + HEAT_PER_SHOT);
    this.heatHold = HEAT_COOL_DELAY;
    if (this.heat >= 1) {
      this.overheated = true;
      audio.overheat();
    }
  }

  spawnAt(p: THREE.Vector3): void {
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.hp = this.maxHp;
    this.fuel = 1;
    this.energy = 1;
    this.heat = 0;
    this.overheated = false;
    this.heatHold = 0;
    this.alive = true;
    this.respawnTimer = 0;
    // a fresh body is briefly untouchable — long enough to see where it
    // landed and move, rather than dying again into the same firing line
    this.hitGuard = RESPAWN_IFRAMES;
    // nothing carried over from the last body: a net taken before dying
    // used to re-form the player still crawling at snare speed
    this.snareTimer = 0;
    this.hurtFlash = 0;
    this.meleeTimer = 0;
    this.dashTimer = 0;
    this.freshBody = true;
    this.slamming = false;
    this.eggsReady = 0;   // a fresh body starts with every sac dark
    this.eggCharge = 0;
    this.cover = null;
    this.peeking = false;
    // any blade still in flight snaps straight back into the hand
    this.thrownSabers.forEach((t, h) => {
      if (t && t.state !== 'held') {
        t.reset();
        this.char.setSaberHeld?.(h as 0 | 1, true);
      }
    });
    this.char.animator!.releaseAll();
    this.char.root.visible = true;
    // A body that burned away re-forms where it respawns: it starts invisible
    // and fades in as the motes converge, and the camera flies over to the
    // new spot rather than cutting. Armed by die() rather than keyed off the
    // dissolve clones, so a respawn that morphed back to the base fighter (a
    // fresh body, no clones yet) still re-forms; a spawn with no death behind
    // it (match start) and the PvP squad takeover (cancelRebirth) skip it.
    if (this.rebirth) {
      this.rebirth = false;
      this.ensureDissolveMats();
      this.formT = DISSOLVE_TIME;
      this.setOpacity(0);
      this.cam.glideFrom(0.9);
      // Where the view *ends up* is settled by `faceOpenGround`, which the
      // caller runs once the body is placed: a checkpoint inside a room hands
      // out spots against a wall, and swinging the look onto the new body
      // from wherever the old one died left half of them staring into one.
      const look = p.clone();
      look.y += this.height;
      this.cam.snapToward(look, 0.5);
    }
  }

  /**
   * Turn a freshly placed body — and its camera — toward the open side.
   *
   * Called after a spawn rather than inside `spawnAt`, because the answer
   * depends on the world and `spawnAt` is handed nothing but a point. A body
   * re-formed in a corner used to come back facing the corner: the camera
   * kept the bearing the last body died on, the legs kept the last facing,
   * and the first second of a fresh life was spent turning round. Now both
   * point down the clearest line out of the spot, which in the open is
   * whatever the camera was already looking at (see `openBearing`).
   */
  faceOpenGround(game: Game): void {
    const yaw = game.board.physics.openBearing(
      this.position.x, this.position.y + this.height * 0.55, this.position.z, this.cam.yaw);
    this.facingYaw = yaw;
    this.char.root.rotation.y = yaw;
    this.cam.face(yaw);
  }

  /** the takeover possesses a body already standing: no re-form on its spawnAt */
  cancelRebirth(): void {
    this.rebirth = false;
  }

  /**
   * Become a different playable mid-match, in place: the body and the stat
   * sheet swap; position, camera, team, kills and lives stay. This is the
   * brood-queen loop's engine — broodmother → hatchling on the takeover,
   * hatchling → broodmother on growth — and how a respawn walks a morphed
   * player back to the fighter they picked.
   */
  morph(id: PlayableId, game: Game): void {
    this.restoreMats();   // any dissolve clones belong to the body being shed
    game.scene.remove(this.char.root);
    const def = playableDef(id);
    this.characterId = id;
    this.profile = def.profile;
    this.char = def.build();
    this.char.setHeroLight(game.board.heroLight ?? 0);
    this.maxHp = this.profile.maxHp;
    this.hp = Math.min(this.hp, this.maxHp);
    this.radius = this.profile.radius;
    this.height = this.profile.height;
    this.weapon = this.profile.rangedName === null ? 'none' : 'blaster';
    this.rangedIdx = 0;
    this.meleeIdx = 0;
    this.growInto = null;
    this.growT = 0;
    this.eggsReady = 0;
    this.eggCharge = 0;
    this.formT = 0;
    this.char.root.position.copy(this.position);
    game.scene.add(this.char.root);
    this.framedNodes = -1;   // the camera re-measures the new silhouette
    this.frameCheck = 0;
  }

  /** arm the growth clock: survive `secs` in this body and become `into` */
  beginGrowth(into: PlayableId, secs: number): void {
    this.growInto = into;
    this.growT = secs;
  }

  /**
   * @param opts.dot  continuous damage — fire, hazards, a shocking floor. It
   *   ignores the post-hit window and does not open one, so a burn keeps
   *   burning and standing in lava is still fatal.
   */
  damage(amount: number, from: THREE.Vector3, bySlot = -1, opts: { dot?: boolean; heavy?: boolean } = {}): void {
    // a body still assembling isn't there to hit yet, and neither is one
    // standing in a transport door waiting on the rest of the party
    if (!this.alive || this.formT > 0 || this.exited) return;
    // A kill zone is not an attack and is never shrugged off, and neither is
    // a heavy blow (`opts.heavy`): the guard exists so a volley of bolts lands
    // as a rhythm rather than a wall, not so that a bolt 0.2 s before a
    // warlord's slam, a massiff's pounce, a wind-up swing or a drone's
    // detonation turns the big, telegraphed hit into nothing. The callers
    // that commit to a hit say so; everything else still waits its turn.
    if (!opts.dot && !opts.heavy && amount < 500 && this.hitGuard > 0) return;
    // The ride's deflector answers before anything else does (PLAN.md §17).
    // While it is up, what is aimed at the rider stops at the bubble: nothing
    // lands on them and nothing bleeds into the hull under them, and the field
    // takes its sip of the gauge that is holding it there. A kill zone is not
    // an attack and goes through it, the same way it goes through the hull.
    if (this.vehicle?.shielded && amount < 500) {
      this.vehicle.shieldHit(amount);
      return;
    }
    // Mounted, you are still the one in the open (PLAN.md §17, second pass).
    // The hull used to soak every hit aimed at the rider, which made a ride a
    // suit of armour worth more than the fight: a skiff's plate is not between
    // a bolt and a man standing on its deck. What is aimed at the rider hits
    // the rider; the hull has its own hit spheres and takes what is aimed at
    // it. A share of it does carry into the ride — a swing or a blast around
    // the saddle chews the thing you are sitting on — so a mounted fight
    // still costs the ride something.
    if (this.vehicle && amount < 500) {
      this.vehicle.damage(amount * RIDER_HIT_BLEED, from, -1);
      this.noteVehicleHit(from);
    }
    // A raised shield is a shield: the pane already turns bolts, and now a
    // swing, a flame or a slam arriving from the front lands at half force,
    // with the pane's own flash and a sip of energy for it. From behind, or
    // with the pane not yet up, nothing changes.
    if (!opts.dot && amount < 500 && this.blockRaise > 0.6) {
      const fx = Math.sin(this.facingYaw), fz = Math.cos(this.facingYaw);
      _knock.subVectors(from, this.position).setY(0);
      if (_knock.lengthSq() > 1e-6 && _knock.normalize().dot(_facing.set(fx, 0, fz)) > 0.2) {
        amount *= 0.5;
        this.energy = Math.max(0, this.energy - 0.06);
        this.char.shieldHit();
      }
    }
    this.hp -= amount;
    if (bySlot >= 0 && bySlot !== this.slot) this.lastHitBy = bySlot;
    this.regenDelay = 5;
    this.hurtFlash = 1;
    this.lastDamageDir.subVectors(from, this.position);
    audio.hurt(this.profile.voice);
    if (!opts.dot) {
      this.hitGuard = HIT_IFRAMES;
      this.freshBody = false;
      // Every hit moves you. A bolt is a nudge, a slam is a shove; the scale
      // keeps a trooper's pot-shot from launching anyone while still being the
      // thing that says "that one landed". Cover holds you where you are.
      const heft = clamp(amount / 30, 0.35, 1.6);
      this.cam.shake(0.1 + heft * 0.12);
      // the body says it too: a short flinch on the upper channel, unless a
      // swing or the shield is already using the arms
      if (this.meleeTimer <= 0 && this.blockRaise < 0.3 && this.hp - amount > 0) {
        this.char.animator?.playOnce('upper', 'hitUpper', 0.05);
      }
      if (!this.cover && this.snareTimer <= 0) {
        applyKnockback(this.velocity, this.position, from, HIT_KNOCKBACK * heft,
          this.grounded && amount >= 20 ? 1.1 : 0);
      }
    } else this.cam.shake(0.06);
    if (this.hp <= 0) this.die();
  }

  /**
   * A jolt that arrives through the ground — a warlord's slam, the quake
   * before a monster comes up, something heavy landing nearby.
   *
   * The ground can only shake what is standing on it. These used to go
   * straight to `cam.shake`, which rattled a Mandalorian forty metres up on
   * the jetpack exactly as hard as one standing in the dust: with nothing
   * under your feet the rumble stops reading as the world moving and starts
   * reading as the camera being broken. Off the ground it fades out with the
   * last of the contact (`COYOTE_TIME` — a hop still carries the thump,
   * flight does not), and swimming there is no contact at all.
   *
   * Blasts that travel through the air — a rocket, a grenade — are not these:
   * they still shake you wherever you are.
   */
  groundShake(amount: number): void {
    if (this.swimming) return;
    if (this.grounded) { this.cam.shake(amount); return; }
    const contact = clamp(this.coyote / COYOTE_TIME, 0, 1);
    if (contact > 0) this.cam.shake(amount * contact);
  }

  /** the hull took a hit under us: feedback without the health cost */
  noteVehicleHit(from: THREE.Vector3): void {
    this.hurtFlash = Math.max(this.hurtFlash, 0.45);
    this.lastDamageDir.subVectors(from, this.position);
  }

  private die(): void {
    this.vehicle?.dropRider();
    this.hp = 0;
    this.alive = false;
    this.deadT = 0;
    this.rebirth = true;
    // the wait *is* the performance: fall, freeze, burn away — then respawn
    this.respawnTimer = DEATH_ANIM_TIME + DISSOLVE_TIME + 0.1;
    const anim = this.char.animator!;
    anim.release('lower');
    anim.release('upper');
    anim.playOnce('lower', 'deathLower', 0.1, true);
    anim.playOnce('upper', 'deathUpper', 0.1, true);
    this.cover = null;
    this.peeking = false;
    audio.playerDeath(this.profile.voice);
    audio.setJetpackThrust(this.slot, 0);
  }

  get hurtIntensity(): number { return this.hurtFlash; }
  /** true while nothing discrete can land: just hit, or just respawned */
  get invulnerable(): boolean { return this.hitGuard > 0; }
  get meleeActive(): boolean { return this.meleeTimer > 0; }
  /** the corpse is mid-burn: pose frozen, body fading into motes */
  get dissolving(): boolean { return !this.alive && this.deadT > DEATH_ANIM_TIME; }

  /** swap every material for a per-body transparent clone the dissolve can fade */
  private ensureDissolveMats(): void {
    if (this.savedMats) return;
    const saved = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    this.char.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      saved.set(mesh, mesh.material);
      const clone = (m: THREE.Material): THREE.Material => {
        const c = markOwned(m.clone());
        c.transparent = true;
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
    });
    this.savedMats = saved;
  }

  /** the body is whole again: the original (shared, opaque) materials return */
  private restoreMats(): void {
    if (!this.savedMats) return;
    for (const [mesh, mats] of this.savedMats) {
      const cur = mesh.material;
      mesh.material = mats;
      for (const m of Array.isArray(cur) ? cur : [cur]) m.dispose();
    }
    this.savedMats = null;
  }

  private setOpacity(alpha: number): void {
    this.char.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.opacity = alpha;
    });
  }

  /**
   * One frame of the corpse burning away, `k` 0→1: the body fades as amber
   * motes stream off it, the emit point swept from the feet toward the head.
   */
  private setDissolve(k: number, game: Game): void {
    this.ensureDissolveMats();
    this.setOpacity(1 - k);
    if (k >= 1) { this.char.root.visible = false; return; }
    const at = this.position.clone();
    at.y += k * this.height;
    at.x += (Math.random() - 0.5) * this.radius * 2;
    at.z += (Math.random() - 0.5) * this.radius * 2;
    game.particles.disintegrate(at, 4);
  }

  /**
   * Animation time for this frame: near-frozen during hit-stop, so a landed
   * melee hit hangs on its contact frame for a few hundredths of a second.
   * The world keeps moving — only this body's mixer feels it.
   */
  private animDt(dt: number): number {
    if (this.hitStop <= 0) return dt;
    this.hitStop -= dt;
    return dt * 0.05;
  }

  /**
   * The block shield as the projectile system sees it: a sphere sitting a
   * little in front of the chest, facing the way we are. Null until the pane
   * is most of the way up, so a shield that is still rising does not yet
   * bounce anything.
   */
  get shieldCollider(): DeflectSphere | null {
    if (this.blockRaise >= 0.6) {
      const s = this.shieldSphere;
      s.normal.set(Math.sin(this.facingYaw), 0, Math.cos(this.facingYaw));
      if (this.profile.shield360) {
        // A closed bubble is centred on the body it encloses and answers from
        // every bearing: minDot -1 accepts a bolt arriving from behind, which
        // a forward pane deliberately does not. The normal still points ahead
        // so a mirrored bolt goes somewhere sensible.
        s.center.copy(this.position);
        s.center.y += this.profile.hitHeight * 0.5;
        s.radius = SHIELD_BUBBLE_R;
        // below -1 on purpose: the test is `face <= minDot`, so exactly -1
        // would still exclude a bolt arriving from dead astern
        s.minDot = -1.1;
      } else {
        s.center.copy(this.position).addScaledVector(s.normal, 0.6);
        s.center.y += 1.05;
        s.radius = SHIELD_PANE_R;
        s.minDot = 0;
      }
      return s;
    }
    return this.saberCollider;
  }

  /** the character fights with blades and carries nothing to shoot with */
  private get meleeOnly(): boolean {
    return this.profile.rangedOptions.length === 0;
  }

  /** blades out and free to work */
  get sabersDrawn(): boolean {
    return this.alive && this.weapon === 'gaffi' && this.meleeKind === 'sabers';
  }

  /** blades physically in hand — thrown ones are out in the world */
  get sabersHeld(): number {
    let held = 2;
    for (const t of this.thrownSabers) if (t && t.state !== 'held') held--;
    return held;
  }

  /**
   * Twin blades bat blaster fire away. It reuses the block shield's collider
   * rather than inventing a second mechanism, with three differences that make
   * it read as a parry and not a wall: a tighter frontal arc (a bolt from the
   * flank still lands), a short cooldown so a squad firing together gets shots
   * through, and an aim point — the bolt goes back at whoever is in front of
   * her rather than mirroring off a pane, which is the whole fantasy.
   */
  private get saberCollider(): DeflectSphere | null {
    // empty hands turn nothing: with both blades thrown there is no parry
    if (!this.sabersDrawn || this.sabersHeld === 0) return null;
    // an empty gauge stops the *idle* guard, never a swing that is underway
    if (this.energy <= 0 && this.meleeTimer <= 0) return null;
    const s = this.saberSphere;
    s.normal.set(Math.sin(this.facingYaw), 0, Math.cos(this.facingYaw));
    s.center.copy(this.position).addScaledVector(s.normal, 0.55);
    s.center.y += 1.15;
    s.aim = this.deflectTarget;
    return s;
  }

  /** where a deflected bolt is sent: the nearest hostile she is facing */
  private get deflectTarget(): THREE.Vector3 | null {
    const e = this.deflectEnemy;
    if (!e) return null;
    this.deflectAim.copy(e.position);
    this.deflectAim.y += 0.9;
    return this.deflectAim;
  }
  /** set each frame by the game, which is the only thing that knows the roster */
  deflectEnemy: { position: THREE.Vector3 } | null = null;

  /**
   * The blades turn everything they are facing, for as long as she holds them
   * up. No cooldown and no gauge: what limits the guard is where she is
   * pointing, not how long she has been at it — a shot from behind lands, and
   * that is the only way through.
   *
   * This replaced a per-bolt energy charge plus a 0.05 s spacing. Both were
   * balance guesses of mine, and both leaked bolts through a guard that was
   * plainly working, which reads as the parry being broken rather than as a
   * cost being paid. The arc does the limiting instead (`saberSphere.minDot`).
   */
  private consumeDeflect(): boolean {
    this.saberIdle = 0;   // turning a bolt counts as using the blades
    return true;
  }

  /** enemy currently under the crosshair's assist cone, for HUD feedback */
  lockedOn = false;

  update(dt: number, input: FrameInput, game: Game, realDt = dt): void {
    const anim = this.char.animator!;
    this.updateSaberHum();
    // Thrown blades fly on every path — cover, saddle, water, even death
    // (they come home to the body) — so they tick before any early return.
    this.updateSaberThrow(dt, input, game);
    if (!this.alive) { this.updateDeadBody(dt, game, anim); return; }

    // re-forming after a respawn: motes converge head-to-feet and the figure
    // fades back in where it will stand — watchable, untouchable, and deaf to
    // input until it is whole
    if (this.formT > 0) { this.updateForming(dt, game, realDt, anim); return; }

    // Waiting in a transport pocket: the body stands there, the camera still
    // looks around, and the only button that does anything is the one that
    // takes it back. Everything else would be a step out of the door the
    // party is waiting at.
    if (this.exited) {
      // B is the cancel: it is the game's own "back", and while you are in
      // the pocket the shield it normally raises has nothing to guard against
      if (input.blockHeld) this.cancelExit = true;
      input = { ...input, moveX: 0, moveY: 0, jumpHeld: false, jumpPressed: false,
        dashPressed: false, sprintHeld: false, shootHeld: false, meleePressed: false,
        rocketPressed: false, slamPressed: false, blockHeld: false };
      this.velocity.x = 0;
      this.velocity.z = 0;
    }

    this.updateGrowth(dt, game);
    this.updateEggRack(dt);
    this.tickTimers(dt);
    this.updateAim(input, game);
    if (this.updateVehicle(dt, input, game, realDt)) return;
    if (this.updateCover(dt, input, game, realDt)) return;
    if (this.updateWater(dt, input, game, realDt)) return;

    // ---- movement basis from camera yaw ----
    const { fwdX, fwdZ, rightX, rightZ } = yawBasis(this.cam.yaw);
    const wishX = fwdX * input.moveY + rightX * input.moveX;
    const wishZ = fwdZ * input.moveY + rightZ * input.moveX;
    const wishLen = Math.hypot(wishX, wishZ);
    const nx = wishLen > 0 ? wishX / wishLen : 0;
    const nz = wishLen > 0 ? wishZ / wishLen : 0;
    const moving = wishLen > 0.2;
    this.updateBlock(dt, input);
    this.updateDodge(dt, input, game, wishLen, nx, nz, fwdX, fwdZ, moving);
    this.updateGroundMove(dt, input, game, wishLen, nx, nz, moving);

    const jumped = this.updateJump(dt, input, game);
    this.updateJetpack(dt, input, game, jumped);
    this.updateSuperRise(dt, input);
    this.updateAirFlip(dt, input, jumped);

    // ---- slam ----
    if (input.slamPressed && !this.grounded && this.velocity.y < 6) {
      this.slamming = true;
      this.velocity.y = -30;
    }
    this.applyFall(dt, input, game);
    this.integrateAndLand(dt, game, anim);
    this.updateBounds(game);
    this.applyHazards(dt, game);
    this.updateCombatInput(dt, input, game);

    const speed2 = Math.hypot(this.velocity.x, this.velocity.z);
    this.updateFacing(dt, input, speed2);
    this.updateLocomotionAnim(dt, input, game, anim, speed2);

    this.syncVisual(dt, game);
    anim.update(this.animDt(dt));

    // camera last (after position settles) — on the wall clock, so the
    // camera stays crisp while the world is in slow motion
    this.cam.update(realDt, this.position, game.board.physics, {
      aiming: input.aimHeld, speed: speed2, dashing: this.dashTimer > 0,
      // thrust reads as flight even while hovering still; a plain fall gets
      // its width from the climb term instead, so a kerb-step isn't "flying"
      flying: this.thrusting > 0, climb: this.grounded ? 0 : this.velocity.y,
    });
  }

  /** the fall plays out, then the pose freezes and the body burns away */
  private updateDeadBody(dt: number, game: Game, anim: Animator): void {
      this.respawnTimer -= dt;
      this.deadT += dt;
      this.velocity.x = damp(this.velocity.x, 0, 6, dt);
      this.velocity.z = damp(this.velocity.z, 0, 6, dt);
      applyGravity(this.velocity, game.board, this.position, dt);
      game.board.physics.moveCapsule(this.position, this.radius, this.height, this.velocity, dt);
      this.syncVisual(dt, game);
      // the fall plays out, then the pose freezes and the body burns away
      const dis = (this.deadT - DEATH_ANIM_TIME) / DISSOLVE_TIME;
      if (dis <= 0) anim.update(dt);
      else this.setDissolve(Math.min(dis, 1), game);
  }

  /** motes converge head-to-feet and the figure fades back in where it will stand */
  private updateForming(dt: number, game: Game, realDt: number, anim: Animator): void {
      this.formT -= dt;
      const k = clamp(this.formT / DISSOLVE_TIME, 0, 1);   // 1 = still gone
      this.setOpacity(1 - k);
      const at = this.position.clone();
      at.y += k * this.height;
      at.x += (Math.random() - 0.5) * this.radius * 2;
      at.z += (Math.random() - 0.5) * this.radius * 2;
      game.particles.disintegrate(at, 4);
      if (this.formT <= 0) this.restoreMats();
      anim.play('lower', 'idleLower');
      anim.play('upper', 'idleUpper');
      this.syncVisual(dt, game);
      anim.update(dt);
      this.cam.update(realDt, this.position, game.board.physics, {
        aiming: false, speed: 0, dashing: false,
      });
  }

  /** the brood-queen loop: survive the growth clock and grow back (docs/MODES.md §3) */
  private updateGrowth(dt: number, game: Game): void {
    if (this.growInto && this.growT > 0) {
      this.growT -= dt;
      if (this.growT <= 0) {
        const into = this.growInto;
        const frac = clamp(this.hp / this.maxHp, 0.3, 1);
        this.morph(into, game);   // clears growInto
        this.hp = this.maxHp * frac;
        game.particles.dustPuff(this.position, 14);
        audio.bark('spider_chitter', 0.8);
        game.announce(`${this.profile.name} grows`, 'the brood has its queen again');
      }
    }
  }

  /** the broodmother's clutch charges one egg at a time, three seconds each */
  private updateEggRack(dt: number): void {
    if (this.profile.special === 'layEgg') {
      if (this.eggsReady < BROOD_EGG_RACK) {
        this.eggCharge += dt / 3;
        if (this.eggCharge >= 1) {
          this.eggsReady++;
          this.eggCharge = 0;
        }
      }
      for (let i = 0; i < BROOD_EGG_RACK; i++) {
        this.eggStates[i] = i < this.eggsReady ? 1
          : i === this.eggsReady && this.eggsReady < BROOD_EGG_RACK ? this.eggCharge : -1;
      }
      this.char.setEggs?.(this.eggStates);
    }
  }

  /** the per-frame clocks: cooldowns, the hurt flash, regen, the camera re-measure */
  private tickTimers(dt: number): void {
    // the authored model lands seconds into a match and is a different size
    // from the stand-in it replaces; the camera wants to hear about it
    this.frameCheck -= dt;
    if (this.frameCheck <= 0) {
      this.frameCheck = FRAME_RECHECK;
      this.frameCamera();
      this.adoptTintMats();
    }

    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    this.hitGuard = Math.max(0, this.hitGuard - dt);
    if (this.hitGuard <= 0) this.freshBody = false;
    this.applyHurtTint();
    this.coolBlaster(dt);
    this.fireCd -= dt;
    this.dashCd -= dt;
    this.rocketCd -= dt;
    this.meleeComboWindow -= dt;
    this.regenDelay -= dt;
    if (this.regenDelay <= 0 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 14 * dt);
  }

  /** camera dolly, look, and the lock-on that aim snaps on */
  private updateAim(input: FrameInput, game: Game): void {
    // ---- camera dolly ----
    // Hold the right stick in and push it up or down (or roll the wheel) to
    // set the chase distance; it sticks until it is changed again.
    if (input.zoomDelta) this.cam.dolly(input.zoomDelta);

    // aiming steadies the hand: finer look control while ADS
    const lookScale = input.aimHeld ? 0.55 : 1;
    this.cam.addLook(input.lookX * lookScale, input.lookY * lookScale);

    // lock-on: pressing aim snaps the camera onto the target nearest the
    // reticle, then fine aim is yours (RDR2's "Normal" lock-on)
    if (input.aimHeld && !this.wasAiming && this.weapon === 'blaster') {
      const dir = this.cam.aimDir(new THREE.Vector3());
      const lock = this.aimAssistTarget(game, dir, this.cam.camera.position, 0.9, 50);
      if (lock) {
        const chest = lock.position.clone();
        chest.y += lock.height * 0.55;
        this.cam.snapToward(chest);
      }
    }
    this.wasAiming = input.aimHeld;
    // aiming down sights needs sights: a blades-only fighter holding the aim
    // button just pulls the camera in, and draws no crosshair
    this.aiming = input.aimHeld && !this.meleeOnly;
  }

  /** RB near a parked ride mounts, and the ride wins the press. True = the ride took the frame */
  private updateVehicle(dt: number, input: FrameInput, game: Game, realDt: number): boolean {
    this.nearVehicle = this.vehicle ? null : this.findVehicle(game);
    if (!this.vehicle && this.nearVehicle && input.slamPressed) {
      this.nearVehicle.mount(this);
      this.cover = null;
      this.peeking = false;
      this.nearVehicle = null;
      // the press that mounted must not also read as the dismount press
      this.updateRiding(dt, { ...input, slamPressed: false }, game, realDt);
      return true;
    }
    if (this.vehicle) {
      this.updateRiding(dt, input, game, realDt);
      return true;
    }
    return false;
  }

  /** on the ground the slam button snaps to a nearby box. True = cover took the frame */
  private updateCover(dt: number, input: FrameInput, game: Game, realDt: number): boolean {
    const face = this.grounded ? this.findCoverFace(game) : null;
    this.nearCover = !!face && !this.cover;
    if (!this.cover && face && input.slamPressed) {
      this.cover = face;
      this.peeking = false;
      this.pushAwayTime = 0;
      audio.land(false); // the thump of shoulder meeting crate
      // the press that got us in must not also read as the press that exits
      this.updateInCover(dt, { ...input, slamPressed: false }, game, realDt);
      return true;
    }
    if (this.cover) {
      this.updateInCover(dt, input, game, realDt);
      return true;
    }
    return false;
  }

  /** wade where you can stand, swim where you cannot. True = swimming took the frame */
  private updateWater(dt: number, input: FrameInput, game: Game, realDt: number): boolean {
    const waterY = game.board.waterY;
    const inWater = waterY !== undefined && this.position.y + 0.9 < waterY;
    this.wading = false;
    let swimNow = false;
    if (inWater && waterY !== undefined) {
      const bottom = game.board.physics.groundHeight(this.position.x, this.position.z, this.position.y + 0.5);
      const depth = waterY - (isFinite(bottom) ? bottom : -1e9);
      if (depth > 1.7) swimNow = true;
      else this.wading = true;
    }
    if (inWater && !this.wasInWater) {
      // hitting the surface
      const p = this.position.clone().setY(waterY!);
      game.particles.splash(p, Math.abs(this.velocity.y) > 6 ? 22 : 12);
      audio.splash(true);
      game.director.noise(game, this.position, 18); // a splash carries
    } else if (!inWater && this.wasInWater) {
      game.particles.splash(this.position.clone().setY(waterY ?? this.position.y), 8);
      audio.splash(false, 0.4);
    }
    this.wasInWater = inWater;
    // the clock a lurking predator hunts by: runs in the water, resets ashore
    if (inWater) this.waterTime += dt;
    else if (this.grounded) this.waterTime = 0;
    if (swimNow) {
      this.swimming = true;
      this.updateSwimming(dt, input, game, realDt);
      return true;
    }
    this.swimming = false;
    return false;
  }

  /**
   * Spend the gauge on something that is not a step: the ride's deflector,
   * and the hits it turns.
   *
   * The bubble round a vehicle is this rider's shield thrown wider (PLAN.md
   * §17), so it comes out of this rider's budget — the same one sprinting,
   * dodging and the on-foot block draw on — and holding it up holds the
   * refill off exactly as blocking does. False once the gauge is empty, which
   * is what drops the field rather than any timer on the ride.
   */
  spendShield(amount: number): boolean {
    if (this.energy <= 0) return false;
    this.energy = Math.max(0, this.energy - amount);
    this.sprintRefillDelay = 0.7;
    return true;
  }

  /** block (hold B / R): the same gauge as sprinting, so a fight is a budget */
  private updateBlock(dt: number, input: FrameInput): void {
    // The shield is the same gauge as sprinting, so a fight is a budget: run
    // it down blocking and you have nothing left to run with.
    this.blocking = input.blockHeld && this.energy > 0 && this.meleeTimer <= 0 && this.dashTimer <= 0;
    if (this.blocking) {
      this.energy = Math.max(0, this.energy - dt / BLOCK_SECONDS);
      this.sprintRefillDelay = 0.7;
      this.dashArmed = false;
      this.sprintLatched = false;
    }
    this.blockRaise = damp(this.blockRaise, this.blocking ? 1 : 0, 14, dt);
    this.char.setBlock(this.blockRaise);
  }

  /** LB: a dodge in whatever direction it is given, then a sprint */
  private updateDodge(dt: number, input: FrameInput, game: Game,
    wishLen: number, nx: number, nz: number, fwdX: number, fwdZ: number, moving: boolean): void {
    // One press arms one dodge. If the stick is already pushed it fires on the
    // spot; if the stick is centred the dodge waits for a direction and goes
    // the instant one arrives. Either way, holding LB on past the dodge rolls
    // into a sprint (which means nothing in the air). The same arming works
    // airborne: a falling Mandalorian holds LB and flicks the stick to dart
    // that way — it used to fire camera-forward the instant LB was pressed
    // with the stick centred, which spent the dodge before a direction could
    // be chosen.
    const canDash = this.dashCd <= 0 && this.energy > DASH_ENERGY && !this.blocking && this.snareTimer <= 0 && !this.wading;
    if (input.dashPressed && !this.blocking) {
      this.dashArmed = true;
      // with no dodge to spend — cooling down, or out of gauge — holding it
      // still has to sprint, or the button would go dead mid-fight
      this.sprintLatched = !canDash;
    }
    if (!input.sprintHeld) { this.dashArmed = false; this.sprintLatched = false; }

    const dashNow = this.dashArmed && canDash && moving;
    if (dashNow) {
      this.dashArmed = false;
      // a dodge cuts a swing short once its contact frame has passed: the
      // lunge no longer owns the body, so the recovery is the player's to spend
      if (this.meleeTimer > 0 && this.meleeHitPending <= 0) {
        this.meleeTimer = 0;
        this.char.animator?.release('upper');
      }
      this.dashTimer = 0.24;
      this.dashCd = 0.75;
      this.energy = Math.max(0, this.energy - DASH_ENERGY);
      this.sprintRefillDelay = 0.7;
      const dir = wishLen > 0 ? new THREE.Vector3(nx, 0, nz) : new THREE.Vector3(fwdX, 0, fwdZ);
      this.dashDir.copy(dir);
      audio.dash();
      this.cam.shake(0.06);
      game.particles.dustPuff(this.position, 6);
      // holding on through the dash rolls into a sprint when it ends
      this.sprintLatched = true;
    }
  }

  /** sprint, the top speed everything trims, and the steering that reaches it */
  private updateGroundMove(dt: number, input: FrameInput, game: Game,
    wishLen: number, nx: number, nz: number, moving: boolean): void {
    const wantsSprint = this.sprintLatched && input.sprintHeld && moving
      && this.grounded && this.energy > 0 && !this.blocking;
    this.sprinting = wantsSprint && this.snareTimer <= 0 && !this.wading;
    if (this.sprinting) {
      this.energy = Math.max(0, this.energy - dt / SPRINT_SECONDS);
      this.sprintRefillDelay = 0.7;
    } else if (!this.blocking) {
      this.sprintRefillDelay -= dt;
      if (this.sprintRefillDelay <= 0) this.energy = Math.min(1, this.energy + dt / SPRINT_REFILL);
    }
    // netted: legs bound — a crawl until it runs out, or a melee swing cuts it
    this.snareTimer -= dt;
    if (this.snareTimer > 0 && input.meleePressed) this.snareTimer = 0;
    const snared = this.snareTimer > 0;
    let topSpeed = this.blocking ? BLOCK_SPEED : this.sprinting ? this.profile.sprintSpeed : this.profile.runSpeed;
    if (snared) topSpeed *= 0.32;
    // chest-deep: slow, loud, exposed — less so for something built for it
    if (this.wading) topSpeed *= this.profile.amphibious ? 0.75 : 0.45;
    // a heavy landing has to be absorbed before it can be run out of: the top
    // speed comes back over the recovery rather than switching on at the end
    this.landRecovery = Math.max(0, this.landRecovery - dt);
    this.landTimer = Math.max(0, this.landTimer - dt);
    if (this.landRecovery > 0) topSpeed *= 1 - 0.85 * (this.landRecovery / LAND_RECOVER);
    const speedTarget = Math.min(wishLen, 1) * topSpeed;

    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      this.velocity.x = this.dashDir.x * DASH_SPEED;
      this.velocity.z = this.dashDir.z * DASH_SPEED;
      if (this.velocity.y < 0) this.velocity.y = 0;
    } else if (this.coasting(game, moving)) {
      // Free-floating in vacuum with nothing asked of the stick: keep the
      // velocity you have. Damping toward a standstill is a *force*, and out
      // here there is nothing to push against — a body drifting between
      // platforms that slows to a halt on its own is the one thing space
      // cannot do. Point and burn to change it; otherwise you coast.
    } else {
      // on ice the grip goes: steering barely bites and running becomes a drift
      const traction = this.grounded ? (game.board.tractionAt?.(this.position.x, this.position.z) ?? 1) : 1;
      // a rising or gliding super jumper steers like a flyer (flags are a
      // frame stale here, which the eye cannot see)
      const airLambda = this.thrusting > 0 || this.superRising || this.superGliding ? 9 : AIR_CONTROL * 0.6;
      const lambda = this.grounded ? 13 * traction : airLambda;
      this.velocity.x = damp(this.velocity.x, nx * speedTarget, lambda, dt);
      this.velocity.z = damp(this.velocity.z, nz * speedTarget, lambda, dt);
    }
  }

  /**
   * Adrift: off the ground, out of reach of anything to fall toward, and not
   * being steered. Momentum is the whole of the movement here.
   *
   * The test is the local pull rather than a board flag, so it is true in the
   * open volume of a space station and false the moment a deck comes under
   * you — which is the same line the gravity field itself draws.
   */
  private coasting(game: Game, moving: boolean): boolean {
    if (this.grounded || moving || this.dashTimer > 0) return false;
    if (this.wading || this.swimming || this.cover) return false;
    return this.gravity(game.board) < ZERO_G;
  }

  /** the leap itself (and the hold that arms a super jump). True = it left the ground this frame */
  private updateJump(dt: number, input: FrameInput, game: Game): boolean {
    this.coyote = this.grounded ? COYOTE_TIME : this.coyote - dt;
    if (this.grounded) {
      this.riseHold = false;
      // the ground resets the descent toggle: you always take off falling normally
      this.slowDescent = false;
      this.airTap = -1;
    }
    const superjump = this.profile.flight === 'superjump';
    let jumped = false;
    if (input.jumpPressed && this.coyote > 0 && !this.blocking && this.snareTimer <= 0) {
      this.velocity.y = JUMP_VEL;
      this.coyote = 0;
      this.grounded = false;
      game.particles.dustPuff(this.position, 4);
      jumped = true;
      // the super jump is armed by the take-off itself: the hold that leaves
      // the ground is the one that keeps climbing
      this.riseHold = superjump;
    }
    return jumped;
  }

  /** the pack: thrust, glide, the eased descent and the fuel all three spend */
  private updateJetpack(dt: number, input: FrameInput, game: Game, jumped: boolean): void {
    const jetpack = this.profile.flight === 'jetpack';
    // A quick airborne A tap — no jump left to spend, and released before it
    // reads as a thrust hold — toggles the eased descent. The classification
    // happens on release, so a real hold (which starts thrusting immediately)
    // never flips the mode.
    if (jetpack) {
      if (input.jumpPressed && !jumped && !this.grounded) this.airTap = 0;
      else if (this.airTap >= 0) {
        this.airTap += dt;
        if (!input.jumpHeld) {
          if (this.airTap <= JET_TAP) this.slowDescent = !this.slowDescent;
          this.airTap = -1;
        } else if (this.airTap > JET_TAP) {
          this.airTap = -1;   // held on: that press was a thrust, not a toggle
        }
      }
    }
    this.thrusting = 0;
    this.gliding = false;
    this.jetEasing = false;
    if (jetpack && input.jumpHeld && !this.grounded && !this.blocking && this.velocity.y < JUMP_VEL * 0.7 && this.fuel > 0) {
      this.thrusting = 1;
      this.velocity.y = Math.min(this.velocity.y + JET_ACCEL * dt, JET_MAX_UP);
      this.fuel = Math.max(0, this.fuel - dt / FUEL_SECONDS);
      // Twin nozzle jets, born at the thruster mouths themselves. The offset
      // is taken against the character root rather than the world so the jets
      // do not lag a frame behind us, and the exhaust inherits most of our own
      // velocity — that is what keeps it a short jet stuck under the pack
      // instead of a long trail left behind in world space.
      const ignite = this.thrusting > 0 && !this.wasThrusting;
      for (const nozzle of this.char.nozzles) {
        nozzle.getWorldPosition(_jetPos).sub(this.char.root.position).add(this.position);
        _jetDir.set(0, -1, 0).applyQuaternion(nozzle.getWorldQuaternion(_jetRot));
        if (ignite) game.particles.jetIgnite(_jetPos, _jetDir);
        game.particles.jetPlume(_jetPos, _jetDir, dt, { power: 1, carrier: this.velocity });
      }
    } else if (
      jetpack && input.aimHeld && !this.grounded && !this.blocking
      && !this.slamming && this.dashTimer <= 0 && this.fuel > GLIDE_RESERVE && this.velocity.y < 1
    ) {
      // Aiming on the way down: the boosters take the fall rather than fight
      // it. A quarter-power plume, so the pack is visibly doing the work.
      this.gliding = true;
      this.fuel = Math.max(0, this.fuel - dt / GLIDE_SECONDS);
      for (const nozzle of this.char.nozzles) {
        nozzle.getWorldPosition(_jetPos).sub(this.char.root.position).add(this.position);
        _jetDir.set(0, -1, 0).applyQuaternion(nozzle.getWorldQuaternion(_jetRot));
        game.particles.jetPlume(_jetPos, _jetDir, dt, { power: 0.28, carrier: this.velocity });
      }
    } else if (this.grounded) {
      this.fuel = Math.min(1, this.fuel + dt / (FUEL_SECONDS * 0.55));
    } else if (jetpack && this.slowDescent && this.velocity.y < 0 && this.fuel > 0 && !this.blocking) {
      // eased descent: the pack idles against gravity — a visible low burn,
      // a sip of fuel, and the gravity block below softens the fall
      this.jetEasing = true;
      this.thrusting = 0.35;
      this.fuel = Math.max(0, this.fuel - dt / (FUEL_SECONDS * 5));
    } else if (!input.aimHeld) {
      this.fuel = Math.min(1, this.fuel + dt / (FUEL_SECONDS * 3.2));
    }
    // Holding the sights in the air keeps the pack spooled whether or not it
    // has anything left to give, so a dry tank gets no trickle here. Without
    // that, the airborne refill handed back a sliver of fuel the instant the
    // glide stopped and the glide restarted on it, a frame at a time, all the
    // way down.
    audio.setJetpackThrust(this.slot,
      this.thrusting * (0.6 + 0.4 * Math.min(1, Math.abs(this.velocity.y) / 8)) + (this.gliding ? 0.3 : 0));
    if (this.thrusting > 0 && !this.wasThrusting) audio.jetpackIgnite();
    this.wasThrusting = this.thrusting > 0;
    this.char.setThrust(this.thrusting || (this.gliding ? 0.3 : 0));
  }

  /** super jump: the non-Mandalorian answer to the jetpack */
  private updateSuperRise(dt: number, input: FrameInput): void {
    const superjump = this.profile.flight === 'superjump';
    // Hold A from the leap and she just keeps rising — as high as the hold
    // lasts, no fuel, no flames. The moment the button lifts (or the shield
    // comes up) the climb is spent for good: nothing relights mid-air, and
    // the way down is a commitment, softened only by the glide below.
    this.superRising = false;
    if (superjump && this.riseHold) {
      if (!input.jumpHeld || this.blocking) this.riseHold = false;
      else if (!this.grounded) {
        this.superRising = true;
        this.velocity.y = damp(this.velocity.y, SUPERJUMP_RISE, 6, dt);
      }
    }
  }

  /** gravity, in all the shapes the flight modes give it — and the void, which has none */
  private applyFall(dt: number, input: FrameInput, game: Game): void {
    const superjump = this.profile.flight === 'superjump';
    // Below a board's voidY there is no floor left to land on, so gravity
    // eases right off: you drift, and a tap of jetpack lifts you back out.
    const board = game.board;
    const inVoid = board.voidY !== undefined && this.position.y < board.voidY && !this.grounded;
    // The pull acting here: the board's own field, or the flat void scale
    // under it. A local field is about where you can land, and under the board
    // there is nowhere.
    const localG = inVoid ? (board.gravity ?? 1) * (board.voidGravity ?? 0.15) : this.gravity(board);
    // ...and whether that adds up to standing in space at all. The Spice Run's
    // field is a real 0.45 g over a deck and almost nothing between the
    // platforms, so this is a *place*, not a board: out in the open it is
    // true, and it stops being true a dozen metres above something to land on.
    const weightless = !this.grounded && localG <= SPACE_GRAVITY;
    if (this.dashTimer <= 0) {
      // a super jumper feathers the fall: holding A on the way down is a
      // controlled drop — lighter gravity, a capped fall speed — never a rise
      this.superGliding = superjump && !this.grounded && !this.superRising
        && input.jumpHeld && this.velocity.y < 2 && !this.blocking;
      if (this.gliding) {
        // The boosters carry the weight, so this replaces gravity rather than
        // resisting it — damping a fall *against* a full g settles at whatever
        // speed the two happen to balance at (7.6 m/s, as measured), which is
        // not a glide. Easing to a set descent is what makes it one.
        this.velocity.y = damp(this.velocity.y, GLIDE_FALL, GLIDE_CATCH, dt);
        // the drift bleeds off with it, so a shot can be held on a line
        this.velocity.x = damp(this.velocity.x, 0, GLIDE_DRAG, dt);
        this.velocity.z = damp(this.velocity.z, 0, GLIDE_DRAG, dt);
      } else if (weightless) {
        // ---- out in the vacuum ----
        // Momentum out here is horizontal only. There is nothing to fall
        // towards, so a nudge up or down used to be kept forever and the
        // whole board drifted away under you; now the vertical bleeds off
        // the moment nothing is pushing on it and altitude is something you
        // hold. Up is the pack (A). Down is the shield (B): a reverse burn
        // easing to a set descent, rather than the 16 m/s² brace-and-drop
        // that a floor would have caught — out here nothing catches it, so
        // holding B was a dive to the kill plane.
        if (this.blocking) {
          this.velocity.y = damp(this.velocity.y, -SPACE_SINK, SPACE_SINK_CATCH, dt);
        } else if (this.thrusting <= 0 && !this.superRising) {
          this.velocity.y = damp(this.velocity.y, 0, SPACE_STOP, dt);
        }
      } else {
        const gScale = this.superRising ? 0
          : this.superGliding ? SUPERJUMP_GLIDE
          : this.jetEasing ? JET_DESCENT_GRAV : 1;
        this.velocity.y -= GRAVITY * localG * gScale * dt;
        if (this.superGliding && this.velocity.y < -SUPERJUMP_FALL) this.velocity.y = -SUPERJUMP_FALL;
        if (this.jetEasing && this.velocity.y < -JET_DESCENT_FALL) this.velocity.y = -JET_DESCENT_FALL;
        // A brace wants the ground under it: raising the shield mid-air kills
        // any rise you had and pulls you down to meet it.
        if (this.blocking && !this.grounded) {
          if (this.velocity.y > 0) this.velocity.y = damp(this.velocity.y, 0, 9, dt);
          this.velocity.y -= BLOCK_SINK * dt;
        }
        if (inVoid) {
          const terminal = -(board.voidFallSpeed ?? 3.2);
          if (this.velocity.y < terminal) this.velocity.y = terminal;
        }
      }
    }
    // never strand a drifting player with an empty tank
    if (inVoid) this.fuel = Math.min(1, this.fuel + dt / (FUEL_SECONDS * 0.9));
  }

  /**
   * Metres from the boots to whatever is under them, out to `GROUND_PROBE`;
   * Infinity when nothing is within reach.
   *
   * `groundHeight` only reports surfaces at or below the feet, which is
   * exactly what is wanted here: a catwalk overhead is not a thing to brace
   * for, and the roof you are about to set down on is.
   */
  private dropBelow(game: Game): number {
    const g = game.board.physics.groundHeight(this.position.x, this.position.z, this.position.y);
    const drop = this.position.y - g;
    return drop >= 0 && drop <= GROUND_PROBE ? drop : Infinity;
  }

  /**
   * Out of a body too big to walk through (`Game.bigBodies`).
   *
   * A monster is a capsule the enemy solver carries; the world's colliders
   * know nothing about it, so the capsule move never met one and you strolled
   * through the middle of a krayt dragon. This is the same radial push-out the
   * physics world does for a rock, run against the live list of the big ones —
   * grunts are deliberately not in it, because a crowd you cannot walk through
   * is a crowd that pins you against a wall.
   *
   * Horizontal only, and never while riding: standing on a monster's back is
   * not a thing this game promises, and a ride carries its own hull.
   */
  private pushOutOfBigBodies(game: Game): void {
    if (this.vehicle || !this.alive) return;
    for (const b of game.bigBodies) {
      const head = this.position.y + this.height;
      if (head <= b.minY || this.position.y >= b.maxY) continue;
      const reach = b.r + this.radius;
      let dx = this.position.x - b.x, dz = this.position.z - b.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach * reach) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-5) { dx = 1; dz = 0; d = 1; }   // dead centre: shove somewhere
      const nx = dx / d, nz = dz / d;
      this.position.x = b.x + nx * reach;
      this.position.z = b.z + nz * reach;
      const into = this.velocity.x * nx + this.velocity.z * nz;
      if (into < 0) { this.velocity.x -= into * nx; this.velocity.z -= into * nz; }
    }
  }

  /** the capsule move, and what meeting the ground does: the crouch, and a slam */
  private integrateAndLand(dt: number, game: Game, anim: Animator): void {
    // how hard the ground is about to be met: the collision resolve takes the
    // downward velocity away, so the impact has to be read before the move
    const impact = this.grounded ? 0 : -this.velocity.y;
    const res = game.board.physics.moveCapsule(this.position, this.radius, this.height, this.velocity, dt);
    this.pushOutOfBigBodies(game);
    if (res.grounded && !this.wasGrounded) {
      audio.land(this.slamming || impact > 14);
      game.particles.dustPuff(this.position, this.slamming ? 18 : 6);
      // Take the drop in the knees. A light landing is the same crouch played
      // brisk, a heavy one is the full absorb plus a beat before you can run
      // out of it; a kerb-step gets neither.
      //
      // Setting down off the pack is the exception. A jetpack arrival is slow
      // by design — the whole point of the descent is that it takes the fall —
      // so it almost never clears `LAND_ABSORB`, and the body went from
      // reaching for the ground straight to standing on it in one frame. A
      // braced arrival always gets the crouch, played brisk and faded rather
      // than cut, because the brace has already put the legs most of the way
      // into it: what is left is the last few degrees of give.
      const braced = anim.playing('lower') === 'flyBraceLower';
      if (impact > LAND_ABSORB || this.slamming || braced) {
        const heavy = impact > LAND_HEAVY || this.slamming;
        const soft = braced && impact <= LAND_ABSORB;
        this.landTimer = anim.playOnce(
          'lower', 'landLower', braced ? LAND_BRACE_FADE : 0.05, false,
          heavy ? 1 : soft ? 1.9 : 1.5,
        );
        if (heavy) this.landRecovery = LAND_RECOVER;
      }
      if (this.slamming) {
        this.slamming = false;
        this.cam.shake(0.2);
        audio.explosion();
        // the shockwave reaches the scenery too — ice plates crack under it
        game.damageBreakablesNear(this.position, 4.5, 70);
        for (const e of game.enemies) {
          // never your own squad or brood — they share `enemies` with the hostiles
          if (!e.alive || e.team === this.team) continue;
          const d = e.position.distanceTo(this.position);
          if (d < 5) {
            e.damage(20, this.position, this.slot);
            e.knockback(this.position, 16, 0.55);
            e.knockdown(1.2 + Math.random() * 0.6);
          }
        }
      }
    }
    this.grounded = res.grounded;
    this.wasGrounded = res.grounded;
    this.clampToCeiling(game);
  }

  /**
   * The playable sky's lid (docs/MISSIONS_OUTDOOR.md §2).
   *
   * A mission level caps everyone below its ceiling so a border cannot be
   * flown over and a beat cannot be skipped, and so the sky above it belongs
   * to the backdrop — the band carriers cross and fliers come down out of. It
   * sits well above what one burn reaches, so free flight never meets it; what
   * meets it is a climb up a cliff, and there the pack sputters against it
   * rather than pretending nothing happened.
   */
  private clampToCeiling(game: Game): void {
    const lid = game.ceilingY;
    if (lid === null) return;
    const head = this.position.y + this.height;
    if (head <= lid) return;
    this.position.y = lid - this.height;
    if (this.velocity.y > 0) this.velocity.y = 0;
    if (this.thrusting > 0) {
      this.thrusting = 0;
      audio.setJetpackThrust(this.slot, 0.25);
    }
  }

  /** out of bounds: a void board puts you back on your start, everything else kills */
  private updateBounds(game: Game): void {
    if (this.position.y < game.board.physics.killY) {
      if (game.board.voidY !== undefined) {
        // backstop only — the drift above makes this almost unreachable, and
        // sinking out of a space station shouldn't cost anything
        const s = game.board.playerStarts[this.slot] ?? game.board.playerStarts[0];
        this.position.copy(s);
        this.velocity.set(0, 0, 0);
        this.fuel = 1;
      } else {
        this.damage(999, this.position);
      }
    }
  }

  /** the lock-on flag and the combat pass, with the shield masking what it holds */
  private updateCombatInput(dt: number, input: FrameInput, game: Game): void {
    this.lockedOn = this.weapon === 'blaster' &&
      !!this.aimAssistTarget(game, this.cam.aimDir(new THREE.Vector3()), this.cam.camera.position);
    // Both hands are on the shield: no firing, no swinging, no weapon swap
    // from behind it. Everything else in updateCombat still ticks down.
    this.updateCombat(dt, this.blocking
      ? {
        ...input, shootHeld: false, aimHeld: false, meleePressed: false, rocketPressed: false,
        meleeSwapPressed: false, rangedSwapPressed: false,
      }
      : input, game);
  }

  /** where the chest points: the camera in a fight, the direction of travel otherwise */
  private updateFacing(dt: number, input: FrameInput, speed2: number): void {
    const combatFacing = this.blocking || input.aimHeld || input.shootHeld || this.meleeTimer > 0 || this.weapon === 'blaster' && this.fireCd > -0.6;
    let targetYaw = this.facingYaw;
    if (combatFacing) targetYaw = this.cam.yaw;
    else if (speed2 > 0.8) targetYaw = Math.atan2(this.velocity.x, this.velocity.z);
    this.facingYaw = dampAngle(this.facingYaw, targetYaw, 14, dt);
  }

  /** which clips the body plays for what it is doing */
  private updateLocomotionAnim(dt: number, input: FrameInput, game: Game, anim: Animator, speed2: number): void {
    // ---- animation state ----
    // Cleared here and set again only by the flight branch below, so the lean
    // in `syncVisual` always reflects the pose that actually went on the body
    // this frame — including the frames flight loses the body to a block, a
    // somersault or the ground.
    this.flying = false;
    // Jumping, dashing or thrusting straight back out of a landing cancels the
    // crouch: a one-shot holds the channel to its end, and the legs would stay
    // folded under a body that is already in the air.
    if (this.landTimer > 0 && !this.grounded) { anim.release('lower'); this.landTimer = 0; }
    // The same for running out of one on the ground: a light landing at run
    // speed held the crouch for the whole clip while the body kept going —
    // ~1.9 m of frozen-legged slide after every hop. Once the feet are
    // clearly travelling, hand the channel back to the gait. A heavy landing
    // is not affected in practice: its recovery holds the speed under this
    // until the clip has all but finished.
    if (this.landTimer > 0 && this.grounded && speed2 > 3) { anim.release('lower'); this.landTimer = 0; }
    if (this.blocking) {
      // the brace owns both channels: no running, no firing from behind it
      anim.play('lower', speed2 > 0.6 ? 'runLower' : 'blockLower', 0.14, 0.6);
      anim.play('upper', 'blockUpper', 0.12);
    } else if (this.flipping) {
      // the tuck holds while the button does; letting go cross-fades back to
      // the falling stance, which is the body unfolding out of the roll
      anim.play('lower', 'tuckLower', 0.12);
      if (this.meleeTimer <= 0) anim.play('upper', 'tuckUpper', 0.12);
    } else if (this.gliding || this.thrusting > 0 || (!this.grounded && this.velocity.y > 2 && input.jumpHeld)) {
      // Flight is four poses, not one: which of them is on the body comes from
      // the climb angle and the ground below (see `flightPose`). The fade is
      // longer than a locomotion change because these are held shapes rather
      // than cycles — a snap between two of them reads as a twitch, and the
      // slower blend is what makes going up, over and down one continuous
      // movement instead of three states.
      this.flying = true;
      this.flyPose = flightPose(this.velocity, this.facingYaw, this.dropBelow(game), this.flyPose);
      const fly = flightClips(this.flyPose);
      anim.play('lower', fly.lower, FLY_FADE);
      if (this.meleeTimer <= 0) {
        anim.play('upper', input.aimHeld || input.shootHeld ? 'aimUpper' : fly.upper, FLY_FADE);
      }
    } else if (!this.grounded) {
      anim.play('lower', 'airLower');
      if (this.meleeTimer <= 0) anim.play('upper', input.aimHeld || input.shootHeld ? 'aimUpper' : 'airUpper');
    } else if (speed2 > 0.6) {
      // Which way is travel, relative to the body? Combat facing points the
      // chest at the camera while the feet go where the stick says, and the
      // forward run played for all of it — legs pumping forward through a
      // sidestep is a moonwalk. Pick the cycle by the divergence instead:
      // forward run, lateral shuffle (one clip and its mirror), or the run
      // reversed for a back-pedal.
      const travel = travelClip(this.velocity.x, this.velocity.z, this.facingYaw);
      let lowerClip: string = travel.clip;
      // a sprint is its own longer-reaching cycle, not the run spun faster
      if (lowerClip === 'runLower' && this.sprinting) lowerClip = 'sprintLower';
      // the gait runs at whatever rate plants the feet at our actual ground
      // speed, so the stride pushes off instead of skating; the back-pedal
      // is its cycle played backward, a touch slower
      const rate = travel.dir * anim.gaitRate(lowerClip, speed2, this.char.baseScale) * (travel.dir < 0 ? 0.9 : 1);
      anim.play('lower', lowerClip, 0.15, rate);
      const runUpper = this.sabersDrawn ? 'saberRunUpper' : 'runUpper';
      if (this.meleeTimer <= 0) anim.play('upper', input.aimHeld || input.shootHeld ? 'aimUpper' : runUpper, 0.15, Math.abs(rate));
      if (this.wading) {
        if (Math.random() < speed2 * dt * 0.9) game.particles.splash(this.position.clone().setY(game.board.waterY ?? this.position.y), 3);
      } else if (Math.random() < speed2 * dt * 0.7) game.particles.runDust(this.position);
      // footfalls follow the same cadence, so the sound lands on the plant
      this.footTimer -= dt;
      if (this.footTimer <= 0) {
        this.footTimer = anim.stepInterval(lowerClip, rate);
        if (this.wading) audio.splash(false, 0.18);
        else audio.footstep(game.board.footstep);
      }
    } else {
      anim.play('lower', 'idleLower');
      const idleUpper = this.sabersDrawn ? 'saberIdleUpper' : 'idleUpper';
      if (this.meleeTimer <= 0) anim.play('upper', input.aimHeld || input.shootHeld ? 'aimUpper' : idleUpper);
    }
  }


  /**
   * Free 3D swimming — the helmet is sealed, so depth costs nothing but
   * reach: bolts die at the surface (both ways), so a diver can travel and
   * hide but has to surface to fight. Movement is camera-directed like the
   * jetpack: look where you want to go and push forward; Space rises, and a
   * jump taken near the surface breaches — high enough to catch a deck edge
   * or light the jetpack.
   */
  private updateSwimming(dt: number, input: FrameInput, game: Game, realDt: number): void {
    const anim = this.char.animator!;
    const waterY = game.board.waterY!;

    // Everything about how this body moves in water scales off one number:
    // a fighter built for it is faster, steers harder and kicks further.
    const amphib = this.profile.amphibious ? AMPHIB : 1;

    // camera-directed wish, with Space as ballast
    const fwd = this.cam.aimDir(new THREE.Vector3());
    const { rightX, rightZ } = yawBasis(this.cam.yaw);
    const wish = new THREE.Vector3(
      fwd.x * input.moveY + rightX * input.moveX,
      fwd.y * input.moveY,
      fwd.z * input.moveY + rightZ * input.moveX,
    );
    if (input.jumpHeld) wish.y += 0.85;
    const wishLen = wish.length();
    if (wishLen > 1) wish.divideScalar(wishLen);

    // a kick of the fins: the dash button works underwater too
    this.dashCd -= dt;
    if ((input.dashPressed || input.sprintHeld) && this.dashCd <= 0 && this.energy > DASH_ENERGY && wishLen > 0.2) {
      this.dashCd = 0.8;
      this.energy = Math.max(0, this.energy - DASH_ENERGY);
      this.sprintRefillDelay = 0.7;
      this.velocity.addScaledVector(wish.clone().normalize(), SWIM_KICK * amphib);
      game.particles.splash(this.position.clone().add(new THREE.Vector3(0, 1, 0)), 6);
    } else {
      this.sprintRefillDelay -= dt;
      if (this.sprintRefillDelay <= 0) this.energy = Math.min(1, this.energy + dt / SPRINT_REFILL);
    }

    const swimSpeed = SWIM_SPEED * amphib;
    this.velocity.x = damp(this.velocity.x, wish.x * swimSpeed, SWIM_STEER * amphib, dt);
    this.velocity.z = damp(this.velocity.z, wish.z * swimSpeed, SWIM_STEER * amphib, dt);
    // Beskar is neutrally buoyant here: let go of the controls and you hold
    // your depth. It used to drift up to visor-at-surface, which parked an
    // idle diver exactly on the line the AI uses to decide whether it can see
    // you — so lurking underwater worked or didn't at random. Holding depth
    // makes the stealth route dependable and puts surfacing on the jump
    // button, where the breach already is.
    const buoy = Math.abs(wish.y) > 0.05 ? wish.y * swimSpeed : 0;
    this.velocity.y = damp(this.velocity.y, buoy, 3 * amphib, dt);

    // Breach: a jump taken with the head near the surface throws you clear —
    // and, for a fighter with no jetpack, arms the same held climb a standing
    // leap does. Without that, a super jumper who went in the water could
    // reach the surface and no further: every deck on a water board sits above
    // what a breach alone clears, so the swim was a one-way trip. Holding the
    // button out of the water is now the way back onto the platform.
    if (input.jumpPressed && this.position.y + 1.7 > waterY) {
      this.velocity.y = BREACH_VEL * amphib;
      this.grounded = false;
      this.riseHold = this.profile.flight === 'superjump';
      game.particles.splash(this.position.clone().setY(waterY), 18);
      audio.splash(false);
    }

    const res = game.board.physics.moveCapsule(this.position, this.radius, this.height, this.velocity, dt);
    this.grounded = res.grounded;
    this.wasGrounded = res.grounded;
    this.slamming = false;
    // the pack breathes out: a bubble trail off the helmet
    game.particles.bubbleTrail(this.position.clone().add(new THREE.Vector3(0, 1.5, 0)), dt);
    this.fuel = Math.min(1, this.fuel + dt / (FUEL_SECONDS * 0.7));
    audio.setJetpackThrust(this.slot, 0);
    this.char.setThrust(0);
    this.thrusting = 0;
    this.wasThrusting = false;

    if (this.position.y < game.board.physics.killY) this.damage(999, this.position);
    this.applyHazards(dt, game);

    // guns stay holstered below the surface; the gaffi still swings
    this.aiming = false;
    this.lockedOn = false;
    this.updateCombat(dt, {
      ...input, shootHeld: false, aimHeld: false, rocketPressed: false,
    }, game);

    // face and lean into the stroke
    const speed2 = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed2 > 0.6) {
      this.facingYaw = dampAngle(this.facingYaw, Math.atan2(this.velocity.x, this.velocity.z), SWIM_TURN * amphib, dt);
    }
    this.flying = false;   // the swim has its own lean; see `syncVisual`
    // the stroke runs at the pace of the swimming: a drift is a slow scull, a
    // driven line is a racing crawl
    const stroke = clamp(0.55 + Math.hypot(speed2, this.velocity.y) * 0.11, 0.55, 1.9);
    anim.play('lower', 'swimLower', 0.2, stroke);
    if (this.meleeTimer <= 0) anim.play('upper', 'swimUpper', 0.2, stroke);

    this.syncVisual(dt, game);
    anim.update(this.animDt(dt));
    this.cam.update(realDt, this.position, game.board.physics, {
      aiming: false, speed: speed2, dashing: false,
      flying: true, climb: this.velocity.y,
    });
  }

  /**
   * The board's danger zones: kill zones end it, burn zones tick damage in
   * beats so the hurt feedback reads as heat, not a buzzer.
   */
  private applyHazards(dt: number, game: Game): void {
    if (!this.alive) return;
    tickHazards(this.burn, game.board, this.position, dt, (amount, kill) => {
      // no drowning term: the helmet is sealed, and swimming is a mode here
      if (kill) this.damage(999, this.position);
      else this.damage(amount, this.position, -1, { dot: true });
    });
  }

  /**
   * Nearest box face worth hugging: tall enough to hide behind, wide enough
   * to matter, within snap range, and not the thing we're standing on.
   */
  private findCoverFace(game: Game): { box: StaticBox; nx: number; nz: number } | null {
    let best: { box: StaticBox; nx: number; nz: number } | null = null;
    let bestD = 2.4; // snap range
    for (const b of game.board.physics.boxes) {
      if (b.max.y - this.position.y < 1.0) continue;              // too low to cover the chest
      if (b.min.y > this.position.y + 0.5) continue;              // floating above us
      if (this.position.y > b.max.y - 0.3) continue;              // we're standing on it
      // outside distance to the box, and which face is closest
      const cx = clamp(this.position.x, b.min.x, b.max.x);
      const cz = clamp(this.position.z, b.min.z, b.max.z);
      const ox = this.position.x - cx, oz = this.position.z - cz;
      const dist = Math.hypot(ox, oz);
      if (dist < 0.01 || dist > bestD) continue;
      let nx = 0, nz = 0;
      if (Math.abs(ox) >= Math.abs(oz)) nx = Math.sign(ox) || 1;
      else nz = Math.sign(oz) || 1;
      // the face must be wide enough to actually hide a person
      const width = nx !== 0 ? b.max.z - b.min.z : b.max.x - b.min.x;
      if (width < 1.0) continue;
      bestD = dist;
      best = { box: b, nx, nz };
    }
    return best;
  }

  /**
   * Hugging a box, RDR2-style: slide along the face with the stick, hold aim
   * to lean out past the corner and shoot, release to tuck back in. Jump,
   * dash, melee, pressing the cover button again, or pushing away all leave.
   */
  private updateInCover(dt: number, input: FrameInput, game: Game, realDt: number): void {
    const anim = this.char.animator!;
    // The gauges the open-field path owns still have to tick here, because this
    // branch returns before reaching them. Ducking behind a crate used to leave
    // jetpack fuel and sprint energy frozen exactly where they stood — and,
    // worse, froze the shield: take cover with block held and `blockRaise`
    // stayed pinned at 1, so `shieldCollider` kept reflecting bolts for as long
    // as the player stayed tucked, draining nothing and leaving peek-fire
    // available. Cover is made of real geometry; it does not also get a shield.
    this.blocking = false;
    this.blockRaise = damp(this.blockRaise, 0, 14, dt);
    this.char.setBlock(this.blockRaise);
    this.dashArmed = false;
    this.sprintLatched = false;
    this.sprinting = false;
    this.thrusting = 0;
    this.wasThrusting = false;
    this.char.setThrust(0);
    audio.setJetpackThrust(this.slot, 0);
    this.sprintRefillDelay -= dt;
    if (this.sprintRefillDelay <= 0) this.energy = Math.min(1, this.energy + dt / SPRINT_REFILL);
    // tucked against a box is a grounded state, so fuel comes back at the
    // grounded rate — catching your breath behind cover is the point of it
    this.fuel = Math.min(1, this.fuel + dt / (FUEL_SECONDS * 0.55));

    const c = this.cover!;
    const b = c.box;
    // face geometry: n = outward normal, t = tangent along the face
    const tx = -c.nz, tz = c.nx;
    const facePlane = (c.nx > 0 ? b.max.x : c.nx < 0 ? b.min.x : c.nz > 0 ? b.max.z : b.min.z);
    const hugDist = this.radius + 0.22;
    const tMin = (c.nx !== 0 ? b.min.z : b.min.x);
    const tMax = (c.nx !== 0 ? b.max.z : b.max.x);
    const myT = c.nx !== 0 ? this.position.z : this.position.x;

    // ---- exits ----
    const { fwdX, fwdZ, rightX, rightZ } = yawBasis(this.cam.yaw);
    const wishX = fwdX * input.moveY + rightX * input.moveX;
    const wishZ = fwdZ * input.moveY + rightZ * input.moveX;
    const away = wishX * c.nx + wishZ * c.nz; // pushing off the wall
    this.pushAwayTime = away > 0.6 ? this.pushAwayTime + dt : 0;
    let leave = input.slamPressed || input.dashPressed || input.meleePressed || this.pushAwayTime > 0.18;
    if (input.jumpPressed) {
      leave = true;
      this.velocity.y = JUMP_VEL;
      this.grounded = false;
    }
    if (leave) {
      this.cover = null;
      this.peeking = false;
      // a melee press still swings: fall through to the normal path next frame
      this.syncVisual(dt, game);
      anim.update(dt);
      this.cam.update(realDt, this.position, game.board.physics, { aiming: input.aimHeld, speed: 0, dashing: false });
      return;
    }

    // ---- desired spot on the face ----
    const wasPeeking = this.peeking;
    this.peeking = input.aimHeld && this.weapon === 'blaster';
    let targetT: number;
    if (this.peeking) {
      // Pick the corner: prefer the side the camera leans toward, but when a
      // target is locked, take whichever corner has a clear shot to it —
      // boxes often sit in rows (crate stacks), and leaning out into the
      // neighbouring crate is a peek wasted. Re-checked a few times a second
      // while the aim is held, since targets move; the cone is cast from the
      // chest, not the camera, which can be a frame stale on the first peek.
      this.peekRecheck -= dt;
      if (!wasPeeking || this.peekSide === 0 || this.peekRecheck <= 0) {
        this.peekRecheck = 0.35;
        const aim = this.cam.aimDir(new THREE.Vector3());
        const along = aim.x * tx + aim.z * tz;
        let side = this.peekSide !== 0 ? this.peekSide
          : Math.abs(along) > 0.25 ? Math.sign(along)
          : (myT - (tMin + tMax) / 2 >= 0 ? 1 : -1);
        const chest = this.position.clone();
        chest.y += 1.4;
        const lock = this.aimAssistTarget(game, aim, chest, 0.9, 70);
        if (lock) {
          const clear = (sd: number): boolean => {
            const pt = (sd > 0 ? tMax : tMin) + sd * (this.radius + 0.55);
            const from = c.nx !== 0
              ? new THREE.Vector3(facePlane + c.nx * hugDist, this.position.y + 1.4, pt)
              : new THREE.Vector3(pt, this.position.y + 1.4, facePlane + c.nz * hugDist);
            const to = lock.position.clone();
            to.y += lock.height * 0.55;
            const dir = to.sub(from);
            const dist = dir.length();
            return !game.board.physics.raycast(from, dir.normalize(), dist);
          };
          if (!clear(side) && clear(-side)) side = -side;
        }
        this.peekSide = side;
      }
      targetT = (this.peekSide > 0 ? tMax : tMin) + this.peekSide * (this.radius + 0.55);
    } else {
      this.peekSide = 0;
      // tucked: slide along the face with the stick, staying behind the box
      const slide = wishX * tx + wishZ * tz;
      targetT = clamp(myT + slide * 3.6 * dt * 12, tMin + 0.2, tMax - 0.2);
    }
    let dx: number, dz: number;
    if (c.nx !== 0) {
      dx = (facePlane + c.nx * hugDist) - this.position.x;
      dz = targetT - this.position.z;
    } else {
      dx = targetT - this.position.x;
      dz = (facePlane + c.nz * hugDist) - this.position.z;
    }
    this.velocity.x = clamp(dx * 12, -6.5, 6.5);
    this.velocity.z = clamp(dz * 12, -6.5, 6.5);
    applyGravity(this.velocity, game.board, this.position, dt);
    const res = game.board.physics.moveCapsule(this.position, this.radius, this.height, this.velocity, dt);
    this.grounded = res.grounded;
    this.wasGrounded = res.grounded;
    if (!res.grounded && this.position.y < (game.board.voidY ?? game.board.physics.killY)) {
      this.cover = null; // the floor is gone; back to normal rules
    }

    // out of bounds / hazard (same rules as the open field)
    if (this.position.y < game.board.physics.killY) this.damage(999, this.position);
    this.applyHazards(dt, game);

    // ---- combat: shoot only while leaning out ----
    this.lockedOn = this.peeking &&
      !!this.aimAssistTarget(game, this.cam.aimDir(new THREE.Vector3()), this.cam.camera.position);
    const masked: FrameInput = {
      ...input,
      shootHeld: input.shootHeld && this.peeking,
      rocketPressed: input.rocketPressed && this.peeking,
      meleePressed: false,
      // no swinging and no rummaging through the loadout from behind cover
      meleeSwapPressed: false,
      rangedSwapPressed: false,
    };
    this.updateCombat(dt, masked, game);

    // ---- facing & pose ----
    const targetYaw = this.peeking ? this.cam.yaw : Math.atan2(c.nx, c.nz);
    this.facingYaw = dampAngle(this.facingYaw, targetYaw, 14, dt);
    anim.play('lower', 'idleLower');
    if (this.meleeTimer <= 0) anim.play('upper', this.peeking ? 'aimUpper' : this.sabersDrawn ? 'saberIdleUpper' : 'idleUpper');

    this.syncVisual(dt, game);
    anim.update(dt);
    this.cam.update(realDt, this.position, game.board.physics, {
      aiming: input.aimHeld, speed: Math.hypot(this.velocity.x, this.velocity.z), dashing: false,
    });
  }

  /** Nearest parked, riderless vehicle within mounting reach. */
  private findVehicle(game: Game): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = 2.4;
    for (const v of game.vehicles) {
      if (!v.alive || v.rider) continue;
      const d = Math.hypot(v.pos.x - this.position.x, v.pos.z - this.position.z) - v.def.radius;
      if (d > bestD) continue;
      if (Math.abs(v.pos.y - this.position.y) > 2.6) continue;
      bestD = d;
      best = v;
    }
    return best;
  }

  /**
   * In the saddle: input drives the vehicle and the rider sits its seat —
   * exposed, since a mounted rider takes what is aimed at them (only a
   * quarter of it bleeds into the ride) unless the ride's own deflector is up
   * over both of them. RB steps off beside a parked ride and bails out of a
   * moving one; either way a ride left with speed in it rolls on driverless
   * until it stops.
   */
  private updateRiding(dt: number, input: FrameInput, game: Game, realDt: number): void {
    const anim = this.char.animator!;
    const v = this.vehicle!;
    // A machine takes both hands — bars, tiller, controls — but an animal
    // takes one: reins in the off hand, blaster in the other. So a mount is
    // the one ride you can fight from, and every ride still stows the rocket
    // rack and the blade (X is the animal's own charge).
    const armed = !!v.def.living && this.alive && !this.meleeOnly;
    // gauges keep ticking and the pack stays cold — mirror of the cover branch
    this.blocking = false;
    this.blockRaise = damp(this.blockRaise, 0, 14, dt);
    this.char.setBlock(this.blockRaise);
    this.dashArmed = false;
    this.sprintLatched = false;
    this.sprinting = false;
    this.thrusting = 0;
    this.wasThrusting = false;
    this.char.setThrust(0);
    audio.setJetpackThrust(this.slot, 0);
    this.fuel = Math.min(1, this.fuel + dt / (FUEL_SECONDS * 0.55));
    this.sprintRefillDelay -= dt;
    if (this.sprintRefillDelay <= 0) this.energy = Math.min(1, this.energy + dt / SPRINT_REFILL);
    this.snareTimer -= dt;
    this.meleeTimer = 0;
    this.meleeHitPending = 0;
    this.slamming = false;
    this.swimming = false;
    this.wading = false;
    this.waterTime = 0; // the hull is between you and whatever hunts the water
    this.aiming = armed && input.aimHeld;
    this.lockedOn = false;
    this.cover = null;

    // ---- dismount ----
    // RB is the only exit now that A is the accelerator, and it reads the
    // speedometer: step off a parked ride, bail out of a moving one. Bailing
    // keeps the ride's momentum and pops you up into a jetpack chain, which
    // is both the fun exit and the one you want when the hull is about to go.
    if (input.slamPressed || !v.alive) {
      const carry = v.vel.clone();
      const hop = Math.hypot(carry.x, carry.z) > 6;
      v.dropRider();
      this.velocity.copy(carry);
      if (hop) {
        this.velocity.y = JUMP_VEL;
        game.particles.dustPuff(this.position, 6);
      } else {
        // step clear sideways so we don't stand inside the newly parked box
        this.position.x += Math.cos(v.yaw) * (v.def.radius + 0.75);
        this.position.z -= Math.sin(v.yaw) * (v.def.radius + 0.75);
      }
      this.grounded = false;
      audio.setEngine(this.slot, 0);
      this.syncVisual(dt, game);
      anim.update(dt);
      this.cam.update(realDt, this.position, game.board.physics, {
        aiming: false, speed: Math.hypot(carry.x, carry.z), dashing: false,
      });
      return;
    }

    v.drive(dt, input, this, game);
    // a crash or a ram chip can end the ride inside drive(): destroy() has
    // already thrown us clear — settle the visuals and let next frame be normal
    if (!this.vehicle) {
      this.syncVisual(dt, game);
      anim.update(dt);
      this.cam.update(realDt, this.position, game.board.physics, {
        aiming: false, speed: Math.hypot(this.velocity.x, this.velocity.z), dashing: false,
      });
      return;
    }

    // sit the seat, carry the ride's momentum (the camera paces off velocity)
    v.seatWorld(this.position);
    this.velocity.copy(v.vel);
    this.grounded = true;
    this.wasGrounded = true;
    this.coyote = COYOTE_TIME;

    // kill zones still end the rider (the hull is not armour against a sarlacc);
    // burn zones cook the hull instead
    const hzd = hazardAt(game.board, this.position);
    if (hzd.kill) { this.damage(999, this.position); return; }
    if (hzd.dps > 0 && this.vehicle) v.damage(hzd.dps * dt, this.position, -1);
    if (!this.vehicle) return; // the burn just finished the ride

    // ---- firing from the saddle ----
    // The same combat path the feet use, with the melee swing masked out (X
    // charges the animal instead) and the ordnance with it: the free hand
    // holds a blaster, not a launcher.
    if (armed) {
      this.lockedOn = this.weapon === 'blaster' &&
        !!this.aimAssistTarget(game, this.cam.aimDir(new THREE.Vector3()), this.cam.camera.position);
      this.updateCombat(dt, {
        ...input, meleePressed: false, rocketPressed: false, slamPressed: false,
      }, game);
    }
    // The chest turns to the camera while you are working the gun and back to
    // the animal's nose when you are not — a rider twists in the saddle, and
    // the bolts have to leave where the crosshair is looking.
    const gunUp = armed && (input.aimHeld || input.shootHeld
      || (this.weapon === 'blaster' && this.fireCd > -0.6));
    this.facingYaw = dampAngle(this.facingYaw, gunUp ? this.cam.yaw : v.yaw, gunUp ? 14 : 10, dt);
    const stand = v.def.stance === 'stand';
    anim.play('lower', stand ? 'idleLower' : 'rideLower');
    if (this.meleeTimer <= 0) {
      anim.play('upper', gunUp ? 'aimUpper' : stand ? 'idleUpper' : 'rideUpper');
    }

    this.syncVisual(dt, game);
    anim.update(dt);
    const speed = Math.hypot(v.vel.x, v.vel.z);
    this.cam.update(realDt, this.position, game.board.physics, {
      aiming: this.aiming, speed, dashing: false, flying: false, climb: 0,
    });
  }

  /**
   * Blade hum while the sabers are out. It leans up during a swing, so the
   * weapon sounds alive in the hand rather than only at the moment of contact,
   * and drops to nothing when they are stowed, the shield is up, or she dies.
   * Called from the top of update(), which every path — cover included —
   * passes through before it can return early.
   */
  private updateSaberHum(): void {
    if (this.meleeKind !== 'sabers') return;
    const drawn = this.alive && this.weapon === 'gaffi' && !this.blocking;
    audio.setSaberHum(this.slot, drawn ? 0.55 + (this.meleeTimer > 0 ? 0.8 : 0) : 0);
  }

  /**
   * Blades put themselves away after a lull, for a fighter who carries nothing
   * else — the playable war beasts, whose other hand is empty rather than
   * holding a gun. They are lit by swinging or by turning a bolt (both reset
   * the clock) and the next swing brings them straight back out, so stowing is
   * never something you have to undo before you can fight.
   *
   * Anyone carrying a gun never reaches this: their blade goes away when they
   * pull the trigger, which is the same idea with a better cue.
   */
  private updateSaberStow(dt: number, input: FrameInput): void {
    if (!this.meleeOnly) return;
    if (this.weapon !== 'gaffi') { this.saberIdle = 0; return; }
    // a blade still in flight keeps the set out — stowing a hand that is
    // about to catch a returning saber would hide the catch
    const busy = this.meleeTimer > 0 || this.meleeComboWindow > 0 || input.meleePressed
      || this.blocking || this.sabersHeld < 2;
    this.saberIdle = busy ? 0 : this.saberIdle + dt;
    if (this.saberIdle >= SABER_STOW_DELAY) {
      this.weapon = 'none';
      this.saberIdle = 0;
      this.char.setWeapon('none');
      audio.saberIgnite();   // the same snap, going the other way
    }
  }

  /**
   * RT for the saber fighter, tap or hold.
   *
   * A quick pull is just a swing — the trigger is her attack button, and
   * every pull throwing a blade meant she could not strike with RT at all
   * without disarming herself. Hold it past THROW_HOLD and the blade leaves
   * the hand instead, spins out ahead for as long as the trigger stays down,
   * and comes home the moment it is released. Holding again while the first
   * blade is away sends the other hand's. With both gone she fights
   * bare-handed — shorter, weaker, nothing to deflect on — until they return.
   *
   * Reads the raw input (not the masked copies handed to updateCombat), and
   * runs on every update path, so a blade in flight keeps flying while she
   * blocks, hugs cover, rides, swims, or dies.
   */
  private updateSaberThrow(dt: number, input: FrameInput, game: Game): void {
    if (!this.meleeOnly || this.meleeKind !== 'sabers') return;
    const pressed = input.shootHeld && !this.prevThrowHeld;
    this.prevThrowHeld = input.shootHeld;
    // letting go — or losing the ability to hold on — turns the blades home
    const held = input.shootHeld && this.alive && !this.blocking;
    const free = this.alive && !this.blocking && !this.cover && !this.vehicle
      && !this.swimming && this.snareTimer <= 0;

    if (pressed && free && this.meleeTimer <= 0) this.throwHold = 0;
    if (this.throwHold >= 0) {
      if (!input.shootHeld || !free) {
        // let go before the hold matured: she meant to hit something with it
        if (input.shootHeld === false && free) this.pendingMelee = true;
        this.throwHold = -1;
      } else {
        this.throwHold += dt;
        if (this.throwHold >= THROW_HOLD) {
          this.throwHold = -1;
          const t0 = this.thrownSabers[0];
          const t1 = this.thrownSabers[1];
          const hand = (!t0 || t0.state === 'held') ? 0 : (!t1 || t1.state === 'held') ? 1 : -1;
          if (hand >= 0) this.beginThrow(hand as 0 | 1);
        }
      }
    }

    // the blade leaves on the forward whip, not on the button
    if (this.throwWind >= 0) {
      this.throwWind -= dt;
      if (this.throwWind <= 0) {
        this.throwWind = -1;
        if (free) this.releaseSaber(this.throwHand, game);
      }
    }

    const catchPoint = _catch.set(this.position.x, this.position.y + 1.25, this.position.z);
    for (const hand of [0, 1] as const) {
      const t = this.thrownSabers[hand];
      // A blade already home is still stepped: its trail has to be told to
      // age out, and skipping it left the ribbon hanging in mid-air.
      if (!t) continue;
      if (t.state !== 'held' && !held) t.recall();
      if (t.update(dt, game, this, catchPoint)) {
        // caught: the hand goes out to meet it and folds in around the hilt
        this.char.setSaberHeld?.(hand, true);
        this.saberIdle = 0;
        audio.saberIgnite();
        this.char.animator?.playOnce('upper', hand === 0 ? 'saberCatchR' : 'saberCatchL', 0.05);
        this.meleeTimer = Math.max(this.meleeTimer, 0.3);
      }
    }
  }

  /**
   * Wind up: the arm cocks back and the blade stays in the hand.
   *
   * The throw is two beats, because one beat does not read as a throw — the
   * blade used to leave on the button, during a borrowed slash animation, so
   * nothing on her body said she had let go of it. `saberThrow*` cocks back
   * over the shoulder, and `releaseSaber` runs on the forward whip.
   */
  private beginThrow(hand: 0 | 1): void {
    // throwing draws, the same way a melee press does
    if (this.weapon !== 'gaffi') {
      audio.saberIgnite();
      this.weapon = 'gaffi';
      this.char.setWeapon('gaffi');
    }
    this.saberIdle = 0;
    this.throwWind = THROW_WINDUP;
    this.throwHand = hand;
    this.char.animator?.playOnce('upper', hand === 0 ? 'saberThrowR' : 'saberThrowL', 0.05);
    // hold the one-shot against the locomotion poses for the whole action; no
    // hit rides on this timer, meleeHitPending stays where it was
    this.meleeTimer = Math.max(this.meleeTimer, THROW_WINDUP + 0.2);
    audio.melee(2, 'sabers');
  }

  /** Send one blade out along the crosshair (soft-locked when a target sits in the cone). */
  private releaseSaber(hand: 0 | 1, game: Game): void {
    if (!this.throwFx) this.throwFx = new THREE.Group();
    if (this.throwFx.parent !== game.scene) game.scene.add(this.throwFx);
    let t = this.thrownSabers[hand];
    if (!t) t = this.thrownSabers[hand] = new ThrownSaber(this.throwFx, { light: hand === 0 });
    this.saberIdle = 0;
    this.char.setSaberHeld?.(hand, false);

    const from = this.position.clone();
    from.y += 1.35;
    const camDir = this.cam.aimDir(new THREE.Vector3());
    const lock = this.aimAssistTarget(game, camDir, this.cam.camera.position, 0.93, 45);
    let dir: THREE.Vector3;
    if (lock) {
      dir = lock.position.clone();
      dir.y += lock.height * 0.55;
      dir.sub(from).normalize();
    } else {
      dir = camDir;
    }
    // Never thrown downhill. A blade that leaves her hand at chest height and
    // noses into the dirt two strides on reads as a dropped sword, not a
    // thrown one, and the aim assist happily points there — a short enemy on
    // lower ground puts the lock point below the throwing hand. So the pitch
    // is floored at level: level or climbing, never descending. The blade
    // circle is a metre across, which covers the height it gives up.
    if (dir.y < 0) {
      dir = dir.clone();
      dir.y = 0;
      // straight down leaves nothing to normalise; face her instead
      if (dir.lengthSq() < 1e-6) dir.set(Math.sin(this.facingYaw), 0, Math.cos(this.facingYaw));
      dir.normalize();
    }
    from.addScaledVector(dir, 0.5);
    t.launch(from, dir);
    this.facingYaw = Math.atan2(dir.x, dir.z);
    this.cam.shake(0.045);
  }

  /** D-pad left: next blade in the loadout, drawn as it is chosen. */
  private cycleMelee(): void {
    const opts = this.profile.meleeOptions;
    if (opts.length > 1) this.meleeIdx = (this.meleeIdx + 1) % opts.length;
    this.char.setMeleeKind(this.meleeKind);
    // picking a blade is reaching for it: it comes out, whatever was in hand
    this.weapon = 'gaffi';
    this.char.setWeapon('gaffi');
    this.saberIdle = 0;
    if (this.meleeKind === 'sabers') audio.saberIgnite();
    else audio.uiMove();
  }

  /** D-pad right: next gun in the loadout, drawn as it is chosen. */
  private cycleRanged(): void {
    const opts = this.profile.rangedOptions;
    if (!opts.length) return;         // a beast has nothing to cycle
    if (opts.length > 1) this.rangedIdx = (this.rangedIdx + 1) % opts.length;
    const kind = this.rangedKind;
    if (kind) this.char.setRangedKind(kind);
    this.weapon = 'blaster';
    this.char.setWeapon('blaster');
    audio.uiMove();
  }

  private updateCombat(dt: number, input: FrameInput, game: Game): void {
    // Which slot is in hand is never something the player has to arrange: the
    // button that uses a weapon is the button that draws it. All the D-pad
    // does is pick *which* blade or which gun that is, for a fighter carrying
    // more than one of either.
    const stowed = this.meleeOnly ? 'none' : 'blaster';
    if (input.meleeSwapPressed) this.cycleMelee();
    if (input.rangedSwapPressed) this.cycleRanged();

    // melee (always available; swaps to gaffi visual during swing)
    this.meleeTimer -= dt;
    // a short RT pull from the saber fighter arrives here as a swing
    // A press during a swing is kept for a moment rather than dropped, so a
    // combo is played on intent and not on rhythm: the next swing starts the
    // frame the current one clears.
    this.meleeBuffer -= dt;
    if ((input.meleePressed || this.pendingMelee) && this.meleeTimer > 0) this.meleeBuffer = MELEE_BUFFER;
    const swing = input.meleePressed || this.pendingMelee || this.meleeBuffer > 0;
    this.pendingMelee = false;
    if (swing && this.meleeTimer <= 0) {
      this.meleeBuffer = 0;
      this.meleeStep = this.meleeComboWindow > 0 ? (this.meleeStep % 3) + 1 : 1;
      // Both blades away means both hands empty: the same combo swings, but
      // as fists — shorter reach, less than half the damage, and no saber
      // sound to sell a blade that isn't there.
      const bare = this.meleeKind === 'sabers' && this.sabersHeld === 0;
      this.meleeBare = bare;
      this.meleeRange = bare ? 1.8 : 3;
      // twin blades get their own combo; everyone else swings the staff set
      const set = this.meleeKind === 'sabers' ? 'saber' : 'melee';
      const clip = `${set}${this.meleeStep === 1 ? 1 : this.meleeStep === 2 ? 2 : 3}`;
      // creatures (the playable heavies) animate their own strike — their
      // Animator is a stub, so without the attack hook an X press showed
      // nothing at all
      const dur = this.char.attack?.() ?? this.char.animator?.playOnce('upper', clip, 0.05) ?? 0.5;
      this.meleeTimer = dur;
      this.meleeComboWindow = dur + 0.55;
      this.meleeHitPending = dur * 0.45;
      this.meleeDamage = (this.meleeStep === 3 ? this.profile.meleeFinisher : this.profile.meleeDamage)
        * (bare ? 0.4 : 1);
      // Melee draws: pressing swing with the blades away lights them on the
      // spot rather than costing a swap first, and they stay lit afterwards
      // until the idle timer puts them back.
      if (this.weapon !== 'gaffi' && this.meleeKind === 'sabers') audio.saberIgnite();
      this.weapon = 'gaffi';
      this.saberIdle = 0;
      this.char.setWeapon('gaffi');
      audio.melee(this.meleeStep, bare ? 'gaffi' : this.meleeKind);
      // lunge toward nearest enemy in front (fists don't carry as far)
      const target = this.nearestEnemy(game, bare ? 3.5 : 5.5, 0.4);
      if (target) {
        const dir = target.position.clone().sub(this.position).setY(0).normalize();
        this.velocity.x = dir.x * (bare ? 10 : 13);
        this.velocity.z = dir.z * (bare ? 10 : 13);
        this.facingYaw = Math.atan2(dir.x, dir.z);
      } else if (this.grounded && Math.hypot(this.velocity.x, this.velocity.z) < 3.5) {
        // no lunge to carry the body, so the legs join the swing: weight
        // drop, step, pivot — one-shots matched to each upper's duration
        this.char.animator!.playOnce('lower', `meleeLower${this.meleeStep}`, 0.08);
      }
      this.flourished = false;
    }
    // Combo punctuation: when the window lapses with blades still lit, the
    // wrists circle both sabers once and settle into the guard. The window
    // was decremented once this frame, so `+ dt` reads its previous value —
    // this fires exactly on the frame it lapses.
    if (
      !this.flourished && this.sabersDrawn && this.meleeTimer <= 0
      && this.meleeComboWindow <= 0 && this.meleeComboWindow + dt > 0
    ) {
      this.flourished = true;
      this.char.animator!.playOnce('upper', 'saberFlourish', 0.12);
      this.trailTimer = 0.55;
    }
    if (this.meleeTimer <= 0 && this.meleeComboWindow < 0 && this.weapon !== 'gaffi' && this.char.gaffi.visible) {
      this.char.setWeapon(stowed);
    }
    this.updateSaberStow(dt, input);
    if (this.meleeHitPending > 0) {
      this.meleeHitPending -= dt;
      if (this.meleeHitPending <= 0) {
        let hitAny = false;
        for (const e of game.hostilesFor(this)) {
          if (!e.alive) continue;
          const to = e.position.clone().sub(this.position);
          const dist = to.length();
          if (dist > this.meleeRange + e.radius) continue;
          to.normalize();
          const facing = new THREE.Vector3(Math.sin(this.facingYaw), 0, Math.cos(this.facingYaw));
          if (to.dot(facing) < 0.25) continue;
          const wasAlive = e.alive;
          e.damage(this.meleeDamage, this.position, this.slot);
          // the finisher is the haymaker: it puts the target flat on the
          // ground (follow up while they're down and hits land double)
          const en = e as Partial<Enemy> & typeof e;
          if (en.knockback && en.knockdown) {
            if (this.meleeStep === 3) {
              en.knockback(this.position, 12, 0.35, 0.08);
              en.knockdown(1.6 + Math.random() * 0.5);
            } else {
              en.knockback(this.position, 11, 0.32);
            }
          } else {
            // a rival player has no knockdown state: shove the body instead
            const push = to.multiplyScalar(this.meleeStep === 3 ? 9 : 6);
            e.velocity.x += push.x;
            e.velocity.z += push.z;
            e.velocity.y += 2;
          }
          hitAny = true;
          if (wasAlive && !e.alive) this.fuel = Math.min(1, this.fuel + 0.4); // melee kill refunds fuel
        }
        // and the scenery: a crate, a barrel, a supply cache or a parked ride
        // is as breakable with a blade as it is with a bolt
        if (game.meleeProps(this.position, this.facingYaw, this.meleeRange + 1.2,
          this.meleeDamage, this.slot)) hitAny = true;
        if (hitAny) {
          audio.meleeHit(this.meleeBare ? 'gaffi' : this.meleeKind);
          this.cam.shake(0.1);
          game.hitMarker(this.slot);
          // hit-stop: the attacker's animation hangs for a few frames on
          // contact (heavier on the finisher), which is most of what makes
          // a hit feel like it landed on something solid
          this.hitStop = this.meleeStep === 3 ? 0.09 : 0.055;
        }
      }
    }

    // Blaster. The trigger is also the draw: a player who just swung comes out
    // of it shooting rather than losing a beat to a swap they never asked for.
    // The swing itself still finishes — the gun comes up as the blade comes
    // down, not through it.
    if ((input.shootHeld || input.aimHeld) && !this.meleeOnly
        && this.weapon !== 'blaster' && this.meleeTimer <= 0) {
      this.weapon = 'blaster';
      this.char.setWeapon('blaster');
      this.meleeComboWindow = 0;
      this.saberIdle = 0;
    }
    // the broodmother's trigger: she has no gun — RT lobs a charged egg
    if (input.shootHeld && this.profile.special === 'layEgg'
        && this.fireCd <= 0 && this.meleeTimer <= 0) {
      this.throwEgg(game);
    }

    if (input.shootHeld && this.weapon === 'blaster' && this.fireCd <= 0 && this.meleeTimer <= 0
        && !this.overheated) {
      this.fireCd = this.profile.fireCd;
      this.addHeat();
      const muzzlePos = new THREE.Vector3();
      this.char.muzzle!.getWorldPosition(muzzlePos);

      // Converge the shot on whatever the crosshair is actually over, rather
      // than firing parallel from the muzzle. The muzzle sits off to the side
      // of the camera, so a parallel shot misses what the crosshair covers at
      // close range — which is what made aiming feel unreadable.
      const shotDir = this.aimPointFrom(game, muzzlePos);

      // spread when hip-firing (worse on the move); aiming removes it
      if (!input.aimHeld) {
        const spread = 0.008 + Math.min(Math.hypot(this.velocity.x, this.velocity.z) / this.profile.runSpeed, 1) * 0.015;
        shotDir.x += (Math.random() - 0.5) * spread;
        shotDir.y += (Math.random() - 0.5) * spread;
        shotDir.z += (Math.random() - 0.5) * spread;
        shotDir.normalize();
      }
      game.projectiles.fire(muzzlePos, shotDir, this.profile.boltSpeed, this.profile.boltDamage, this.team, this.slot);
      game.particles.muzzleFlash(muzzlePos, shotDir);
      // blaster fire carries: nearby posted enemies come looking
      game.director.noise(game, this.position, 55);
      audio.blaster(this.rangedKind ?? this.profile.blasterVoice);
      this.cam.shake(0.035);
      // recoil: the muzzle climbs, less when shouldered — you ride it back down
      this.cam.addLook((Math.random() - 0.5) * 0.003, input.aimHeld ? 0.005 : 0.01);
      // ...and the arm takes it: a short kick on the firing shoulder, laid
      // over the aim pose (syncVisual), so the body recoils and not just the view
      this.armKick = ARM_KICK;
    }

    // Y: ordnance for whoever carries a gun, the heavy lunge for whoever
    // doesn't. A blades-only fighter (or a war beast) has no rocket rack —
    // theirs is a committed leap onto the nearest target that lands as the
    // finisher: knockdown, finisher damage, the works.
    if (input.rocketPressed && this.rocketCd <= 0) {
      if (this.profile.special === 'layEgg') {
        this.layEgg(game);
      } else if (this.meleeOnly) {
        this.heavyLunge(game);
      } else {
        this.rocketCd = ROCKET_CD;
        const dir = new THREE.Vector3();
        this.cam.aimDir(dir);
        const origin = this.position.clone();
        origin.y += 1.9;
        const lock = this.aimAssistTarget(game, dir, origin, 0.85, 80);
        game.fireRocket(origin, dir, lock, this.slot);
        audio.rocket();
        this.cam.shake(0.15);
      }
    }
  }

  /**
   * The melee-only signature on Y: a leaping heavy strike. The body is thrown
   * at the nearest hostile ahead (or camera-forward with nobody in reach), and
   * the hit resolves through the ordinary melee pipeline as a step-3 finisher,
   * so it knocks down whatever it lands on. Its clock is the rocket's slot but
   * far shorter — a pounce, not ordnance.
   */
  /**
   * The broodmother's signature Y: set a charged egg down behind her. It
   * takes 5 s to hatch, is destroyable the whole time, and what crawls out
   * hunts for her (docs/MODES.md §3). Y and the RT throw draw from the same
   * clutch — the real clock is the 3 s an egg takes to charge — so both
   * buttons only carry a short anti-spam throttle. The Game owns the nest
   * and refuses when it is full.
   */
  private layEgg(game: Game): void {
    this.rocketCd = 0.5;
    if (this.eggsReady <= 0) return;   // nothing charged yet
    // the egg leaves from the sac that goes dark: same egg, delivered
    const from = this.eggOrigin();
    const vel = new THREE.Vector3(-Math.sin(this.facingYaw) * 2.2, 1.1, -Math.cos(this.facingYaw) * 2.2);
    if (!game.layEgg(this, from, vel)) return;
    this.eggsReady--;
    this.char.attack?.();   // she rears to set it down
    this.cam.shake(0.06);
  }

  /** where the next egg physically leaves her: the last charged sac's spot */
  private eggOrigin(): THREE.Vector3 {
    const from = new THREE.Vector3();
    if (this.char.eggSpot?.(this.eggsReady - 1, from)) return from;
    from.copy(this.position);
    from.y += this.height * 0.8;
    return from;
  }

  /**
   * The broodmother's RT: lob a charged egg at whatever is under the aim.
   * The hit shoves its target back without hurting them — the hurt is the
   * hatchling five seconds later, if nobody destroys the egg where it fell.
   */
  private throwEgg(game: Game): void {
    this.fireCd = 0.5;
    if (this.eggsReady <= 0) return;
    const from = this.eggOrigin();   // it flies off the sac that empties
    const dir = this.aimPointFrom(game, from);
    if (!game.throwEgg(this, from, dir)) return;
    this.eggsReady--;
    this.char.attack?.();
    audio.bark('spider_chitter', 0.45);
    this.cam.shake(0.05);
  }

  private heavyLunge(game: Game): void {
    this.rocketCd = 5;
    // both blades away: the leap still goes, but it lands as a body-check —
    // bare-hand reach and bare-hand damage
    const bare = this.meleeKind === 'sabers' && this.sabersHeld === 0;
    this.meleeBare = bare;
    this.meleeRange = bare ? 1.8 : 3;
    const target = this.nearestEnemy(game, 14, 0.2);
    const dir = target
      ? target.position.clone().sub(this.position).setY(0).normalize()
      : new THREE.Vector3(Math.sin(this.cam.yaw), 0, Math.cos(this.cam.yaw));
    this.velocity.x = dir.x * 16;
    this.velocity.z = dir.z * 16;
    this.velocity.y = Math.max(this.velocity.y, 6.5);
    this.facingYaw = Math.atan2(dir.x, dir.z);
    this.meleeStep = 3;   // lands as the finisher: knockdown + finisher damage
    const set = this.meleeKind === 'sabers' ? 'saber' : 'melee';
    if (this.weapon !== 'gaffi' && this.meleeKind === 'sabers') audio.saberIgnite();
    this.weapon = 'gaffi';
    this.char.setWeapon('gaffi');
    this.saberIdle = 0;
    const dur = this.char.attack?.() ?? this.char.animator?.playOnce('upper', `${set}3`, 0.05) ?? 0.6;
    this.meleeTimer = dur + 0.1;
    this.meleeComboWindow = dur + 0.55;
    this.meleeHitPending = dur * 0.6;
    this.meleeDamage = this.profile.meleeFinisher * (bare ? 0.4 : 1);
    this.flourished = false;
    audio.melee(3, bare ? 'gaffi' : this.meleeKind);
    audio.dash();
    this.cam.shake(0.12);
    game.particles.dustPuff(this.position, 8);
  }

  /** the gravity acting on this body where it is standing (or flying) */
  private gravity(board: Board): number {
    return gravityScale(board, this.position.x, this.position.y, this.position.z);
  }

  /**
   * Direction from `from` to whatever the crosshair is pointing at: a
   * soft-locked enemy if one sits in the assist cone, else the first thing the
   * camera ray hits, else a point far downrange.
   */
  private aimPointFrom(game: Game, from: THREE.Vector3): THREE.Vector3 {
    const camDir = this.cam.aimDir(new THREE.Vector3());
    const camPos = this.cam.camera.position;
    const lock = this.aimAssistTarget(game, camDir, camPos);
    const aimPoint = new THREE.Vector3();
    if (lock) {
      aimPoint.copy(lock.position);
      aimPoint.y += lock.height * 0.55;
    } else {
      const hit = game.board.physics.raycast(camPos, camDir, 200);
      aimPoint.copy(camPos).addScaledVector(camDir, hit ? hit.dist : 120);
    }
    return aimPoint.sub(from).normalize();
  }

  /** Best hostile near the aim direction (dot threshold), for soft-lock. */
  private aimAssistTarget(game: Game, dir: THREE.Vector3, from: THREE.Vector3, minDot = 0.986, maxDist = 65): Combatant | null {
    let best: Combatant | null = null;
    let bestScore = -Infinity;
    const to = new THREE.Vector3();
    const solids = game.board.physics;
    for (const e of game.hostilesFor(this)) {
      if (!e.alive) continue;
      to.copy(e.position);
      to.y += e.height * 0.55;
      to.sub(from);
      const d = to.length();
      if (d > maxDist || d < 1.2) continue;
      to.normalize();
      const dot = to.dot(dir);
      // widen the cone slightly for close targets
      const need = d < 12 ? minDot - 0.02 : minDot;
      if (dot < need) continue;
      let score = dot * 10 - d * 0.02;
      // a body dragging itself away is a target of last resort: never let it
      // win the lock over a live shooter at the same angle
      if ((e as { wounded?: boolean }).wounded) score -= 4;
      if (score <= bestScore) continue;
      // Line of sight, against the solid colliders only (the terrain never
      // hides anyone the camera can see): the lock used to snap onto a body
      // behind a crate and plant every bolt in the crate face.
      const hit = solids.raycastSolids(from, to, d - 0.6);
      if (hit) continue;
      bestScore = score; best = e;
    }
    return best;
  }

  private nearestEnemy(game: Game, maxDist: number, minDot: number): Combatant | null {
    let best: Combatant | null = null;
    let bestD = maxDist;
    const facing = new THREE.Vector3(Math.sin(this.cam.yaw), 0, Math.cos(this.cam.yaw));
    const to = new THREE.Vector3();
    for (const e of game.hostilesFor(this)) {
      if (!e.alive) continue;
      to.copy(e.position).sub(this.position);
      to.y = 0;
      const d = to.length();
      if (d > bestD) continue;
      if (d > 1 && to.normalize().dot(facing) < minDot) continue;
      bestD = d;
      best = e;
    }
    return best;
  }

  /**
   * The acrobat's air somersault.
   *
   * Jump again once you are already airborne and the body tucks and turns for
   * as long as the button stays down — no thrust, no fuel, nothing that
   * changes where you are going. Letting go does not stop it mid-turn, which
   * would leave a fighter falling head-down: the roll carries on to the next
   * whole revolution and unwinds into a normal fall, arriving upright every
   * time. Landing takes precedence over both — feet come first.
   *
   * `jumped` says this frame's press was the take-off, which is the one press
   * that must not start a roll.
   */
  private updateAirFlip(dt: number, input: FrameInput, jumped: boolean): void {
    if (!this.profile.airFlip || this.grounded || !this.alive || this.blocking) {
      // upright on the ground, whatever the roll was doing a moment ago
      this.flipping = false;
      this.flipAngle = 0;
      this.flipSpin = 0;
      return;
    }
    if (input.jumpPressed && !jumped) this.flipping = true;
    if (this.flipping && !input.jumpHeld) {
      // the button is gone: pick the revolution to finish on and unwind to it
      this.flipping = false;
      this.flipTarget = (Math.floor(this.flipAngle / (Math.PI * 2)) + 1) * Math.PI * 2;
    }
    if (this.flipping) {
      this.flipSpin = damp(this.flipSpin, FLIP_SPIN, FLIP_SPIN_UP, dt);
      this.flipAngle += this.flipSpin * dt;
      return;
    }
    if (this.flipSpin <= 0) return;
    // Easing in on what is left, floored so it always gets there: damping
    // alone approaches the target without ever reaching it, and a fighter
    // frozen a few degrees short of upright is the bug this avoids.
    const left = this.flipTarget - this.flipAngle;
    this.flipSpin = Math.max(FLIP_SETTLE_MIN, Math.min(this.flipSpin, left * FLIP_SETTLE_EASE));
    this.flipAngle += this.flipSpin * dt;
    if (this.flipAngle >= this.flipTarget - 0.02) {
      this.flipAngle = 0;   // a whole number of turns is the pose it started in
      this.flipSpin = 0;
    }
  }

  /**
   * The aim layer: two additive offsets laid over the mixer's pose.
   *
   * The carbine's aim clip is a fixed pose, so shooting up or down the rifle
   * stayed level while the bolts left along the camera. The chest now takes
   * a share of the camera pitch as an extra rotation applied after the clips
   * (the animator undoes and reapplies it around each update), and the arms
   * and head ride along — the muzzle follows the reticle. Only while the aim
   * pose is on the upper channel, which is exactly while aiming or firing
   * (and peeking from cover); it eases out again as the arms come down.
   *
   * The second is the recoil kick: for a few hundredths of a second after a
   * shot the firing shoulder rolls up and settles, so the body recoils and
   * not only the view.
   */
  private syncAimLayer(dt: number): void {
    const anim = this.char.animator;
    if (!anim) return;
    const aiming = this.alive && anim.playing('upper') === 'aimUpper';
    // +pitch looks up; +X on the chest folds it forward and down, so the sign flips
    const want = aiming ? clamp(-this.cam.pitch * AIM_PITCH_SHARE, -AIM_PITCH_MAX, AIM_PITCH_MAX) : 0;
    this.aimPitch = damp(this.aimPitch, want, aiming ? 18 : 10, dt);
    anim.setAdditive('chest', Math.abs(this.aimPitch) < 1e-4 ? 0 : this.aimPitch, 0, 0);
    if (this.armKick > 0) {
      this.armKick = Math.max(0, this.armKick - dt);
      // a fast rise and a longer settle: peak in the first third, then ease out
      const k = this.armKick / ARM_KICK;
      const shape = k > 0.66 ? (1 - k) / 0.34 : k / 0.66;
      anim.setAdditive('upperArmR', -ARM_KICK_ANGLE * shape, 0, 0);
    } else {
      anim.setAdditive('upperArmR', 0, 0, 0);    }
  }

  private syncVisual(dt: number, game: Game): void {
    this.char.root.position.copy(this.position);
    // YXZ, not the default XYZ. Three applies an XYZ Euler outermost-X-last,
    // which makes `rotation.x` a pitch about the *world* X axis — so a body
    // facing north leaned forward correctly and the same body facing east
    // rolled onto its shoulder instead, and a somersault taken sideways came
    // out a cartwheel. Yaw-first puts the pitch back on the character's own
    // right-hand axis, whichever way they are pointed, which is also the axis
    // `_flipAxis` below has always swung the hips about.
    this.char.root.rotation.order = 'YXZ';
    this.char.root.rotation.y = this.facingYaw;
    this.syncAimLayer(dt);
    // blade trails ride the swings (and the flourish), on every update path
    this.trailTimer -= dt;
    this.char.setTrail(this.weapon === 'gaffi' && (this.meleeTimer > 0 || this.trailTimer > 0));
    // Lean into velocity while flying; underwater the whole body pitches
    // into the stroke — diving tips you prone, rising brings you upright.
    //
    // In flight the raw velocity lean is shaped by which of the four jetpack
    // poses is on the body (`FLY_LEAN`): the cruise leans on it fully, the
    // climb and the descent stand most of the way up, and the brace tips a
    // few degrees back so the boots reach the ground ahead of the chest. The
    // clips carry the legs and this carries the whole body, and it is the two
    // together that make the difference between flying up and flying along.
    const lean = clamp((this.velocity.x * Math.sin(this.facingYaw) + this.velocity.z * Math.cos(this.facingYaw)) / 18, -0.35, 0.35);
    let target: number;
    if (this.swimming) target = clamp(lean * 2.2 - this.velocity.y * 0.09, -0.6, 0.9);
    else if (this.grounded) target = 0;
    else if (this.flying) {
      const [share, pitchDeg] = FLY_LEAN[this.flyPose];
      target = lean * share + pitchDeg * (Math.PI / 180);
    } else target = lean * 0.4;
    this.leanX = damp(this.leanX, target, this.flying ? 6 : 8, dt);
    this.char.root.rotation.x = this.leanX + this.flipAngle;
    if (this.flipAngle !== 0) {
      // A somersault turns about the body, and `position` is where the boots
      // are — spun about that the fighter scythes round their own feet like a
      // vaulting pole. So the root is shifted by whatever the turn moved the
      // hips, which pins the turn to the hips and leaves the feet to swing.
      _flipPivot.set(0, this.height * 0.55, 0);
      _flipAxis.set(Math.cos(this.facingYaw), 0, -Math.sin(this.facingYaw));
      _flipSwung.copy(_flipPivot).applyAxisAngle(_flipAxis, this.flipAngle);
      this.char.root.position.copy(this.position).add(_flipPivot).sub(_flipSwung);
    }
    // creature playables (PvP heavies) animate themselves off their gait
    this.char.setGait?.(this.alive ? Math.hypot(this.velocity.x, this.velocity.z) : 0);
    this.char.cosmetic?.(dt, game.time);
  }
}
