.merge.limit:@[value;`.merge.limit;0b]
\d .u
upd:{[t;x] t insert x} / adds rows to t
\d .
run:{[t] .u.upd[t;.merge.limit]}
