TS = ~/src/TypeScript
TSLOC = $(TS)/built/local
BIN = $(TSLOC)/tsserver.js $(TSLOC)/tsserver.js.map $(TSLOC)/lib.d.ts $(TSLOC)/lib.es6.d.ts 
LTSC = node $(TSLOC)/tsc.js
SRC = editorServices.ts protocol.ts server.ts

it: $(SRC)
	$(LTSC) node.d.ts editorServices.ts protocol.ts server.ts --noImplicitAny -out protocol.js 

client: $(SRC)
	$(LTSC) node.d.ts editorServices.ts protocol.ts client.ts --noImplicitAny -out client.js 

install:
	cp $(BIN) ../../tsserver

clean: 
	-rm *.js
	-rm *~
	-rm #*
