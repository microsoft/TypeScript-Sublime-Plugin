TS = ../../../TypeScript
TSLOC = $(TS)/built/local
LTSC = node $(TSLOC)/tsc.js
SRC = editorServices.ts protocol.ts server.ts

it: $(SRC)
	$(LTSC) node.d.ts editorServices.ts protocol.ts server.ts -m commonjs -out protocol.js 

install:
	-rm -rf ../../clients/sublime/TypeScript/node_modules
	cp -r ../../node_modules ../../clients/sublime/TypeScript
	cp protocol.js ../../clients/sublime/TypeScript

clean: 
	-rm *.js
	-rm *~
	-rm #*
