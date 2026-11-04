/ Writes lexing.json: each line of lexing.q with how q's lexer, -4!, splits
/ it, or the error it gives. The header records the md5 of both files and the
/ q version that wrote it.
/ Run after changing either: npm run fixtures

hex:{raze string x}
digest:{hex md5 "c"$read1 x}
cases:{x where not (x like "/*") or 0=count each x} read0 `:lexing.q
entry:{r:@[-4!;x;{`$x}]; `line`tokens!(x;$[-11h=type r;string r;r])}
header:`lexing`script`q!(digest `:lexing.q;digest `:lex.q;string[.z.K]," ",string .z.k)
body:.j.j each entry each cases
`:lexing.json 0:
  enlist[(-1_.j.j header),",\"cases\":["],
  ((-1_body),\:","),(-1#body),
  enlist "]}";
exit 0
