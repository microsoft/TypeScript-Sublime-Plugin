/// <reference path='../../node_modules/typescript/bin/typescriptServices.d.ts'/>
/// <reference path='../../node_modules/typescript/bin/typescriptServices_internal.d.ts'/>
/// <reference path='node.d.ts' />
/// <reference path='protodef.d.ts' />
/// <reference path='editorServices.ts' />


module ts {
    export interface NavigationBarItem {
        displayString?: string;
        docString?: string;
    }
}

module ts.server {
    var nodeproto: typeof NodeJS._debugger = require('_debugger');
    var readline: NodeJS.ReadLine = require('readline');
    var path: NodeJS.Path = require('path');

    var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
    });

    var paddedLength = 8;

    var typeNames = ["interface", "class", "enum", "module", "alias", "type"];

    var spaceCache = [" ", "  ", "   ", "    "];

    interface StackTraceError extends Error {
        stack?: string;
    }



    function generateSpaces(n: number): string {
        if (!spaceCache[n]) {
            var strBuilder = "";
            for (var i = 0; i < n; i++) {
                strBuilder += " ";
            }
            spaceCache[n] = strBuilder;
        }
        return spaceCache[n];
    }

    function printObject(obj: any) {
        for (var p in obj) {
            if (obj.hasOwnProperty(p)) {
                console.log(p + ": " + obj[p]);
            }
        }
    }

    function isTypeName(name: string, suffix?: string) {
        for (var i = 0, len = typeNames.length; i < len; i++) {
            if (typeNames[i] == name) {
                return true;
            }
            else if (suffix && ((typeNames[i] + suffix) == name)) {
                return true;
            }
        }
        return false;
    }

    function parseTypeName(displayParts: ts.SymbolDisplayPart[]) {
        var len = displayParts.length;
        for (var i = len - 1; i >= 0; i--) {
            if (isTypeName(displayParts[i].kind, "Name")) {
                return displayParts[i].text;
            }
        }
        return undefined;
    }

    function findExactMatchType(items: ts.NavigateToItem[]) {
        for (var i = 0, len = items.length; i < len; i++) {
            var navItem = items[i];
            if (navItem.matchKind == "exact") {
                if (isTypeName(navItem.kind)) {
                    return navItem;
                }
            }
        }
    }

    interface FileMin {
        file: string;
        min: ILineInfo;
    }

    function compareNumber(a: number, b: number) {
        if (a < b) {
            return -1;
        }
        else if (a == b) {
            return 0;
        }
        else return 1;
    }

    function compareFileMin(a: FileMin, b: FileMin) {
        if (a.file < b.file) {
            return -1;
        }
        else if (a.file == b.file) {
            var n = compareNumber(a.min.line, b.min.line);
            if (n == 0) {
                return compareNumber(a.min.col, b.min.col);
            }
            else return n;
        }
        else {
            return 1;
        }
    }

    function sortNavItems(items: ts.NavigateToItem[]) {
        return items.sort((a, b) => {
            if (a.matchKind < b.matchKind) {
                return -1;
            }
            else if (a.matchKind == b.matchKind) {
                var lowa = a.name.toLowerCase();
                var lowb = b.name.toLowerCase();
                if (lowa < lowb) {
                    return -1;
                }
                else if (lowa == lowb) {
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

    function SourceInfo(body: NodeJS._debugger.BreakResponse) {
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
        client: NodeJS._debugger.Client;
        host = 'localhost';
        port = 5858;

        constructor() {
            this.init();
        }

        cont(cb: NodeJS._debugger.RequestHandler) {
            this.client.reqContinue(cb);
        }

        listSrc() {
            this.client.reqScripts((err: any) => {
                if (err) {
                    console.log("rscr error: " + err);
                }
                else {
                    console.log("req scripts");
                    for (var id in this.client.scripts) {
                        var script = this.client.scripts[id];
                        if ((typeof script === "object") && script.name) {
                            console.log(id + ": " + script.name);
                        }
                    }
                }
            });
        }

        findScript(file: string) {
            if (file) {
                var script: NodeJS._debugger.ScriptDesc;
                var scripts = this.client.scripts;
                var keys: any[] = Object.keys(scripts);
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
                file = this.client.currentScript;
            }
            var script: NodeJS._debugger.ScriptDesc;
            var scriptResult = this.findScript(file);
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
                var brkmsg: NodeJS._debugger.BreakpointMessageBody = {
                    type: 'scriptId',
                    target: script.id,
                    line: line - 1,
                }
                this.client.setBreakpoint(brkmsg,(err, bod) => {
                    // TODO: remember breakpoint
                    if (err) {
                        console.log("Error: set breakpoint: " + err);
                    }
                });
            }

        }

        init() {
            var connectionAttempts = 0;
            this.client = new nodeproto.Client();
            this.client.on('break', (res: NodeJS._debugger.Event) => {
                this.handleBreak(res.body);
            });
            this.client.on('exception',(res: NodeJS._debugger.Event) => {
                this.handleBreak(res.body);
            });
            this.client.on('error',() => {
                setTimeout(() => {
                    ++connectionAttempts;
                    this.client.connect(this.port, this.host);
                }, 500);
            });
            this.client.once('ready',() => {
            });
            this.client.on('unhandledResponse',() => {
            });
            this.client.connect(this.port, this.host);
        }

        evaluate(code: string) {
            var frame = this.client.currentFrame;
            this.client.reqFrameEval(code, frame,(err, bod) => {
                if (err) {
                    console.log("Error: evaluate: " + err);
                    return;
                }

                console.log("Value: " + bod.toString());
                if (typeof bod === "object") {
                    printObject(bod);
                }

                // Request object by handles (and it's sub-properties)
                this.client.mirrorObject(bod, 3,(err, mirror) => {
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

        handleBreak(breakInfo: NodeJS._debugger.BreakResponse) {
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
        file?: string;
        min: ILineInfo;
        lim: ILineInfo;
    }

    interface FileRanges {
        file: string;
        locs: FileRange[];
    }

    function formatDiag(file: string, project: Project, diag: ts.Diagnostic) {
        return {
            min: project.compilerService.host.positionToLineCol(file, diag.start),
            len: diag.length,
            text: diag.messageText,
        };
    }

    interface PendingErrorCheck {
        filename: string;
        project: Project;
    }

    interface IdFile {
        id: number;
        fileName: string;
    }

    function allEditsBeforePos(edits: ts.TextChange[], pos: number) {
        for (var i = 0, len = edits.length; i < len; i++) {
            if (ts.textSpanEnd(edits[i].span) >= pos) {
                return false;
            }
        }
        return true;
    }

    export class Session {
        projectService = new ProjectService();
        prettyJSON = false;
        pendingOperation = false;
        fileHash: ts.Map<number> = {};
        abbrevTable: ts.Map<string>;
        fetchedAbbrev = false;
        nextFileId = 1;
        debugSession: JsDebugSession;
        protocol: NodeJS._debugger.Protocol;
        errorTimer: NodeJS.Timer;
        immediateId: any;
        changeSeq = 0;

        constructor(useProtocol = false) {
            this.initAbbrevTable();
            if (useProtocol) {
                this.initProtocol();
            }
        }

        logError(err: Error, cmd: string) {
            var typedErr = <StackTraceError>err;
            var msg = "Exception on executing command " + cmd;
            if (typedErr.message) {
                msg += ":\n" + typedErr.message;
                if (typedErr.stack) {
                    msg += "\n" + typedErr.stack;
                }
            }
            this.projectService.log(msg);
        }

        initProtocol() {
            this.protocol = new nodeproto.Protocol();
            // note: onResponse was named by nodejs authors; we are re-purposing the Protocol
            // class in this case so that it supports a server instead of a client
            this.protocol.onResponse = (pkt) => {
                this.handleRequest(pkt);
            };
        }

        handleRequest(req: NodeJS._debugger.Packet) {
            console.log("Got JSON msg:\n" + req.raw);
        }

        send(msg: NodeJS._debugger.Message) {
            var json: string;
            if (this.prettyJSON) {
                json = JSON.stringify(msg, null, " ");
            }
            else {
                json = JSON.stringify(msg);
            }
            console.log('Content-Length: ' + (1 + Buffer.byteLength(json, 'utf8')) +
                '\r\n\r\n' + json);
        }

        event(info: any, eventName: string) {
            var ev: NodeJS._debugger.Event = {
                seq: 0,
                type: "event",
                event: eventName,
                body: info,
            };
            this.send(ev);
        }

        response(info: any, reqSeq = 0, errorMsg?: string) {
            var res: NodeJS._debugger.Response = {
                seq: 0,
                type: "response",
                request_seq: reqSeq,
                success: !errorMsg,
            }
            if (!errorMsg) {
                res.body = info;
            }
            else {
                res.message = errorMsg;
            }
            this.send(res);
        }

        initAbbrevTable() {
            this.abbrevTable = {
                name: "n",
                kind: "k",
                fileName: "f",
                containerName: "cn",
                containerKind: "ck",
                min: "m",
                line: "l",
                col: "c",
                "interface": "i",
                "function": "fn",
            };
        }

        encodeFilename(filename: string): number | IdFile {
            var id = ts.lookUp(this.fileHash, filename);
            if (!id) {
                id = this.nextFileId++;
                this.fileHash[filename] = id;
                return { id: id, fileName: filename };
            }
            else {
                return id;
            }
        }

        abbreviate(obj: any) {
            if (this.fetchedAbbrev && (!this.prettyJSON)) {
                for (var p in obj) {
                    if (obj.hasOwnProperty(p)) {
                        var sub = ts.lookUp(this.abbrevTable, p);
                        if (sub) {
                            obj[sub] = obj[p];
                            obj[p] = undefined;
                        }
                    }
                }
            }
        }

        output(info: any, reqSeq = 0, errorMsg?: string) {
            if (this.protocol) {
                this.response(info, reqSeq, errorMsg);
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
                    console.log(JSON.stringify("error: " + errorMsg));
                }
            }
        }

        semanticCheck(file: string, project: Project) {
            var diags = project.compilerService.languageService.getSemanticDiagnostics(file);
            if (diags) {
                var bakedDiags = diags.map((diag) => formatDiag(file, project, diag));
                this.event({ file: file, diagnostics: bakedDiags }, "semanticDiag");
            }
        }

        syntacticCheck(file: string, project: Project) {
            var diags = project.compilerService.languageService.getSyntacticDiagnostics(file);
            if (diags) {
                var bakedDiags = diags.map((diag) => formatDiag(file, project, diag));
                this.event({ file: file, diagnostics: bakedDiags }, "syntaxDiag");
            }
        }

        errorCheck(file: string, project: Project) {
            this.syntacticCheck(file, project);
            this.semanticCheck(file, project);
        }

        updateErrorCheck(checkList: PendingErrorCheck[], seq: number,
            matchSeq: (seq: number) => boolean, ms = 1500, followMs = 200) {
            if (followMs > ms) {
                followMs = ms;
            }
            if (this.errorTimer) {
                clearTimeout(this.errorTimer);
            }
            if (this.immediateId) {
                clearImmediate(this.immediateId);
                this.immediateId = undefined;
            }
            var index = 0;
            var checkOne = () => {
                if (matchSeq(seq)) {
                    var checkSpec = checkList[index++];
                    if (checkSpec.project.getSourceFileFromName(checkSpec.filename)) {
                        this.syntacticCheck(checkSpec.filename, checkSpec.project);
                        this.immediateId = setImmediate(() => {
                            this.semanticCheck(checkSpec.filename, checkSpec.project);
                            this.immediateId = undefined;
                            if (checkList.length > index) {
                                this.errorTimer = setTimeout(checkOne, followMs);
                            }
                            else {
                                this.errorTimer = undefined;
                            }
                        });
                    }
                }
            }
            if ((checkList.length > index) && (matchSeq(seq))) {
                this.errorTimer = setTimeout(checkOne, ms);
            }
        }

        goToDefinition(line: number, col: number, rawfile: string, reqSeq = 0) {
            var file = ts.normalizePath(rawfile);
            var project = this.projectService.getProjectForFile(file);
            if (project) {
                var compilerService = project.compilerService;
                var pos = compilerService.host.lineColToPosition(file, line, col);
                var locs = compilerService.languageService.getDefinitionAtPosition(file, pos);
                if (locs) {
                    var info: ServerProtocol.CodeSpan[] = locs.map(def => ({
                        file: def && def.fileName,
                        min: def &&
                        compilerService.host.positionToLineCol(def.fileName, def.textSpan.start),
                        lim: def &&
                        compilerService.host.positionToLineCol(def.fileName, ts.textSpanEnd(def.textSpan))
                    }));
                    this.output(info, reqSeq);
                }
                else {
                    this.output(undefined, reqSeq, "could not find def");
                }
            }
            else {
                this.output(undefined, reqSeq, "no project for " + file);
            }
        }

        rename(line: number, col: number, rawfile: string, reqSeq = 0) {
            var file = ts.normalizePath(rawfile);
            var project = this.projectService.getProjectForFile(file);
            if (project) {
                var compilerService = project.compilerService;
                var pos = compilerService.host.lineColToPosition(file, line, col);
                var renameInfo = compilerService.languageService.getRenameInfo(file, pos);
                if (renameInfo) {
                    if (renameInfo.canRename) {
                        var renameLocs = compilerService.languageService.findRenameLocations(file, pos, false, false);
                        if (renameLocs) {
                            var bakedRenameLocs = renameLocs.map(loc=> ({
                                file: loc.fileName,
                                min: compilerService.host.positionToLineCol(loc.fileName, loc.textSpan.start),
                                lim: compilerService.host.positionToLineCol(loc.fileName, ts.textSpanEnd(loc.textSpan)),
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
                                        return b.min.col - a.min.col;
                                    }
                                }
                            }).reduce<FileRanges[]>((accum: FileRanges[], cur: FileRange) => {
                                var curFileAccum: FileRanges;
                                if (accum.length > 0) {
                                    curFileAccum = accum[accum.length - 1];
                                    if (curFileAccum.file != cur.file) {
                                        curFileAccum = undefined;
                                    }
                                }
                                if (!curFileAccum) {
                                    curFileAccum = { file: cur.file, locs: [] };
                                    accum.push(curFileAccum);
                                }
                                curFileAccum.locs.push({ min: cur.min, lim: cur.lim });
                                return accum;
                            }, []);
                            this.output({ info: renameInfo, locs: bakedRenameLocs }, reqSeq);
                        }
                        else {
                            this.output({ info: renameInfo, locs: [] }, reqSeq);
                        }
                    }
                    else {
                        this.output(undefined, reqSeq, renameInfo.localizedErrorMessage);
                    }
                }
                else {
                    this.output(undefined, reqSeq, "no rename information at cursor");
                }
            }
        }

        findReferences(line: number, col: number, rawfile: string, reqSeq = 0) {
            // TODO: get all projects for this file; report refs for all projects deleting duplicates
            // can avoid duplicates by eliminating same ref file from subsequent projects
            var file = ts.normalizePath(rawfile);
            var project = this.projectService.getProjectForFile(file);
            if (project) {
                var compilerService = project.compilerService;
                var pos = compilerService.host.lineColToPosition(file, line, col);
                var refs = compilerService.languageService.getReferencesAtPosition(file, pos);
                if (refs) {
                    var nameInfo = compilerService.languageService.getQuickInfoAtPosition(file, pos);
                    if (nameInfo) {
                        var displayString = ts.displayPartsToString(nameInfo.displayParts);
                        var nameSpan = nameInfo.textSpan;
                        var nameColStart =
                            compilerService.host.positionToLineCol(file, nameSpan.start).col;
                        var nameText =
                            compilerService.host.getScriptSnapshot(file).getText(nameSpan.start, ts.textSpanEnd(nameSpan));
                        var bakedRefs: ServerProtocol.ReferencesResponseItem[] = refs.map((ref) => {
                            var min = compilerService.host.positionToLineCol(ref.fileName, ref.textSpan.start);
                            var refLineSpan = compilerService.host.lineToTextSpan(ref.fileName, min.line - 1);
                            var snap = compilerService.host.getScriptSnapshot(ref.fileName);
                            var lineText = snap.getText(refLineSpan.start, ts.textSpanEnd(refLineSpan)).replace(/\r|\n/g, "");
                            return {
                                file: ref.fileName,
                                min: min,
                                lineText: lineText,
                                lim: compilerService.host.positionToLineCol(ref.fileName, ts.textSpanEnd(ref.textSpan)),
                            };
                        }).sort(compareFileMin);
                        var response: ServerProtocol.ReferencesResponseBody = {
                            refs: bakedRefs,
                            symbolName: nameText,
                            symbolStartCol: nameColStart,
                            symbolDisplayString: displayString
                        };
                        this.output(response, reqSeq);
                    }
                    else {
                        this.output(undefined, reqSeq, "no references at this position");
                    }
                }
                else {
                    this.output(undefined, reqSeq, "no references at this position");
                }
            }
        }

        // TODO: implement this as ls api that can return multiple def sites
        goToType(line: number, col: number, rawfile: string, reqSeq = 0) {
            var file = ts.normalizePath(rawfile);
            var project = this.projectService.getProjectForFile(file);
            if (project) {
                var compilerService = project.compilerService;
                var pos = compilerService.host.lineColToPosition(file, line, col);
                var quickInfo = compilerService.languageService.getQuickInfoAtPosition(file, pos);
                var typeLoc: any;

                if (quickInfo && (quickInfo.kind == "var") || (quickInfo.kind == "local var")) {
                    var typeName = parseTypeName(quickInfo.displayParts);
                    if (typeName) {
                        var navItems = compilerService.languageService.getNavigateToItems(typeName);
                        var navItem = findExactMatchType(navItems);
                        if (navItem) {
                            typeLoc = {
                                file: navItem.fileName,
                                min: compilerService.host.positionToLineCol(navItem.fileName,
                                    navItem.textSpan.start),
                                lim: compilerService.host.positionToLineCol(navItem.fileName,
                                    ts.textSpanEnd(navItem.textSpan)),
                            };
                        }
                    }
                }
                if (typeLoc) {
                    this.output([typeLoc], reqSeq);
                }
                else {
                    this.output(undefined, reqSeq, "no info at this location");
                }
            }
            else {
                this.output(undefined, reqSeq, "no project for " + file);
            }
        }

        openClientFile(rawfile: string) {
            var file = ts.normalizePath(rawfile);
            this.projectService.openClientFile(file);
        }

        quickInfo(line: number, col: number, rawfile: string, reqSeq = 0) {
            var file = ts.normalizePath(rawfile);
            var project = this.projectService.getProjectForFile(file);
            if (project) {
                var compilerService = project.compilerService;
                var pos = compilerService.host.lineColToPosition(file, line, col);
                var quickInfo = compilerService.languageService.getQuickInfoAtPosition(file, pos);
                if (quickInfo) {
                    var displayString = ts.displayPartsToString(quickInfo.displayParts);
                    var docString = ts.displayPartsToString(quickInfo.documentation);
                    this.output({
                        info: displayString,
                        doc: docString,
                    }, reqSeq);
                }
                else {
                    this.output(undefined, reqSeq, "no info")
                }
            }
        }

        format(line: number, col: number, endLine: number, endCol: number, rawfile: string, cmd: string, reqSeq = 0) {
            var file = ts.normalizePath(rawfile);
            var project = this.projectService.getProjectForFile(file);
            if (project) {
                var compilerService = project.compilerService;
                var pos = compilerService.host.lineColToPosition(file, line, col);
                var endPos = compilerService.host.lineColToPosition(file, endLine, endCol);
                var edits: ts.TextChange[];
                // TODO: avoid duplicate code (with formatonkey)
                try {
                    edits = compilerService.languageService.getFormattingEditsForRange(file, pos, endPos,
                        compilerService.formatCodeOptions);
                }
                catch (err) {
                    this.logError(err, cmd);
                    edits = undefined;
                }
                if (edits) {
                    var bakedEdits: ServerProtocol.CodeEdit[] = edits.map((edit) => {
                        return {
                            min: compilerService.host.positionToLineCol(file,
                                edit.span.start),
                            lim: compilerService.host.positionToLineCol(file,
                                ts.textSpanEnd(edit.span)),
                            newText: edit.newText ? edit.newText : ""
                        };
                    });
                    this.output(bakedEdits, reqSeq);
                }
                else {
                    this.output(undefined, reqSeq, "no edits")
                }
            }
        }

        formatOnKey(line: number, col: number, key: string, rawfile: string, cmd: string, reqSeq = 0) {
            var file = ts.normalizePath(rawfile);
            var project = this.projectService.getProjectForFile(file);
            if (project) {
                var compilerService = project.compilerService;
                var pos = compilerService.host.lineColToPosition(file, line, col);
                var edits: ts.TextChange[];
                try {
                    edits = compilerService.languageService.getFormattingEditsAfterKeystroke(file, pos, key,
                        compilerService.formatCodeOptions);
                    if ((key == "\n") && ((!edits) || (edits.length == 0) || allEditsBeforePos(edits, pos))) {
                        // TODO: get these options from host
                        var editorOptions: ts.EditorOptions = {
                            IndentSize: 4,
                            TabSize: 4,
                            NewLineCharacter: "\n",
                            ConvertTabsToSpaces: true,
                        };
                        var indentPosition = compilerService.languageService.getIndentationAtPosition(file, pos, editorOptions);
                        var spaces = generateSpaces(indentPosition);
                        if (indentPosition > 0) {
                            edits.push({ span: ts.createTextSpanFromBounds(pos, pos), newText: spaces });
                        }
                    }
                }
                catch (err) {
                    this.logError(err, cmd);
                    edits = undefined;
                }
                if (edits) {
                    var bakedEdits: ServerProtocol.CodeEdit[] = edits.map((edit) => {
                        return {
                            min: compilerService.host.positionToLineCol(file,
                                edit.span.start),
                            lim: compilerService.host.positionToLineCol(file,
                                ts.textSpanEnd(edit.span)),
                            newText: edit.newText ? edit.newText : ""
                        };
                    });
                    this.output(bakedEdits, reqSeq);
                }
                else {
                    this.output(undefined, reqSeq, "no edits")
                }
            }
        }

        completions(line: number, col: number, prefix: string, rawfile: string, cmd: string, reqSeq = 0) {
            if (!prefix) {
                prefix = "";
            }
            var file = ts.normalizePath(rawfile);
            var project = this.projectService.getProjectForFile(file);
            var completions: ts.CompletionInfo = undefined;
            if (project) {
                var compilerService = project.compilerService;
                var pos = compilerService.host.lineColToPosition(file, line, col);
                if (pos >= 0) {
                    try {
                        completions = compilerService.languageService.getCompletionsAtPosition(file, pos);
                    }
                    catch (err) {
                        this.logError(err, cmd);
                        completions = undefined;
                    }
                    if (completions) {
                        var compressedEntries: ServerProtocol.CompletionItem[] =
                            completions.entries.reduce((accum: ts.CompletionEntryDetails[], entry: ts.CompletionEntry) => {
                                if (entry.name.indexOf(prefix) == 0) {
                                    var protoEntry = <ts.CompletionEntryDetails>{};
                                    protoEntry.name = entry.name;
                                    protoEntry.kind = entry.kind;
                                    if (entry.kindModifiers && (entry.kindModifiers.length > 0)) {
                                        protoEntry.kindModifiers = entry.kindModifiers;
                                    }
                                    var details = compilerService.languageService.getCompletionEntryDetails(file, pos, entry.name);
                                    if (details && (details.documentation) && (details.documentation.length > 0)) {
                                        protoEntry.documentation = details.documentation;
                                    }
                                    accum.push(protoEntry);
                                }
                                return accum;
                            }, []);
                        this.output(compressedEntries, reqSeq);
                    }
                }
            }
            if (!completions) {
                this.output(undefined, reqSeq, "no completions");
            }
        }

        geterr(ms: number, rawFiles: string) {
            var files = rawFiles.split(';');
            var checkList = files.reduce((accum: PendingErrorCheck[], filename: string) => {
                filename = ts.normalizePath(filename);
                var project = this.projectService.getProjectForFile(filename);
                if (project) {
                    accum.push({ filename: filename, project: project });
                }
                return accum;
            }, []);
            if (checkList.length > 0) {
                this.updateErrorCheck(checkList, this.changeSeq,(n) => n == this.changeSeq, ms)
            }
        }

        change(line: number, col: number, deleteLen: number, insertLen: number, insertString: string, rawfile: string) {
            var file = ts.normalizePath(rawfile);
            var project = this.projectService.getProjectForFile(file);
            if (project) {
                var compilerService = project.compilerService;
                var pos = compilerService.host.lineColToPosition(file, line, col);
                if (pos >= 0) {
                    compilerService.host.editScript(file, pos, pos + deleteLen, insertString);
                    this.changeSeq++;
                }
            }
        }

        reload(rawfile: string, rawtmpfile: string, reqSeq = 0) {
            var file = ts.normalizePath(rawfile);
            var tmpfile = ts.normalizePath(rawtmpfile);
            var project = this.projectService.getProjectForFile(file);
            if (project) {
                this.changeSeq++;
                // make sure no changes happen before this one is finished
                project.compilerService.host.reloadScript(file, tmpfile,() => {
                    this.output({ ack: true }, reqSeq);
                });
            }
        }

        saveToTmp(rawfile: string, rawtmpfile: string) {
            var file = ts.normalizePath(rawfile);
            var tmpfile = ts.normalizePath(rawtmpfile);

            var project = this.projectService.getProjectForFile(file);
            if (project) {
                project.compilerService.host.saveTo(file, tmpfile);
            }
        }

        closeClientFile(rawfile: string) {
            var file = ts.normalizePath(rawfile);
            this.projectService.closeClientFile(file);
        }

        decorateNavBarItem(navBarItem: ts.NavigationBarItem, compilerService: CompilerService, file: string) {
            if (navBarItem.spans.length == 1) {
                var span = navBarItem.spans[0];
                var offset = span.start;
                var textForSpan = compilerService.host.getScriptSnapshot(file).getText(offset, offset + span.length);
                var adj = textForSpan.indexOf(navBarItem.text);
                if (adj > 0) {
                    offset += adj;
                }
                var quickInfo = compilerService.languageService.getQuickInfoAtPosition(file,
                    offset + (navBarItem.text.length / 2));
                if (quickInfo) {
                    var displayString = ts.displayPartsToString(quickInfo.displayParts);
                    var docString = ts.displayPartsToString(quickInfo.documentation);
                    navBarItem.displayString = displayString;
                    navBarItem.docString = docString;
                }
            }
            if (navBarItem.childItems.length > 0) {
                navBarItem.childItems =
                navBarItem.childItems.map(navBarItem => this.decorateNavBarItem(navBarItem, compilerService, file));
            }
            return navBarItem;
        }

        navbar(rawfile: string, reqSeq = 0) {
            var file = ts.normalizePath(rawfile);
            var project = this.projectService.getProjectForFile(file);
            if (project) {
                var compilerService = project.compilerService;
                var navBarItems = compilerService.languageService.getNavigationBarItems(file);
                var bakedNavBarItems = navBarItems.map(navBarItem => this.decorateNavBarItem(navBarItem, compilerService, file));
                console.log(JSON.stringify(bakedNavBarItems, null, " "));
            }
        }

        navto(searchTerm: string, rawfile: string, cmd: string, reqSeq = 0) {
            var file = ts.normalizePath(rawfile);
            var project = this.projectService.getProjectForFile(file);
            if (project) {
                var compilerService = project.compilerService;
                var navItems: ts.NavigateToItem[];
                var cancellationToken = <CancellationToken>compilerService.host.getCancellationToken();
                if (this.pendingOperation) {
                    cancellationToken.cancel();
                    cancellationToken.reset();
                }
                try {
                    this.pendingOperation = true;
                    navItems = sortNavItems(compilerService.languageService.getNavigateToItems(searchTerm));
                }
                catch (err) {
                    this.logError(err, cmd);
                    navItems = undefined;
                }
                this.pendingOperation = false;
                if (navItems) {
                    var bakedNavItems: ServerProtocol.NavtoItem[] = navItems.map((navItem) => {
                        var min = compilerService.host.positionToLineCol(navItem.fileName,
                            navItem.textSpan.start);
                        this.abbreviate(min);
                        var bakedItem: any = {
                            name: navItem.name,
                            kind: navItem.kind,
                            file: this.encodeFilename(navItem.fileName),
                            min: min,
                        };
                        if (navItem.containerName && (navItem.containerName.length > 0)) {
                            bakedItem.containerName = navItem.containerName;
                        }
                        if (navItem.containerKind && (navItem.containerKind.length > 0)) {
                            bakedItem.containerKind = navItem.containerKind;
                        }
                        this.abbreviate(bakedItem);
                        return bakedItem;
                    });

                    this.output(bakedNavItems, reqSeq);
                }
                else {
                    this.output(undefined, reqSeq, "no nav items");
                }
            }
        }

        executeJSONcmd(cmd: string) {
            var req = <ServerProtocol.Request>JSON.parse(cmd);
            switch (req.command) {
                case "definition": {
                    var defArgs = <ServerProtocol.CodeLocationRequestArgs>req.arguments;
                    this.goToDefinition(defArgs.line, defArgs.col, defArgs.file, req.seq);
                    break;
                }
                case "references": {
                    var refArgs = <ServerProtocol.CodeLocationRequestArgs>req.arguments;
                    this.findReferences(refArgs.line, refArgs.col, refArgs.file, req.seq);
                    break;
                }
                case "rename": {
                    var renameArgs = <ServerProtocol.CodeLocationRequestArgs>req.arguments;
                    this.rename(renameArgs.line, renameArgs.col, renameArgs.file, req.seq);
                    break;
                }
                case "type": {
                    var typeArgs = <ServerProtocol.CodeLocationRequestArgs>req.arguments;
                    this.goToType(typeArgs.line, typeArgs.col, typeArgs.file, req.seq);
                    break;
                }
                case "open": {
                    var openArgs = <ServerProtocol.FileRequestArgs>req.arguments;
                    this.openClientFile(openArgs.file);
                    break;
                }
                case "quickinfo": {
                    var quickinfoArgs = <ServerProtocol.CodeLocationRequestArgs>req.arguments;
                    this.quickInfo(quickinfoArgs.line, quickinfoArgs.col, quickinfoArgs.file, req.seq);
                    break;
                }
                case "format": {
                    var formatArgs = <ServerProtocol.FormatRequestArgs>req.arguments;
                    this.format(formatArgs.line, formatArgs.col, formatArgs.endLine, formatArgs.endCol, formatArgs.file,
                        cmd, req.seq);
                    break;
                }
                case "formatonkey": {
                    var formatOnKeyArgs = <ServerProtocol.FormatOnKeyRequestArgs>req.arguments;
                    this.formatOnKey(formatOnKeyArgs.line, formatOnKeyArgs.col, formatOnKeyArgs.key, formatOnKeyArgs.file,
                        cmd, req.seq);
                    break;
                }
                case "completions": {
                    var completionsArgs = <ServerProtocol.CompletionsRequestArgs>req.arguments;
                    this.completions(req.arguments.line, req.arguments.col, completionsArgs.prefix, req.arguments.file,
                        cmd, req.seq);
                    break;
                }
                case "geterr": {
                    var geterrArgs = <ServerProtocol.GeterrRequestArgs>req.arguments;
                    this.geterr(geterrArgs.delay, geterrArgs.files);
                    break;
                }
                case "change": {
                    var changeArgs = <ServerProtocol.ChangeRequestArgs>req.arguments;
                    this.change(changeArgs.line, changeArgs.col, changeArgs.deleteLen, changeArgs.insertLen, changeArgs.insertString,
                        changeArgs.file);
                    break;
                }
                case "reload": {
                    var reloadArgs = <ServerProtocol.ReloadRequestArgs>req.arguments;
                    this.reload(reloadArgs.file, reloadArgs.tmpfile, req.seq);
                    break;
                }
                case "saveto": {
                    var savetoArgs = <ServerProtocol.SavetoRequestArgs>req.arguments;
                    this.saveToTmp(savetoArgs.file, savetoArgs.tmpfile);
                    break;
                }
                case "close": {
                    var closeArgs = <ServerProtocol.FileRequestArgs>req.arguments;
                    this.closeClientFile(closeArgs.file);
                    break;
                }
                case "navto": {
                    var navtoArgs = <ServerProtocol.NavtoRequestArgs>req.arguments;
                    this.navto(navtoArgs.searchTerm, navtoArgs.file, cmd, req.seq);
                    break;
                }
                default: {
                    this.projectService.log("Unrecognized JSON command: " + cmd);
                    break;
                }
            }
        }

        sendAbbrev(reqSeq = 0) {
            if (!this.fetchedAbbrev) {
                this.output(this.abbrevTable, reqSeq);
            }
            this.fetchedAbbrev = true;
        }

        listen() {
            rl.on('line',(input: string) => {
                var cmd = input.trim();
                if (cmd.indexOf("{") == 0) {
                    // assumption is JSON on single line
                    // plan is to also carry this protocol
                    // over tcp, in which case JSON would
                    // have a Content-Length header
                    this.executeJSONcmd(cmd);
                }
                else {
                    var line: number, col: number, file: string;
                    var m: string[];

                    try {
                        if (m = cmd.match(/^definition (\d+) (\d+) (.*)$/)) {
                            line = parseInt(m[1]);
                            col = parseInt(m[2]);
                            file = m[3];
                            this.goToDefinition(line, col, file);
                        }
                        else if (m = cmd.match(/^dbg start$/)) {
                            this.debugSession = new JsDebugSession();
                        }
                        else if (m = cmd.match(/^dbg cont$/)) {
                            if (this.debugSession) {
                                this.debugSession.cont((err, body, res) => {
                                });
                            }
                        }
                        else if (m = cmd.match(/^dbg src$/)) {
                            if (this.debugSession) {
                                this.debugSession.listSrc();
                            }
                        }
                        else if (m = cmd.match(/^dbg brk (\d+) (.*)$/)) {
                            line = parseInt(m[1]);
                            file = ts.normalizePath(m[2]);
                            if (this.debugSession) {
                                this.debugSession.setBreakpointOnLine(line, file);
                            }
                        }
                        else if (m = cmd.match(/^dbg eval (.*)$/)) {
                            var code = m[1];
                            if (this.debugSession) {
                                this.debugSession.evaluate(code);
                            }
                        }
                        else if (m = cmd.match(/^rename (\d+) (\d+) (.*)$/)) {
                            line = parseInt(m[1]);
                            col = parseInt(m[2]);
                            file = m[3];
                            this.rename(line, col, file);
                        }
                        else if (m = cmd.match(/^type (\d+) (\d+) (.*)$/)) {
                            line = parseInt(m[1]);
                            col = parseInt(m[2]);
                            file = m[3];
                            this.goToType(line, col, file);
                        }
                        else if (m = cmd.match(/^open (.*)$/)) {
                            file = m[1];
                            this.openClientFile(file);
                        }
                        else if (m = cmd.match(/^references (\d+) (\d+) (.*)$/)) {
                            line = parseInt(m[1]);
                            col = parseInt(m[2]);
                            file = m[3];
                            this.findReferences(line, col, file);
                        }
                        else if (m = cmd.match(/^quickinfo (\d+) (\d+) (.*)$/)) {
                            line = parseInt(m[1]);
                            col = parseInt(m[2]);
                            file = m[3];
                            this.quickInfo(line, col, file);
                        }
                        else if (m = cmd.match(/^format (\d+) (\d+) (\d+) (\d+) (.*)$/)) {
                            // format line col endLine endCol file
                            line = parseInt(m[1]);
                            col = parseInt(m[2]);
                            var endLine = parseInt(m[3]);
                            var endCol = parseInt(m[4]);
                            file = m[5];
                            this.format(line, col, endLine, endCol, file, cmd);
                        }
                        else if (m = cmd.match(/^formatonkey (\d+) (\d+) (\{\".*\"\})\s* (.*)$/)) {
                            line = parseInt(m[1]);
                            col = parseInt(m[2]);
                            var key = JSON.parse(m[3].substring(1, m[3].length - 1));
                            file = m[4];
                            this.formatOnKey(line, col, key, file, cmd);
                        }
                        else if (m = cmd.match(/^completions (\d+) (\d+) (\{.*\})?\s*(.*)$/)) {
                            line = parseInt(m[1]);
                            col = parseInt(m[2]);
                            var prefix = "";
                            file = m[4];
                            if (m[3]) {
                                prefix = m[3].substring(1, m[3].length - 1);
                            }
                            this.completions(line, col, prefix, file, cmd);
                        }
                        else if (m = cmd.match(/^geterr (\d+) (.*)$/)) {
                            var ms = parseInt(m[1]);
                            var rawFiles = m[2];
                            this.geterr(ms, rawFiles);
                        }
                        else if (m = cmd.match(/^change (\d+) (\d+) (\d+) (\d+) (\{\".*\"\})?\s*(.*)$/)) {
                            line = parseInt(m[1]);
                            col = parseInt(m[2]);
                            var deleteLen = parseInt(m[3]);
                            var insertLen = parseInt(m[4]);
                            var insertString: string;
                            if (insertLen) {
                                insertString = JSON.parse(m[5].substring(1, m[5].length - 1));
                            }
                            file = m[6];
                            this.change(line, col, deleteLen, insertLen, insertString, file);
                        }
                        else if (m = cmd.match(/^reload (.*) from (.*)$/)) {
                            this.reload(m[1], m[2]);
                        }
                        // TODO: change this to saveto
                        else if (m = cmd.match(/^save (.*) to (.*)$/)) {
                            this.saveToTmp(m[1], m[2]);
                        }
                        else if (m = cmd.match(/^close (.*)$/)) {
                            this.closeClientFile(m[1]);
                        }
                        else if (m = cmd.match(/^navto (\{.*\}) (.*)$/)) {
                            var searchTerm = m[1];
                            searchTerm = searchTerm.substring(1, searchTerm.length - 1);
                            this.navto(searchTerm, m[2], cmd);
                        }
                        else if (m = cmd.match(/^navbar (.*)$/)) {
                            this.navbar(m[1]);
                        }
                        else if (m = cmd.match(/^abbrev/)) {
                            this.sendAbbrev();
                        }
                        else if (m = cmd.match(/^pretty/)) {
                            this.prettyJSON = true;
                        }
                        else if (m = cmd.match(/^printproj/)) {
                            this.projectService.printProjects();
                        }
                        else if (m = cmd.match(/^fileproj (.*)$/)) {
                            file = ts.normalizePath(m[1]);
                            this.projectService.printProjectsForFile(file);
                        }
                        else {
                            this.output(undefined, 0, "Unrecognized command " + cmd);
                        }
                    }
                    catch (err) {
                        this.logError(err, cmd);
                    }
                }
            });

            rl.on('close',() => {
                this.projectService.closeLog();
                console.log("Exiting...");
                process.exit(0);
            });
        }
    }

    new Session(true).listen();
}
