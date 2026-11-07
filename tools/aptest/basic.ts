import { setup, run, st } from './harness.ts';
const id = process.argv[2] ?? 'a320neo';
let s = setup(id, 10000, 250);
console.log('== hold 60s'); run(s, 60, 20, () => console.log(st(s)));
console.log('== HDG 180 (from 90)'); s.fcs.selHdg = 180; run(s, 60, 10, () => console.log(st(s)));
console.log('== climb FLC to 20000'); s.fcs.selAlt = 20000; s.fcs.setVert('FLC'); run(s, 300, 30, () => console.log(st(s)));
console.log('== descend VS -2000 to 12000'); s.fcs.selAlt = 12000; s.fcs.selVs = -2000; s.fcs.setVert('VS'); s.fcs.selVs = -2000; run(s, 300, 30, () => console.log(st(s)));
console.log('== speed 300'); s.fcs.selSpd = 300; run(s, 90, 15, () => console.log(st(s)));
