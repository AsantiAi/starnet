/* frontend/app/roomstyles.js — THE ZONE STYLES the station builder furnishes with (vibe design, 2026-09-29).

   Pure, zero-dep, UMD (node tests + the browser). When the Commander says "the left side cozy, the right side a line", the
   lead names a STYLE for each part of the room and StarNet furnishes it from here: never a piece the model chose or placed.
   A style is a few hand-arranged SETS of furniture, largest first, in the same pieces the station presets are made of; the
   builder takes the largest set that fits the zone and seats it against the room's outer walls. Each set is
   [type, x, y, facing?] in its own tiles (y grows toward the front of the room). A chair left of a table faces 3, right of
   it faces 1 (the presets' own convention). Some pieces are EQUIPMENT (object = capability: a desk is a computer, a rack
   holds files, a dish reaches the web, a workbench runs commands); the approval card names what each style brings. */
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.RoomStyles = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STYLES = {
    cozy: { name: 'a cozy corner', about: 'a couch on a rug, a beanbag, a side table, a lamp and plants', words: ['comfy', 'chill', 'relax', 'relaxing', 'hangout', 'warm', 'snug'],
      sets: [
        { w: 8, h: 6, pieces: [['bookshelf', 0, 0], ['tallplant', 7, 0], ['rug', 2, 1], ['beanbag', 7, 2], ['couch', 1, 4], ['sidetable', 6, 4], ['lavalamp', 6, 4], ['plant', 7, 5]] },
        { w: 6, h: 4, pieces: [['rug_small', 1, 0], ['plant', 0, 0], ['couch', 0, 3], ['sidetable', 5, 3]] },
      ] },
    lounge: { name: 'a lounge', about: 'a TV, a couch, recliners and a side table', words: ['tv', 'movie', 'movies', 'living', 'sofa', 'couch'],
      sets: [
        { w: 8, h: 6, pieces: [['tv', 2, 0], ['plant', 0, 0], ['plant', 7, 0], ['rug', 2, 1], ['recliner', 1, 2, 3], ['recliner_r', 6, 2, 1], ['couch', 1, 4], ['sidetable', 6, 4]] },
        { w: 6, h: 4, pieces: [['tv', 1, 0], ['rug_small', 1, 1], ['couch', 0, 3], ['plant', 5, 3]] },
      ] },
    library: { name: 'a reading nook', about: 'bookshelves, a recliner on a rug, a side table and a book stack', words: ['reading', 'books', 'book', 'study', 'quiet'],
      sets: [
        { w: 8, h: 5, pieces: [['bookshelf', 0, 0], ['bookshelf', 2, 0], ['bookshelf', 4, 0], ['tallplant', 7, 0], ['rug_small', 2, 2], ['recliner', 1, 3, 3], ['sidetable', 6, 3], ['bookstack', 7, 4]] },
        { w: 6, h: 4, pieces: [['bookshelf', 0, 0], ['bookshelf', 2, 0], ['plant', 5, 0], ['recliner', 1, 2, 3], ['sidetable', 3, 2], ['bookstack', 4, 3]] },
      ] },
    desks: { name: 'work desks', about: 'desks with chairs and lamps', words: ['desk', 'office', 'workspace', 'work', 'workstations', 'computers'],
      sets: [
        // spaced for either desk: the classic one is 2 tiles wide, the remastered one 3
        { w: 12, h: 3, pieces: [['desk', 0, 0], ['desklamp', 3, 0], ['desk', 4, 0], ['desklamp', 7, 0], ['desk', 8, 0], ['plant', 11, 0], ['chair', 1, 1], ['chair', 5, 1], ['chair', 9, 1]] },
        { w: 7, h: 3, pieces: [['desk', 0, 0], ['desklamp', 3, 0], ['desk', 4, 0], ['chair', 1, 1], ['chair', 5, 1]] },
      ] },
    meeting: { name: 'a meeting table', about: 'a long table with chairs and a whiteboard', words: ['meeting', 'meetings', 'conference', 'planning', 'standup', 'huddle'],
      sets: [
        { w: 7, h: 5, pieces: [['whiteboard', 1, 0], ['plant', 6, 0], ['chair', 2, 1], ['chair', 4, 1], ['chair', 1, 2, 3], ['longtable', 2, 2], ['chair', 5, 2, 1], ['chair', 3, 3]] },
        { w: 5, h: 3, pieces: [['chair', 0, 1, 3], ['longtable', 1, 1], ['chair', 4, 1, 1], ['plant', 4, 0]] },
      ] },
    cafe: { name: 'a café corner', about: 'a bar with stools, coffee, a fridge and a table', words: ['coffee', 'kitchen', 'bar', 'snacks', 'food', 'break', 'breakroom', 'cafe'],
      sets: [
        { w: 8, h: 5, pieces: [['quarters_minifridge', 0, 0], ['bar', 1, 0], ['coffee', 5, 0], ['quarters_vending', 7, 0], ['stool', 1, 1], ['stool', 3, 1], ['dinerchair', 1, 3, 3], ['dinertable', 2, 3], ['dinerchair', 5, 3, 1]] },
        { w: 6, h: 3, pieces: [['bar', 0, 0], ['coffee', 4, 0], ['quarters_minifridge', 5, 0], ['stool', 0, 1], ['stool', 2, 1]] },
      ] },
    games: { name: 'a games corner', about: 'a pool table, arcade cabinets and a pinball', words: ['game', 'arcade', 'fun', 'play', 'pool', 'gaming'],
      sets: [
        { w: 8, h: 5, pieces: [['arcade', 0, 0], ['arcade2', 1, 0], ['pinball', 2, 0], ['gachapon', 7, 0], ['quarters_pooltable', 2, 3], ['stool', 7, 4]] },
        { w: 5, h: 4, pieces: [['arcade', 0, 0], ['arcade2', 1, 0], ['pinball', 2, 0], ['beanbag', 4, 3]] },
      ] },
    garden: { name: 'a garden', about: 'planters, tall plants, a terrarium and a bench', words: ['plants', 'green', 'nature', 'calm', 'zen', 'greenhouse'],
      sets: [
        { w: 8, h: 5, pieces: [['tallplant', 0, 0], ['industrial_planter', 1, 0], ['monstera', 3, 0], ['industrial_planter', 4, 0], ['tallplant', 7, 0], ['terrarium', 0, 2], ['industrial_bench', 3, 3], ['plant', 7, 3], ['monstera', 0, 4]] },
        { w: 5, h: 3, pieces: [['tallplant', 0, 0], ['industrial_planter', 1, 0], ['monstera', 4, 0], ['industrial_bench', 1, 2]] },
      ] },
    quarters: { name: 'sleeping quarters', about: 'beds, lockers, a side table and a lamp', words: ['sleep', 'bed', 'beds', 'bedroom', 'bunks', 'rest', 'dorm'],
      sets: [
        { w: 8, h: 5, pieces: [['bunk', 0, 0], ['sidetable', 2, 0], ['lavalamp', 2, 0], ['bunk', 3, 0], ['quarters_lockerbank', 5, 0], ['rug_small', 0, 2], ['plant', 7, 4]] },
        { w: 5, h: 3, pieces: [['bunk', 0, 0], ['sidetable', 2, 0], ['quarters_lockerbank', 2, 2]] },
      ] },
    storage: { name: 'storage', about: 'crates, boxes, lockers and a drawer bank', words: ['stock', 'supplies', 'inventory', 'crates', 'warehouse', 'boxes'],
      sets: [
        { w: 8, h: 4, pieces: [['industrial_locker', 0, 0], ['industrial_drawerbank', 2, 0], ['rackV', 6, 0], ['crate', 0, 2], ['boxes', 3, 3], ['crate', 6, 3]] },
        { w: 5, h: 3, pieces: [['industrial_locker', 0, 0], ['crate', 3, 0], ['boxes', 0, 2]] },
      ] },
    gym: { name: 'a gym', about: 'a heavy bag, a bench press and a locker', words: ['workout', 'fitness', 'exercise', 'training'],
      sets: [
        { w: 7, h: 4, pieces: [['punchbag', 0, 0], ['industrial_locker', 2, 0], ['tallplant', 6, 0], ['benchpress', 2, 3]] },
        { w: 5, h: 3, pieces: [['punchbag', 0, 0], ['benchpress', 2, 2]] },
      ] },
    lab: { name: 'a lab bench', about: 'a desk, a sample cart, a core lens and research papers', words: ['science', 'research', 'experiments', 'laboratory', 'analysis'],
      sets: [
        { w: 8, h: 4, pieces: [['research_corelens', 0, 0], ['desk', 2, 0], ['research_samplecart', 5, 0], ['plant', 7, 0], ['chair', 2, 1], ['research_papers', 4, 3], ['tube', 0, 3]] },
        { w: 5, h: 3, pieces: [['desk', 0, 0], ['research_samplecart', 3, 0], ['chair', 0, 1]] },
      ] },
    comms: { name: 'a comms desk', about: 'a console, screens and a comms dish', words: ['communications', 'radio', 'signal', 'network', 'web', 'internet'],
      sets: [
        { w: 8, h: 4, pieces: [['screens', 0, 0], ['consoleL', 2, 0], ['comms_dish', 6, 0], ['chair', 3, 1], ['plant', 0, 3]] },
        { w: 6, h: 3, pieces: [['consoleL', 0, 0], ['screens', 4, 0], ['chair', 1, 1]] },
      ] },
    workshop: { name: 'a workshop', about: 'a workbench, a fabricator, a toolbox and crates', words: ['maker', 'tools', 'build', 'fabrication', 'engineering', 'garage'],
      sets: [
        { w: 8, h: 4, pieces: [['workbench', 0, 0], ['toolbox', 2, 0], ['fabricator', 4, 0], ['industrial_toolcaddy', 7, 0], ['crate', 0, 3], ['boxes', 6, 3]] },
        { w: 5, h: 3, pieces: [['workbench', 0, 0], ['toolbox', 2, 0], ['crate', 3, 2]] },
      ] },
  };
  // what the approval card calls a piece where its catalog label reads badly in a sentence ("RECLINER ‹ LEFT", "BOOKS")
  const NAMES = { tv: 'TV', recliner: 'recliner', recliner_r: 'recliner', bookstack: 'book stack', coffee: 'coffee machine', quarters_vending: 'vending machine',
    arcade: 'arcade cabinet', arcade2: 'arcade cabinet', punchbag: 'heavy bag', punchbag_r: 'heavy bag', benchpress: 'bench press', benchpress_r: 'bench press',
    rackV: 'rack', consoleL: 'console', comms_dish: 'comms dish', research_papers: 'stack of papers', quarters_lockerbank: 'locker bank', boxes: 'stack of boxes',
    screens: 'screen wall', tube: 'specimen tube', bunk: 'bed', industrial_bench: 'bench', industrial_planter: 'planter', industrial_locker: 'locker' };
  const ORDER = Object.keys(STYLES);
  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z]+/g, ' ').trim();

  // a style by its id, its name ("a cozy corner"), or one of its words ("comfy") — null when nothing matches
  function resolve(raw) {
    const n = norm(raw);
    if (!n) return null;
    if (STYLES[n]) return n;
    for (const id of ORDER) if (norm(STYLES[id].name) === n || norm(STYLES[id].name).replace(/^(a|an) /, '') === n) return id;
    for (const id of ORDER) if (STYLES[id].words.indexOf(n) >= 0 || n.split(' ').some(w => w === id)) return id;
    return null;
  }
  const menu = () => ORDER.map(id => ({ id, name: STYLES[id].name, about: STYLES[id].about }));

  return { STYLES, ORDER, NAMES, resolve, menu };
});
