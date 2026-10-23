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
  c="z"; "z"$-700000+n?3600000f;
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

/ Tables with columns of any type, strings, nested lists and matrices
col:{[n] $[
  4>r:rand 7; vector[first 1?types;n];
  r=4; {[x] "c"$97+(rand 4)?26} each til n;
  r=5; {[x] vector[first 1?types;rand 3]} each til n;
  {[c;x] vector[c;2]}[first 1?types] each til n]};
names:{[k] `$string[k?`3],'string til k};
tbl:{[k;n] flip (names k)!col each k#n};
vals,:{tbl[1+rand 4;rand 6]} each til 60;
/ Keyed tables, and dictionaries of vectors, lists and tables
vals,:{n:1+rand 5; tbl[1+rand 2;n]!tbl[1+rand 3;n]} each til 40;
vals,:{n:rand 6; vector[first 1?types;n]!col n} each til 60;
vals,:{n:1+rand 4; vector["s";n]!tbl[1+rand 2;n]} each til 20;
vals,:{n:1+rand 4; tbl[1+rand 2;n]!vector[first 1?types;n]} each til 20;
vals,:{n:1+rand 3; (n?`3)!{nested 1} each til n} each til 20;

b:-8!'vals;
/ With the lines and width .Q.s shows at this \c
(hsym `$.z.x 1) 0: enlist .j.j `size`values!((system "c")-2 1;{`bytes`console!(raze string x;.Q.s -9!x)} each b);
exit 0
