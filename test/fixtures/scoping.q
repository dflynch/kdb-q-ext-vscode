/ One q lambda per line, for the annotation pass's tests: scope.q writes the
/ parameters, locals and globals q itself finds in each (value on the lambda)
/ into scoping.json. Lines starting with / are notes, skipped. Not loaded as a
/ script: q only compiles each line.
/ Parameters: explicit, implicit up to the highest used, none
{[a;b] a+b}
{x+y}
{z}
{1}
{[] 1}
{{y}}
{x+{z}}
/ Locals: only a plain name: makes one, anywhere in the body
{[a] b:1; c::2; a+b+d}
{a :1; a}
{if[c;a:1]; a}
{$[a;b:1;c::2]}
{f[a:1]; a}
{(a;b):1 2}
{`a`b!(c:1;2); c}
{x:1; y}
{x::1}
{a:1; a::2; a}
/ Amends and dotted names make globals, not locals
{a[0]:1; b+:1; c,::2; e.f:3}
{.x.y+e.f+g}
{x.a}
/ No closures: a nested lambda reads globals, not the outer's locals
{a:1; {a}; a}
{a:1; {b:2; a+b}}
/ Literal keys and columns aren't locals
{([] a:1 2)}
{([a:1;b:2])}
{([k:1] v:2)}
/ qSQL: names in clauses are columns, the from expression is code
{update a:1, b:c from t where d>0, e in f}
{select g by h from t}
{[t] select from t where s in w, v>u}
{exec q from t; delete r from t}
{select s.n from t where s.m>0, .a.b>c}
{exec a from t; b}
{select[2] a from t}
{select[>a] from t}
{a:1; select a from t}
{delete from `t where a}
{select from t where a in exec b from u}
{select {x+1} each a from t}
/ Keywords and handles aren't globals
{count x}
{`n set 1; value `m}
{@[`.;`upd;:;x]}
{.Q.dd[x;`a]}
/ from and by are keywords only in a query
{(a;from;by)}
/ From TorQ
{[IDS].gw.eod&1<count distinct$[11h=type ids:raze IDS;ids;exec servertype from .gw.servers where any serverid in/:ids]}
{[timerid] delete from `.timer.timer where id=timerid}
{[connectiontab;procs;connect] res:select from connectiontab where not ([]procname;proctype;hpup) in select procname,proctype,hpup from .servers.SERVERS; res}
{[t].lg.o[`writedown;"clearing table ",string t]; @[`.;t;0#]}
{asc distinct exec proctypes from`.servers.SERVERS where .dotz.liveh w}
{@[value;`.dqe.currentpartition;(`date^partitiontype)$(.z.D,.z.d)utctime]}
