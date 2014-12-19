TS = ../../../TypeScript
TSLOC = $(TS)/built/local
LTSC = node $(TSLOC)/tsc.js

it: 
	$(LTSC) versionCacheTest.ts -m commonjs

clean: 
	-rm *.js
	-rm *~
	-rm "#*"
