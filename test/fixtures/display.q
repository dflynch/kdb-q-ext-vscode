/ Values at the edges of the console's text, for the formatter's fixtures:
/ q's layout of general lists, floats and temporal values at q's limits, and
/ the characters q escapes. They live under .corpus with the rest, but not in
/ corpus.q, as they add nothing to the grammar snapshot.
/ After a change, run npm run fixtures

\d .corpus

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
/ In exponent form, a tie rounded down keeps its zeros
float.tieExponent:10541605f
float.realTieExponent:12000005e
float.tieExponentUp:10541595f
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

/ Every primitive q has, from its type and code, so that one a new q adds
/ fails a test. -9! fails on a code q doesn't have.
primitive.unaries:{x where 100<=type each x} {@[-9!;0x010000000a00000065,"x"$x;::]} each til 256
primitive.operators:{x where 100<=type each x} {@[-9!;0x010000000a00000066,"x"$x;::]} each til 256
primitive.iterators:{x where 100<=type each x} {@[-9!;0x010000000a00000067,"x"$x;::]} each til 256
