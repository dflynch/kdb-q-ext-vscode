/ Corpus of q for the grammar snapshot and the codec fixtures.
/ Every value lives under .corpus, where fixtures.q walks it with key.
/ It must load cleanly: npm run fixtures fails if it doesn't.
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
temporal.preEpochTimestamp:1999.12.31D23:59:59.999999999
temporal.unixEpoch:1970.01.01D00:00:00.000000000

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
null.generic:(::)

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
infinity.negativeTimestamp:-0Wp
infinity.month:0Wm
infinity.negativeMonth:-0Wm
infinity.date:0Wd
infinity.negativeDate:-0Wd
infinity.datetime:0Wz
infinity.negativeDatetime:-0wz
infinity.timespan:0Wn
infinity.negativeTimespan:-0Wn
infinity.minute:0Wu
infinity.negativeMinute:-0Wu
infinity.second:0Wv
infinity.negativeSecond:-0Wv
infinity.time:0Wt
infinity.negativeTime:-0Wt

/ Nulls and infinities inside vectors, where q drops the type suffix
special.short:0N 0W -0W 1h
special.int:0N 0W -0W 1i
special.long:0N 0W -0W 1
special.real:0N 0w -0w 1e
special.float:0n 0w -0w 1
special.timestamp:(0Np;0Wp;-0Wp;2026.10.22D00:00)
special.month:(0Nm;0Wm;-0Wm;2026.10m)
special.date:(0Nd;0Wd;-0Wd;2026.10.22)
special.datetime:(0Nz;0Wz;-0Wz;2026.10.22T00:00:00.000)
special.timespan:(0Nn;0Wn;-0Wn;0D01)
special.minute:(0Nu;0Wu;-0Wu;12:00)
special.second:(0Nv;0Wv;-0Wv;12:00:00)
special.time:(0Nt;0Wt;-0Wt;12:00:00.000)
special.symbol:`a``c
special.guid:(0Ng;"G"$"0a369037-75d3-b24d-6721-5a1d44d4bed5")

/ Empty vectors, which q shows with a cast
empty.boolean:`boolean$()
empty.guid:`guid$()
empty.byte:`byte$()
empty.short:`short$()
empty.int:`int$()
empty.long:`long$()
empty.real:`real$()
empty.float:`float$()
empty.char:""
empty.symbol:`$()
empty.timestamp:`timestamp$()
empty.month:`month$()
empty.date:`date$()
empty.datetime:`datetime$()
empty.timespan:`timespan$()
empty.minute:`minute$()
empty.second:`second$()
empty.time:`time$()

/ Floats that q rounds or writes in exponent form
float.negativeZero:-0.0
float.negativeZeroVector:-0.0 1
float.rounded:1.23456789
float.large:123456789.0
float.small:1e-5
float.sum:0.1+0.2
float.realRounded:1.23456789e

/ Strings and escapes
string.empty:""
string.escapes:"tab\there\nnewline \"quoted\" back\\slash"
string.octal:"\001\377"
string.slashes:"a / b \\ c"
string.multiLine:"first
 second"
string.utf8:"\303\251t\303\251"

/ Symbols and file handles
symbol.dotted:`.corpus.atom
symbol.list:`a`b`c
symbol.withColon:`a:b
symbol.handle:`:data/trades.csv
symbol.hostPort:`:localhost:5000
symbol.cast:`$"with space"
symbol.utf8:`$"\303\251t\303\251"

/ Attributes
attribute.sorted:`s#1 2 3
attribute.unique:`u#`a`b`c
attribute.parted:`p#1 1 2 2
attribute.grouped:`g#`a`b`a

/ General lists, dictionaries and tables
list.mixed:(1;`a;"b";2.5)
list.nested:(1 2;(3;`c);())
list.empty:()
list.dictAndTable:(`a`b!1 2;([] x:1 2))
dict.simple:`a`b`c!1 2 3
dict.mixed:`a`b!(1;"two")
dict.empty:(`symbol$())!()
dict.sorted:`s#`a`b!1 2
dict.nonSymbolKeys:1 2!`a`b
table.trades:([] sym:`a`b`a; price:1.5 2.5 3.5; size:100 200 300)
table.flipped:flip `x`y!(1 2;`p`q)
table.empty:([] sym:`symbol$(); price:`float$())
table.keyed:([sym:`a`b] price:1.5 2.5)
table.multiKeyed:([sym:`a`b; ex:`n`l] price:1.5 2.5)
table.sortedKeyed:`s#([sym:`a`b] price:1.5 2.5)
table.attributes:([] p:`p#1 1 2; s:`s#1 2 3; u:`u#`x`y`z; g:`g#`p`q`p)
table.stringColumn:([] s:("ab";enlist "c";""); n:1 2 3)
table.nestedColumn:([] v:(1 2;3 4 5))
table.charColumns:([] a:"ab"; b:"cd")
/ -8! sends an enumeration as plain symbols
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
fn.elided:{x+y+z}[;1]
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
/ The same value as fn.implicit, for the grammar's dotted name
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
op.globalAssign:{.corpus.op.touched::x;x}1b

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
large.symbols:3000#`a`b`c
large.table:([] sym:300#`a`b`c; price:300#1.5 2.5; size:til 300)

/ Display: the console's layout of a general list, a line to an item, or a
/ matrix when the items are lists of one length
display.atoms:(1;`a;"b";2.5;::)
display.ragged:(1 2;10 20 30;3)
display.matrix:(1 2;10 20)
display.matrixNulls:(0N 1;2 0N)
display.matrixFloats:(1.5 2;3 4.25)
display.matrixMixed:(1 2;"ab";`a`b)
display.matrixOfLists:((1 2;3);(10 20;4))
display.matrixOfAtoms:((`a;1);(`bb;22))
display.matrixOfMatrices:((`a`b;`c`d);(`e`f;`g`h))
display.matrixDeeper:(1 2;(1 2;3 4))
display.matrixEmpty:(();())
display.strings:("ab";"cd")
display.booleans:(101b;010b)
display.bytes:(0x0102;0x0304)
display.mixedBooleans:(101b;1 2 3)
display.singletons:(enlist 1;enlist 2)
display.oneRow:enlist (1;`a)
display.nested:(`a`b!1 2;([] x:1 2);([k:1 2] v:3 4);`s#`a`b!1 2;{x+y}[1];+[;1])
display.compositions:('[neg;abs];'[count;+];'[{x};neg];neg abs@)
display.emptyItems:(1;`long$();"";`symbol$();0x)
display.cube:3 2 2#til 12
display.cubeUneven:((1 22;3 4);(5 6;7 8))
display.dictKeys:((enlist 1 2)!enlist 3;(enlist "ab")!enlist 2;(`long$())!`long$();(`$())!())
display.compositionColons:('[::;neg];'[(0::);neg])

/ Floats and temporal values at q's edges
float.exponentLarge:1e300
float.exponentSmall:-1e-300
float.wholeLarge:1000000f
float.roundedWhole:1234567.8
float.realExponent:123456789e
float.realNegativeZero:-0e
/ C rounds an exact tie to even
float.tie:1000.0625
float.tieWhole:1234566.5
float.realTie:-86463.625e
temporal.firstDate:0001.01.01
temporal.lastDate:9999.12.31
temporal.outOfRange:9999.12.31+1
temporal.yearZeroMonth:`month$-23989
temporal.hundredHours:"u"$6000
temporal.negativeMinute:"u"$-61
temporal.lastTimestamp:"p"$0W-1
temporal.firstTimestamp:"p"$1-0W
temporal.longestTimespan:"n"$0W-1
temporal.datetimeRoundsUp:`datetime$0.00000001157
temporal.datetimeTruncates:`datetime$0.99999999999
temporal.datetimeNegative:`datetime$-0.0000000057
temporal.datetimeOutOfRange:"z"$-923892.12
temporal.allNullDates:2#0Nd
temporal.allInfiniteDatetimes:2#0Wz

/ Characters q escapes in a string
string.control:"\r\001\177\200 ~"

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
