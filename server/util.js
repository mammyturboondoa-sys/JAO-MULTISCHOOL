'use strict';
// Sequential async map: like Array.map but each step may await (one at a time, in order).
async function mapSeq(list, fn) {
  const out = [];
  for (let i = 0; i < list.length; i++) out.push(await fn(list[i], i));
  return out;
}
module.exports = { mapSeq };
