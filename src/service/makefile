TS = ../../../TypeScript
TSLOC = $(TS)/built/local
LTSC = node $(TSLOC)/tsc.js

it: editorServices.js
	$(LTSC) protocol.ts -m commonjs

editorServices.js: editorServices.ts
	$(LTSC) editorServices.ts --declaration -m commonjs	

clean: 
	-rm *.js
	-rm *~
	-rm #*
