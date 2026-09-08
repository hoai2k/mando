/**
 * The model workbench's entry point, behind the same door.
 *
 * The workbench is a tool rather than part of the game, but it is served off
 * the same site, so leaving it open would leave a door open beside the one we
 * just built. Same module, same stored pass: a friend who signed in to play
 * walks straight into the workbench too.
 */
import { openGate } from './gate';

void openGate().then(() => import('../workbench/main'));
