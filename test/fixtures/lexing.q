/ One q expression per line, for the scanner's tests: lex.q writes how q's
/ own lexer, -4!, splits each into lexing.json. Lines starting with / are
/ notes, skipped. Not loaded as a script: some lines don't run.
/ Minus: a literal only after whitespace or a non-value, with a digit next
a -1
a-1
1 -1
(1)-1
(1) -1
"a"-1
"a" -1
x[0]-1
x[0] -1
{x}-1
{x} -1
`a-1
`a -1
1-1
1 - 1
-1
a- 1
a -a
(-1)
x*-1
f[-1]
f[1;-1]
{-1}
-1-1
-1 -1
x- -1
-.5
x -.5
x-.5
-0w
x -0w
x@-1
x!-1
x<-1
x:-1
-1+-1
1 2-1
1 2 -1
1f-1
0x01-1
`a`b!1 -2
-3_-13#x
x_-1
a_ -1
/ Names
a.b
a .b
a . b
.a.b
a.1
a .1
a1
a.b1
x.y.z
a.
a_b
a__b
a _b
.Q.s1 x
.z.p
f . (1;2)
.[f;(1;2)]
/ Numbers and times
1.5e2
.5
1.
1e
1e10
1e-1
1.5e-2
1e+10
0x0aff
101b
0N
0Nj
0Wp
0w
1i
1h
1 2 3f
2026.11.04D12:00
12:00:00.000
1D
0D00:05
2026.11m
2026.11.04
0N!x
/ Symbols
`a
`a`b
`a`b`c
`:a/b.q
`:host:5010
`a:b
`a.b`c
`a`
` `a
`a_b
`.servers.getservers
`a"b"
2#`a
/ Strings
"a"
"a\"b"
"\n"
"a /b"
"http://x" / note
1"a"
/ Operators and assignment
x:1
x::1
x+:1
x,:1
x-:1
-:[x]
a:b:1
x+::1
x,::y
0:
2:
0:hsym x
1:-1
`:f 0:x
"\t" 0:x
x<>y
x<=y
x>=y
x~y
x^y
x#y
x_y
x$y
x?y
x&y
x|y
x%y
/ Iterators
+/[1 2]
x/:y
x\:y
x':y
x'y
f each x
+\[1 2]
,/[x]
/ Comments
a:1 / note
a:1	/ after a tab
a:1;/b
f:{[x;y] x+y} / c
/ Brackets, lambdas and qSQL
f:{[x;y] x+y}
{x+y}[1;2]
select a,b from t where c>1
update a:b+1 by c from t
exec first w from t where i in r`index
([]a:1 2;b:`x`y)
([k:`a`b]v:1 2)
$[a;b;c]
if[x;:y]
