/**
 * The model workbench's entry point, behind the same door.
 *
 * The workbench is a tool rather than part of the game, but it is served off
 * the same site, so leaving it open would leave a door open beside the one we
 * just built. Same module, same stored pass: a friend who signed in to play
 * walks straight into the workbench too.
 *
 * No `warm` hook, on purpose. The workbench loads whichever character you pick
 * and there is no way to know which that is from here — warming the whole cast
 * on the chance would pull down far more than it saved.
 */
import { openGate } from './gate';

void openGate({
  title: 'Model workbench',
  game: 'workbench',
  blurb: 'This game is for friends of Hoai Nguyen. Use your invite link, or enter your code below.',
}).then(() => import('../workbench/main'));
