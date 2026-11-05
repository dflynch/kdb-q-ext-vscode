/ A module whose export is built as it loads
a:{x}
b:{y}
export:enlist[`$"a"]!enlist a
export,:([b:b])
