TS = ../../../TypeScript
TSLOC = $(TS)/built/local
LTSC = node $(TSLOC)/tsc.js
SRC = protocol.ts editorServices.ts

it: $(SRC)
	$(LTSC) protocol.ts editorServices.ts -m commonjs

clean: 
	-rm *.js
	-rm *~
	-rm #*
