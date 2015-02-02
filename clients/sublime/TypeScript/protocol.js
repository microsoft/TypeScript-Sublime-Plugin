/// <reference path='../../node_modules/typescript/bin/typescript.d.ts'/>
/// <reference path='../../node_modules/typescript/bin/typescript_internal.d.ts'/>
/// <reference path='editorServices.d.ts' />
/// <reference path='node.d.ts' />
/// <reference path='_debugger.d.ts' />
var nodeproto = require('_debugger');
var readline = require('readline');
var path = require('path');
var ts = require('typescript');
var ed = require('./editorServices');
var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
});
var paddedLength = 8;
var typeNames = ["interface", "class", "enum", "module", "alias", "type"];
var spaceCache = [" ", "  ", "   ", "    "];
function generateSpaces(n) {
    if (!spaceCache[n]) {
        var strBuilder = "";
        for (var i = 0; i < n; i++) {
            strBuilder += " ";
        }
        spaceCache[n] = strBuilder;
    }
    return spaceCache[n];
}
function printObject(obj) {
    for (var p in obj) {
        if (obj.hasOwnProperty(p)) {
            console.log(p + ": " + obj[p]);
        }
    }
}
function isTypeName(name, suffix) {
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
function parseTypeName(displayParts) {
    var len = displayParts.length;
    for (var i = len - 1; i >= 0; i--) {
        if (isTypeName(displayParts[i].kind, "Name")) {
            return displayParts[i].text;
        }
    }
    return undefined;
}
function findExactMatchType(items) {
    for (var i = 0, len = items.length; i < len; i++) {
        var navItem = items[i];
        if (navItem.matchKind == "exact") {
            if (isTypeName(navItem.kind)) {
                return navItem;
            }
        }
    }
}
function compareNumber(a, b) {
    if (a < b) {
        return -1;
    }
    else if (a == b) {
        return 0;
    }
    else
        return 1;
}
function compareFileMin(a, b) {
    if (a.file < b.file) {
        return -1;
    }
    else if (a.file == b.file) {
        var n = compareNumber(a.min.line, b.min.line);
        if (n == 0) {
            return compareNumber(a.min.offset, b.min.offset);
        }
        else
            return n;
    }
    else {
        return 1;
    }
}
function sortNavItems(items) {
    return items.sort(function (a, b) {
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
    });
}
function SourceInfo(body) {
    var result = body.exception ? 'exception in ' : 'break in ';
    if (body.script) {
        if (body.script.name) {
            var name = body.script.name, dir = path.resolve() + '/';
            // Change path to relative, if possible
            if (name.indexOf(dir) === 0) {
                name = name.slice(dir.length);
            }
            result += name;
        }
        else {
            result += '[unnamed]';
        }
    }
    result += ':';
    result += body.sourceLine + 1;
    if (body.exception)
        result += '\n' + body.exception.text;
    return result;
}
var JsDebugSession = (function () {
    function JsDebugSession() {
        this.host = 'localhost';
        this.port = 5858;
        this.init();
    }
    JsDebugSession.prototype.cont = function (cb) {
        this.client.reqContinue(cb);
    };
    JsDebugSession.prototype.listSrc = function () {
        var _this = this;
        this.client.reqScripts(function (err) {
            if (err) {
                console.log("rscr error: " + err);
            }
            else {
                console.log("req scripts");
                for (var id in _this.client.scripts) {
                    var script = _this.client.scripts[id];
                    if ((typeof script === "object") && script.name) {
                        console.log(id + ": " + script.name);
                    }
                }
            }
        });
    };
    JsDebugSession.prototype.findScript = function (file) {
        if (file) {
            var script;
            var scripts = this.client.scripts;
            var keys = Object.keys(scripts);
            var ambiguous = false;
            for (var v = 0; v < keys.length; v++) {
                var id = keys[v];
                if (scripts[id] && scripts[id].name && scripts[id].name.indexOf(file) !== -1) {
                    if (script) {
                        ambiguous = true;
                    }
                    script = scripts[id];
                }
            }
            return { script: script, ambiguous: ambiguous };
        }
    };
    // TODO: condition
    JsDebugSession.prototype.setBreakpointOnLine = function (line, file) {
        if (!file) {
            file = this.client.currentScript;
        }
        var script;
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
            var brkmsg = {
                type: 'scriptId',
                target: script.id,
                line: line - 1
            };
            this.client.setBreakpoint(brkmsg, function (err, bod) {
                // TODO: remember breakpoint
                if (err) {
                    console.log("Error: set breakpoint: " + err);
                }
            });
        }
    };
    JsDebugSession.prototype.init = function () {
        var _this = this;
        var connectionAttempts = 0;
        this.client = new nodeproto.Client();
        this.client.on('break', function (res) {
            _this.handleBreak(res.body);
        });
        this.client.on('exception', function (res) {
            _this.handleBreak(res.body);
        });
        this.client.on('error', function () {
            setTimeout(function () {
                ++connectionAttempts;
                _this.client.connect(_this.port, _this.host);
            }, 500);
        });
        this.client.once('ready', function () {
        });
        this.client.on('unhandledResponse', function () {
        });
        this.client.connect(this.port, this.host);
    };
    JsDebugSession.prototype.evaluate = function (code) {
        var _this = this;
        var frame = this.client.currentFrame;
        this.client.reqFrameEval(code, frame, function (err, bod) {
            if (err) {
                console.log("Error: evaluate: " + err);
                return;
            }
            console.log("Value: " + bod.toString());
            if (typeof bod === "object") {
                printObject(bod);
            }
            // Request object by handles (and it's sub-properties)
            _this.client.mirrorObject(bod, 3, function (err, mirror) {
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
    };
    JsDebugSession.prototype.handleBreak = function (breakInfo) {
        this.client.currentSourceLine = breakInfo.sourceLine;
        this.client.currentSourceLineText = breakInfo.sourceLineText;
        this.client.currentSourceColumn = breakInfo.sourceColumn;
        this.client.currentFrame = 0;
        this.client.currentScript = breakInfo.script && breakInfo.script.name;
        console.log(SourceInfo(breakInfo));
        // TODO: watchers        
    };
    return JsDebugSession;
})();
function formatDiag(file, project, diag) {
    return {
        min: project.compilerService.host.positionToZeroBasedLineCol(file, diag.start),
        len: diag.length,
        text: diag.messageText
    };
}
function allEditsBeforePos(edits, pos) {
    for (var i = 0, len = edits.length; i < len; i++) {
        if (ts.textSpanEnd(edits[i].span) >= pos) {
            return false;
        }
    }
    return true;
}
var Session = (function () {
    function Session(useProtocol) {
        if (useProtocol === void 0) { useProtocol = false; }
        this.projectService = new ed.ProjectService();
        this.prettyJSON = false;
        this.pendingOperation = false;
        this.fileHash = {};
        this.fetchedAbbrev = false;
        this.nextFileId = 1;
        this.changeSeq = 0;
        this.initAbbrevTable();
        if (useProtocol) {
            this.initProtocol();
        }
    }
    Session.prototype.initProtocol = function () {
        var _this = this;
        this.protocol = new nodeproto.Protocol();
        // note: onResponse was named by nodejs authors; we are re-purposing the Protocol
        // class in this case so that it supports a server instead of a client
        this.protocol.onResponse = function (pkt) {
            _this.handleRequest(pkt);
        };
    };
    Session.prototype.handleRequest = function (req) {
        // TODO: so far requests always come in on stdin
    };
    Session.prototype.send = function (msg) {
        var json;
        if (this.prettyJSON) {
            json = JSON.stringify(msg, null, " ");
        }
        else {
            json = JSON.stringify(msg);
        }
        console.log('Content-Length: ' + (1 + Buffer.byteLength(json, 'utf8')) + '\r\n\r\n' + json);
    };
    Session.prototype.event = function (info, eventName) {
        var ev = {
            seq: 0,
            type: "event",
            event: eventName,
            body: info
        };
        this.send(ev);
    };
    Session.prototype.response = function (info, reqSeq, errorMsg) {
        if (reqSeq === void 0) { reqSeq = 0; }
        var res = {
            seq: 0,
            type: "response",
            request_seq: reqSeq,
            success: !errorMsg
        };
        if (!errorMsg) {
            res.body = info;
        }
        else {
            res.message = errorMsg;
        }
        this.send(res);
    };
    Session.prototype.initAbbrevTable = function () {
        this.abbrevTable = {
            name: "n",
            kind: "k",
            fileName: "f",
            containerName: "c",
            containerKind: "ck",
            min: "m",
            line: "l",
            offset: "o",
            "interface": "i",
            "function": "fn"
        };
    };
    Session.prototype.encodeFilename = function (filename) {
        var id = ts.lookUp(this.fileHash, filename);
        if (!id) {
            id = this.nextFileId++;
            this.fileHash[filename] = id;
            return { id: id, fileName: filename };
        }
        else {
            return id;
        }
    };
    Session.prototype.abbreviate = function (obj) {
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
    };
    Session.prototype.output = function (info, errorMsg) {
        if (this.protocol) {
            this.response(info, 0, errorMsg);
        }
        else if (this.prettyJSON) {
            if (!errorMsg) {
                console.log(JSON.stringify(info, null, " ").trim());
            }
            else {
                console.log(JSON.stringify(errorMsg));
            }
        }
        else {
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
    };
    Session.prototype.semanticCheck = function (file, project) {
        var diags = project.compilerService.languageService.getSemanticDiagnostics(file);
        if (diags) {
            var bakedDiags = diags.map(function (diag) { return formatDiag(file, project, diag); });
            this.event({ fileName: file, diagnostics: bakedDiags }, "semanticDiag");
        }
    };
    Session.prototype.syntacticCheck = function (file, project) {
        var diags = project.compilerService.languageService.getSyntacticDiagnostics(file);
        if (diags) {
            var bakedDiags = diags.map(function (diag) { return formatDiag(file, project, diag); });
            this.event({ fileName: file, diagnostics: bakedDiags }, "syntaxDiag");
        }
    };
    Session.prototype.errorCheck = function (file, project) {
        this.syntacticCheck(file, project);
        this.semanticCheck(file, project);
    };
    Session.prototype.updateErrorCheck = function (checkList, seq, matchSeq, ms, followMs) {
        var _this = this;
        if (ms === void 0) { ms = 1500; }
        if (followMs === void 0) { followMs = 200; }
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
        var checkOne = function () {
            if (matchSeq(seq)) {
                var checkSpec = checkList[index++];
                _this.syntacticCheck(checkSpec.filename, checkSpec.project);
                _this.immediateId = setImmediate(function () {
                    _this.semanticCheck(checkSpec.filename, checkSpec.project);
                    _this.immediateId = undefined;
                    if (checkList.length > index) {
                        _this.errorTimer = setTimeout(checkOne, followMs);
                    }
                    else {
                        _this.errorTimer = undefined;
                    }
                });
            }
        };
        if ((checkList.length > index) && (matchSeq(seq))) {
            this.errorTimer = setTimeout(checkOne, ms);
        }
    };
    Session.prototype.listen = function () {
        var _this = this;
        //console.log("up...");
        rl.on('line', function (input) {
            var cmd = input.trim();
            var line, col, file;
            var tmpfile;
            var pos;
            var m;
            var project;
            var compilerService;
            if (m = cmd.match(/^definition (\d+) (\d+) (.*)$/)) {
                line = parseInt(m[1]);
                col = parseInt(m[2]);
                file = ts.normalizePath(m[3]);
                project = _this.projectService.getProjectForFile(file);
                if (project) {
                    var compilerService = project.compilerService;
                    pos = compilerService.host.lineColToPosition(file, line, col);
                    var locs = compilerService.languageService.getDefinitionAtPosition(file, pos);
                    if (locs) {
                        var info = locs.map(function (def) { return ({
                            file: def && def.fileName,
                            min: def && compilerService.host.positionToZeroBasedLineCol(def.fileName, def.textSpan.start),
                            lim: def && compilerService.host.positionToZeroBasedLineCol(def.fileName, ts.textSpanEnd(def.textSpan))
                        }); });
                        _this.output(info[0] || null);
                    }
                    else {
                        _this.output(undefined, "could not find def");
                    }
                }
                else {
                    _this.output(undefined, "no project for " + file);
                }
            }
            else if (m = cmd.match(/^dbg start$/)) {
                _this.debugSession = new JsDebugSession();
            }
            else if (m = cmd.match(/^dbg cont$/)) {
                if (_this.debugSession) {
                    _this.debugSession.cont(function (err, body, res) {
                    });
                }
            }
            else if (m = cmd.match(/^dbg src$/)) {
                if (_this.debugSession) {
                    _this.debugSession.listSrc();
                }
            }
            else if (m = cmd.match(/^dbg brk (\d+) (.*)$/)) {
                line = parseInt(m[1]);
                file = ts.normalizePath(m[2]);
                if (_this.debugSession) {
                    _this.debugSession.setBreakpointOnLine(line, file);
                }
            }
            else if (m = cmd.match(/^dbg eval (.*)$/)) {
                var code = m[1];
                if (_this.debugSession) {
                    _this.debugSession.evaluate(code);
                }
            }
            else if (m = cmd.match(/^rename (\d+) (\d+) (.*)$/)) {
                line = parseInt(m[1]);
                col = parseInt(m[2]);
                file = ts.normalizePath(m[3]);
                project = _this.projectService.getProjectForFile(file);
                if (project) {
                    var compilerService = project.compilerService;
                    pos = compilerService.host.lineColToPosition(file, line, col);
                    var renameInfo = compilerService.languageService.getRenameInfo(file, pos);
                    if (renameInfo) {
                        if (renameInfo.canRename) {
                            var renameLocs = compilerService.languageService.findRenameLocations(file, pos, false, false);
                            if (renameLocs) {
                                var bakedRenameLocs = renameLocs.map(function (loc) { return ({
                                    file: loc.fileName,
                                    min: compilerService.host.positionToZeroBasedLineCol(loc.fileName, loc.textSpan.start),
                                    lim: compilerService.host.positionToZeroBasedLineCol(loc.fileName, ts.textSpanEnd(loc.textSpan))
                                }); }).sort(function (a, b) {
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
                                            return b.min.offset - a.min.offset;
                                        }
                                    }
                                }).reduce(function (accum, cur) {
                                    var curFileAccum;
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
                                _this.output({ info: renameInfo, locs: bakedRenameLocs });
                            }
                            else {
                                _this.output([]);
                            }
                        }
                        else {
                            _this.output(undefined, renameInfo.localizedErrorMessage);
                        }
                    }
                    else {
                        _this.output(undefined, "no rename information at cursor");
                    }
                }
            }
            else if (m = cmd.match(/^type (\d+) (\d+) (.*)$/)) {
                line = parseInt(m[1]);
                col = parseInt(m[2]);
                file = ts.normalizePath(m[3]);
                project = _this.projectService.getProjectForFile(file);
                if (project) {
                    var compilerService = project.compilerService;
                    pos = compilerService.host.lineColToPosition(file, line, col);
                    var quickInfo = compilerService.languageService.getQuickInfoAtPosition(file, pos);
                    var typeLoc;
                    if (quickInfo && (quickInfo.kind == "var") || (quickInfo.kind == "local var")) {
                        var typeName = parseTypeName(quickInfo.displayParts);
                        if (typeName) {
                            var navItems = compilerService.languageService.getNavigateToItems(typeName);
                            var navItem = findExactMatchType(navItems);
                            if (navItem) {
                                typeLoc = {
                                    fileName: navItem.fileName,
                                    min: compilerService.host.positionToZeroBasedLineCol(navItem.fileName, navItem.textSpan.start)
                                };
                            }
                        }
                    }
                    if (typeLoc) {
                        _this.output(typeLoc);
                    }
                    else {
                        _this.output(undefined, "no info at this location");
                    }
                }
                else {
                    _this.output(undefined, "no project for " + file);
                }
            }
            else if (m = cmd.match(/^open (.*)$/)) {
                file = ts.normalizePath(m[1]);
                _this.projectService.openSpecifiedFile(file);
            }
            else if (m = cmd.match(/^references (\d+) (\d+) (.*)$/)) {
                line = parseInt(m[1]);
                col = parseInt(m[2]);
                file = ts.normalizePath(m[3]);
                // TODO: get all projects for this file; report refs for all projects deleting duplicates
                // can avoid duplicates by eliminating same ref file from subsequent projects
                project = _this.projectService.getProjectForFile(file);
                if (project) {
                    compilerService = project.compilerService;
                    pos = compilerService.host.lineColToPosition(file, line, col);
                    var refs = compilerService.languageService.getReferencesAtPosition(file, pos);
                    if (refs) {
                        var nameInfo = compilerService.languageService.getQuickInfoAtPosition(file, pos);
                        if (nameInfo) {
                            var displayString = ts.displayPartsToString(nameInfo.displayParts);
                            var nameSpan = nameInfo.textSpan;
                            var nameColStart = compilerService.host.positionToZeroBasedLineCol(file, nameSpan.start).offset;
                            var nameText = compilerService.host.getScriptSnapshot(file).getText(nameSpan.start, ts.textSpanEnd(nameSpan));
                            var bakedRefs = refs.map(function (ref) {
                                var min = compilerService.host.positionToZeroBasedLineCol(ref.fileName, ref.textSpan.start);
                                var refLineSpan = compilerService.host.lineToTextSpan(ref.fileName, min.line);
                                var snap = compilerService.host.getScriptSnapshot(ref.fileName);
                                var lineText = snap.getText(refLineSpan.start, ts.textSpanEnd(refLineSpan)).replace(/\r|\n/g, "");
                                return {
                                    file: ref.fileName,
                                    min: min,
                                    lineText: lineText,
                                    lim: compilerService.host.positionToZeroBasedLineCol(ref.fileName, ts.textSpanEnd(ref.textSpan))
                                };
                            }).sort(compareFileMin);
                            _this.output([bakedRefs, nameText, nameColStart, displayString]);
                        }
                        else {
                            _this.output(undefined, "no references at this position");
                        }
                    }
                    else {
                        _this.output(undefined, "no references at this position");
                    }
                }
            }
            else if (m = cmd.match(/^quickinfo (\d+) (\d+) (.*)$/)) {
                line = parseInt(m[1]);
                col = parseInt(m[2]);
                file = ts.normalizePath(m[3]);
                project = _this.projectService.getProjectForFile(file);
                if (project) {
                    compilerService = project.compilerService;
                    pos = compilerService.host.lineColToPosition(file, line, col);
                    var quickInfo = compilerService.languageService.getQuickInfoAtPosition(file, pos);
                    if (quickInfo) {
                        var displayString = ts.displayPartsToString(quickInfo.displayParts);
                        var docString = ts.displayPartsToString(quickInfo.documentation);
                        _this.output({
                            info: displayString,
                            doc: docString
                        });
                    }
                    else {
                        _this.output(undefined, "no info");
                    }
                }
            }
            else if (m = cmd.match(/^format (\d+) (\d+) (\d+) (\d+) (.*)$/)) {
                // format line col endLine endCol file
                line = parseInt(m[1]);
                col = parseInt(m[2]);
                var endLine = parseInt(m[3]);
                var endCol = parseInt(m[4]);
                file = ts.normalizePath(m[5]);
                project = _this.projectService.getProjectForFile(file);
                if (project) {
                    compilerService = project.compilerService;
                    pos = compilerService.host.lineColToPosition(file, line, col);
                    var endPos = compilerService.host.lineColToPosition(file, endLine, endCol);
                    var edits;
                    // TODO: avoid duplicate code (with formatonkey)
                    try {
                        edits = compilerService.languageService.getFormattingEditsForRange(file, pos, endPos, compilerService.formatCodeOptions);
                    }
                    catch (err) {
                        edits = undefined;
                    }
                    if (edits) {
                        var bakedEdits = edits.map(function (edit) {
                            return {
                                min: compilerService.host.positionToZeroBasedLineCol(file, edit.span.start),
                                lim: compilerService.host.positionToZeroBasedLineCol(file, ts.textSpanEnd(edit.span)),
                                newText: edit.newText ? edit.newText : ""
                            };
                        });
                        _this.output(bakedEdits);
                    }
                    else {
                        _this.output(undefined, "no edits");
                    }
                }
            }
            else if (m = cmd.match(/^formatonkey (\d+) (\d+) (\{\".*\"\})\s* (.*)$/)) {
                line = parseInt(m[1]);
                col = parseInt(m[2]);
                file = ts.normalizePath(m[4]);
                project = _this.projectService.getProjectForFile(file);
                if (project) {
                    compilerService = project.compilerService;
                    pos = compilerService.host.lineColToPosition(file, line, col);
                    var key = JSON.parse(m[3].substring(1, m[3].length - 1));
                    var edits;
                    try {
                        edits = compilerService.languageService.getFormattingEditsAfterKeystroke(file, pos, key, compilerService.formatCodeOptions);
                        if ((key == "\n") && ((!edits) || (edits.length == 0) || allEditsBeforePos(edits, pos))) {
                            // TODO: get this from host
                            var editorOptions = {
                                IndentSize: 4,
                                TabSize: 4,
                                NewLineCharacter: "\n",
                                ConvertTabsToSpaces: true
                            };
                            var indentPosition = compilerService.languageService.getIndentationAtPosition(file, pos, editorOptions);
                            var spaces = generateSpaces(indentPosition);
                            if (indentPosition > 0) {
                                edits.push({ span: ts.createTextSpanFromBounds(pos, pos), newText: spaces });
                            }
                        }
                    }
                    catch (err) {
                        edits = undefined;
                    }
                    if (edits) {
                        var bakedEdits = edits.map(function (edit) {
                            return {
                                min: compilerService.host.positionToZeroBasedLineCol(file, edit.span.start),
                                lim: compilerService.host.positionToZeroBasedLineCol(file, ts.textSpanEnd(edit.span)),
                                newText: edit.newText ? edit.newText : ""
                            };
                        });
                        _this.output(bakedEdits);
                    }
                    else {
                        _this.output(undefined, "no edits");
                    }
                }
            }
            else if (m = cmd.match(/^completions (\d+) (\d+) (\{.*\})?\s*(.*)$/)) {
                line = parseInt(m[1]);
                col = parseInt(m[2]);
                var prefix = "";
                file = ts.normalizePath(m[4]);
                if (m[3]) {
                    prefix = m[3].substring(1, m[3].length - 1);
                }
                project = _this.projectService.getProjectForFile(file);
                var completions = undefined;
                if (project) {
                    compilerService = project.compilerService;
                    pos = compilerService.host.lineColToPosition(file, line, col);
                    if (pos >= 0) {
                        try {
                            completions = compilerService.languageService.getCompletionsAtPosition(file, pos);
                        }
                        catch (err) {
                            completions = undefined;
                        }
                        if (completions) {
                            var compressedEntries = completions.entries.reduce(function (accum, entry) {
                                if (entry.name.indexOf(prefix) == 0) {
                                    var protoEntry = {};
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
                            _this.output(compressedEntries);
                        }
                    }
                }
                if (!completions) {
                    _this.output(undefined, "no completions");
                }
            }
            else if (m = cmd.match(/^geterr (\d+) (.*)$/)) {
                var ms = parseInt(m[1]);
                var rawFiles = m[2];
                var files = rawFiles.split(';');
                var checkList = files.reduce(function (accum, filename) {
                    filename = ts.normalizePath(filename);
                    project = _this.projectService.getProjectForFile(filename);
                    if (project) {
                        accum.push({ filename: filename, project: project });
                    }
                    return accum;
                }, []);
                if (checkList.length > 0) {
                    _this.updateErrorCheck(checkList, _this.changeSeq, function (n) { return n == _this.changeSeq; }, ms);
                }
            }
            else if (m = cmd.match(/^change (\d+) (\d+) (\d+) (\d+) (\{\".*\"\})?\s*(.*)$/)) {
                line = parseInt(m[1]);
                col = parseInt(m[2]);
                var deleteLen = parseInt(m[3]);
                var insertLen = parseInt(m[4]);
                var insertString;
                if (insertLen) {
                    insertString = JSON.parse(m[5].substring(1, m[5].length - 1));
                }
                file = ts.normalizePath(m[6]);
                project = _this.projectService.getProjectForFile(file);
                if (project) {
                    compilerService = project.compilerService;
                    pos = compilerService.host.lineColToPosition(file, line, col);
                    if (pos >= 0) {
                        var checkRefs = false;
                        endLine = compilerService.host.positionToZeroBasedLineCol(file, pos + deleteLen).line + 1;
                        if ((endLine == line) && ((!insertString) || (0 > insertString.indexOf('\n')))) {
                            checkRefs = compilerService.host.lineAffectsRefs(file, line);
                        }
                        else {
                            checkRefs = true;
                        }
                        compilerService.host.editScript(file, pos, pos + deleteLen, insertString);
                        if (!checkRefs) {
                            checkRefs = compilerService.host.lineAffectsRefs(file, line);
                        }
                        if (checkRefs) {
                        }
                        _this.changeSeq++;
                    }
                }
            }
            else if (m = cmd.match(/^reload (.*) from (.*)$/)) {
                file = ts.normalizePath(m[1]);
                tmpfile = ts.normalizePath(m[2]);
                project = _this.projectService.getProjectForFile(file);
                if (project) {
                    _this.changeSeq++;
                    // make sure no changes happen before this one is finished
                    project.compilerService.host.reloadScript(file, tmpfile, function () {
                        _this.output({ ack: true });
                    });
                }
            }
            else if (m = cmd.match(/^save (.*) to (.*)$/)) {
                file = ts.normalizePath(m[1]);
                tmpfile = ts.normalizePath(m[2]);
                project = _this.projectService.getProjectForFile(file);
                if (project) {
                    project.compilerService.host.saveTo(file, tmpfile);
                }
            }
            else if (m = cmd.match(/^navto (\{.*\}) (.*)$/)) {
                var searchTerm = m[1];
                searchTerm = searchTerm.substring(1, searchTerm.length - 1);
                file = ts.normalizePath(m[2]);
                project = _this.projectService.getProjectForFile(file);
                if (project) {
                    compilerService = project.compilerService;
                    var navItems;
                    var cancellationToken = compilerService.host.getCancellationToken();
                    if (_this.pendingOperation) {
                        cancellationToken.cancel();
                        cancellationToken.reset();
                    }
                    try {
                        _this.pendingOperation = true;
                        navItems = sortNavItems(compilerService.languageService.getNavigateToItems(searchTerm));
                    }
                    catch (err) {
                        navItems = undefined;
                    }
                    _this.pendingOperation = false;
                    if (navItems) {
                        var bakedNavItems = navItems.map(function (navItem) {
                            var min = compilerService.host.positionToZeroBasedLineCol(navItem.fileName, navItem.textSpan.start);
                            _this.abbreviate(min);
                            var bakedItem = {
                                name: navItem.name,
                                kind: navItem.kind,
                                fileName: _this.encodeFilename(navItem.fileName),
                                min: min
                            };
                            if (navItem.containerName && (navItem.containerName.length > 0)) {
                                bakedItem.containerName = navItem.containerName;
                            }
                            if (navItem.containerKind && (navItem.containerKind.length > 0)) {
                                bakedItem.containerKind = navItem.containerKind;
                            }
                            _this.abbreviate(bakedItem);
                            return bakedItem;
                        });
                        _this.output(bakedNavItems);
                    }
                    else {
                        _this.output(undefined, "no nav items");
                    }
                }
            }
            else if (m = cmd.match(/^abbrev/)) {
                _this.fetchedAbbrev = true;
                _this.output(_this.abbrevTable);
            }
            else if (m = cmd.match(/^pretty/)) {
                _this.prettyJSON = true;
            }
            else if (m = cmd.match(/^printproj/)) {
                _this.projectService.printProjects();
            }
            else if (m = cmd.match(/^fileproj (.*)$/)) {
                file = ts.normalizePath(m[1]);
                _this.projectService.printProjectsForFile(file);
            }
            else {
                _this.output(undefined, "Unrecognized command " + cmd);
            }
        });
        rl.on('close', function () {
            console.log("Exiting...");
            process.exit(0);
        });
    };
    return Session;
})();
new Session(true).listen();
