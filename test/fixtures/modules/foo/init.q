/ A module: its names land in .m.foo, and it exports h as f, a lambda as k,
/ and a nested module's export
g:2
h:{g+x}
.abs.v:9
s:use`.sub
export:([f:h; k:{x*g}; t:s`s])
