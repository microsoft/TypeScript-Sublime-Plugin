TS = ../../../TypeScript
TSLOC = $(TS)/built/local
BIN = $(TSLOC)/tsserver.js $(TSLOC)/tsserver.js.map $(TSLOC)/lib.d.ts $(TSLOC)/lib.es6.d.ts 
LTSC = node $(TSLOC)/tsc.js
SRC = editorServices.ts protocol.ts server.ts

it: $(SRC)
	$(LTSC) node.d.ts editorServices.ts protocol.ts server.ts -m commonjs --noImplicitAny -out protocol.js 

install:
	cp $(BIN) ../../clients/sublime/TypeScript/tsserver

clean: 
	-rm *.js
	-rm *~
	-rm #*
