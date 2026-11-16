/ Writes querying.json: each outer query of querying.q with each inner query
/ in place of its X, those q parses, with each name and how q reads it: a
/ column, if within any query's columns, by or where, or a table within one;
/ else a global. The header records the md5 of this script and querying.q,
/ and the q version. Run after changing either: npm run fixtures

hex:{raze string x}
digest:{hex md5 "c"$read1 x}
lines:{x where not (x like "/*") or 0=count each x} read0 `:querying.q
outers:lines where lines like "*X*"
inners:lines where not lines like "*X*"
/ A query in q's parse: ?[t;where;by;columns] for select and exec, with a
/ row count and a sort after for select[n;>c]; ![t;where;by;columns] for
/ update and delete
query:{(0h=type x)&(5<=count x)&any (?;!)~\:first x}
/ Each name in parse tree x, as (name;role), x being read as role c. A
/ dictionary's keys are the columns a query names; a symbol vector is a
/ literal, as `t in update from `t, not a name
roles:{[x;c]
  $[-11h=type x; enlist (x;c);
    99h=type x; $[11h=type key x; (key x),\:`column; ()],raze .z.s[;c] each value x;
    not 0h=type x; ();
    not query x; raze .z.s[;c] each x;
    .z.s[x 1;c],(raze .z.s[;`column] each x 2 3 4),
      $[5<count x; .z.s[x 5;c]; ()],$[6<count x; .z.s[x 6;`column]; ()]]}
entry:{[o;i]
  q:ssr[o;"X";i]; p:@[parse;q;{`}];
  $[(`)~p; (); enlist `query`names!(q;{(string x 0;string x 1)} each roles[p;`global])]}
cases:raze {[o] raze entry[o] each inners} each outers
header:`querying`script`q!(digest `:querying.q;digest `:query.q;string[.z.K]," ",string .z.k)
`:querying.json 0: enlist .j.j header,enlist[`cases]!enlist cases
exit 0
