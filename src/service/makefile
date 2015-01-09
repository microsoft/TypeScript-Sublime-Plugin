TS = ../../../TypeScript
TSLOC = $(TS)/built/local
LTSC = node $(TSLOC)/tsc.js

it: editorServices.d.ts
	$(LTSC) protocol.ts -m commonjs

ed: 
	$(LTSC) editorServices.ts --declaration -m commonjs		

editorServices.d.ts: editorServices.ts
	$(LTSC) editorServices.ts --declaration -m commonjs	

clean: 
	-rm *.js
	-rm *~
	-rm #*
	-rm editorServices.d.ts
