/ Nested qSQL queries, for the annotation pass's tests: query.q puts each
/ inner query in place of X in each outer one, and writes into querying.json
/ what q's parse makes of each name in those it parses. Lines with an X are
/ outer queries, the rest inner ones. Lines starting with / are notes,
/ skipped. Not loaded as a script.
/ Outer: the inner query in the column list, alone or with more after it
select c:X from t
select c:X from t where z
select c:X by g from t
select c:X, d:a from t
exec X from t
exec c:X by g from t
exec c:X, d:a from t
/ in the by list
select by c:X from t
select by c:X from t where z
/ under a row count and a sort
select[n] c:X from t
select[n;>e] c:X from t
select[>e] c:X from t
/ in update's columns, in place too
update c:X from t where z
update c:X by g from t
/ in the clause
select from t where a in X
select from t where a in X, e
select from t where e, a in X
delete from t where a in X
/ as the table
select from X
select from X where z
exec a from X
/ applied, unbracketed and in brackets
select c:f X from t
select c:f[X] from t
select from t where a in f[X]
/ Inner: with and without by and where; commas and where as the function in
/ its clause; a query of its own, as its table and in its column list
exec x from s
exec x from s where y
exec x by h from s where y
exec x, w from s where y
select from s where y
select x by h from s where y
select from s where y, w
update x:1 from s where y
delete from s where y
delete x from s
exec x from s where y in where w
exec x from select from u where v
exec d:select from u where v from s where y
/ in brackets
(exec x from s)
(select from s where y)
