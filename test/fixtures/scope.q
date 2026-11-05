/ Writes scoping.json: for each line of scoping.q, the lambda's parameters,
/ locals and globals as q's value lists them, or the error q gives. Also
/ loads the modules under modules/ (run with QPATH=modules) and records each
/ one's export keys and the names in its namespace. The header records the
/ md5 of this script, scoping.q and the modules, and the q version.
/ Run after changing any of them: npm run fixtures

hex:{raze string x}
digest:{hex md5 "c"$read1 x}
cases:{x where not (x like "/*") or 0=count each x} read0 `:scoping.q
names:{string x where not null x}
scope:{v:value value x; `params`locals`globals!(names v 1;names v 2;names 1_v 3)}
entry:{r:@[scope;x;{`$x}]; `line`scope!(x;$[-11h=type r;string r;r])}
modfiles:`:modules/foo/init.q`:modules/foo/sub.q`:modules/dyn.q
module:{r:@[use;x;{`$x}]; `module`export!(string x;$[-11h=type r;string r;99h=type r;string key r;"dynamic"])}
mods:module each `foo`foo.sub`dyn
spaces:{`space`names!(string x;string 1_key x)} each `.m.foo`.m.foo.0sub`.m.dyn
header:`scoping`script`digests`q!(digest `:scoping.q;digest `:scope.q;raze digest each modfiles;string[.z.K]," ",string .z.k)
`:scoping.json 0: enlist .j.j header,`cases`modules`spaces!(entry each cases;mods;spaces)
exit 0
