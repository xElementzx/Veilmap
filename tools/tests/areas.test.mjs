// Veilmap - GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { evalInLuaModule } from './helpers/lua.mjs';

const run = (snippet) => evalInLuaModule('Fog/Areas.lua', snippet);

// Builds a Lua entry in the shipped format: {w,h,x,y,{areaIDs},"files",{l,t,r,b}}.
// Only fields 5 and 7 matter to Areas; the rest are filler.
const E = (ids, l, t, r, b) => `{0,0,0,0,{${ids.join(',')}},"",{${l},${t},${r},${b}}}`;

test('Areas.HitTest', async (t) => {
  await t.test('returns the entry containing the point', async () => {
    const r = await run(`
      local a = ${E([1], 0, 0, 10, 10)}
      return Areas.HitTest({ a }, 5, 5) == a and "hit" or "miss"
    `);
    assert.equal(r, 'hit');
  });

  await t.test('returns nil outside every rect', async () => {
    const r = await run(`return Areas.HitTest({ ${E([1], 0, 0, 10, 10)} }, 11, 5) == nil and "nil" or "hit"`);
    assert.equal(r, 'nil');
  });

  await t.test('edges are inclusive on all four sides', async () => {
    const r = await run(`
      local a = ${E([1], 10, 20, 30, 40)}
      local n = 0
      for _, p in ipairs({ {10, 25}, {30, 25}, {15, 20}, {15, 40} }) do
        if Areas.HitTest({ a }, p[1], p[2]) == a then n = n + 1 end
      end
      return n
    `);
    assert.equal(r, 4);
  });

  await t.test('the smallest containing rect wins when rects overlap', async () => {
    const r = await run(`
      local big = ${E([1], 0, 0, 100, 100)}
      local small = ${E([2], 40, 40, 60, 60)}
      return Areas.HitTest({ big, small }, 50, 50)[5][1]
    `);
    assert.equal(r, 2);
  });

  await t.test('equal-area overlap goes to the earlier entry', async () => {
    const r = await run(`
      local first = ${E([1], 0, 0, 10, 10)}
      local second = ${E([2], 5, 5, 15, 15)}
      return Areas.HitTest({ first, second }, 7, 7)[5][1]
    `);
    assert.equal(r, 1);
  });

  await t.test('an empty list returns nil', async () => {
    const r = await run('return Areas.HitTest({}, 1, 1) == nil and "nil" or "hit"');
    assert.equal(r, 'nil');
  });
});

test('Areas.Group', async (t) => {
  await t.test('one group per area ID, in first-seen order', async () => {
    const r = await run(`
      local g = Areas.Group({ ${E([7], 0, 0, 1, 1)}, ${E([3], 0, 0, 1, 1)}, ${E([7], 0, 0, 2, 2)} })
      return #g .. ":" .. g[1].areaID .. "," .. g[2].areaID .. ":" .. #g[1].entries .. "," .. #g[2].entries
    `);
    assert.equal(r, '2:7,3:2,1');
  });

  await t.test('a multi-area entry joins every group it names', async () => {
    const r = await run(`
      local shared = ${E([1, 2], 0, 0, 5, 5)}
      local g = Areas.Group({ shared })
      return #g .. ":" .. (g[1].entries[1] == shared and "y" or "n") .. (g[2].entries[1] == shared and "y" or "n")
    `);
    assert.equal(r, '2:yy');
  });

  await t.test('largest is the entry with the biggest hit rect, ties to the earlier', async () => {
    const r = await run(`
      local a = ${E([1], 0, 0, 10, 10)}
      local b = ${E([1], 0, 0, 20, 20)}
      local c = ${E([1], 50, 50, 70, 70)}
      local g = Areas.Group({ a, b, c })
      return g[1].largest == b and "b" or "other"
    `);
    assert.equal(r, 'b');
  });
});

test('Areas.Centre', async (t) => {
  await t.test('normalizes the hit-rect centre by the layer size', async () => {
    const r = await run(`
      local x, y = Areas.Centre(${E([1], 100, 50, 300, 150)}, 1000, 500)
      return x .. "," .. y
    `);
    assert.equal(r, '0.2,0.2');
  });
});

test('Areas.Sort', async (t) => {
  // Layer 1000 x 500, player at the centre. A's centre is (0.5, 0.7): 0.2 away
  // in raw 0-1 units but 100 px. B's centre is (0.65, 0.5): 0.15 raw but 150 px.
  // Correct (pixel) order is A then B; raw 0-1 order would be B then A.
  const aspectSetup = `
    local a = ${E([1], 490, 340, 510, 360)}
    local b = ${E([2], 640, 240, 660, 260)}
    local groups = Areas.Group({ b, a })
  `;

  await t.test('sorts by distance in layer pixels when the player is on the map', async () => {
    const r = await run(`${aspectSetup}
      Areas.Sort(groups, {}, { x = 0.5, y = 0.5 }, 1000, 500)
      return groups[1].areaID .. "," .. groups[2].areaID
    `);
    assert.equal(r, '1,2');
  });

  await t.test('equal distances break ties on area ID', async () => {
    const r = await run(`
      local groups = Areas.Group({ ${E([9], 0, 0, 10, 10)}, ${E([4], 0, 0, 10, 10)} })
      Areas.Sort(groups, {}, { x = 0.9, y = 0.9 }, 100, 100)
      return groups[1].areaID .. "," .. groups[2].areaID
    `);
    assert.equal(r, '4,9');
  });

  await t.test('sorts alphabetically when there is no player position', async () => {
    const r = await run(`
      local groups = Areas.Group({ ${E([1], 0, 0, 1, 1)}, ${E([2], 0, 0, 1, 1)}, ${E([3], 0, 0, 1, 1)} })
      Areas.Sort(groups, { [1] = "Brook", [2] = "Arch", [3] = "Crag" }, nil, 100, 100)
      return groups[1].areaID .. "," .. groups[2].areaID .. "," .. groups[3].areaID
    `);
    assert.equal(r, '2,1,3');
  });

  await t.test('alphabetical order ignores case', async () => {
    const r = await run(`
      local groups = Areas.Group({ ${E([1], 0, 0, 1, 1)}, ${E([2], 0, 0, 1, 1)} })
      Areas.Sort(groups, { [1] = "beta", [2] = "Alpha" }, nil, 100, 100)
      return groups[1].areaID .. "," .. groups[2].areaID
    `);
    assert.equal(r, '2,1');
  });

  await t.test('unnamed areas sort last, then by ID', async () => {
    const r = await run(`
      local groups = Areas.Group({ ${E([9], 0, 0, 1, 1)}, ${E([5], 0, 0, 1, 1)}, ${E([2], 0, 0, 1, 1)} })
      Areas.Sort(groups, { [2] = "Zed" }, nil, 100, 100)
      return groups[1].areaID .. "," .. groups[2].areaID .. "," .. groups[3].areaID
    `);
    assert.equal(r, '2,5,9');
  });

  await t.test('identical names break ties on ID', async () => {
    const r = await run(`
      local groups = Areas.Group({ ${E([8], 0, 0, 1, 1)}, ${E([3], 0, 0, 1, 1)} })
      Areas.Sort(groups, { [8] = "Same", [3] = "Same" }, nil, 100, 100)
      return groups[1].areaID .. "," .. groups[2].areaID
    `);
    assert.equal(r, '3,8');
  });
});

test('Areas.DisplayName', async (t) => {
  await t.test('uses the name when there is one', async () => {
    assert.equal(await run('return Areas.DisplayName("Goldshire", 87)'), 'Goldshire');
  });
  await t.test('falls back to "Area <id>" for nil or empty names', async () => {
    assert.equal(await run('return Areas.DisplayName(nil, 87)'), 'Area 87');
    assert.equal(await run('return Areas.DisplayName("", 87)'), 'Area 87');
  });
});

test('Areas.Summary', async (t) => {
  await t.test('zero reads All explored', async () => {
    assert.equal(await run('return Areas.Summary(0)'), 'All explored');
  });
  await t.test('one is singular', async () => {
    assert.equal(await run('return Areas.Summary(1)'), 'Unexplored: 1 area');
  });
  await t.test('many is plural', async () => {
    assert.equal(await run('return Areas.Summary(4)'), 'Unexplored: 4 areas');
  });
});

test('Areas.OnMap', async (t) => {
  // C_Map.GetPlayerMapPosition projects the player onto neighbouring zones of
  // the same continent, giving coordinates outside 0-1. Those must not count.
  await t.test('a position inside the map counts, edges included', async () => {
    assert.equal(await run('return (Areas.OnMap(0.5, 0.5) and Areas.OnMap(0, 1) and Areas.OnMap(1, 0)) and "y" or "n"'), 'y');
  });
  await t.test('a projected position outside 0-1 does not count', async () => {
    assert.equal(await run('return (Areas.OnMap(1.2, 0.5) or Areas.OnMap(0.5, -0.1)) and "y" or "n"'), 'n');
  });
});

test('Areas.IsClick', async (t) => {
  // Cursor positions in screen pixels at mouse down and mouse up. A press that
  // moved further than a few pixels was a pan drag, not a click.
  await t.test('a press that barely moved is a click', async () => {
    assert.equal(await run('return Areas.IsClick(100, 100, 102, 99) and "y" or "n"'), 'y');
  });
  await t.test('a press that moved several pixels is a drag', async () => {
    assert.equal(await run('return Areas.IsClick(100, 100, 108, 100) and "y" or "n"'), 'n');
  });
});

test('Areas.PointMatches', async (t) => {
  await t.test('identical points match', async () => {
    assert.equal(await run('return Areas.PointMatches(0.25, 0.5, 0.25, 0.5) and "y" or "n"'), 'y');
  });
  await t.test('float noise within 0.0001 matches', async () => {
    assert.equal(await run('return Areas.PointMatches(0.25, 0.5, 0.25009, 0.49991) and "y" or "n"'), 'y');
  });
  await t.test('a re-pinned point elsewhere does not match', async () => {
    assert.equal(await run('return Areas.PointMatches(0.25, 0.5, 0.2502, 0.5) and "y" or "n"'), 'n');
    assert.equal(await run('return Areas.PointMatches(0.25, 0.5, 0.25, 0.4) and "y" or "n"'), 'n');
  });
});

test('Areas.Nearest', async (t) => {
  await t.test('returns nil for no points', async () => {
    assert.equal(await run('return Areas.Nearest({}, 0.5, 0.5, 100, 100) == nil and "nil" or "pt"'), 'nil');
  });

  await t.test('picks the nearest point', async () => {
    const r = await run(`
      local p = Areas.Nearest({ { x = 0.9, y = 0.9 }, { x = 0.4, y = 0.5 }, { x = 0.1, y = 0.1 } }, 0.5, 0.5, 100, 100)
      return p.x .. "," .. p.y
    `);
    assert.equal(r, '0.4,0.5');
  });

  await t.test('measures in layer pixels, so aspect ratio matters', async () => {
    // Layer 1000 x 100. A is 0.05 away in x (50 px); B is 0.2 away in y (20 px).
    const r = await run(`
      local p = Areas.Nearest({ { x = 0.55, y = 0.5 }, { x = 0.5, y = 0.7 } }, 0.5, 0.5, 1000, 100)
      return p.y
    `);
    assert.equal(r, 0.7);
  });

  await t.test('a tie goes to the earlier point', async () => {
    const r = await run(`
      local p = Areas.Nearest({ { x = 0.4, y = 0.5 }, { x = 0.6, y = 0.5 } }, 0.5, 0.5, 100, 100)
      return p.x
    `);
    assert.equal(r, 0.4);
  });
});
