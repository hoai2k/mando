import type { Board, BoardId } from './board';
import { buildTatooine } from './tatooine';
import { buildWaystation } from './waystation';
import { buildNevarro } from './nevarro';
import { buildCrevasse } from './crevasse';
import { buildTrask } from './trask';
import { buildRefinery } from './refinery';
import { buildForge } from './forge';
import { buildRingworld } from './ringworld';

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
    id: 'desert', name: 'The Dune Sea',
    desc: 'Tatooine wastes — Tusken outcasts, Pyke patrols, swoop gangs, and the sarlacc. Watch your step.',
    art: 'board_tatooine.jpg', gradient: 'linear-gradient(160deg, #d9a860, #7a4a28)',
    build: buildTatooine,
  },
  {
    id: 'station', name: 'The Spice Run',
    desc: 'A smugglers’ waystation in deep space. Floating platforms — the jetpack is the only road.',
    art: 'board_waystation.jpg', gradient: 'linear-gradient(160deg, #2a2f4a, #0c0d18)',
    build: buildWaystation,
  },
  {
    id: 'nevarro', name: 'The Lava Flats',
    desc: 'Nevarro’s black glass, cut by living lava. Geysers erupt on a rhythm — ride them, or feed the rivers.',
    art: 'board_nevarro.jpg', gradient: 'linear-gradient(160deg, #6a5a52, #2a1410)',
    build: buildNevarro,
  },
  {
    id: 'crevasse', name: 'The Crevasse',
    desc: 'Maldo Kreis. Three layers of ice, a lake that cracks underfoot, and the spiders that own the dark.',
    art: 'board_crevasse.jpg', gradient: 'linear-gradient(160deg, #cfe0ec, #4a7494)',
    build: buildCrevasse,
  },
  {
    id: 'trask', name: 'The Storm Docks',
    desc: 'A Trask fishing port in a squall. Heaving trawler decks, lightning, and the mamacore under the pier.',
    art: 'board_trask.jpg', gradient: 'linear-gradient(160deg, #55636e, #1c2830)',
    build: buildTrask,
  },
  {
    id: 'refinery', name: 'The Refinery',
    desc: 'An Imperial rhydonium plant. Low corridors, a 40 m reactor shaft, volatile barrels, and the alarm consoles.',
    art: 'board_refinery.jpg', gradient: 'linear-gradient(160deg, #3a3f48, #14161c)',
    build: buildRefinery,
  },
  {
    id: 'forge', name: 'The Great Forge',
    desc: 'Mandalore’s glassed ruins. Magnetic storms sweep the open ground — the calm is for fighting.',
    art: 'board_forge.jpg', gradient: 'linear-gradient(160deg, #8a988c, #3a443c)',
    build: buildForge,
  },
  {
    id: 'ringworld', name: 'The Ringworld',
    desc: 'A Glavis street under a moving terminator. The dark side hides you; the tram runs through both.',
    art: 'board_ringworld.jpg', gradient: 'linear-gradient(160deg, #34405c, #141824)',
    build: buildRingworld,
  },
];
