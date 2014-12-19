///<reference path='ed.ts' />

module Editor {
    var gloError = false;
    var lineCollectionCapacity = 4;
    var indentStrings: string[] = [];
    var indentBase = "    ";
    function getIndent(indentAmt: number) {
        if (!indentStrings[indentAmt]) {
            indentStrings[indentAmt] = "";
                  for (var i = 0; i < indentAmt; i++) {
                  indentStrings[indentAmt] += indentBase;
             }
        }
        return indentStrings[indentAmt];
    }

    function editFlat(s: number, dl: number, nt: string, source: string) {
        return source.substring(0, s) + nt + source.substring(s + dl, source.length);
    }

    export function printLine(s: string) {
        sys.write(s + '\n'); 
    }

    function showLines(s: string) {
        var strBuilder = "";
        for (var i = 0, len = s.length; i < len; i++) {
            if (s.charCodeAt(i) == 10) {
                strBuilder += '\\n';
            }
            else if (s.charCodeAt(i) == 13) {
                strBuilder += '\\r';
            }
            else {
                strBuilder += s.charAt(i);
            }
        }
        return strBuilder;
    }

    function recordError() {
        gloError=true; 
    }

    function tstTest() {
        var fname = 'tst.ts';
        var content = sys.readFile(fname);
        var lm = LineIndex.linesFromText(content);
        var lines = lm.lines;
        if (lines.length == 0) {
            return;
        }
        var lineMap = lm.lineMap;

        var lineIndex = new LineIndex();
        lineIndex.load(lines);

        var editedText = lineIndex.getText(0, content.length);

        var snapshot: LineIndex;
        var checkText: string;
        var insertString: string;

// change 9 1 0 1 {"y"}
        var pos =lineColToPosition(lineIndex,9,1);
        insertString = "y";
        checkText = editFlat(pos,0,insertString,content);
        snapshot = lineIndex.edit(pos, 0, insertString);
        editedText = snapshot.getText(0, checkText.length);
        if (editedText != checkText) {
            recordError();
            return;
        }

// change 9 2 0 1 {"."}
        var pos =lineColToPosition(snapshot,9,2);
        insertString = ".";
        checkText = editFlat(pos,0,insertString,checkText);
        snapshot = snapshot.edit(pos, 0, insertString);
        editedText = snapshot.getText(0, checkText.length);
        if (editedText != checkText) {
            recordError();
            return;
        }

// change 9 3 0 1 {"\n"}
        var pos =lineColToPosition(snapshot,9,3);
        insertString = "\n";
        checkText = editFlat(pos,0,insertString,checkText);
        snapshot = snapshot.edit(pos, 0, insertString);
        editedText = snapshot.getText(0, checkText.length);
        if (editedText != checkText) {
            recordError();
            return;
        }

// change 10 1 0 10 {"\n\n\n\n\n\n\n\n\n\n"}
        pos =lineColToPosition(snapshot,10,1);        
        insertString = "\n\n\n\n\n\n\n\n\n\n";
        checkText = editFlat(pos,0,insertString,checkText);
        snapshot = snapshot.edit(pos, 0, insertString);
        editedText = snapshot.getText(0, checkText.length);
        if (editedText != checkText) {
            recordError();
            return;
        }

// change 19 1 1 0
        pos =lineColToPosition(snapshot,19,1);
        checkText = editFlat(pos,1,"",checkText);
        snapshot = snapshot.edit(pos, 1);
        editedText = snapshot.getText(0, checkText.length);        
        if (editedText != checkText) {
            recordError();
            return;
        }

// change 18 1 1 0
        pos =lineColToPosition(snapshot,18,1);
        checkText = editFlat(pos,1,"",checkText);
        snapshot = snapshot.edit(pos, 1);
        editedText = snapshot.getText(0, checkText.length);        
        if (editedText != checkText) {
            recordError();
            return;
        }

        function lineColToPosition(lineIndex:LineIndex,line:number,col:number) {
            var lineInfo=lineIndex.lineNumberToInfo(line);
            return (lineInfo.offset+col-1);
        }
    }

    function editTest() {
        var fname = 'editme';
        var content = sys.readFile(fname);
        var lm = LineIndex.linesFromText(content);
        var lines = lm.lines;
        if (lines.length == 0) {
            return;
        }
        var lineMap = lm.lineMap;

        var lineIndex = new LineIndex();
        lineIndex.load(lines);

        var editedText = lineIndex.getText(0, content.length);

        var snapshot: LineIndex;
        var checkText: string;
        var insertString: string;

        // Case VII: insert at end of file
        insertString = "hmmmm...\r\n";
        checkText = editFlat(content.length,0,insertString,content);
        snapshot = lineIndex.edit(content.length, 0, insertString);
        editedText = snapshot.getText(0, checkText.length);
        if (editedText != checkText) {
            recordError();
            return;
        }

        // Case IV: unusual line endings merge
        snapshot = lineIndex.edit(lines[0].length-1,lines[1].length, "");
        editedText = snapshot.getText(0, content.length - lines[1].length);
        checkText = editFlat(lines[0].length-1, lines[1].length, "", content);
        if (editedText != checkText) {
            recordError();
            return;
        }


        // Case VIIa: delete whole line and nothing but line (last line)
        var llpos = lm.lineMap[lm.lineMap.length-2];
        snapshot = lineIndex.edit(llpos, lines[lines.length-1].length, "");
        checkText = editFlat(llpos, lines[lines.length-1].length, "" , content);
        editedText = snapshot.getText(0, checkText.length);
        if (editedText != checkText) {
            recordError();
            return;
        }

        // Case VIIb: delete whole line and nothing but line (first line)
        snapshot = lineIndex.edit(0, lines[0].length, "");
        editedText = snapshot.getText(0, content.length - lines[0].length);
        checkText = editFlat(0, lines[0].length, "" , content);
        if (editedText != checkText) {
            recordError();
            return;
        }

        // and insert with no line breaks
        insertString = "moo, moo, moo! ";
        snapshot = lineIndex.edit(0, lines[0].length, insertString);
        editedText = snapshot.getText(0, content.length - lines[0].length + insertString.length);
        checkText = editFlat(0, lines[0].length, insertString, content);
        if (editedText != checkText) {
            recordError();
            return;
        }

        // and insert with multiple line breaks
        insertString = "moo, \r\nmoo, \r\nmoo! ";
        snapshot = lineIndex.edit(0, lines[0].length, insertString);
        editedText = snapshot.getText(0, content.length - lines[0].length + insertString.length);
        checkText = editFlat(0, lines[0].length, insertString, content);
        if (editedText != checkText) {
            recordError();
            return;
        }

        snapshot = lineIndex.edit(0, lines[0].length + lines[1].length, "");
        editedText = snapshot.getText(0, content.length - (lines[0].length+lines[1].length));
        checkText = editFlat(0, lines[0].length+ lines[1].length, "", content);
        if (editedText != checkText) {
            recordError();
            return;
        }

        snapshot = lineIndex.edit(lines[0].length, lines[1].length + lines[2].length, "");

        editedText = snapshot.getText(0, content.length - (lines[1].length + lines[2].length));
        checkText = editFlat(lines[0].length, lines[1].length + lines[2].length, "", content);
        if (editedText != checkText) {
            recordError();
            return;
        }

        // Case VI: insert multiple line breaks

        insertString = "cr...\r\ncr...\r\ncr...\r\ncr...\r\ncr...\r\ncr...\r\ncr...\r\ncr...\r\ncr...\r\ncr...\r\ncr...\r\ncr";
        snapshot = lineIndex.edit(21, 1, insertString);
        editedText = snapshot.getText(0, content.length + insertString.length - 1);
        checkText = editFlat(21, 1, insertString, content);
        if (editedText != checkText) {
            recordError();
            return;
        }

        insertString = "cr...\r\ncr...\r\ncr";
        snapshot = lineIndex.edit(21, 1, insertString);
        editedText = snapshot.getText(0, content.length + insertString.length - 1);
        checkText = editFlat(21, 1, insertString, content);
        if (editedText != checkText) {
            recordError();
            return;
        }

        // leading '\n'
        insertString = "\ncr...\r\ncr...\r\ncr";
        snapshot = lineIndex.edit(21, 1, insertString);
        editedText = snapshot.getText(0, content.length + insertString.length - 1);
        checkText = editFlat(21, 1, insertString, content);
        if (editedText != checkText) {
            recordError();
            return;
        }

        // Case I: single line no line breaks deleted or inserted
        // delete 1 char
        snapshot = lineIndex.edit(21, 1);
        editedText = snapshot.getText(0, content.length - 1);
        checkText = editFlat(21, 1, "", content);
        if (editedText != checkText) {
            recordError();
            return;
        }

        // insert 1 char
        snapshot = lineIndex.edit(21, 0, "b");
        editedText = snapshot.getText(0, content.length + 1);
        checkText = editFlat(21, 0, "b", content);
        if (editedText != checkText) {
            recordError();
            return;
        }

        // delete 1, insert 2
        snapshot = lineIndex.edit(21, 1, "cr");
        editedText = snapshot.getText(0, content.length + 1);
        checkText = editFlat(21, 1, "cr", content);
        if (editedText != checkText) {
            recordError();
            return;
        }

        // Case II: delete across line break
        snapshot = lineIndex.edit(21, 22);
        editedText = snapshot.getText(0, content.length -22);
        checkText = editFlat(21, 22, "", content);
        if (editedText != checkText) {
            recordError();
            return;
        }

        snapshot = lineIndex.edit(21, 32);
        editedText = snapshot.getText(0, content.length - 32);
        checkText = editFlat(21, 32, "", content);
        if (editedText != checkText) {
            recordError();
            return;
        }

        // Case III: delete across multiple line breaks and insert no line breaks
        snapshot = lineIndex.edit(21, 42);
        editedText = snapshot.getText(0, content.length - 42);
        checkText = editFlat(21, 42, "", content);
        if (editedText != checkText) {
            recordError();
            return;
        }

        snapshot = lineIndex.edit(21, 42, "slithery ");
        editedText = snapshot.getText(0, content.length - 33);
        checkText = editFlat(21, 42, "slithery ", content);
        if (editedText != checkText) {
            recordError();
            return;
        }
    }


    function editStress(fname: string, timing: boolean) {
        var content = sys.readFile(fname);
        var lm = LineIndex.linesFromText(content);
        var lines = lm.lines;
        if (lines.length == 0) {
            return;
        }
        var lineMap = lm.lineMap;

        var lineIndex = new LineIndex();
        lineIndex.load(lines);
        var totalChars = content.length;
        var rsa:number[]= [];
        var la:number[] = [];
        var las:number[] = [];
        var elas:number[] = [];
        var ersa:number[] = [];
        var ela:number[] = [];
        var etotalChars = totalChars;
        var j:number;
        
        var startTime:number;
        for (j = 0; j < 100000; j++) {
            rsa[j] = Math.floor(Math.random() * totalChars);
            la[j] = Math.floor(Math.random() * (totalChars - rsa[j]));
            if (la[j] > 4) {
                las[j] = 4;
            }
            else {
                las[j] = la[j];
            }
            if (j < 4000) {
                ersa[j] = Math.floor(Math.random() * etotalChars);
                ela[j] = Math.floor(Math.random() * (etotalChars - ersa[j]));
                if (ela[j] > 4) {
                    elas[j] = 4;
                }
                else {
                    elas[j] = ela[j];
                }
                etotalChars += (las[j] - elas[j]);
            }
        }
        if (timing) {
            startTime = Date.now();
        }
        for (j = 0; j < 2000; j++) {
            var s2 = lineIndex.getText(rsa[j], la[j]);
            if (!timing) {
                var s1 = content.substring(rsa[j], rsa[j] + la[j]);
                if (s1 != s2) {
                    recordError();
                    return;
                }
            }
        }
        if (timing) {
            printLine("range (average length 1/4 file size): " + ((Date.now() - startTime) / 2).toFixed(3) + " us");
        }
//        printLine("check1");
        if (timing) {
            startTime = Date.now();
        }
        for (j = 0; j < 10000; j++) {
            var s2 = lineIndex.getText(rsa[j], las[j]);
            if (!timing) {
                var s1 = content.substring(rsa[j], rsa[j] + las[j]);
                if (s1 != s2) {
                    recordError();
                    return;
                }
            }
        }
//        printLine("check2");
        if (timing) {
            printLine("range (average length 4 chars): " + ((Date.now() - startTime) / 10).toFixed(3) + " us");
        }

        if (timing) {
            startTime = Date.now();
        }
        var snapshot: LineIndex;
        for (j = 0; j < 2000; j++) {
            var insertString = content.substring(rsa[100000 - j], rsa[100000 - j] + las[100000 - j]);
            snapshot = lineIndex.edit(rsa[j], las[j], insertString);
            if (!timing) {
                var checkText = editFlat(rsa[j], las[j], insertString, content);
                var snapText = snapshot.getText(0, checkText.length);
                if (checkText != snapText) {
                    if (s1 != s2) {
                        recordError();
                        return;
                    }
                }
            }
        }
//        printLine("check3");
        if (timing) {
            printLine("edit (average length 4): " + ((Date.now() - startTime) / 2).toFixed(3) + " us");
        }

        var svc = ScriptVersionCache.fromString(content);
        checkText = content;
        if (timing) {
            startTime = Date.now();
        }
        for (j = 0; j < 2000; j++) {
            insertString = content.substring(rsa[j], rsa[j] + las[j]);
            svc.edit(ersa[j], elas[j], insertString);
            if (!timing) {
                checkText = editFlat(ersa[j], elas[j], insertString, checkText);
            }
            if (0 == (j % 4)) {
                var snap = svc.getSnapshot();
                if (!timing) {
                    snapText = snap.getText(0, checkText.length);
                    if (checkText != snapText) {
                        if (s1 != s2) {
                            recordError();
                            return;
                        }
                    }
                }
            }
        }
        if (timing) {
            printLine("edit ScriptVersionCache: " + ((Date.now() - startTime) / 2).toFixed(3) + " us");
        }

//        printLine("check4");
        if (timing) {
            startTime = Date.now();
        }
        for (j = 0; j < 5000; j++) {
            insertString = content.substring(rsa[100000 - j], rsa[100000 - j] + la[100000 - j]);
            snapshot = lineIndex.edit(rsa[j], la[j], insertString);
            if (!timing) {
                checkText = editFlat(rsa[j], la[j], insertString, content);
                snapText = snapshot.getText(0, checkText.length);
                if (checkText != snapText) {
                    if (s1 != s2) {
                        recordError();
                        return;
                    }
                }
            }
        }
        if (timing) {
            printLine("edit (average length 1/4th file size): " + ((Date.now() - startTime) / 5).toFixed(3) + " us");
        }

        var t: ts.LineAndCharacter;
        var errorCount = 0;
        if (timing) {
            startTime = Date.now();
        }
//        printLine("check5");
        for (j = 0; j < 100000; j++) {
            var lp = lineIndex.charOffsetToLineNumberAndPos(rsa[j]);
            if (!timing) {
                var lac = ts.getLineAndCharacterOfPosition(lineMap,rsa[j]);

                if (lac.line != lp.line) {
                    recordError();
                    printLine("arrgh "+lac.line + " " + lp.line+ " " + j);
                    return;
                }
                if (lac.character != (lp.offset+1)) {
                    recordError();
                    printLine("arrgh ch... "+lac.character + " " + (lp.offset+1)+ " " + j);
                    return;
                }
            }
        }
//        printLine("check6");
        if (timing) {
            printLine("line/offset from pos: " + ((Date.now() - startTime) / 100).toFixed(3) + " us");
        }

        if (timing) {
            startTime = Date.now();
        }

        var outer = 1;
        if (timing) {
            outer = 100;
        }
        for (var ko = 0; ko < outer; ko++) {
            for (var k = 0, llen = lines.length; k < llen; k++) {
                var lineInfo = lineIndex.lineNumberToInfo(k + 1);
                var lineIndexOffset = lineInfo.offset;
                if (!timing) {
                    var lineMapOffset = lineMap[k];
                    if (lineIndexOffset != lineMapOffset) {
                        recordError();
                        return;
                    }
                }
            }
        }
        if (timing) {
            printLine("start pos from line: " + (((Date.now() - startTime) / lines.length) * 10).toFixed(3) + " us");
        }
    }

    export class ScriptInfo {
        svc: ScriptVersionCache;
        isRoot=false;
        children:ScriptInfo[]=[];
        activeProject: Project;

        constructor(public filename: string, public content:string, public isOpen = true) {
            this.svc = ScriptVersionCache.fromString(content);
        }

        addChild(childInfo:ScriptInfo) {
            this.children.push(childInfo);
        }
 
        public snap() {
            return this.svc.getSnapshot();
        }

        public editContent(minChar: number, limChar: number, newText: string): void {
            this.svc.edit(minChar, limChar - minChar, newText);
        }

        public getTextChangeRangeBetweenVersions(startVersion: number, endVersion: number): ts.TextChangeRange {
            return this.svc.getTextChangesBetweenVersions(startVersion, endVersion);
        }

        getChangeRange(oldSnapshot: ts.IScriptSnapshot): ts.TextChangeRange {
            return this.snap().getChangeRange(oldSnapshot);
        }
    }

    export class CancellationToken {
        public static None = new CancellationToken();

        requestPending=false;

        constructor() {
        }

        cancel() {
            this.requestPending=true;
        }

        reset() {
            this.requestPending=false;
        }

        public isCancellationRequested() {
            var temp=this.requestPending;
            return temp;
        }
    }

    export class LSHost implements ts.LanguageServiceHost {
        private ls: ts.LanguageService = null;
        logger: ts.Logger;
        private compilationSettings: ts.CompilerOptions = null;
        private filenameToScript: ts.Map<ScriptInfo> = {};

        constructor(private cancellationToken: CancellationToken = CancellationToken.None) {
            this.logger = this;
            this.addDefaultLibrary();
        }

        trace(str:string) {
        }

        error(str:string) {
        }

        public cancel() {
            this.cancellationToken.cancel();
        }

        public reset() {
            this.cancellationToken.reset();
        }

        public addDefaultLibrary() {
            this.addFile("/home/steve/src/TypeScript/built/local/lib.core.d.ts");
        }

        getScriptSnapshot(filename: string): ts.IScriptSnapshot {
            return this.getScriptInfo(filename).snap();
        }
                
        getCompilationSettings() {
            return this.compilationSettings;
        }

        getScriptFileNames() {
            var filenames:string[]=[];
            for (var filename in this.filenameToScript) {
                filenames.push(filename);
            }
            return filenames;
        }

        getScriptVersion(filename: string) {
            return this.getScriptInfo(filename).svc.latestVersion().toString();
        }

        public getLocalizedDiagnosticMessages(): string {
            return "";
        }

        public getCancellationToken(): ts.CancellationToken {
            return this.cancellationToken;
        }

        public getCurrentDirectory(): string {
            return "";
        }

        public getDefaultLibFilename(): string {
            return "";
        }

        getScriptIsOpen(filename: string) {
            return this.getScriptInfo(filename).isOpen;
        }

        public addFile(name: string) {
            var content = sys.readFile(name);
            this.addScript(name, content);
        }

        getScriptInfo(filename: string): ScriptInfo {
            return ts.lookUp(this.filenameToScript,filename);
        }

        public addScriptInfo(info:ScriptInfo) {
            if (!this.getScriptInfo(info.filename)) {
                this.filenameToScript[info.filename]=info;
                return info;
            }
        }

        public addScript(filename: string, content: string) {
            var script = new ScriptInfo(filename, content);
            this.filenameToScript[filename]=script;
            return script;
        }

        public editScript(filename: string, minChar: number, limChar: number, newText: string) {
            var script = this.getScriptInfo(filename);
            if (script) {
                script.editContent(minChar, limChar, newText);
                return;
            }

            throw new Error("No script with name '" + filename + "'");
        }

        resolvePath(path: string): string {
            var start = new Date().getTime();
            var result = sys.resolvePath(path);
            return result;
        }

        fileExists(path: string): boolean {
            var start = new Date().getTime();
            var result = sys.fileExists(path);
            return result;
        }

        directoryExists(path: string): boolean {
            return sys.directoryExists(path);
        }

        public log(s: string): void {
            // For debugging...
            //printLine("TypeScriptLS:" + s);
        }

        /**
         * @param line 1 based index
         * @param col 1 based index
        */
        lineColToPosition(filename: string, line: number, col: number): number {
            var script: ScriptInfo = this.filenameToScript[filename];
            var index=script.snap().index;

            var lineInfo=index.lineNumberToInfo(line);
            return (lineInfo.offset+col-1);
        }

        /**
         * @param line 0 based index
         * @param offset 0 based index
        */
        positionToZeroBasedLineCol(filename: string, position: number): ILineInfo {
            var script: ScriptInfo = this.filenameToScript[filename];
            var index=script.snap().index;
            var lineCol=index.charOffsetToLineNumberAndPos(position);

            return { line: lineCol.line-1, offset: lineCol.offset };
        }
    }

    function getCanonicalFileName(filename: string) {
        if (sys.useCaseSensitiveFileNames) {
            return filename;
        }
        else {
            return filename.toLowerCase();
        }
    }

    // assumes normalized paths
    function getAbsolutePath(filename:string, directory: string) {
        var rootLength=ts.getRootLength(filename);
        if (rootLength>0) {
            return filename;
        }
        else {
            var splitFilename=filename.split('/');
            var splitDir=directory.split('/');
            var i=0;
            var dirTail=0;
            var sflen=splitFilename.length;
            while ((i<sflen) && (splitFilename[i].charAt(0)=='.')) {
                var dots=splitFilename[i];
                if (dots=='..') {
                    dirTail++;
                }
                else if(dots!='.') {
                    return undefined;
                }
                i++;
            }
            return splitDir.slice(0,splitDir.length-dirTail).concat(splitFilename.slice(i)).join('/');
        }
    }

    export class Project {
        compilerService=new CompilerService();
        
        constructor(public root:ScriptInfo) {
            this.addGraph(root);
            this.compilerService.languageService.getNavigateToItems(".*");
        }

        addGraph(scriptInfo:ScriptInfo) {
            if (this.addScript(scriptInfo)) {
                for (var i=0,clen=scriptInfo.children.length;i<clen;i++) {
                    this.addGraph(scriptInfo.children[i]);
                }
            }
        }

        addScript(info:ScriptInfo) {
            info.activeProject=this;
            return this.compilerService.host.addScriptInfo(info);
        }
        
        printFiles() {
            var filenames=this.compilerService.host.getScriptFileNames();
            filenames.map(filename=> { console.log(filename); });
        }
    }

    export class ProjectService {
        filenameToScriptInfo: ts.Map<ScriptInfo> = {};
        roots: ScriptInfo[]=[];
        projects:Project[]=[];
        rootsChanged=false;
        newRootDisjoint=true;

        getProjectForFile(filename: string) {
            var scriptInfo=ts.lookUp(this.filenameToScriptInfo,filename);
            if (scriptInfo) {
                return scriptInfo.activeProject;
            }
        }

        printProjects() {
            for (var i=0,len=this.projects.length;i<len;i++) {
                var project=this.projects[i];
                console.log("Project "+i.toString());
                project.printFiles();
                console.log("-----------------------------------------------");
            }
        }

        removeRoot(info:ScriptInfo) {
            var len=this.roots.length;
            for (var i=0;i<len;i++) {
                if (this.roots[i]==info) {
                    if (i<(len-1)) {
                        this.roots[i]=this.roots[len-1];
                    }
                    this.roots.length--;
                    this.rootsChanged=true;
                    info.isRoot=false;
                    return true;
                }
            }
            return false;
        }

        openSpecifiedFile(filename:string) {
            this.rootsChanged=false;
            this.newRootDisjoint=true;
            var info=this.openFile(filename,true);
            if (this.rootsChanged) {
                var i=0;
                var len=this.roots.length;
                if (this.newRootDisjoint) {
                    i=len-1;
                }
                for (;i<len;i++) {
                    var root=this.roots[i];
                    root.isRoot=true;
                    this.projects[i]=new Project(root);
                }
            }
            return info;
        }

        /**
         * @param filename is absolute pathname
        */
        openFile(filename: string,possibleRoot=false) {
            //console.log("opening "+filename+"...");
            filename=ts.normalizePath(filename);
            var dirPath = ts.getDirectoryPath(filename);
            //console.log("normalized as "+filename+" with dir path "+dirPath);
            var info = ts.lookUp(this.filenameToScriptInfo,filename);
            if (!info) {
                var content = sys.readFile(filename);
                if (content) {
                    info = new ScriptInfo(filename, content);
                    this.filenameToScriptInfo[filename]=info;
                    if (possibleRoot) {
                        this.roots.push(info);
                        this.rootsChanged=true;
                    }
                    var preProcessedInfo = ts.preProcessFile(content, false);
                    if (preProcessedInfo.referencedFiles.length > 0) {
                        for (var i = 0, len = preProcessedInfo.referencedFiles.length; i < len; i++) {
                            var refFilename = ts.normalizePath(preProcessedInfo.referencedFiles[i].filename);
                            refFilename=getAbsolutePath(refFilename,dirPath);
                            var refInfo=this.openFile(refFilename);
                            if (refInfo) {
                                info.addChild(refInfo);
                            }
                        }
                    }
//                  console.log("opened "+filename);
                }
                else {
                    //console.log("could not open "+filename);
                }
            }

            if ((!possibleRoot)&&(info)&&(info.isRoot)) {
                if (this.removeRoot(info)) {
                    this.rootsChanged=true;
                    this.newRootDisjoint=false;
                }
            }

            return info;
        }

    }

    export class CompilerService {
        // TODO: add usable cancellation token
        cancellationToken=new CancellationToken();
        host = new LSHost(this.cancellationToken);
        languageService: ts.LanguageService;
        classifier: ts.Classifier;
        settings = ts.getDefaultCompilerOptions();
        documentRegistry = ts.createDocumentRegistry();
        formatCodeOptions:ts.FormatCodeOptions = {
            IndentSize: 4,
            TabSize: 4,
            NewLineCharacter: sys.newLine,
            ConvertTabsToSpaces: true,
            InsertSpaceAfterCommaDelimiter: true,
            InsertSpaceAfterSemicolonInForStatements: true,
            InsertSpaceBeforeAndAfterBinaryOperators: true,
            InsertSpaceAfterKeywordsInControlFlowStatements: true,
            InsertSpaceAfterFunctionKeywordForAnonymousFunctions: false,
            InsertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: false,
            PlaceOpenBraceOnNewLineForFunctions: false,
            PlaceOpenBraceOnNewLineForControlBlocks: false,
        }
        
        constructor() {
            this.languageService = ts.createLanguageService(this.host,this.documentRegistry);
            this.classifier = ts.createClassifier(this.host);
        }

        /**
         * @param filename is absolute pathname
        */
        openFile(filename: string) {
            //console.log("opening "+filename+"...");
            filename=ts.normalizePath(filename);
            var dirPath = ts.getDirectoryPath(filename);
            //console.log("normalized as "+filename+" with dir path "+dirPath);
            var info = this.host.getScriptInfo(filename);
            if (info == null) {
                var content = sys.readFile(filename);
                if (content) {
                    info = this.host.addScript(filename, content);
                    var preProcessedInfo = ts.preProcessFile(content, false);
                    if (preProcessedInfo.referencedFiles.length > 0) {
                        for (var i = 0, len = preProcessedInfo.referencedFiles.length; i < len; i++) {
                            var refFilename = ts.normalizePath(preProcessedInfo.referencedFiles[i].filename);
                            refFilename=getAbsolutePath(refFilename,dirPath);
                             this.openFile(refFilename);
                        }
                    }
                    console.log("opened "+filename);
                }
                else {
                    //console.log("could not open "+filename);
                }
            }
            return info;
        }

    }

    var homePrefix="/home/steve/src/ts/versionCache/";
    var compPrefix="/home/steve/src/TypeScript/src/compiler/";

    function bigProjTest(projectService: ProjectService) {
        var cfile = homePrefix + "client.ts";
        var innerFile = compPrefix + "core.ts";
        projectService.openSpecifiedFile(innerFile);
        var scriptInfo = projectService.openSpecifiedFile(cfile);
        var project = scriptInfo.activeProject;
        var compilerService = project.compilerService;

        var pos = compilerService.host.lineColToPosition(cfile, 824, 61);
        var typeInfo = compilerService.languageService.getQuickInfoAtPosition(cfile, pos);

        if (typeInfo) {
            printLine(ts.displayPartsToString(typeInfo.displayParts));
            projectService.printProjects();
        }
    }

    export function lsProjTest(tstname:string,projectService:ProjectService,goBig=false) {
        var tfile=homePrefix+tstname;
        var zfile=homePrefix+"z.ts";
        var scriptInfo = projectService.openSpecifiedFile(tfile);
        var project=scriptInfo.activeProject;
        var compilerService=project.compilerService;

        var typeInfo = compilerService.languageService.getQuickInfoAtPosition(zfile, 0);
        printLine(ts.displayPartsToString(typeInfo.displayParts));
        compilerService.host.editScript(zfile, 2, 9, "zebra");
        typeInfo = compilerService.languageService.getQuickInfoAtPosition(zfile, 2);

        printLine(ts.displayPartsToString(typeInfo.displayParts));

        compilerService.host.editScript(zfile, 2, 7, "giraffe");
        typeInfo = compilerService.languageService.getQuickInfoAtPosition(zfile, 2);
        printLine(ts.displayPartsToString(typeInfo.displayParts));

        var snapshot = compilerService.host.getScriptSnapshot(zfile);
        var text = snapshot.getText(0, snapshot.getLength());
        var tinsertString = "class Manimal {\r\n    location: Point;\r\n}\r\n";
        compilerService.host.editScript(tfile, 0, 0, tinsertString);
        var insertString = ";\r\nvar m = new Manimal();\r\nm.location"
        compilerService.host.editScript(zfile, text.length - 1, text.length - 1, insertString);
        var offset = text.length + 28;
        typeInfo = compilerService.languageService.getQuickInfoAtPosition(zfile, offset);
        printLine(ts.displayPartsToString(typeInfo.displayParts));
        if (goBig) {
            bigProjTest(projectService);
        }
    }

    export function lsTest() {
        var compilerService = new CompilerService();
        var tfile=homePrefix+"tst.ts";
        var zfile=homePrefix+"z.ts";
        var info = compilerService.openFile(tfile);

        var typeInfo = compilerService.languageService.getQuickInfoAtPosition(zfile, 0);

        printLine(ts.displayPartsToString(typeInfo.displayParts));
        compilerService.host.editScript(zfile, 2, 9, "zebra");
        typeInfo = compilerService.languageService.getQuickInfoAtPosition(zfile, 2);

        printLine(ts.displayPartsToString(typeInfo.displayParts));

        compilerService.host.editScript(zfile, 2, 7, "giraffe");
        typeInfo = compilerService.languageService.getQuickInfoAtPosition(zfile, 2);
        printLine(ts.displayPartsToString(typeInfo.displayParts));

        var snapshot = compilerService.host.getScriptSnapshot(zfile);
        var text = snapshot.getText(0, snapshot.getLength());
        var tinsertString = "class Manimal {\r\n    location: Point;\r\n}\r\n";
        compilerService.host.editScript(tfile, 0, 0, tinsertString);
        var insertString = ";\r\nvar m = new Manimal();\r\nm.location"
        compilerService.host.editScript(zfile, text.length - 1, text.length - 1, insertString);
        var offset = text.length + 28;
        typeInfo = compilerService.languageService.getQuickInfoAtPosition(zfile, offset);
        printLine(ts.displayPartsToString(typeInfo.displayParts));


        /*
        if (typeInfo.memberName.toString()!="Point") {
            recordError();
            return;
        }
        */
    }

    function bigTest() {
//        editStress("../../TypeScript/src/lib/dom.generated.d.ts", false);
        editStress("../../TypeScript/src/compiler/types.ts", false);
        editStress("tst.ts", false);
        editStress("client.ts", false);
//        editStress("..\\..\\TypeScript\\src\\lib\\dom.generated.d.ts", false);
    }

    export function edTest() {
        editTest();
        tstTest();
        if (!gloError) {
            lsTest();
        }
        if (!gloError) {
            var projectService = new ProjectService();
            lsProjTest("tst.ts",projectService);
            lsProjTest("auxtst.ts",projectService,true);
        }
        if (!gloError) {
            bigTest();
        }
        if (gloError) {
            printLine(" ! Fail: versionCache");
        }
        else {
            printLine("Pass"); 
        }
    }
}

