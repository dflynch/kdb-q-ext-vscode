/ Ground truth for navigation: every lambda each running TorQ process holds,
/ with q's own name, file, line, context and referenced globals.
/ q truth.q -root <deploy dir> -out <file.json> -ports 6000 6001 ...
a:.Q.opt .z.x;
root:first a`root; out:hsym `$first a`out; ports:"J"$a`ports;

/ runs inside each process: one row per lambda whose file is under root
walk:{[root]
  / a lambda, then the lambdas among its constants (anonymous inner lambdas),
  / each with its own globals; inner ones get path `` (bound to nothing)
  row:{[root;path;v]
    w:value v; n:count w; f:w n-3;
    if[not (count[root]<=count f)&root~count[root]#f; :()];
    inner:c where 100h=type each c:4_(n-4)#w;
    (enlist `path`name`file`line`context`globals`source!(path;w n-4;f;w n-2;first w 3;1_w 3;w n-1)),raze .z.s[root;`]'[inner]};
  visit:{[row;path;v]
    $[100h=type v; row[path;v];
      99h<>type v; ();
      not (`)~first key v; ();                                / a dictionary, not a namespace
      raze .z.s[row]'[` sv' path,'1_key v;1_value v]]}[row root];
  r:raze visit'[k;get each k:key `.];
  ns:` sv' `,'key `;
  r,raze visit'[ns;get each ns]};

one:{[root;p]
  h:@[hopen;(`$"::",string[p],":admin:admin";30000);{-2 "skip ",string[x],": ",y;0Ni}[p]];
  if[null h;:()];
  pt:h"(.proc.proctype;.proc.procname)";
  r:@[h;(walk;root);{-2 "walk failed: ",x;()}];
  hclose h;
  r:{x,`proctype`procname!y}[;pt] each r;
  -1 string[p]," ",string[pt 1],": ",string count r;
  r};

rows:raze one[root] each ports;
-1 string[count rows]," lambdas";
out 0: enlist .j.j rows;
exit 0
