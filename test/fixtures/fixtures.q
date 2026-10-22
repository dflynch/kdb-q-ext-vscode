/ Writes corpus.ipc.json: each value in corpus.q with its -8! bytes, and its
/ -18! bytes where q compresses them. The header records the md5 of this
/ script and of the corpus, and the q version that wrote the file.
/ Run after changing either script: npm run fixtures

\l corpus.q

/ A namespace is a dictionary whose first value is ::
isNamespace:{(99h=type x) and (::)~first x}
leaves:{[p] v:get p; $[isNamespace v; raze .z.s each ` sv' p,'1_key v; enlist p]}

hex:{raze string x}
digest:{hex md5 "c"$read1 x}
entry:{[p]
  v:get p;
  e:`name`type`bytes!(string p;type v;hex b:-8!v);
  $[b~c:-18!v; e; e,enlist[`compressed]!enlist hex c]}

header:`corpus`script`q!(digest `:corpus.q;digest `:fixtures.q;string[.z.K]," ",string .z.k)

/ One value per line, so a change to the corpus gives a readable diff
body:.j.j each entry each leaves `.corpus
`:corpus.ipc.json 0:
  enlist[(-1_.j.j header),",\"values\":["],
  ((-1_body),\:","),(-1#body),
  enlist "]}";
exit 0
