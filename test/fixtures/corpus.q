/ Corpus of q for the grammar snapshot and the codec fixtures.
/ Every value lives under .corpus, where fixtures.q walks it with key.
/ It must load cleanly: q -q test/fixtures/corpus.q
/ After a change, run npm run fixtures and UPDATE_SNAPSHOT=1 npm test

\d .corpus

/ Atoms, one per type
atom.boolean:1b
atom.guid:"G"$"0a369037-75d3-b24d-6721-5a1d44d4bed5"
atom.byte:0x2a
atom.short:42h
atom.int:42i
atom.long:42
atom.longSuffixed:42j
atom.real:4.2e
atom.float:4.2
atom.floatSuffixed:42f
atom.floatExponent:4.2e10
atom.char:"q"
atom.symbol:`kdb
atom.timestamp:2026.10.22D12:34:56.123456789
atom.month:2026.10m
atom.date:2026.10.22
atom.datetime:2026.10.22T12:34:56.123
atom.timespan:0D12:34:56.123456789
atom.timespanDays:1D02:00:00
atom.minute:12:34
atom.second:12:34:56
atom.time:12:34:56.123

/ Times beyond 24 hours and negative times
temporal.longTimespan:12D23:59:59.999999999
temporal.negativeTimespan:-0D00:00:01
temporal.longMinute:99:59
temporal.negativeSecond:-00:00:01
temporal.longTime:25:00:00.000
temporal.negativeTime:-12:34:56.789
temporal.preEpochDate:1999.12.31
temporal.preEpochTimestamp:1970.01.01D00:00:00.000000000

/ Vectors, one per type
vector.boolean:101b
vector.guid:"G"$("0a369037-75d3-b24d-6721-5a1d44d4bed5";"00000000-0000-0000-0000-000000000001")
vector.byte:0x00ff2a
vector.short:1 2 3h
vector.int:1 2 3i
vector.long:1 2 3
vector.real:1 2.5 3e
vector.float:1 2.5 3
vector.char:"kdb+"
vector.symbol:`a`b`c
vector.timestamp:2026.10.22D00:00:00 2026.10.23D00:00:00
vector.month:2026.10 2026.11m
vector.date:2026.10.22 2026.10.23
vector.datetime:2026.10.22T00:00:00.000 2026.10.23T00:00:00.000
vector.timespan:0D00:00:01 0D00:00:02
vector.minute:12:00 12:01
vector.second:12:00:00 12:00:01
vector.time:12:00:00.000 12:00:00.001
vector.emptyLong:`long$()
vector.emptySymbol:`$()
vector.singleton:enlist 42

/ Typed nulls
null.guid:0Ng
null.short:0Nh
null.int:0Ni
null.long:0N
null.longSuffixed:0Nj
null.real:0Ne
null.float:0n
null.floatSuffixed:0Nf
null.char:" "
null.symbol:`
null.timestamp:0Np
null.month:0Nm
null.date:0Nd
null.datetime:0Nz
null.timespan:0Nn
null.minute:0Nu
null.second:0Nv
null.time:0Nt
null.vector:1 0N 3

/ Infinities, positive and negative
infinity.short:0Wh
infinity.negativeShort:-0Wh
infinity.int:0Wi
infinity.negativeInt:-0Wi
infinity.long:0W
infinity.negativeLong:-0W
infinity.longSuffixed:0Wj
infinity.real:0We
infinity.negativeReal:-0We
infinity.float:0w
infinity.negativeFloat:-0w
infinity.floatSuffixed:0Wf
infinity.negativeFloatSuffixed:-0Wf
infinity.timestamp:0Wp
infinity.month:0Wm
infinity.date:0Wd
infinity.datetime:0Wz
infinity.timespan:0Wn
infinity.negativeTimespan:-0Wn
infinity.minute:0Wu
infinity.second:0Wv
infinity.time:0Wt

/ Strings and escapes
string.empty:""
string.escapes:"tab\there\nnewline \"quoted\" back\\slash"
string.octal:"\001\377"
string.slashes:"a / b \\ c"
string.multiLine:"first
 second"

/ Symbols and file handles
symbol.dotted:`.corpus.atom
symbol.list:`a`b`c
symbol.withColon:`a:b
symbol.handle:`:data/trades.csv
symbol.hostPort:`:localhost:5000
symbol.cast:`$"with space"

/ Attributes
attribute.sorted:`s#1 2 3
attribute.unique:`u#`a`b`c
attribute.parted:`p#1 1 2 2
attribute.grouped:`g#`a`b`a

/ General lists, dictionaries and tables
list.mixed:(1;`a;"b";2.5)
list.nested:(1 2;(3;`c);())
list.empty:()
dict.simple:`a`b`c!1 2 3
dict.mixed:`a`b!(1;"two")
dict.empty:(`symbol$())!()
table.trades:([] sym:`a`b`a; price:1.5 2.5 3.5; size:100 200 300)
table.flipped:flip `x`y!(1 2;`p`q)
table.empty:([] sym:`symbol$(); price:`float$())
table.keyed:([sym:`a`b] price:1.5 2.5)
table.multiKeyed:([sym:`a`b; ex:`n`l] price:1.5 2.5)
table.enumerated:([] sym:`.corpus.domain?`a`b`a)

/ Functions: implicit and explicit parameters, projections and compositions
fn.implicit:{x+y}
fn.implicitZ:{x+y*z}
fn.explicit:{[a;b] a+b}
fn.explicitSpaced:{[ a ; b ] a*b}
fn.noArgs:{[] 42}
fn.multiLine:{[t;n]
  r:select from t where size>n;
  / a comment inside a function
  r }
fn.global:{[v] `.corpus.fn.seen set v; v}
fn.projection:{x+y}[1]
fn.composition:('[neg;abs])
fn.operator:(+)
fn.iterator:(/)
fn.iterated:+/
fn.each:count'
fn.scan:+\
fn.prior:-':
fn.eachRight:,/:
fn.eachLeft:,\:
fn.builtin:count
fn.dotted:.corpus.fn.implicit

/ Operators and iterators
op.arithmetic:(1+2;3-1;2*3;7%2)
op.comparison:(1=1;1<>2;1<2;2>1;1<=1;1>=1;1~1)
op.join:1 2,3
op.take:2#1 2 3
op.drop:1_1 2 3
op.apply:.corpus.fn.implicit . 1 2
op.index:1 2 3@1
op.minusLiteral:(5 -1;5-1;(5)-1)
op.over:+/[1 2 3]
op.scan:+\[1 2 3]
op.each:count each (1 2;3 4 5)
op.eachIterator:count'[(1 2;3 4 5)]
op.eachRight:1 2,/:3 4
op.eachLeft:1 2,\:3 4
op.eachPrior:-':[1 4 9]
op.amend:@[1 2 3;1;:;20]
op.amendInPlace:{x[1]+:10;x}1 2 3
op.globalAssign:{.corpus.op.touched::1b}[]

/ Casts and internal functions
cast.lowercase:"j"$4.2
cast.symbol:`int$42
cast.short:5h$42
cast.parse:"D"$"2026.10.22"
internal.encode:-8!42
internal.decode:-9!-8!42
internal.type:type 42

/ Control flow and signals
control.cond:$[1b;`yes;`no]
control.vectorCond:?[101b;1 2 3;0]
control.if:{if[x;:`yes];`no}1b
control.do:{n:0;do[x;n+:1];n}3
control.while:{n:0;while[n<x;n+:1];n}3
control.signal:@[{'`oops};::;{x}]
control.signalAfterSemicolon:@[{x;'`late};::;{x}]
control.trap:.[{x+y};(1;`a);{x}]

/ qSQL
qsql.select:select price by sym from table.trades where size>100
qsql.exec:exec sum size from table.trades
qsql.update:update price*2 from table.trades
qsql.delete:delete from table.trades where sym=`b
qsql.functional:?[table.trades;();0b;()]

/ Large values, which -18! compresses
large.longs:til 2000
large.symbols:1000#`a`b`c
large.table:([] sym:300#`a`b`c; price:300#1.5 2.5; size:til 300)

/ System namespaces
system.zK:.z.K
system.Qn:.Q.n
system.hHtml:.h.htc[`p;"q"]
system.jJson:.j.j `a`b!1 2

/ Comments in awkward places
comment.trailing:1 / a trailing comment
comment.trailingTab:1	/ after a tab
comment.notAComment:+/[1 2]
/
  a block comment
  /
    nested inside it
  \
  still in the outer block
\
comment.afterBlock:1

\d .corpus.nested.deeper
answer:42
\d .
.corpus.nested.direct:{.corpus.nested.deeper.answer}[]

/ System commands
\t:10 til 1000
\ts til 1000 / timing with a comment
\c 25 80
\P 7

k).corpus.k:+/1 2 3

/ A lone backslash ends the script: q ignores everything below it
\
this is not q and is never read
select from where
