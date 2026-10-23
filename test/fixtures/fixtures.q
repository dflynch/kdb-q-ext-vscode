/ Writes corpus.ipc.json: each value in corpus.q and display.q with its -8!
/ bytes, its -18! bytes where q compresses them, and the console's text for
/ it. The header records the md5 of this script and of both value files,
/ the q version that wrote the file, and the size .Q.s shows values at.
/ Run after changing any of them: npm run fixtures

\l corpus.q
\l display.q
/ The console at its largest, so that only the largest values are cut
\c 2000 2000

/ A namespace is a dictionary whose first value is ::
isNamespace:{(99h=type x) and (::)~first x}
leaves:{[p] v:get p; $[isNamespace v; raze .z.s each ` sv' p,'1_key v; enlist p]}

hex:{raze string x}
digest:{hex md5 "c"$read1 x}
entry:{[p]
  v:get p;
  b:-8!v;
  / The console text is what a q client shows when the value arrives, which
  / can differ from the value's own: q sends var as {var x}
  e:`name`type`bytes`console!(string p;type v;hex b;.Q.s -9!b);
  $[b~c:-18!v; e; e,enlist[`compressed]!enlist hex c]}

/ The lines and width .Q.s shows at this \c
header:`corpus`display`script`q`size!(digest `:corpus.q;digest `:display.q;digest `:fixtures.q;string[.z.K]," ",string .z.k;(system "c")-2 1)

/ One value per line, so a change to the corpus gives a readable diff
body:.j.j each entry each leaves `.corpus
`:corpus.ipc.json 0:
  enlist[(-1_.j.j header),",\"values\":["],
  ((-1_body),\:","),(-1#body),
  enlist "]}";
exit 0
