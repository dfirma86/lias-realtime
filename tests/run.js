\
const assert = (name, cond) => console.log(`${cond ? '✅' : '❌'} ${name}`);
const { normalizeAlias, nextChainTimer, generateId, selectNextHost } = require('../shared/utils');

assert('normalize duplicates: "Shad ow!!" vs "shadow"',
  normalizeAlias('  Shad ow!! ') === normalizeAlias('shadow'));

assert('normalize spelling different: "shaddow" != "shadow"',
  normalizeAlias('shaddow') !== normalizeAlias('shadow'));

let t = 15; for (let i=0;i<5;i++) t = nextChainTimer(t); assert('timer floors at 3', t === 3);

const a = generateId(), b = generateId();
assert('generateId returns string', typeof a === 'string' && a.length > 0);
assert('generateId unique-ish', a !== b);

const now = Date.now();
const players = [
  { id:'A', joinedAt: now-3000, isEliminated:false, isHost:true },
  { id:'B', joinedAt: now-2000, isEliminated:false, isHost:false },
  { id:'C', joinedAt: now-1000, isEliminated:true,  isHost:false },
  { id:'D', joinedAt: now-500,  isEliminated:false, isHost:false },
];
assert('selectNextHost -> B', selectNextHost(players,'A') === 'B');
