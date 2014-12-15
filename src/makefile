TS = /home/steve/src/TypeScript
#TS = c:\usr\users\lucco\src\TypeScript
TSLOC = $(TS)/built/local
#TSLOC = $(TS)\built\local
LTSC = node $(TSLOC)/tsc.js
#LTSC = node $(TSLOC)\tsc.js
HOME = /home/steve
REMOTE_HOME = $(HOME)/steve-u1/steve

SRC = tsio.ts client.ts scriptVersionCache.ts
it: $(SRC) ed.js
	$(LTSC) protocol.ts -m commonjs
	cat ed.js protocol.js >proto.js

ed.js: $(SRC)
	$(LTSC) tsio.ts -declaration -out ed.js

ted: $(SRC)
	$(LTSC) tsio.ts edrive.ts -out ted.js

dbg: debugger.ts
	$(LTSC) debugger.ts -m commonjs

iot: ioTest.ts
	$(LTSC) ioTest.ts -m commonjs

clean: 
	-rm *.js *~

tolap:	
	cp -r $(HOME)/.emacs.d $(REMOTE_HOME)
	cp -r $(HOME)/src/ts/versionCache $(REMOTE_HOME)/src/ts
	cp $(HOME)/.emacs $(REMOTE_HOME)/remote.emacs

fromlap:	
	cp -r $(REMOTE_HOME)/.emacs.d $(HOME)
	cp -r $(REMOTE_HOME)/src/ts/versionCache $(HOME)/src/ts
	cp $(REMOTE_HOME)/.emacs $(HOME)/remote.emacs
	-diff $(HOME)/.emacs $(REMOTE_HOME)/remote.emacs >ff


zip:
	zip -ur $(HOME)/distr.zip $(HOME)/src/ts/versionCache $(HOME)/.emacs.d 
