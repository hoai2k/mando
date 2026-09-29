/** Workbench weapon choice: which slots each pose offers, what is never offered, and the live swap. */
import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const base = `http://localhost:${process.env.HARNESS_PORT ?? '4173'}`;
const url = (character, pose) => `${base}/workbench/?edit=models&character=${character}&pose=${pose}&mode=authored`;
const h = await launch({ url: url('ig11', 'idle') });
const page = h.page;

const MELEE = ['gaffi', 'gaffi_collection', 'poleaxe', 'electrostaff', 'force_pike', 'rey_staff',
  'nightsister_polearm', 'pirate_boarding_club', 'alamite_stone_club'];
const GUNS = ['carbine', 'longrifle', 'crossbow', 'pistol', 'pistols', 'enemy_blaster_rifle',
  'flame_projector', 'net_launcher'];
const FORBIDDEN = /saber|beskar|tonfa|dark/i;

const open = (character, pose) => h.workbench(character, pose, 'edit=models&mode=authored');
/** option values of a slot's picker, without the empty "Default" entry; null when there is no picker */
const offered = (slot) => page.evaluate((s) => {
  const select = document.querySelector(`#weaponChoice-${s}`);
  // the weapons on offer: not the default (''), nor None (an empty hand, offered in every slot)
  return select ? [...select.options].map((o) => o.value).filter((v) => v && v !== 'none') : null;
}, slot);
const allLabels = () => page.evaluate(() => [...document.querySelectorAll('[data-weapon-slot] option')]
  .map((o) => `${o.value} ${o.textContent}`));
/**
 * Is the object named `name` on the figure actually drawn: every ancestor
 * visible, and a visible mesh under it once its sculpt has settled?
 */
const drawn = (name) => page.evaluate((n) => {
  const root = window.__wb.figures[0].inst.root;
  const node = root.getObjectByName(n);
  if (!node) return { found: false };
  let chain = true;
  for (let c = node; c; c = c.parent) chain &&= c.visible;
  let meshes = 0;
  node.traverse((o) => { if (o.isMesh && o.visible) meshes++; });
  return { found: true, chain, meshes, parent: node.parent?.name, pending: !!node.userData.propPending };
}, name);
const settle = (name) => page.waitForFunction((n) => {
  const node = window.__wb.figures[0].inst.root.getObjectByName(n);
  return node && !node.userData.propPending;
}, name, { timeout: 30000 });

try {
  await page.evaluate(() => localStorage.clear());
  // IG-11 carries the force pike (Paz, who used to, fights with his fists now)
  await open('ig11', 'melee1');

  const meleePose = { melee: await offered('melee'), gun: await offered('gun') };
  check('melee attack offers only melee weapons',
    !!meleePose.melee && meleePose.gun === null && meleePose.melee.every((id) => MELEE.includes(id))
      && meleePose.melee.length === MELEE.length - 1, meleePose);

  await page.locator('#pose').selectOption('aim');
  const gunPose = { melee: await offered('melee'), gun: await offered('gun') };
  check('aim pose offers only guns',
    gunPose.melee === null && !!gunPose.gun && gunPose.gun.every((id) => GUNS.includes(id))
      && gunPose.gun.length === GUNS.length - 1, gunPose);

  await page.locator('#pose').selectOption('idle');
  const idlePose = { melee: await offered('melee'), gun: await offered('gun') };
  check('idle offers both a melee and a gun picker, with an in-hand toggle',
    !!idlePose.melee?.length && !!idlePose.gun?.length && await page.locator('#weaponHand').isVisible(), idlePose);

  const seen = [];
  for (const [character, pose] of [['ig11', 'idle'], ['armorer', 'idle'], ['bossk', 'idle'], ['duelist', 'idle'],
    ['stormtrooper', 'idle'], ['tusken', 'idle'], ['officer', 'idle'], ['enforcer', 'idle'], ['din', 'idle']]) {
    await open(character, pose);
    seen.push(...await allLabels());
  }
  check('sabers, the Darksaber and the beskar spear are never offered',
    seen.length > 0 && !seen.some((label) => FORBIDDEN.test(label)), seen.filter((l) => FORBIDDEN.test(l)));

  const din = {};
  for (const pose of ['idle', 'melee1', 'saber1', 'aim']) {
    await open('din', pose);
    din[pose] = { melee: await offered('melee'), gun: await offered('gun') };
  }
  check('Din: no melee choice anywhere; his gun can still be changed',
    Object.values(din).every((d) => d.melee === null) && !!din.idle.gun && !!din.aim.gun
      && din.melee1.gun === null && din.saber1.gun === null, din);

  const sabers = {};
  for (const [character, pose] of [['ventress', 'idle'], ['ventress', 'saberIdle'], ['maul', 'saber1'],
    ['jedi', 'idle'], ['maris', 'idle'], ['revan', 'aim']]) {
    await open(character, pose).catch(() => {});
    sabers[`${character}:${pose}`] = await page.locator('[data-weapon-slot]').count();
  }
  check('saber wielders show no weapon choice at all', Object.values(sabers).every((n) => n === 0), sabers);

  // ---- the swap itself ----
  await open('ig11', 'melee1');
  // IG-11 carries the force pike; its hand group keeps the slot's own name
  const beforeGaffi = await drawn('gaffi');
  await page.locator('#weaponChoice-melee').selectOption('electrostaff');
  await settle('electrostaff');
  const pike = await drawn('electrostaff');
  const gaffiHidden = await page.evaluate(() => window.__wb.figures[0].extras.gaffi.visible === false);
  check('choosing a melee weapon puts it in the authored hand and hides the default',
    beforeGaffi.chain && pike.chain && pike.meshes > 0 && pike.parent === 'weaponMount' && gaffiHidden,
    { beforeGaffi, pike, gaffiHidden });
  check('a pick that differs from the default is tagged',
    await page.locator('.weapon-choice.changed .changed-tag').count() === 1
      && await page.locator('.weapon-choices .ledger .edit').count() === 1);

  await page.locator('#pose').selectOption('aim');
  const carbine = await page.evaluate(() => {
    const gun = window.__wb.figures[0].inst.muzzle.parent;
    return gun.visible;
  });
  const pikeInAim = await drawn('electrostaff');
  check('the melee pick stays out of a gun pose', carbine && !pikeInAim.found, { carbine, pikeInAim });

  await page.locator('#pose').selectOption('melee2');
  check('the melee pick persists across poses',
    await page.locator('#weaponChoice-melee').inputValue() === 'electrostaff' && (await drawn('electrostaff')).chain);

  await page.locator('#pose').selectOption('idle');
  // IG-11's own gun is the long rifle: the pick is the pistol
  await page.locator('#weaponChoice-gun').selectOption('pistol');
  await settle('pistol');
  const rifle = await drawn('pistol');
  const handGun = await page.locator('#weaponHand [data-hand="gun"]').getAttribute('aria-pressed');
  check('choosing a gun in idle shows it in hand', rifle.chain && rifle.meshes > 0 && handGun === 'true', rifle);
  await page.locator('#weaponHand [data-hand="melee"]').click();
  const pikeIdle = await drawn('electrostaff');
  const rifleIdle = await drawn('pistol');
  check('the in-hand toggle shows the melee pick in idle', pikeIdle.chain && !rifleIdle.found, { pikeIdle, rifleIdle });

  // the grip editor works on the weapon that is showing
  await page.locator('#editToggle').click();
  await page.locator('[data-edit-kind="weapon"]').click();
  await page.waitForFunction(() => [...document.querySelector('#weaponTarget').options]
    .some((o) => o.textContent.includes('electrostaff')), undefined, { timeout: 15000 }).catch(() => {});
  const targets = await page.locator('#weaponTarget option').allTextContents();
  check('weapon grip editor targets the chosen weapon', targets.some((t) => t.includes('electrostaff'))
    && !targets.some((t) => t.includes('gaffi')), targets);
  await page.locator('#editToggle').click();

  // enemies: one hand, two slots
  await open('stormtrooper', 'enemyAim');
  check('stormtrooper aim offers guns only', (await offered('melee')) === null && !!(await offered('gun'))?.length);
  await page.locator('#weaponChoice-gun').selectOption('pistols');
  await settle('pistols');
  const pistols = { main: await drawn('pistols'), offhand: await drawn('pistolsL') };
  check('twin pistols fill both authored hands on a stormtrooper',
    pistols.main.chain && pistols.offhand.chain && pistols.main.parent === 'weaponMount'
      && pistols.offhand.parent === 'weaponMountL', pistols);
  await page.locator('#pose').selectOption('enemySwing');
  check('stormtrooper swing offers melee only', (await offered('gun')) === null && !!(await offered('melee'))?.length);

  await page.evaluate(() => {
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { window.__choiceExport = blob; return create(blob); };
  });
  await page.locator('#weaponChoiceExport').click();
  const exported = await page.evaluate(async () => JSON.parse(await window.__choiceExport.text()));
  const find = (c, s) => exported.entries.find((e) => e.character === c && e.slot === s);
  check('export lists every pick against its default',
    exported.format === 'mando-workbench-weapon-choices/1' && exported.entries.length === 3
      && find('ig11', 'melee')?.chosen.id === 'electrostaff' && find('ig11', 'melee')?.default.id === 'force_pike'
      && find('ig11', 'gun')?.chosen.id === 'pistol' && find('ig11', 'gun')?.default.id === 'longrifle'
      && find('stormtrooper', 'gun')?.chosen.id === 'pistols', exported);

  if (process.env.WB_SHOT) {
    await open('ig11', 'melee1');
    await page.waitForTimeout(800);
    await page.screenshot({ path: process.env.WB_SHOT });
  }
  check('browser reported no errors', h.errors.length === 0, h.errors);
} finally {
  await h.close();
}
check.done('Workbench weapon choice');
