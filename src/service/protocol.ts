/// <reference path='../../node_modules/typescript/bin/typescript.d.ts'/>
/// <reference path='../../node_modules/typescript/bin/typescript_internal.d.ts'/>
/// <reference path='node.d.ts' />
/// <reference path='_debugger.d.ts' />

import net = require('net');
import nodeproto = require('_debugger');
import readline = require('readline');
import util = require('util');
import path=require('path');
import ts=require('typescript');

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
        ts.sys.write(s + '\n'); 
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
        var content = ts.sys.readFile(fname);
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
        var content = ts.sys.readFile(fname);
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
        var content = ts.sys.readFile(fname);
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

    // TODO: make this a parameter of the service or in service environment

    var defaultLibDir=
        "/home/steve/src/TypeScript-Service/node_modules/typescript/bin/lib.core.d.ts";

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
            this.addFile(defaultLibDir);
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
            var content = ts.sys.readFile(name);
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
            var result = ts.sys.resolvePath(path);
            return result;
        }

        fileExists(path: string): boolean {
            var start = new Date().getTime();
            var result = ts.sys.fileExists(path);
            return result;
        }

        directoryExists(path: string): boolean {
            return ts.sys.directoryExists(path);
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
        if (ts.sys.useCaseSensitiveFileNames) {
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
                var content = ts.sys.readFile(filename);
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
            NewLineCharacter: ts.sys.newLine,
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
                var content = ts.sys.readFile(filename);
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

    export interface LineCollection {
        charCount(): number;
        lineCount(): number;
        isLeaf(): boolean;
        walk(rangeStart: number, rangeLength: number, walkFns: ILineIndexWalker): void;
        print(indentAmt: number): void;
    }

    export interface ILineInfo {
        line: number;
        offset: number;
        text?: string;
        leaf?: LineLeaf;
    }

    export enum CharRangeSection {
        PreStart,
        Start,
        Entire,
        Mid,
        End,
        PostEnd
    }

    export interface ILineIndexWalker {
        goSubtree: boolean;
        done: boolean;
        leaf(relativeStart: number, relativeLength: number, lineCollection: LineLeaf): void;
        pre? (relativeStart: number, relativeLength: number, lineCollection: LineCollection, parent: LineNode, nodeType: CharRangeSection): LineCollection;
        post? (relativeStart: number, relativeLength: number, lineCollection: LineCollection, parent: LineNode, nodeType: CharRangeSection): LineCollection;
    }

    class BaseLineIndexWalker implements ILineIndexWalker {
        goSubtree = true;
        done = false;
        leaf(rangeStart: number, rangeLength: number, ll: LineLeaf) {
        }
    }

    class EditWalker extends BaseLineIndexWalker {
        lineIndex = new LineIndex();
        // path to start of range
        startPath: LineCollection[];
        endBranch: LineCollection[] = [];
        branchNode: LineNode;
        // path to current node 
        stack: LineNode[];
        state = CharRangeSection.Entire;
        lineCollectionAtBranch: LineCollection;
        initialText = "";
        trailingText = ""; 
        suppressTrailingText = false;

        constructor() {
            super();
            this.lineIndex.root = new LineNode();
            this.startPath = [this.lineIndex.root];
            this.stack = [this.lineIndex.root];
        }

        insertLines(insertedText: string) {
            if (this.suppressTrailingText) {
                this.trailingText = "";
            }
            if (insertedText) {
                insertedText = this.initialText + insertedText + this.trailingText;
            }
            else {
                insertedText = this.initialText + this.trailingText;
            }
            var lm = LineIndex.linesFromText(insertedText);
            var lines = lm.lines;
            if (lines.length > 1) {
                if (lines[lines.length - 1] == "") {
                    lines.length--;
                }
            }
            var branchParent: LineNode;
            var lastZeroCount: LineCollection;

            for (var k = this.endBranch.length-1; k >= 0; k--) {
                (<LineNode>this.endBranch[k]).updateCounts();
                if (this.endBranch[k].charCount() == 0) {
                    lastZeroCount = this.endBranch[k];
                    if (k > 0) {
                        branchParent = <LineNode>this.endBranch[k - 1];
                    }
                    else {
                        branchParent = this.branchNode;
                    }
                }
            }
            if (lastZeroCount) {
                branchParent.remove(lastZeroCount);
            }

            // path at least length two (root and leaf)
            var insertionNode = <LineNode>this.startPath[this.startPath.length - 2];
            var leafNode = <LineLeaf>this.startPath[this.startPath.length - 1];
            var len = lines.length;

            if (len>0) {
                leafNode.text = lines[0];

                if (len > 1) {
                    var insertedNodes = <LineCollection[]>new Array(len - 1);
                    var startNode = <LineCollection>leafNode;
                    for (var i = 1, len = lines.length; i < len; i++) {
                        insertedNodes[i - 1] = new LineLeaf(lines[i]);
                    }
                    var pathIndex = this.startPath.length - 2;
                    while (pathIndex >= 0) {
                        insertionNode = <LineNode>this.startPath[pathIndex];
                        insertedNodes = insertionNode.insertAt(startNode, insertedNodes);
                        pathIndex--;
                        startNode = insertionNode;
                    }
                    var insertedNodesLen = insertedNodes.length;
                    while (insertedNodesLen > 0) {
                        var newRoot = new LineNode();
                        newRoot.add(this.lineIndex.root);
                        insertedNodes = newRoot.insertAt(this.lineIndex.root, insertedNodes);
                        insertedNodesLen = insertedNodes.length;
                        this.lineIndex.root = newRoot;
                    }
                    this.lineIndex.root.updateCounts();
                }
                else {
                    for (var j = this.startPath.length - 2; j >= 0; j--) {
                        (<LineNode>this.startPath[j]).updateCounts();
                    }
                }
            }
            else {
                // no content for leaf node, so delete it
                insertionNode.remove(leafNode);
                for (var j = this.startPath.length - 2; j >= 0; j--) {
                    (<LineNode>this.startPath[j]).updateCounts();
                }
            }

            return this.lineIndex;
        }

        post(relativeStart: number, relativeLength: number, lineCollection: LineCollection, parent: LineCollection, nodeType: CharRangeSection):LineCollection {
            // have visited the path for start of range, now looking for end
            // if range is on single line, we will never make this state transition
            if (lineCollection == this.lineCollectionAtBranch) {
                this.state = CharRangeSection.End;
            }
            // always pop stack because post only called when child has been visited
            this.stack.length--;
            return undefined;
        }

        pre(relativeStart: number, relativeLength: number, lineCollection: LineCollection, parent: LineCollection, nodeType: CharRangeSection) {
            // currentNode corresponds to parent, but in the new tree
            var currentNode = this.stack[this.stack.length - 1];

            if ((this.state == CharRangeSection.Entire) && (nodeType == CharRangeSection.Start)) {
                // if range is on single line, we will never make this state transition
                this.state = CharRangeSection.Start;
                this.branchNode = currentNode;
                this.lineCollectionAtBranch = lineCollection;
            }
          
            var child: LineCollection;
            function fresh(node: LineCollection): LineCollection {
                if (node.isLeaf()) {
                    return new LineLeaf("");
                }
                else return new LineNode();
            }
            switch (nodeType) {
                case CharRangeSection.PreStart:
                    this.goSubtree = false;
                    if (this.state != CharRangeSection.End) {
                        currentNode.add(lineCollection);
                    }
                    break;
                case CharRangeSection.Start:
                    if (this.state == CharRangeSection.End) {
                        this.goSubtree = false;
                    }
                    else {
                        child = fresh(lineCollection);
                        currentNode.add(child);
                        this.startPath[this.startPath.length] = child;
                    }
                    break;
                case CharRangeSection.Entire:
                    if (this.state != CharRangeSection.End) {
                        child = fresh(lineCollection);
                        currentNode.add(child);
                        this.startPath[this.startPath.length] = child;
                    }
                    else {
                        if (!lineCollection.isLeaf()) {
                            child = fresh(lineCollection);
                            currentNode.add(child);
                            this.endBranch[this.endBranch.length] = child;
                        }
                    }
                    break;
                case CharRangeSection.Mid:
                    this.goSubtree = false;
                    break;
                case CharRangeSection.End:
                    if (this.state != CharRangeSection.End) {
                        this.goSubtree = false;
                    }
                    else {
                        if (!lineCollection.isLeaf()) {
                            child = fresh(lineCollection);
                            currentNode.add(child);
                            this.endBranch[this.endBranch.length] = child;
                        }
                    }
                    break;
                case CharRangeSection.PostEnd:
                    this.goSubtree = false;
                    if (this.state != CharRangeSection.Start) {
                        currentNode.add(lineCollection);
                    }
                    break;
            }
            if (this.goSubtree) {
                this.stack[this.stack.length] = <LineNode>child;
            }
            return lineCollection;
        }
        // just gather text from the leaves
        leaf(relativeStart: number, relativeLength: number, ll: LineLeaf) {
            if (this.state == CharRangeSection.Start) {
                this.initialText = ll.text.substring(0, relativeStart);
            }
            else if (this.state == CharRangeSection.Entire) {
                this.initialText = ll.text.substring(0, relativeStart);
                this.trailingText = ll.text.substring(relativeStart+relativeLength);
            }
            else {
                // state is CharRangeSection.End
                this.trailingText = ll.text.substring(relativeStart + relativeLength);
            }
        }
    }

    // text change information 
    export class TextChange {
        constructor(public pos: number, public deleteLen: number, public insertedText?: string) {
        }

        getTextChangeRange() {
            return new ts.TextChangeRange(new ts.TextSpan(this.pos, this.deleteLen),
                this.insertedText ? this.insertedText.length : 0);
        }
    }

    export class ScriptVersionCache {
        changes: TextChange[] = [];
        versions: LineIndexSnapshot[] = [];
        private currentVersion = 0;

        static changeNumberThreshold = 8;
        static changeLengthThreshold = 256;

        // REVIEW: can optimize by coalescing simple edits
        edit(pos: number, deleteLen: number, insertedText?: string) {
            this.changes[this.changes.length] = new TextChange(pos, deleteLen, insertedText);
            if ((this.changes.length > ScriptVersionCache.changeNumberThreshold) ||
                (deleteLen > ScriptVersionCache.changeLengthThreshold) ||
                (insertedText && (insertedText.length>ScriptVersionCache.changeLengthThreshold))) {
                this.getSnapshot();
            }
        }

        latest() {
            return this.versions[this.currentVersion];
        }

        latestVersion() {
            if (this.changes.length > 0) {
                this.getSnapshot();
            }
            return this.currentVersion;
        }

        getSnapshot() {
            var snap = this.versions[this.currentVersion];
            if (this.changes.length > 0) {
                var snapIndex = this.latest().index;
                for (var i = 0, len = this.changes.length; i < len; i++) {
                    var change = this.changes[i];
                    snapIndex = snapIndex.edit(change.pos, change.deleteLen, change.insertedText);
                }
                snap = new LineIndexSnapshot(this.currentVersion + 1, this);
                snap.index = snapIndex;
                snap.changesSincePreviousVersion = this.changes;
                this.currentVersion = snap.version;
                this.versions[snap.version] = snap;
                this.changes = [];
            }
            return snap;
        }

        getTextChangesBetweenVersions(oldVersion: number, newVersion: number) {
            if (oldVersion < newVersion) {
                var textChangeRanges: ts.TextChangeRange[] = [];
                for (var i = oldVersion + 1; i <= newVersion; i++) {
                    var snap = this.versions[i];
                    for (var j = 0, len = snap.changesSincePreviousVersion.length; j < len; j++) {
                        var textChange = snap.changesSincePreviousVersion[j];
                        textChangeRanges[textChangeRanges.length] = textChange.getTextChangeRange();
                    }
                }
                return ts.TextChangeRange.collapseChangesAcrossMultipleVersions(textChangeRanges);
            }
            else {
                return ts.TextChangeRange.unchanged;
            }
        }

        static fromString(script: string) {
            var svc = new ScriptVersionCache();
            var snap = new LineIndexSnapshot(0, svc);
            svc.versions[svc.currentVersion] = snap;
            snap.index = new LineIndex();
            var lm = LineIndex.linesFromText(script);
            snap.index.load(lm.lines);
            return svc;
        }
    }

    export class LineIndexSnapshot implements ts.IScriptSnapshot {
        index: LineIndex;
        changesSincePreviousVersion: TextChange[] = [];

        constructor(public version: number, public cache: ScriptVersionCache) {
        }

        getText(rangeStart: number, rangeEnd: number) {
            return this.index.getText(rangeStart, rangeEnd-rangeStart);
        }

        getLength() {
            return this.index.root.charCount();
        }

        // this requires linear space so don't hold on to these 
        getLineStartPositions(): number[] {
            var starts: number[] = [-1];
            var count = 1;
            var pos = 0;
            this.index.every((ll, s, len) => {
                starts[count++] = pos;
                pos += ll.text.length;
                return true;
            },0);
            return starts;
        }

        getLineMapper() {
            return ((line: number) => {
                return this.index.lineNumberToInfo(line).offset;
            });
        }

        getTextChangeRangeSinceVersion(scriptVersion: number) {
            if (this.version <= scriptVersion) {
                return ts.TextChangeRange.unchanged;
            }
            else {
                return this.cache.getTextChangesBetweenVersions(scriptVersion,this.version);
            }
        }

        getChangeRange(oldSnapshot: ts.IScriptSnapshot): ts.TextChangeRange {
            var oldSnap=<LineIndexSnapshot>oldSnapshot;
            return this.getTextChangeRangeSinceVersion(oldSnap.version);
        }
    }


    export class LineIndex {
        root: LineNode;

        charOffsetToLineNumberAndPos(charOffset: number) {
            return this.root.charOffsetToLineNumberAndPos(1, charOffset);
        }

        lineNumberToInfo(lineNumber: number): ILineInfo {
            var lineCount = this.root.lineCount();
            if (lineNumber <= lineCount) {
                var lineInfo = this.root.lineNumberToInfo(lineNumber, 0);
                lineInfo.line = lineNumber;
                return lineInfo;
            }
            else {
                return {
                    line: lineNumber,
                    offset: this.root.charCount()
                }
            }
        }

        print() {
            Editor.printLine("index TC " + this.root.charCount() + " TL " + this.root.lineCount());
            this.root.print(0);
            Editor.printLine("");
        }

        load(lines: string[]) {
            var leaves: LineLeaf[] = [];
            for (var i = 0, len = lines.length; i < len; i++) {
                leaves[i] = new LineLeaf(lines[i]);
            }
            this.root = LineIndex.buildTreeFromBottom(leaves);
        }

        walk(rangeStart: number, rangeLength: number, walkFns: ILineIndexWalker) {
            this.root.walk(rangeStart, rangeLength, walkFns);
        }

        getText(rangeStart: number, rangeLength: number) {
            var accum = "";
            this.walk(rangeStart, rangeLength, {
                goSubtree: true,
                done: false,
                leaf: (relativeStart: number, relativeLength: number, ll: LineLeaf) => {
                    accum = accum.concat(ll.text.substring(relativeStart,relativeStart+relativeLength));
                }
            });
            return accum;
        }

        every(f: (ll: LineLeaf, s: number, len: number) => boolean, rangeStart: number, rangeEnd?: number) {
            if (!rangeEnd) {
                rangeEnd = this.root.charCount();
            }
            var walkFns = {
                goSubtree: true,
                done: false,
                leaf: function (relativeStart: number, relativeLength: number, ll: LineLeaf) {
                    if (!f(ll, relativeStart, relativeLength)) {
                        this.done = true;
                    }
                }
            }
            this.walk(rangeStart, rangeEnd - rangeStart, walkFns);
            return !walkFns.done;
        }

        edit(pos: number, deleteLength: number, newText?: string) {
            var walker = new EditWalker();
            if (deleteLength > 0) {
                // check whether last characters deleted are line break
                var e = pos + deleteLength;
                var lineInfo = this.charOffsetToLineNumberAndPos(e);
                if ((lineInfo && (lineInfo.offset == 0))) {
                    // move range end just past line that will merge with previous line
                    deleteLength += lineInfo.text.length;
                    // store text by appending to end of insertedText
                    if (newText) {
                        newText = newText + lineInfo.text;
                    }
                    else {
                        newText = lineInfo.text;
                    }
                }
            }
            else if (pos >= this.root.charCount()) {
                // insert at end
                var endString = this.getText(pos - 1, 1);
                if (newText) {
                    newText = endString + newText;
                }
                else {
                    newText = endString;
                }
                pos = pos - 1;
                deleteLength = 0;
                walker.suppressTrailingText = true;
            }
            this.root.walk(pos, deleteLength, walker);
            walker.insertLines(newText);
            return walker.lineIndex;
        }

        static buildTreeFromBottom(nodes: LineCollection[]) : LineNode {
            var nodeCount = Math.ceil(nodes.length / lineCollectionCapacity);
            var interiorNodes: LineNode[] = [];
            var nodeIndex = 0;
            for (var i = 0; i < nodeCount; i++) {
                interiorNodes[i] = new LineNode();
                var charCount = 0;
                var lineCount = 0;
                for (var j = 0; j < lineCollectionCapacity; j++) {
                    if (nodeIndex < nodes.length) {
                        interiorNodes[i].add(nodes[nodeIndex]);
                        charCount += nodes[nodeIndex].charCount();
                        lineCount += nodes[nodeIndex].lineCount();
                    }
                    else {
                        break;
                    }
                    nodeIndex++;
                }
                interiorNodes[i].totalChars = charCount;
                interiorNodes[i].totalLines = lineCount;
            }
            if (interiorNodes.length == 1) {
                return interiorNodes[0];
            }
            else {
                return this.buildTreeFromBottom(interiorNodes);
            }
        }

        static linesFromText(text: string) {
            var sourceSnap = ts.ScriptSnapshot.fromString(text);
            var lineStarts = sourceSnap.getLineStartPositions();

            if (lineStarts.length == 0) {
                return { lines: <string[]>[], lineMap: lineStarts };
            }
            var lines = <string[]>new Array(lineStarts.length);
            var lc = lineStarts.length - 1;
            for (var lmi = 0; lmi < lc; lmi++) {
                lines[lmi] = text.substring(lineStarts[lmi], lineStarts[lmi + 1]);
            }

            var endText = text.substring(lineStarts[lc]);
            if (endText.length > 0) {
                lines[lc] = endText;
            }
            else {
                lines.length--;
            }
            return { lines: lines, lineMap: lineStarts };
        }
    }

    export class LineNode implements LineCollection {
        totalChars = 0;
        totalLines = 0;
        children: LineCollection[] = [];

        isLeaf() {
            return false;
        }

        print(indentAmt: number) {
            var strBuilder = getIndent(indentAmt);
            strBuilder += ("node ch " + this.children.length + " TC " + this.totalChars + " TL " + this.totalLines + " :");
            Editor.printLine(strBuilder);
            for (var ch = 0, clen = this.children.length; ch < clen; ch++) {
                this.children[ch].print(indentAmt + 1);
            }
        }

        updateCounts() {
            this.totalChars = 0;
            this.totalLines = 0;
            for (var i = 0, len = this.children.length; i<len ; i++) {
                var child = this.children[i];
                this.totalChars += child.charCount();
                this.totalLines += child.lineCount();
            }
        }

        execWalk(rangeStart: number, rangeLength: number, walkFns: ILineIndexWalker, childIndex: number, nodeType:CharRangeSection) {
            if (walkFns.pre) {
                walkFns.pre(rangeStart, rangeLength,this.children[childIndex], this, nodeType);
            }
            if (walkFns.goSubtree) {
                this.children[childIndex].walk(rangeStart, rangeLength, walkFns);
                if (walkFns.post) {
                    walkFns.post(rangeStart, rangeLength, this.children[childIndex], this, nodeType);
                }
            }
            else {
                walkFns.goSubtree = true;
            }
            return walkFns.done;
        }

        skipChild(relativeStart: number, relativeLength: number, childIndex: number, walkFns: ILineIndexWalker, nodeType: CharRangeSection) {
            if (walkFns.pre && (!walkFns.done)) {
                walkFns.pre(relativeStart, relativeLength, this.children[childIndex], this, nodeType);
                walkFns.goSubtree = true;
            }
        }

        walk(rangeStart: number, rangeLength: number, walkFns: ILineIndexWalker) {
            // assume (rangeStart < this.totalChars) && (rangeLength <= this.totalChars) 
            var childIndex = 0;
            var child = this.children[0];
            var childCharCount = child.charCount();
            // find sub-tree containing start
            var adjustedStart = rangeStart;
            while (adjustedStart >= childCharCount) {
                this.skipChild(adjustedStart, rangeLength, childIndex, walkFns, CharRangeSection.PreStart);
                adjustedStart -= childCharCount;
                child = this.children[++childIndex];
                childCharCount = child.charCount();
            }
            // Case I: both start and end of range in same subtree
            if ((adjustedStart + rangeLength) <= childCharCount) {
                if (this.execWalk(adjustedStart, rangeLength, walkFns, childIndex, CharRangeSection.Entire)) {
                    return;
                }
            }
            else {
                // Case II: start and end of range in different subtrees (possibly with subtrees in the middle)
                if (this.execWalk(adjustedStart, childCharCount - adjustedStart, walkFns, childIndex, CharRangeSection.Start)) {
                    return;
                }
                var adjustedLength = rangeLength - (childCharCount - adjustedStart);
                child = this.children[++childIndex];
                if (!child) {
                    this.print(2);
                }
                childCharCount = child.charCount();
                while (adjustedLength > childCharCount) {
                    if (this.execWalk(0, childCharCount, walkFns, childIndex, CharRangeSection.Mid)) {
                        return;
                    }
                    adjustedLength -= childCharCount;
                    child = this.children[++childIndex];
                    childCharCount = child.charCount();
                }
                if (adjustedLength > 0) {
                    if (this.execWalk(0, adjustedLength, walkFns, childIndex, CharRangeSection.End)) {
                        return;
                    }
                }
            }
            // Process any subtrees after the one containing range end
            if (walkFns.pre) {
                var clen = this.children.length;
                if (childIndex < (clen - 1)) {
                    for (var ej = childIndex+1; ej < clen; ej++) {
                        this.skipChild(0, 0, ej, walkFns, CharRangeSection.PostEnd);
                    }
                }
            }
        }

        charOffsetToLineNumberAndPos(lineNumber: number, charOffset: number): ILineInfo {
            var childInfo = this.childFromCharOffset(lineNumber, charOffset);
            if (childInfo.childIndex<this.children.length) {
                if (childInfo.child.isLeaf()) {
                    return {
                        line: childInfo.lineNumber,
                        offset: childInfo.charOffset,
                        text: (<LineLeaf>(childInfo.child)).text,
                        leaf: (<LineLeaf>(childInfo.child))
                    };
                }
                else {
                    var lineNode = <LineNode>(childInfo.child);
                    return lineNode.charOffsetToLineNumberAndPos(childInfo.lineNumber, childInfo.charOffset);
                }
            }
            else {
                return undefined;
            }
        }

        lineNumberToInfo(lineNumber: number, charOffset: number): ILineInfo {
            var childInfo = this.childFromLineNumber(lineNumber, charOffset);
            if (childInfo.child.isLeaf()) {
                return {
                    line: lineNumber,
                    offset: childInfo.charOffset,
                    text: (<LineLeaf>(childInfo.child)).text,
                    leaf: (<LineLeaf>(childInfo.child))
                }
            }
            else {
                var lineNode = <LineNode>(childInfo.child);
                return lineNode.lineNumberToInfo(childInfo.relativeLineNumber, childInfo.charOffset);
            }
        }

        childFromLineNumber(lineNumber: number, charOffset: number) {
            var child: LineCollection;
            var relativeLineNumber = lineNumber;
            for (var i = 0, len = this.children.length; i < len; i++) {
                child = this.children[i];
                var childLineCount = child.lineCount();
                if (childLineCount >= relativeLineNumber) {
                    break;
                }
                else {
                    relativeLineNumber -= childLineCount;
                    charOffset += child.charCount();
                }
            }
            return {
                child: child,
                childIndex: i,
                relativeLineNumber: relativeLineNumber,
                charOffset: charOffset
            };
        }

        childFromCharOffset(lineNumber: number, charOffset: number) {
            var child: LineCollection;
            for (var i = 0, len = this.children.length; i < len; i++) {
                child = this.children[i];
                if (child.charCount() > charOffset) {
                    break;
                }
                else {
                    charOffset -= child.charCount();
                    lineNumber += child.lineCount();
                }
            }
            return {
                child: child,
                childIndex: i,
                charOffset: charOffset,
                lineNumber: lineNumber
            }
        }

        splitAfter(childIndex: number) {
            var splitNode: LineNode;
            var clen = this.children.length;
            childIndex++;
            var endLength = childIndex;
            if (childIndex < clen) {
                splitNode = new LineNode();
                while (childIndex < clen) {
                    splitNode.add(this.children[childIndex++]);
                }
                splitNode.updateCounts();
            }
            this.children.length = endLength;
            return splitNode;
        }

        remove(child: LineCollection) {
            var childIndex = this.findChildIndex(child);
            var clen = this.children.length;
            if (childIndex < (clen - 1)) {
                for (var i = childIndex; i < (clen-1); i++) {
                    this.children[i] = this.children[i + 1];
                }
            }
            this.children.length--;
        }

        findChildIndex(child: LineCollection) {
            var childIndex = 0;
            var clen = this.children.length;
            while ((this.children[childIndex] != child) && (childIndex < clen)) childIndex++;
            return childIndex;
        }

        insertAt(child: LineCollection, nodes: LineCollection[]) {
            var childIndex = this.findChildIndex(child);
            var clen = this.children.length;
            var nodeCount = nodes.length;
            // if child is last and there is more room and only one node to place, place it
            if ((clen < lineCollectionCapacity) && (childIndex == (clen - 1)) && (nodeCount == 1)) {
                this.add(nodes[0]);
                this.updateCounts();
                return [];
            }
            else {
                var shiftNode = this.splitAfter(childIndex);
                var nodeIndex = 0;
                childIndex++;
                while ((childIndex < lineCollectionCapacity) &&( nodeIndex<nodeCount)) {
                    this.children[childIndex++] = nodes[nodeIndex++];
                }
                var splitNodes: LineNode[] = [];
                var splitNodeCount = 0;
                if (nodeIndex < nodeCount) {
                    splitNodeCount = Math.ceil((nodeCount-nodeIndex) / lineCollectionCapacity);
                    splitNodes = <LineNode[]>new Array(splitNodeCount);
                    var splitNodeIndex = 0;
                    for (var i = 0; i < splitNodeCount; i++) {
                        splitNodes[i] = new LineNode();
                    }
                    var splitNode = <LineNode>splitNodes[0];
                    while (nodeIndex < nodeCount) {
                        splitNode.add(nodes[nodeIndex++]);
                        if (splitNode.children.length == lineCollectionCapacity) {
                            splitNodeIndex++;
                            splitNode = <LineNode>splitNodes[splitNodeIndex];
                        }
                    }
                    for (i = splitNodes.length - 1; i >= 0; i--) {
                        if (splitNodes[i].children.length == 0) {
                            splitNodes.length--;
                        }
                    }
                }
                if (shiftNode) {
                    splitNodes[splitNodes.length] = shiftNode;
                }
                this.updateCounts();
                for (i = 0; i < splitNodeCount; i++) {
                    (<LineNode>splitNodes[i]).updateCounts();
                }
                return splitNodes;
            }
        }

        // assume there is room for the item; return true if more room
        add(collection: LineCollection) {
            this.children[this.children.length] = collection;
            return(this.children.length < lineCollectionCapacity);
        }

        charCount() {
            return this.totalChars;
        }

        lineCount() {
            return this.totalLines;
        }
    }

    export class LineLeaf implements LineCollection {
        udata: any;

        constructor(public text: string) {

        }

        setUdata(data: any) {
            this.udata = data;
        }

        getUdata() {
            return this.udata;
        }

        isLeaf() {
            return true;
        }

        walk(rangeStart: number, rangeLength: number, walkFns: ILineIndexWalker) {
            walkFns.leaf(rangeStart, rangeLength,  this);
        }

        charCount() {
            return this.text.length;
        }

        lineCount() {
            return 1;
        }

        print(indentAmt: number) {
            var strBuilder = getIndent(indentAmt);
            Editor.printLine(strBuilder + showLines(this.text));
        }
    }

}

var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
});

var paddedLength=8;

var typeNames = ["interface","class","enum","module","alias","type"];

function printObject(obj: any) {
    for (var p in obj) {
        if (obj.hasOwnProperty(p)) {
            console.log(p+": "+obj[p]);
        }
    }
}

function isTypeName(name: string,suffix?:string) {
    for (var i=0,len=typeNames.length;i<len;i++) {
        if (typeNames[i]==name) {
            return true;
        }
        else if (suffix&&((typeNames[i]+suffix)==name)) {
            return true;
        }
    }
    return false;
}

function parseTypeName(displayParts: ts.SymbolDisplayPart[]) {
    var len=displayParts.length;
    for (var i=len-1;i>=0;i--) {
        if (isTypeName(displayParts[i].kind,"Name")) {
            return displayParts[i].text;
        }
    }
    return undefined;
}

function findExactMatchType(items: ts.NavigateToItem[]) {
    for (var i=0,len = items.length;i<len;i++) {
        var navItem=items[i];
        if (navItem.matchKind=="exact") {
            if (isTypeName(navItem.kind)) {
                return navItem;
            }
        }
    }
}
        
function sortNavItems(items: ts.NavigateToItem[]) {
    return items.sort((a,b)=> {
        if (a.matchKind<b.matchKind) {
            return -1;
        }
        else if (a.matchKind==b.matchKind) {
            var lowa=a.name.toLowerCase();
            var lowb=b.name.toLowerCase();
            if (lowa<lowb) {
                return -1;
            }
            else if (lowa==lowb) {
                return 0;
            }
            else {
                return 1;
            }
        }
        else {
            return 1;
        }
    })
}

function SourceInfo(body:nodeproto.BreakResponse) {
    var result = body.exception ? 'exception in ' : 'break in ';

    if (body.script) {
        if (body.script.name) {
            var name = body.script.name,
            dir = path.resolve() + '/';

            // Change path to relative, if possible
            if (name.indexOf(dir) === 0) {
                name = name.slice(dir.length);
            }

            result += name;
        } else {
            result += '[unnamed]';
        }
    }
    result += ':';
    result += body.sourceLine + 1;

    if (body.exception) result += '\n' + body.exception.text;

    return result;
}

class JsDebugSession {
    client:nodeproto.Client;
    host='localhost';
    port=5858;

    constructor() {
        this.init();
    }

    cont(cb:nodeproto.RequestHandler) {
        this.client.reqContinue(cb);
    }

    listSrc() {
        this.client.reqScripts((err) => {
            if (err) {
                console.log("rscr error: " + err);
            }
            else {
                console.log("req scripts");
                for (var id in this.client.scripts) {
                    var script = this.client.scripts[id];
                    if ((typeof script==="object") && script.name) {
                        console.log(id + ": " + script.name);
                    }
                }
            }
        });
    } 

    findScript(file: string) {
        if (file) {
            var script: nodeproto.ScriptDesc;
            var scripts = this.client.scripts;
            var keys = Object.keys(scripts);
            var ambiguous = false;
            for (var v = 0; v < keys.length; v++) {
                var id = keys[v];
                if (scripts[id] &&
                    scripts[id].name &&
                    scripts[id].name.indexOf(file) !== -1) {
                    if (script) {
                        ambiguous = true;
                    }
                    script = scripts[id];
                }
            }
            return { script: script, ambiguous: ambiguous };
        }
    }

    // TODO: condition
    setBreakpointOnLine(line: number, file?: string) {
        if (!file) {
            file=this.client.currentScript;
        }
        var script:nodeproto.ScriptDesc;
        var scriptResult=this.findScript(file);
        if (scriptResult) {
            if (scriptResult.ambiguous) {
                // TODO: send back error
                script = undefined;
            }
            else {
                script = scriptResult.script;
            }
        }
        // TODO: set breakpoint when script not loaded
        if (script) {
            var brkmsg:nodeproto.BreakpointMessageBody = {
                type: 'scriptId',
                target: script.id,
                line: line-1,
            }
            this.client.setBreakpoint(brkmsg,(err, bod) => {
                // TODO: remember breakpoint
                if (err) {
                    console.log("Error: set breakpoint: "+err);
                }
            });
        }

    }

    init() {
        var connectionAttempts=0;
        this.client=new nodeproto.Client();
        this.client.on('break', res=> {
            this.handleBreak(res.body);
        });
        this.client.on('exception', res=> {
            this.handleBreak(res.body);
        });
        this.client.on('error',() => {
            setTimeout(() => {
                ++connectionAttempts;
                this.client.connect(this.port,this.host);
            },500);
        });
        this.client.once('ready',() => {
        });
        this.client.on('unhandledResponse',() => {
        });
        this.client.connect(this.port,this.host);
    }

    evaluate(code: string) {
        var frame = this.client.currentFrame;
        this.client.reqFrameEval(code, frame, (err, bod) => {
            if (err) {
                console.log("Error: evaluate: "+err);
                return;
            }

            console.log("Value: "+bod.toString());
            if (typeof bod === "object") {
                printObject(bod);
            }

            // Request object by handles (and it's sub-properties)
            this.client.mirrorObject(bod, 3, (err, mirror) => {
                if (mirror) {
                    if (typeof mirror === "object") {
                        printObject(mirror);
                    }
                    console.log(mirror.toString());
                }
                else {
                    console.log("undefined");
                }
            });

        });
    }

    handleBreak(breakInfo:nodeproto.BreakResponse) {
        this.client.currentSourceLine = breakInfo.sourceLine;
        this.client.currentSourceLineText = breakInfo.sourceLineText;
        this.client.currentSourceColumn = breakInfo.sourceColumn;
        this.client.currentFrame = 0;
        this.client.currentScript = breakInfo.script && breakInfo.script.name;

        console.log(SourceInfo(breakInfo));
// TODO: watchers        
    }
}

interface FileRange {
    file?:string;
    min: Editor.ILineInfo;
    lim: Editor.ILineInfo;
}

interface FileRanges {
    file: string;
    locs: FileRange[];
}

function formatDiag(file:string, project: Editor.Project, diag: ts.Diagnostic) {
    return {
        min: project.compilerService.host.positionToZeroBasedLineCol(file, diag.start),
        len: diag.length,
        text: diag.messageText,
    };
}

class Session {
    projectService=new Editor.ProjectService();
    prettyJSON=false;
    pendingOperation=false;
    fileHash:ts.Map<number>={};
    abbrevTable:ts.Map<string>;
    fetchedAbbrev=false;
    nextFileId=1;
    debugSession: JsDebugSession;
    protocol:nodeproto.Protocol;
    errorTimer: NodeJS.Timer;
    immediateId: any;

    constructor(useProtocol=false) {
        this.initAbbrevTable();
        if (useProtocol) {
            this.initProtocol();
        }
    }

    initProtocol() {
        this.protocol=new nodeproto.Protocol();
        // note: onResponse was named by nodejs authors; we are re-purposing the Protocol
        // class in this case so that it supports a server instead of a client
        this.protocol.onResponse = (pkt) => {
            this.handleRequest(pkt);
        };
    }

    handleRequest(req: nodeproto.Packet) {
        // TODO: so far requests always come in on stdin
    }

    send(msg: nodeproto.Message) {
        var json:string;
        if (this.prettyJSON) {
            json = JSON.stringify(msg, null, " ");
        }
        else {
            json = JSON.stringify(msg);
        }
        console.log('Content-Length: ' + (1+Buffer.byteLength(json, 'utf8')) +
                    '\r\n\r\n' + json);
    }

    event(info: any,eventName:string) {
        var ev: nodeproto.Event = {
            seq: 0,
            type: "event",
            event: eventName,
            body: info,
        };
        this.send(ev);
    }

    
    response(info:any,reqSeq=0,errorMsg?: string) {
        var res: nodeproto.Response = {
            seq: 0,
            type: "response",
            request_seq: reqSeq,
            success: !errorMsg,
        }
        if (!errorMsg) {
            res.body = info;
        }
        else {
            res.message=errorMsg;
        }
        this.send(res);
    }

    initAbbrevTable() {
        this.abbrevTable= {
            name: "n",
            kind: "k",
            fileName: "f",
            containerName: "c",
            containerKind: "ck",
            min: "m",
            line: "l",
            offset: "o",
            "interface": "i",
            "function" : "fn",
        };
    }

    // TODO: use union type for return type
    encodeFilename(filename:string):any {
        var id=ts.lookUp(this.fileHash,filename);
        if (!id) {
            id = this.nextFileId++;
            this.fileHash[filename]=id;
            return { id: id, fileName: filename };
        }
        else {
            return id;
        }
    }

    abbreviate(obj:any) {
        if (this.fetchedAbbrev&&(!this.prettyJSON)) {
            for (var p in obj) {
                if (obj.hasOwnProperty(p)) {
                    var sub=ts.lookUp(this.abbrevTable,p);
                    if (sub) {
                        obj[sub]=obj[p];
                        obj[p]=undefined;
                    }
                }
            }
        }
    }

    output(info,errorMsg?:string) {
        if (this.protocol) {
            this.response(info,0,errorMsg);
        }
        else if (this.prettyJSON) {
            if (!errorMsg) {
                console.log(JSON.stringify(info, null, " ").trim());
            }
            else {
                console.log(JSON.stringify(errorMsg));
            }
        } else {
            if (!errorMsg) {
                var infoStr = JSON.stringify(info).trim();
                // [8 digits of length,infoStr] + '\n'
                var len = infoStr.length + paddedLength + 4;
                var lenStr = len.toString();
                var padLen = paddedLength - lenStr.length;
                for (var i = 0; i < padLen; i++) {
                    lenStr = '0' + lenStr;
                }
                console.log("[" + lenStr + "," + infoStr + "]");
            }
            else {
                console.log(JSON.stringify("error: "+errorMsg));
            }
        }
    }

    semanticCheck(file: string, project: Editor.Project) {
        var diags = project.compilerService.languageService.getSemanticDiagnostics(file);
        if (diags) {
            var bakedDiags = diags.map((diag)=>formatDiag(file,project,diag));
            this.event({ fileName: file, diagnostics: bakedDiags }, "semanticDiag");
        }
    }

    updateErrorCheck(file: string,project: Editor.Project) {
        if (this.errorTimer) {
            clearTimeout(this.errorTimer);
        }
        if (this.immediateId) {
            clearImmediate(this.immediateId);
            this.immediateId=undefined;
        }
        this.errorTimer = setTimeout(() => {
            var diags = project.compilerService.languageService.getSyntacticDiagnostics(file);
            if (diags) {
                var bakedDiags = diags.map((diag)=>formatDiag(file,project,diag));
                this.event({ fileName: file, diagnostics: bakedDiags }, "syntaxDiag");
            }
            this.errorTimer=undefined;
            this.immediateId=setImmediate(()=>this.semanticCheck(file,project));
        },1500);
    }

    listen() {
        //console.log("up...");
        rl.on('line', (input:string) => {
            var cmd = input.trim();
            var line:number,col:number,file:string;
            var pos:number;
            var m:string[];
            var project:Editor.Project;
            var compilerService:Editor.CompilerService;

            if (m=cmd.match(/^definition (\d+) (\d+) (.*)$/)) {
                line = parseInt(m[1]);
                col  = parseInt(m[2]);
                file = m[3];
                project=this.projectService.getProjectForFile(file);
                if (project) {
                    var compilerService=project.compilerService;
                    pos=compilerService.host.lineColToPosition(file,line,col);
                    var locs=compilerService.languageService.getDefinitionAtPosition(file,pos);
                    if (locs) {
                        var info = locs.map( def => ({
                            file : def && def.fileName,
                            min  : def &&
                                compilerService.host.positionToZeroBasedLineCol(def.fileName,def.textSpan.start()),
                            lim  : def &&
                                compilerService.host.positionToZeroBasedLineCol(def.fileName,def.textSpan.end())
                        }));
                        this.output(info[0]||null); 
                    }
                    else {
                        this.output(undefined,"could not find def");
                    }
                }
                else {
                    this.output(undefined,"no project for "+file);
                }
            }
            else if (m=cmd.match(/^dbg start$/)) {
                this.debugSession=new JsDebugSession();
            }
            else if (m=cmd.match(/^dbg cont$/)) {
                if (this.debugSession) {
                    this.debugSession.cont((err, body, res) => {
                    });
                }
            }
            else if (m=cmd.match(/^dbg src$/)) {
                if (this.debugSession) {
                    this.debugSession.listSrc();
                }
            }
            else if (m = cmd.match(/^dbg brk (\d+) (.*)$/)) {
                line = parseInt(m[1]);                
                file = m[2];
                if (this.debugSession) {
                    this.debugSession.setBreakpointOnLine(line,file);
                }
            }
            else if (m = cmd.match(/^dbg eval (.*)$/)) {
                var code=m[1];
                if (this.debugSession) {
                    this.debugSession.evaluate(code);
                }
            }
            else if (m=cmd.match(/^rename (\d+) (\d+) (.*)$/)) {
                line = parseInt(m[1]);
                col  = parseInt(m[2]);
                file = m[3];
                project=this.projectService.getProjectForFile(file);
                if (project) {
                    var compilerService = project.compilerService;
                    pos = compilerService.host.lineColToPosition(file, line, col);
                    var renameInfo=compilerService.languageService.getRenameInfo(file,pos);
                    if (renameInfo) {
                        if (renameInfo.canRename) {
                            var renameLocs = compilerService.languageService.findRenameLocations(file, pos, false, false);
                            if (renameLocs) {
                                var bakedRenameLocs = renameLocs.map(loc=> ({
                                    file: loc.fileName,
                                    min: compilerService.host.positionToZeroBasedLineCol(loc.fileName,loc.textSpan.start()),
                                    lim: compilerService.host.positionToZeroBasedLineCol(loc.fileName,loc.textSpan.end()),
                                })).sort((a, b) => {
                                    if (a.file < b.file) {
                                        return -1;
                                    }
                                    else if (a.file > b.file) {
                                        return 1;
                                    }
                                    else {
                                        // reverse sort assuming no overlap
                                        if (a.min.line < b.min.line) {
                                            return 1;
                                        }
                                        else if (a.min.line > b.min.line) {
                                            return -1;
                                        }
                                        else {
                                            return b.min.offset-a.min.offset;
                                        }
                                    }
                                }).reduce<FileRanges[]>((accum:FileRanges[], cur:FileRange) => {
                                    var curFileAccum:FileRanges;
                                    if (accum.length > 0) {
                                        curFileAccum=accum[accum.length-1];
                                        if (curFileAccum.file != cur.file) {
                                            curFileAccum=undefined;
                                        }
                                    }
                                    if (!curFileAccum) {
                                        curFileAccum = { file: cur.file, locs: [] };
                                        accum.push(curFileAccum);
                                    }
                                    curFileAccum.locs.push({ min: cur.min, lim: cur.lim });
                                    return accum;
                                },[]);
                                this.output({ info: renameInfo, locs: bakedRenameLocs });
                            }
                            else {
                                this.output([]);
                            }
                        }
                        else {
                            this.output(undefined, renameInfo.localizedErrorMessage);
                        }
                    }
                    else {
                        this.output(undefined,"no rename information at cursor");
                    }
                }
            }
            else if (m=cmd.match(/^type (\d+) (\d+) (.*)$/)) {
                line = parseInt(m[1]);
                col  = parseInt(m[2]);
                file = m[3];
                project=this.projectService.getProjectForFile(file);
                if (project) {
                    var compilerService=project.compilerService;
                    pos=compilerService.host.lineColToPosition(file,line,col);
                    var quickInfo=compilerService.languageService.getQuickInfoAtPosition(file,pos);
                    var typeLoc:any="no type";

                    if ((quickInfo.kind=="var")||(quickInfo.kind=="local var")) {
                        var typeName = parseTypeName(quickInfo.displayParts);
                        if (typeName) {
                            var navItems = compilerService.languageService.getNavigateToItems(typeName);
                            var navItem=findExactMatchType(navItems);
                            if (navItem) {
                                typeLoc= {
                                    fileName: navItem.fileName,
                                    min: compilerService.host.positionToZeroBasedLineCol(navItem.fileName,
                                                                                         navItem.textSpan.start()),
                                };
                            }
                        }
                    }

                    this.output(typeLoc);
                }
                else {
                    this.output(undefined,"no project for "+file);
                }
            }
            else if (m=cmd.match(/^open (.*)$/)) {
                file=m[1];
                this.projectService.openSpecifiedFile(file);
            }
            else if (m=cmd.match(/^references (\d+) (\d+) (.*)$/)) {
                line = parseInt(m[1]);
                col  = parseInt(m[2]);
                file = m[3];
                project=this.projectService.getProjectForFile(file);
                if (project) {
                    compilerService=project.compilerService;
                    pos=compilerService.host.lineColToPosition(file,line,col);
                    var refs = compilerService.languageService.getReferencesAtPosition(file,pos);
                    if (refs) {
                        var nameInfo = compilerService.languageService.getQuickInfoAtPosition(file,pos);
                        if (nameInfo) {
                            var nameSpan=nameInfo.textSpan;
                            var nameColStart=
                                compilerService.host.positionToZeroBasedLineCol(file,nameSpan.start()).offset;
                            var nameText=
                                compilerService.host.getScriptSnapshot(file).getText(nameSpan.start(),nameSpan.end());
                            var bakedRefs=refs.map (ref => ({
                                file: ref.fileName,
                                min: compilerService.host.positionToZeroBasedLineCol(ref.fileName,ref.textSpan.start()),
                                lim: compilerService.host.positionToZeroBasedLineCol(ref.fileName,ref.textSpan.end()),
                            }));
                            this.output([bakedRefs,nameText,nameColStart]);
                        }
                        else {
                            this.output(undefined,"no references at this position");
                        }
                    }
                    else {
                        this.output(undefined,"no references at this position");                        
                    }
                }
            }
            else if (m=cmd.match(/^quickinfo (\d+) (\d+) (.*)$/)) {
                line = parseInt(m[1]);
                col  = parseInt(m[2]);
                file = m[3];
                project=this.projectService.getProjectForFile(file);
                if (project) {
                    compilerService=project.compilerService;
                    pos=compilerService.host.lineColToPosition(file,line,col);
                    var quickInfo = compilerService.languageService.getQuickInfoAtPosition(file,pos);
                    if (quickInfo) {
                        var displayString=ts.displayPartsToString(quickInfo.displayParts);
                        this.output(displayString);
                    }
                    else {
                        this.output(undefined,"no info")
                    }
                }
            }
            else if (m=cmd.match(/^formatonkey (\d+) (\d+) (\{\".*\"\})\s* (.*)$/)) {
                line = parseInt(m[1]);
                col  = parseInt(m[2]);
                file = m[4];
                project=this.projectService.getProjectForFile(file);
                if (project) {
                    compilerService=project.compilerService;
                    pos=compilerService.host.lineColToPosition(file,line,col);
                    var key=JSON.parse(m[3].substring(1,m[3].length-1));
                    
                    var edits:ts.TextChange[];
                    try {
                        edits = compilerService.languageService.getFormattingEditsAfterKeystroke(file, pos, key,
                            compilerService.formatCodeOptions);
                    }
                    catch (err) {
                        edits=undefined;
                    }
                    if (edits) {
                        var bakedEdits=edits.map((edit)=>{
                            return {
                                min: compilerService.host.positionToZeroBasedLineCol(file,
                                                                                     edit.span.start()),
                                lim: compilerService.host.positionToZeroBasedLineCol(file,
                                                                                     edit.span.end()),
                                newText: edit.newText?edit.newText:""
                            };
                        });
                        this.output(bakedEdits);
                    }
                    else {
                        this.output(undefined,"no edits")
                    }
                }
            }
            else if (m=cmd.match(/^completions (\d+) (\d+) (.*)$/)) {
                line = parseInt(m[1]);
                col  = parseInt(m[2]);
                file = m[3];
                project=this.projectService.getProjectForFile(file);
                if (project) {
                    compilerService=project.compilerService;
                    pos=compilerService.host.lineColToPosition(file,line,col);
                    var completions=compilerService.languageService.getCompletionsAtPosition(file,pos);
                    if (completions) {
                        var compressedEntries=completions.entries.map((entry)=> {
                            var protoEntry=<ts.CompletionEntryDetails>{};
                            protoEntry.name=entry.name;
                            protoEntry.kind=entry.kind;
                            if (entry.kindModifiers&&(entry.kindModifiers.length>0)) {
                                protoEntry.kindModifiers=entry.kindModifiers;
                            }
                            var details = compilerService.languageService.getCompletionEntryDetails(file,pos,entry.name);
                            if (details&&(details.documentation)&&(details.documentation.length>0)) {
                                protoEntry.documentation=details.documentation;
                            }
                            return protoEntry;
                        });
                        this.output(compressedEntries);
                    }
                    else {
                        this.output(undefined,"no completions")                        
                    }
                }
            }
            else if (m=cmd.match(/^change (\d+) (\d+) (\d+) (\d+) (\{\".*\"\})?\s*(.*)$/)) {
                line = parseInt(m[1]);
                col  = parseInt(m[2]);
                var deleteLen=parseInt(m[3]);
                var insertLen=parseInt(m[4]);
                var insertString:string;

                if (insertLen) {
                    insertString=JSON.parse(m[5].substring(1,m[5].length-1));
                }

                file = m[6];
                project=this.projectService.getProjectForFile(file);
                if (project) {
                    compilerService=project.compilerService;
                    pos=compilerService.host.lineColToPosition(file,line,col);
                    compilerService.host.editScript(file,pos,pos+deleteLen,insertString);
                    this.updateErrorCheck(file,project);
                }
            }
            else if (m=cmd.match(/^navto (\{.*\}) (.*)$/)) {
                var searchTerm=m[1];
                searchTerm=searchTerm.substring(1,searchTerm.length-1);
                file = m[2];
                project=this.projectService.getProjectForFile(file);
                if (project) {
                    compilerService=project.compilerService;
                    var navItems: ts.NavigateToItem[];
                    var cancellationToken=<Editor.CancellationToken>compilerService.host.getCancellationToken();
                    if (this.pendingOperation) {
                        cancellationToken.cancel();
                        cancellationToken.reset();
                    }
                    try {
                        this.pendingOperation=true;
                        navItems = sortNavItems(compilerService.languageService.getNavigateToItems(searchTerm));
                    }
                    catch (err) {
                        navItems=undefined;
                    }
                    this.pendingOperation=false;
                    if (navItems) {
                        var bakedNavItems = navItems.map((navItem)=>{
                            var min =compilerService.host.positionToZeroBasedLineCol(navItem.fileName,
                                                                                     navItem.textSpan.start());
                            this.abbreviate(min);
                            var bakedItem:any = {
                                name: navItem.name,
                                kind: navItem.kind,
                                fileName: this.encodeFilename(navItem.fileName),
                                min: min,
                            };
                            if (navItem.containerName&&(navItem.containerName.length>0)) {
                                bakedItem.containerName=navItem.containerName;
                            }
                            if (navItem.containerKind&&(navItem.containerKind.length>0)) {
                                bakedItem.containerKind=navItem.containerKind;
                            }
                            this.abbreviate(bakedItem);
                            return bakedItem;
                        });
                        
                        this.output(bakedNavItems);
                    }
                    else {
                        this.output(undefined,"no nav items");
                    }
                }
            }
            else if (m=cmd.match(/^abbrev/)) {
                this.fetchedAbbrev=true;
                this.output(this.abbrevTable);
            }
            else if (m = cmd.match(/^pretty/)) {
                this.prettyJSON=true;
            }
            else {
                this.output(undefined,"Unrecognized command "+cmd);
            }
        });

        rl.on('close', function() {
            console.log("Exiting...");
            process.exit(0);
        });
    }
}

new Session(true).listen();




