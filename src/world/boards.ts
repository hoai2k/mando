import { TEXT } from '../text';
import type { Board, BoardId } from './board';
import { buildTatooine } from './tatooine';
import { buildWaystation } from './waystation';
import { buildNevarro } from './nevarro';
import { buildCrevasse } from './crevasse';
import { buildTrask } from './trask';
import { buildRefinery } from './refinery';
import { buildForge } from './forge';
import { buildRingworld } from './ringworld';
import { buildNarkina } from './narkina';

/**
 * The board roster: everything the select screen and the game boot need to
 * know about a territory, in one place. Adding a board = one entry here plus
 * its builder module; nothing else in the game switches on board identity.
 */
export interface BoardInfo {
  id: BoardId;
  name: string;
  desc: string;
  /** authored select-card art under assets/textures/ (see ASSETS_IMAGES.md) */
  art: string;
  /** CSS gradient behind/underneath the card art */
  gradient: string;
  build: () => Board;
}

export const BOARDS: BoardInfo[] = [
  {
    id: 'desert', ...TEXT.boards.desert,
    art: 'board_tatooine.jpg', gradient: 'linear-gradient(160deg, #d9a860, #7a4a28)',
    build: buildTatooine,
  },
  {
    id: 'station', ...TEXT.boards.station,
    art: 'board_waystation.jpg', gradient: 'linear-gradient(160deg, #2a2f4a, #0c0d18)',
    build: buildWaystation,
  },
  {
    id: 'nevarro', ...TEXT.boards.nevarro,
    art: 'board_nevarro.jpg', gradient: 'linear-gradient(160deg, #6a5a52, #2a1410)',
    build: buildNevarro,
  },
  {
    id: 'crevasse', ...TEXT.boards.crevasse,
    art: 'board_crevasse.jpg', gradient: 'linear-gradient(160deg, #cfe0ec, #4a7494)',
    build: buildCrevasse,
  },
  {
    id: 'trask', ...TEXT.boards.trask,
    art: 'board_trask.jpg', gradient: 'linear-gradient(160deg, #55636e, #1c2830)',
    build: buildTrask,
  },
  {
    id: 'refinery', ...TEXT.boards.refinery,
    art: 'board_refinery.jpg', gradient: 'linear-gradient(160deg, #3a3f48, #14161c)',
    build: buildRefinery,
  },
  {
    id: 'forge', ...TEXT.boards.forge,
    art: 'board_forge.jpg', gradient: 'linear-gradient(160deg, #8a988c, #3a443c)',
    build: buildForge,
  },
  {
    id: 'ringworld', ...TEXT.boards.ringworld,
    art: 'board_ringworld.jpg', gradient: 'linear-gradient(160deg, #34405c, #141824)',
    build: buildRingworld,
  },
  {
    id: 'narkina', ...TEXT.boards.narkina,
    art: 'board_narkina.jpg', gradient: 'linear-gradient(160deg, #c8d4dc, #3c5560)',
    build: buildNarkina,
  },
];
