TS = ../../../../TypeScript
TSLOC = $(TS)/built/local
LTSC = node $(TSLOC)/tsc.js

it: 
	$(LTSC) versionCacheTest.ts -out vct.js

clean: 
	-rm *.js
	-rm *~
	-rm "#*"
