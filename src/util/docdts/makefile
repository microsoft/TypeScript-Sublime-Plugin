TS = ../../../../TypeScript
TSLOC = $(TS)/built/local
LTSC = node $(TSLOC)/tsc.js
SRC = docdts.ts

it: $(SRC)
	$(LTSC) docdts.ts -m commonjs --noImplicitAny 


clean: 
	-rm *.js
	-rm *~
	-rm #*
