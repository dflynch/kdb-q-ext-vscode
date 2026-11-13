/- VWAP bars for the gateway
/- .ana.vwap[syms;start;end;bar]: VWAP and volume per sym per bar
/- syms: symbol(s); start, end: timestamps; bar: timespan e.g. 0D00:05
/- runs on the RDB (today, from memory) and the HDB (earlier dates, date-partitioned)
/- through the gateway: .gw.syncexec[(`.ana.vwap;syms;start;end;bar);`rdb`hdb]

.ana.vwap:{[syms;start;end;bar]
  .lg.o[`vwap;"vwap bars for ",(-3!syms)," from ",string[start]," to ",string[end]," by ",string bar];
  syms:(),syms;
  / the HDB is date-partitioned; the RDB holds today only
  $[`date in cols `trade;
    select vwap:size wavg price, volume:sum `long$size by sym, time:bar xbar time from trade where date within `date$(start;end), sym in syms, time within (start;end);
    select vwap:size wavg price, volume:sum `long$size by sym, time:bar xbar time from trade where sym in syms, time within (start;end)]
  }
