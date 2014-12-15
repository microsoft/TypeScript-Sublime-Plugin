/// <reference path='node.d.ts' />
/// <reference path='_debugger.d.ts' />
/// <reference path='ed.d.ts' />

import net = require('net');
import nodeproto = require('_debugger');
import readline = require('readline');
import util = require('util');
import path=require('path');

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

    updateErrorCheck(file: string,project: Editor.Project) {
        if (this.errorTimer) {
            clearTimeout(this.errorTimer);
        }
        this.errorTimer = setTimeout(() => {
            var diags = project.compilerService.languageService.getSyntacticDiagnostics(file);
            if (diags) {
                var bakedDiags = diags.map(diag => ({
                    min: project.compilerService.host.positionToZeroBasedLineCol(file, diag.start),
                    len: diag.length,
                    text: diag.messageText,
                }));
                this.event({ fileName: file, diagnostics: bakedDiags }, "syntaxDiag");
            }
            this.errorTimer=undefined;
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
                    var completions=compilerService.languageService.getCompletionsAtPosition(file,pos,true);
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
