/ Random values for the console fuzz: writes each one's -8! bytes and the
/ text a q client shows when it arrives, as fixtures.q does.
/ Run by fuzz.js: q fuzz.q seed out.json -q

\c 2000 2000
system "S ",.z.x 0;

/ A vector of n of type c, with nulls and infinities among ordinary values
types:"bgxhijefcspmdznuvt";
ordinary:{[c;n] $[
  c="b"; n?0b;
  c="g"; n?0Ng;
  c="x"; `byte$n?256;
  c="h"; `short$-1000+n?2000;
  c="i"; -100000i+n?200000i;
  c="j"; -1000000000000+n?2000000000000;
  c="e"; "e"$(-1+n?2f)*10 xexp -20+n?40;
  c="f"; (-1+n?2f)*10 xexp -30+n?60;
  c="c"; "c"$32+n?95;
  c="s"; n?`3;
  c="p"; "p"$-3000000000000000000+n?6000000000000000000;
  c="m"; "m"$-20000+n?40000i;
  c="d"; "d"$-700000+n?3600000i;
  / Before 2^20 days: past it, q's datetimes can show a millisecond less
  / than ours, as temporal.ts says
  c="z"; "z"$-700000+n?1748576f;
  c="n"; "n"$-1000000000000000+n?2000000000000000;
  c="u"; "u"$-3000+n?6000i;
  c="v"; "v"$-200000+n?400000i;
  "t"$-200000000+n?400000000i]};
specials:{[c] $[c in "bxcs"; 0#c$(); c="g"; enlist 0Ng; (c$0N;c$0W;c$-0W)]};
vector:{[c;n] v:ordinary[c;n]; s:specials c; w:where 0=n?3;
  $[count s; @[v;w;:;count[w]?s]; v]};

/ Random lists, nested to depth d
leaf:{v:vector[first 1?types;first 1?0 1 2 3 5]; $[rand 4; v; first v]};
nested:{[d] $[d=0; leaf[];
  [n:1+rand 3; $[rand 2; n#enlist .z.s d-1; .z.s each n#d-1]]]};
/ A matrix of r rows of n elements, all of type c or of mixed types
matrix:{[c;r;n] {[c;n;x] vector[c;n]}[c;n] each til r};
mixed:{[r;n] {[n;c] vector[c;n]}[n] each r?types};

vals:raze {[c] vector[c] each 0 1 2 5 20} each types;
vals,:raze {[c] {[c;x] first vector[c;1]}[c] each til 5} each types;
vals,:raze {[c] {[c;x] matrix[c;2+rand 3;1+rand 4]}[c] each til 3} each types;
vals,:{mixed[2+rand 3;1+rand 4]} each til 50;
vals,:{[c] 2 2 2#vector[c;8]} each types;
vals,:nested each 200#3;

b:-8!'vals;
(hsym `$.z.x 1) 0: enlist .j.j {`bytes`console!(raze string x;.Q.s -9!x)} each b;
exit 0
