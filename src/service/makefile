TS = ../../../TypeScript
TSLOC = $(TS)/built/local
LTSC = node $(TSLOC)/tsc.js
SRC = protocol.ts editorServices.ts

it: $(SRC)
	$(LTSC) protocol.ts editorServices.ts -m commonjs

install:
	-rm -rf ../../clients/sublime/TypeScript/node_modules
	cp -r ../../node_modules ../../clients/sublime/TypeScript
	cp protocol.js ../../clients/sublime/TypeScript
	cp editorServices.js ../../clients/sublime/TypeScript

clean: 
	-rm *.js
	-rm *~
	-rm #*
