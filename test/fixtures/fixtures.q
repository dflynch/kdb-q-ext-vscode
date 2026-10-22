/ Writes corpus.ipc.json: each value in corpus.q with its -8! bytes, its
/ -18! bytes where they differ (compressed), and how the q console shows it.
/ Run from this directory after changing the corpus: q fixtures.q -q

\l corpus.q

/ The corpus sets a narrow console; show text must not be cut short
\c 2000 2000

/ A namespace is a dictionary whose first value is ::
isNamespace:{(99h=type x) and (::)~first x}
leaves:{[p] v:get p; $[isNamespace v; raze .z.s each ` sv' p,'1_key v; enlist p]}

hex:{raze string x}
entry:{[p]
  v:get p;
  e:`name`type`bytes`show!(string p;type v;hex -8!v;.Q.s v);
  $[(-8!v)~c:-18!v; e; e,enlist[`compressed]!enlist hex c]}

/ One value per line, so a change to the corpus gives a readable diff
body:.j.j each entry each leaves `.corpus
digest:hex md5 "c"$read1 `:corpus.q
`:corpus.ipc.json 0:
  enlist["{\"corpus\":",(.j.j digest),",\"values\":["],
  ((-1_body),\:","),(-1#body),
  enlist "]}"
exit 0
