/// <reference path='../../node_modules/typescript/bin/typescript.d.ts'/>
/// <reference path='../../node_modules/typescript/bin/typescript_internal.d.ts'/>
/// <reference path='node.d.ts' />
var __extends = this.__extends || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
};
var ts = require('typescript');
var fs = require('fs');
var measurePerf = false;
var lineCollectionCapacity = 4;
var indentStrings = [];
var indentBase = "    ";
function getIndent(indentAmt) {
    if (!indentStrings[indentAmt]) {
        indentStrings[indentAmt] = "";
        for (var i = 0; i < indentAmt; i++) {
            indentStrings[indentAmt] += indentBase;
        }
    }
    return indentStrings[indentAmt];
}
function printLine(s) {
    ts.sys.write(s + '\n');
}
exports.printLine = printLine;
function showLines(s) {
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
function calibrateTimer() {
    var count = 20;
    var total = 0;
    for (var i = 0; i < count; i++) {
        var start = process.hrtime();
        var elapsed = process.hrtime(start);
        var elapsedNano = 1e9 * elapsed[0] + elapsed[1];
        total += elapsedNano;
    }
    exports.logger.msg("Estimated precision of high-res timer: " + (total / count).toFixed(3) + " nanoseconds", "Perf");
}
function getModififedTime(filename) {
    if (measurePerf) {
        var start = process.hrtime();
    }
    var stats = fs.statSync(filename);
    if (!stats) {
        exports.logger.msg("Stat returned undefined for " + filename);
    }
    if (measurePerf) {
        var elapsed = process.hrtime(start);
        var elapsedNano = 1e9 * elapsed[0] + elapsed[1];
        exports.logger.msg("Elapsed time for stat (in nanoseconds)" + filename + ": " + elapsedNano.toString(), "Perf");
    }
    return stats.mtime;
}
var ScriptInfo = (function () {
    function ScriptInfo(filename, content, isOpen) {
        if (isOpen === void 0) { isOpen = false; }
        this.filename = filename;
        this.content = content;
        this.isOpen = isOpen;
        this.children = []; // files referenced by this file
        this.svc = ScriptVersionCache.fromString(content);
        if (!isOpen) {
            this.mtime = getModififedTime(filename);
        }
    }
    ScriptInfo.prototype.close = function () {
        this.isOpen = false;
        this.mtime = getModififedTime(this.filename);
    };
    ScriptInfo.prototype.addChild = function (childInfo) {
        this.children.push(childInfo);
    };
    ScriptInfo.prototype.snap = function () {
        return this.svc.getSnapshot();
    };
    ScriptInfo.prototype.getText = function () {
        var snap = this.snap();
        return snap.getText(0, snap.getLength());
    };
    ScriptInfo.prototype.getLineInfo = function (line) {
        var snap = this.snap();
        return snap.index.lineNumberToInfo(line);
    };
    ScriptInfo.prototype.editContent = function (minChar, limChar, newText) {
        this.svc.edit(minChar, limChar - minChar, newText);
    };
    ScriptInfo.prototype.getTextChangeRangeBetweenVersions = function (startVersion, endVersion) {
        return this.svc.getTextChangesBetweenVersions(startVersion, endVersion);
    };
    ScriptInfo.prototype.getChangeRange = function (oldSnapshot) {
        return this.snap().getChangeRange(oldSnapshot);
    };
    return ScriptInfo;
})();
exports.ScriptInfo = ScriptInfo;
var CancellationToken = (function () {
    function CancellationToken() {
        this.requestPending = false;
    }
    CancellationToken.prototype.cancel = function () {
        this.requestPending = true;
    };
    CancellationToken.prototype.reset = function () {
        this.requestPending = false;
    };
    CancellationToken.prototype.isCancellationRequested = function () {
        var temp = this.requestPending;
        return temp;
    };
    CancellationToken.None = new CancellationToken();
    return CancellationToken;
})();
exports.CancellationToken = CancellationToken;
function padStringRight(str, padding) {
    return (str + padding).slice(0, padding.length);
}
var Logger = (function () {
    function Logger(logFilename) {
        this.logFilename = logFilename;
        this.fd = -1;
        this.seq = 0;
        this.inGroup = false;
        this.firstInGroup = true;
    }
    Logger.prototype.close = function () {
        if (this.fd >= 0) {
            fs.close(this.fd);
        }
    };
    Logger.prototype.perftrc = function (s) {
        this.msg(s, "Perf");
    };
    Logger.prototype.info = function (s) {
        this.msg(s, "Info");
    };
    Logger.prototype.startGroup = function () {
        this.inGroup = true;
        this.firstInGroup = true;
    };
    Logger.prototype.endGroup = function () {
        this.inGroup = false;
        this.seq++;
        this.firstInGroup = true;
    };
    Logger.prototype.msg = function (s, type) {
        if (type === void 0) { type = "Err"; }
        if (this.fd < 0) {
            this.fd = fs.openSync(this.logFilename, "w");
        }
        if (this.fd >= 0) {
            s = s + "\n";
            var prefix = padStringRight(type + " " + this.seq.toString(), "          ");
            if (this.firstInGroup) {
                s = prefix + s;
                this.firstInGroup = false;
            }
            if (!this.inGroup) {
                this.seq++;
                this.firstInGroup = true;
            }
            var buf = new Buffer(s);
            fs.writeSync(this.fd, buf, 0, buf.length, null);
        }
    };
    return Logger;
})();
exports.Logger = Logger;
// this places log file in the directory containing editorServices.js
// TODO: check that this location is writable
exports.logger = new Logger(__dirname + "/.log" + process.pid.toString());
var LSHost = (function () {
    function LSHost(project, cancellationToken) {
        if (cancellationToken === void 0) { cancellationToken = CancellationToken.None; }
        this.project = project;
        this.cancellationToken = cancellationToken;
        this.ls = null;
        this.filenameToScript = {};
    }
    LSHost.prototype.getDefaultLibFilename = function () {
        var nodeModuleBinDir = ts.getDirectoryPath(ts.normalizePath(ts.sys.getExecutingFilePath()));
        if (this.compilationSettings && this.compilationSettings.target == 2 /* ES6 */) {
            return nodeModuleBinDir + "/lib.es6.d.ts";
        }
        else {
            return nodeModuleBinDir + "/lib.d.ts";
        }
    };
    LSHost.prototype.cancel = function () {
        this.cancellationToken.cancel();
    };
    LSHost.prototype.reset = function () {
        this.cancellationToken.reset();
    };
    LSHost.prototype.getScriptSnapshot = function (filename) {
        var scriptInfo = this.getScriptInfo(filename);
        if (scriptInfo) {
            return scriptInfo.snap();
        }
    };
    LSHost.prototype.setCompilationSettings = function (opt) {
        this.compilationSettings = opt;
    };
    LSHost.prototype.lineAffectsRefs = function (filename, line) {
        var info = this.getScriptInfo(filename);
        var lineInfo = info.getLineInfo(line);
        if (lineInfo && lineInfo.text) {
            var regex = /reference|import|\/\*|\*\//;
            return regex.test(lineInfo.text);
        }
    };
    LSHost.prototype.getCompilationSettings = function () {
        // change this to return active project settings for file
        return this.compilationSettings;
    };
    LSHost.prototype.getScriptFileNames = function () {
        var filenames = [];
        for (var filename in this.filenameToScript) {
            if (this.filenameToScript[filename] && this.filenameToScript[filename].isOpen) {
                filenames.push(filename);
            }
        }
        return filenames;
    };
    LSHost.prototype.getScriptVersion = function (filename) {
        return this.getScriptInfo(filename).svc.latestVersion().toString();
    };
    LSHost.prototype.getCancellationToken = function () {
        return this.cancellationToken;
    };
    LSHost.prototype.getCurrentDirectory = function () {
        return "";
    };
    LSHost.prototype.getScriptIsOpen = function (filename) {
        return this.getScriptInfo(filename).isOpen;
    };
    LSHost.prototype.removeReferencedFile = function (info) {
        if (!info.isOpen) {
            this.filenameToScript[info.filename] = undefined;
        }
    };
    LSHost.prototype.getScriptInfo = function (filename) {
        var scriptInfo = ts.lookUp(this.filenameToScript, filename);
        if (!scriptInfo) {
            scriptInfo = this.project.openReferencedFile(filename);
            if (scriptInfo) {
                this.filenameToScript[scriptInfo.filename] = scriptInfo;
            }
        }
        else {
        }
        return scriptInfo;
    };
    LSHost.prototype.addRoot = function (info) {
        var scriptInfo = ts.lookUp(this.filenameToScript, info.filename);
        if (!scriptInfo) {
            this.filenameToScript[info.filename] = info;
            return info;
        }
    };
    LSHost.prototype.saveTo = function (filename, tmpfilename) {
        var script = this.getScriptInfo(filename);
        if (script) {
            var snap = script.snap();
            ts.sys.writeFile(tmpfilename, snap.getText(0, snap.getLength()));
        }
    };
    LSHost.prototype.reloadScript = function (filename, tmpfilename, cb) {
        var script = this.getScriptInfo(filename);
        if (script) {
            script.svc.reloadFromFile(tmpfilename, cb);
        }
    };
    LSHost.prototype.editScript = function (filename, minChar, limChar, newText) {
        var script = this.getScriptInfo(filename);
        if (script) {
            script.editContent(minChar, limChar, newText);
            return;
        }
        throw new Error("No script with name '" + filename + "'");
    };
    LSHost.prototype.resolvePath = function (path) {
        var start = new Date().getTime();
        var result = ts.sys.resolvePath(path);
        return result;
    };
    LSHost.prototype.fileExists = function (path) {
        var start = new Date().getTime();
        var result = ts.sys.fileExists(path);
        return result;
    };
    LSHost.prototype.directoryExists = function (path) {
        return ts.sys.directoryExists(path);
    };
    /**
     *  @param line 1 based index
     */
    LSHost.prototype.lineToTextSpan = function (filename, line) {
        var script = this.filenameToScript[filename];
        var index = script.snap().index;
        var lineInfo = index.lineNumberToInfo(line + 1);
        var len;
        if (lineInfo.leaf) {
            len = lineInfo.leaf.text.length;
        }
        else {
            var nextLineInfo = index.lineNumberToInfo(line + 2);
            len = nextLineInfo.col - lineInfo.col;
        }
        return ts.createTextSpan(lineInfo.col, len);
    };
    /**
     * @param line 1 based index
     * @param col 1 based index
     */
    LSHost.prototype.lineColToPosition = function (filename, line, col) {
        var script = this.filenameToScript[filename];
        var index = script.snap().index;
        var lineInfo = index.lineNumberToInfo(line);
        // TODO: assert this column is actually on the line
        return (lineInfo.col + col - 1);
    };
    /**
     * @param line 1-based index
     * @param col 1-based index
     */
    LSHost.prototype.positionToLineCol = function (filename, position) {
        var script = this.filenameToScript[filename];
        var index = script.snap().index;
        var lineCol = index.charOffsetToLineNumberAndPos(position);
        return { line: lineCol.line, col: lineCol.col + 1 };
    };
    return LSHost;
})();
exports.LSHost = LSHost;
function getCanonicalFileName(filename) {
    if (ts.sys.useCaseSensitiveFileNames) {
        return filename;
    }
    else {
        return filename.toLowerCase();
    }
}
// assumes normalized paths
function getAbsolutePath(filename, directory) {
    var rootLength = ts.getRootLength(filename);
    if (rootLength > 0) {
        return filename;
    }
    else {
        var splitFilename = filename.split('/');
        var splitDir = directory.split('/');
        var i = 0;
        var dirTail = 0;
        var sflen = splitFilename.length;
        while ((i < sflen) && (splitFilename[i].charAt(0) == '.')) {
            var dots = splitFilename[i];
            if (dots == '..') {
                dirTail++;
            }
            else if (dots != '.') {
                return undefined;
            }
            i++;
        }
        return splitDir.slice(0, splitDir.length - dirTail).concat(splitFilename.slice(i)).join('/');
    }
}
var Project = (function () {
    function Project(projectService) {
        this.projectService = projectService;
        this.filenameToSourceFile = {};
        this.updateGraphSeq = 0;
        this.compilerService = new CompilerService(this);
    }
    Project.prototype.openReferencedFile = function (filename) {
        return this.projectService.openFile(filename, false);
    };
    Project.prototype.getSourceFile = function (info) {
        return this.filenameToSourceFile[info.filename];
    };
    Project.prototype.getSourceFileFromName = function (filename) {
        var info = this.projectService.getScriptInfo(filename);
        if (info) {
            return this.getSourceFile(info);
        }
    };
    Project.prototype.removeReferencedFile = function (info) {
        this.compilerService.host.removeReferencedFile(info);
        this.updateGraph();
    };
    Project.prototype.updateFileMap = function () {
        this.filenameToSourceFile = {};
        var sourceFiles = this.program.getSourceFiles();
        for (var i = 0, len = sourceFiles.length; i < len; i++) {
            var normFilename = ts.normalizePath(sourceFiles[i].filename);
            this.filenameToSourceFile[normFilename] = sourceFiles[i];
        }
    };
    Project.prototype.finishGraph = function () {
        this.updateGraph();
        this.compilerService.languageService.getNavigateToItems(".*");
    };
    Project.prototype.updateGraph = function () {
        this.program = this.compilerService.languageService.getProgram();
        this.updateFileMap();
    };
    Project.prototype.isConfiguredProject = function () {
        return this.projectFilename;
    };
    // add a root file to project
    Project.prototype.addRoot = function (info) {
        info.defaultProject = this;
        return this.compilerService.host.addRoot(info);
    };
    Project.prototype.filesToString = function () {
        var strBuilder = "";
        ts.forEachValue(this.filenameToSourceFile, function (sourceFile) {
            strBuilder += sourceFile.filename + "\n";
        });
        return strBuilder;
    };
    Project.prototype.setProjectOptions = function (projectOptions) {
        this.projectOptions = projectOptions;
        if (projectOptions.compilerOptions) {
            this.compilerService.setCompilerOptions(projectOptions.compilerOptions);
        }
        if (projectOptions.formatCodeOptions) {
            this.compilerService.setFormatCodeOptions(projectOptions.formatCodeOptions);
        }
    };
    return Project;
})();
exports.Project = Project;
function copyListRemovingItem(item, list) {
    var copiedList = [];
    for (var i = 0, len = list.length; i < len; i++) {
        if (list[i] != item) {
            copiedList.push(list[i]);
        }
    }
    return copiedList;
}
// REVIEW: for now this implementation uses polling.
// The advantage of polling is that it works reliably
// on all os and with network mounted files.
// For 90 referenced files, the average time to detect 
// changes is 2*msInterval (by default 5 seconds).
// The overhead of this is .04 percent (1/2500) with
// average pause of < 1 millisecond (and max
// pause less than 1.5 milliseconds); question is
// do we anticipate reference sets in the 100s and
// do we care about waiting 10-20 seconds to detect
// changes for large reference sets? If so, do we want
// to increase the chunk size or decrease the interval
// time dynamically to match the large reference set?
var WatchedFileSet = (function () {
    // average async stat takes about 30 microseconds
    // set chunk size to do 30 files in < 1 millisecond
    function WatchedFileSet(fileEvent, msInterval, chunkSize) {
        if (msInterval === void 0) { msInterval = 2500; }
        if (chunkSize === void 0) { chunkSize = 30; }
        this.fileEvent = fileEvent;
        this.msInterval = msInterval;
        this.chunkSize = chunkSize;
        this.watchedFiles = [];
        this.nextFileToCheck = 0;
    }
    WatchedFileSet.prototype.checkWatchedFileChanged = function (checkedIndex, stats) {
        var info = this.watchedFiles[checkedIndex];
        if (info && (!info.isOpen)) {
            if (info.mtime.getTime() != stats.mtime.getTime()) {
                exports.logger.msg(info.filename + " changed");
                info.svc.reloadFromFile(info.filename);
            }
        }
    };
    WatchedFileSet.prototype.fileDeleted = function (info) {
        if (this.fileEvent) {
            this.fileEvent(info, "deleted");
        }
    };
    WatchedFileSet.prototype.poll = function (checkedIndex) {
        var _this = this;
        var watchedFile = this.watchedFiles[checkedIndex];
        if (!watchedFile) {
            return;
        }
        if (measurePerf) {
            var start = process.hrtime();
        }
        fs.stat(watchedFile.filename, function (err, stats) {
            if (err) {
                var msg = err.message;
                if (err.errno) {
                    msg += " errno: " + err.errno.toString();
                }
                exports.logger.msg("Error " + msg + " in stat for file " + watchedFile.filename);
                if (err.errno == WatchedFileSet.fileDeleted) {
                    _this.fileDeleted(watchedFile);
                }
            }
            else {
                _this.checkWatchedFileChanged(checkedIndex, stats);
            }
        });
        if (measurePerf) {
            var elapsed = process.hrtime(start);
            var elapsedNano = 1e9 * elapsed[0] + elapsed[1];
            exports.logger.msg("Elapsed time for async stat (in nanoseconds)" + watchedFile.filename + ": " + elapsedNano.toString(), "Perf");
        }
    };
    // this implementation uses polling and
    // stat due to inconsistencies of fs.watch
    // and efficiency of stat on modern filesystems
    WatchedFileSet.prototype.startWatchTimer = function () {
        var _this = this;
        exports.logger.msg("Start watch timer: " + this.chunkSize.toString(), "Info");
        this.watchTimer = setInterval(function () {
            var count = 0;
            var nextToCheck = _this.nextFileToCheck;
            var firstCheck = -1;
            while ((count < _this.chunkSize) && (nextToCheck != firstCheck)) {
                _this.poll(nextToCheck);
                if (firstCheck < 0) {
                    firstCheck = nextToCheck;
                }
                nextToCheck++;
                if (nextToCheck == _this.watchedFiles.length) {
                    nextToCheck = 0;
                }
                count++;
            }
            _this.nextFileToCheck = nextToCheck;
        }, this.msInterval);
    };
    // TODO: remove watch file if opened by editor or no longer referenced 
    // assume normalized and absolute pathname
    WatchedFileSet.prototype.addFile = function (info) {
        this.watchedFiles.push(info);
        if (this.watchedFiles.length == 1) {
            this.startWatchTimer();
        }
    };
    WatchedFileSet.prototype.removeFile = function (info) {
        this.watchedFiles = copyListRemovingItem(info, this.watchedFiles);
    };
    WatchedFileSet.fileDeleted = 34;
    return WatchedFileSet;
})();
exports.WatchedFileSet = WatchedFileSet;
var ProjectService = (function () {
    function ProjectService(eventHandler) {
        var _this = this;
        this.eventHandler = eventHandler;
        this.filenameToScriptInfo = {};
        // open, non-configured files in two lists
        this.openFileRoots = [];
        this.openFilesReferenced = [];
        // projects covering open files
        this.inferredProjects = [];
        this.psLogger = exports.logger;
        if (measurePerf) {
            calibrateTimer();
        }
        ts.disableIncrementalParsing = true;
        this.watchedFileSet = new WatchedFileSet(function (info, eventName) {
            if (eventName == "deleted") {
                _this.fileDeletedInFilesystem(info);
            }
        });
    }
    ProjectService.prototype.log = function (msg, type) {
        if (type === void 0) { type = "Err"; }
        this.psLogger.msg(msg, type);
    };
    ProjectService.prototype.closeLog = function () {
        this.psLogger.close();
    };
    ProjectService.prototype.createInferredProject = function (root) {
        var iproj = new Project(this);
        iproj.addRoot(root);
        iproj.finishGraph();
        this.inferredProjects.push(iproj);
        return iproj;
    };
    ProjectService.prototype.fileDeletedInFilesystem = function (info) {
        this.psLogger.info(info.filename + " deleted");
        this.watchedFileSet.removeFile(info);
        if (!info.isOpen) {
            this.filenameToScriptInfo[info.filename] = undefined;
            var referencingProjects = this.findReferencingProjects(info);
            for (var i = 0, len = referencingProjects.length; i < len; i++) {
                referencingProjects[i].removeReferencedFile(info);
            }
        }
        this.printProjects();
    };
    ProjectService.prototype.addOpenFile = function (info) {
        this.findReferencingProjects(info);
        if (info.defaultProject) {
            this.openFilesReferenced.push(info);
        }
        else {
            // create new inferred project p with the newly opened file as root
            info.defaultProject = this.createInferredProject(info);
            var openFileRoots = [];
            // for each inferred project root r
            for (var i = 0, len = this.openFileRoots.length; i < len; i++) {
                var r = this.openFileRoots[i];
                // if r referenced by the new project
                if (info.defaultProject.getSourceFile(r)) {
                    // remove project rooted at r
                    this.inferredProjects = copyListRemovingItem(r.defaultProject, this.inferredProjects);
                    // put r in referenced open file list
                    this.openFilesReferenced.push(r);
                    // set default project of r to the new project 
                    r.defaultProject = info.defaultProject;
                }
                else {
                    // otherwise, keep r as root of inferred project
                    openFileRoots.push(r);
                }
            }
            this.openFileRoots = openFileRoots;
            this.openFileRoots.push(info);
        }
    };
    ProjectService.prototype.closeOpenFile = function (info) {
        var openFileRoots = [];
        var removedProject;
        for (var i = 0, len = this.openFileRoots.length; i < len; i++) {
            // if closed file is root of project
            if (info == this.openFileRoots[i]) {
                // remove that project and remember it
                removedProject = info.defaultProject;
            }
            else {
                openFileRoots.push(this.openFileRoots[i]);
            }
        }
        this.openFileRoots = openFileRoots;
        if (removedProject) {
            // remove project from inferred projects list
            this.inferredProjects = copyListRemovingItem(removedProject, this.inferredProjects);
            var openFilesReferenced = [];
            var orphanFiles = [];
            // for all open, referenced files f
            for (var i = 0, len = this.openFilesReferenced.length; i < len; i++) {
                var f = this.openFilesReferenced[i];
                // if f was referenced by the removed project, remember it
                if (f.defaultProject == removedProject) {
                    f.defaultProject = undefined;
                    orphanFiles.push(f);
                }
                else {
                    // otherwise add it back to the list of referenced files
                    openFilesReferenced.push(f);
                }
            }
            this.openFilesReferenced = openFilesReferenced;
            // treat orphaned files as newly opened
            for (var i = 0, len = orphanFiles.length; i < len; i++) {
                this.addOpenFile(orphanFiles[i]);
            }
        }
        else {
            this.openFilesReferenced = copyListRemovingItem(info, this.openFilesReferenced);
        }
        info.close();
    };
    ProjectService.prototype.findReferencingProjects = function (info) {
        var referencingProjects = [];
        info.defaultProject = undefined;
        for (var i = 0, len = this.inferredProjects.length; i < len; i++) {
            this.inferredProjects[i].updateGraph();
            if (this.inferredProjects[i].getSourceFile(info)) {
                info.defaultProject = this.inferredProjects[i];
                referencingProjects.push(this.inferredProjects[i]);
            }
        }
        return referencingProjects;
    };
    ProjectService.prototype.getScriptInfo = function (filename) {
        filename = ts.normalizePath(filename);
        return ts.lookUp(this.filenameToScriptInfo, filename);
    };
    /**
     * @param filename is absolute pathname
     */
    ProjectService.prototype.openFile = function (filename, openedByClient) {
        if (openedByClient === void 0) { openedByClient = false; }
        filename = ts.normalizePath(filename);
        var info = ts.lookUp(this.filenameToScriptInfo, filename);
        if (!info) {
            var content;
            if (ts.sys.fileExists(filename)) {
                content = ts.sys.readFile(filename);
            }
            if (!content) {
                if (openedByClient) {
                    content = "";
                }
            }
            if (content !== undefined) {
                info = new ScriptInfo(filename, content, openedByClient);
                this.filenameToScriptInfo[filename] = info;
                if (!info.isOpen) {
                    this.watchedFileSet.addFile(info);
                }
            }
        }
        if (info) {
            if (openedByClient) {
                info.isOpen = true;
            }
        }
        return info;
    };
    /**
     * Open file whose contents is managed by the client
     * @param filename is absolute pathname
     */
    ProjectService.prototype.openClientFile = function (filename) {
        // TODO: tsconfig check
        var info = this.openFile(filename, true);
        this.addOpenFile(info);
        this.printProjects();
        return info;
    };
    /**
     * Close file whose contents is managed by the client
     * @param filename is absolute pathname
     */
    ProjectService.prototype.closeClientFile = function (filename) {
        // TODO: tsconfig check
        var info = ts.lookUp(this.filenameToScriptInfo, filename);
        if (info) {
            this.closeOpenFile(info);
            info.isOpen = false;
        }
        this.printProjects();
    };
    ProjectService.prototype.getProjectsReferencingFile = function (filename) {
        var scriptInfo = ts.lookUp(this.filenameToScriptInfo, filename);
        if (scriptInfo) {
            var projects = [];
            for (var i = 0, len = this.inferredProjects.length; i < len; i++) {
                if (this.inferredProjects[i].getSourceFile(scriptInfo)) {
                    projects.push(this.inferredProjects[i]);
                }
            }
            return projects;
        }
    };
    ProjectService.prototype.getProjectForFile = function (filename) {
        var scriptInfo = ts.lookUp(this.filenameToScriptInfo, filename);
        if (scriptInfo) {
            return scriptInfo.defaultProject;
        }
    };
    ProjectService.prototype.printProjectsForFile = function (filename) {
        var scriptInfo = ts.lookUp(this.filenameToScriptInfo, filename);
        if (scriptInfo) {
            this.psLogger.startGroup();
            this.psLogger.info("Projects for " + filename);
            var projects = this.getProjectsReferencingFile(filename);
            for (var i = 0, len = projects.length; i < len; i++) {
                this.psLogger.info("Inferred Project " + i.toString());
            }
            this.psLogger.endGroup();
        }
        else {
            this.psLogger.info(filename + " not in any project");
        }
    };
    ProjectService.prototype.printProjects = function () {
        this.psLogger.startGroup();
        for (var i = 0, len = this.inferredProjects.length; i < len; i++) {
            var project = this.inferredProjects[i];
            this.psLogger.info("Project " + i.toString());
            this.psLogger.info(project.filesToString());
            this.psLogger.info("-----------------------------------------------");
        }
        this.psLogger.info("Open file roots: ");
        for (var i = 0, len = this.openFileRoots.length; i < len; i++) {
            this.psLogger.info(this.openFileRoots[i].filename);
        }
        this.psLogger.info("Open files referenced: ");
        for (var i = 0, len = this.openFilesReferenced.length; i < len; i++) {
            this.psLogger.info(this.openFilesReferenced[i].filename);
        }
        this.psLogger.endGroup();
    };
    ProjectService.prototype.openConfigFile = function (configFilename) {
        configFilename = ts.normalizePath(configFilename);
        // file references will be relative to dirPath (or absolute)
        var dirPath = ts.getDirectoryPath(configFilename);
        var rawConfig = ts.readConfigFile(configFilename);
        if (!rawConfig) {
            return { errorMsg: "tsconfig syntax error" };
        }
        else {
            // REVIEW: specify no base path so can get absolute path below
            var parsedCommandLine = ts.parseConfigFile(rawConfig);
            if (parsedCommandLine.errors) {
                // TODO: gather diagnostics and transmit
                return { errorMsg: "tsconfig option errors" };
            }
            else if (parsedCommandLine.filenames) {
                var proj = this.createProject(configFilename);
                for (var i = 0, len = parsedCommandLine.filenames.length; i < len; i++) {
                    var rootFilename = parsedCommandLine.filenames[i];
                    var normRootFilename = ts.normalizePath(rootFilename);
                    normRootFilename = getAbsolutePath(normRootFilename, dirPath);
                    if (ts.sys.fileExists(normRootFilename)) {
                        var info = this.openFile(normRootFilename);
                        proj.addRoot(info);
                    }
                    else {
                        return { errorMsg: "specified file " + rootFilename + " not found" };
                    }
                }
                var projectOptions = {
                    files: parsedCommandLine.filenames,
                    compilerOptions: parsedCommandLine.options
                };
                if (rawConfig.formatCodeOptions) {
                    projectOptions.formatCodeOptions = rawConfig.formatCodeOptions;
                }
                proj.setProjectOptions(projectOptions);
                return { success: true, project: proj };
            }
            else {
                return { errorMsg: "no files found" };
            }
        }
    };
    ProjectService.prototype.createProject = function (projectFilename) {
        var eproj = new Project(this);
        eproj.projectFilename = projectFilename;
        return eproj;
    };
    return ProjectService;
})();
exports.ProjectService = ProjectService;
var CompilerService = (function () {
    function CompilerService(project) {
        this.project = project;
        this.cancellationToken = new CancellationToken();
        this.settings = ts.getDefaultCompilerOptions();
        this.documentRegistry = ts.createDocumentRegistry();
        this.formatCodeOptions = CompilerService.defaultFormatCodeOptions;
        this.host = new LSHost(project, this.cancellationToken);
        // override default ES6 (remove when compiler default back at ES5)
        this.settings.target = 1 /* ES5 */;
        this.host.setCompilationSettings(this.settings);
        this.languageService = ts.createLanguageService(this.host, this.documentRegistry);
        this.classifier = ts.createClassifier();
    }
    CompilerService.prototype.setCompilerOptions = function (opt) {
        this.settings = opt;
        this.host.setCompilationSettings(opt);
    };
    CompilerService.prototype.setFormatCodeOptions = function (fco) {
        // use this loop to preserve default values
        for (var p in fco) {
            if (fco.hasOwnProperty(p)) {
                this.formatCodeOptions[p] = fco[p];
            }
        }
    };
    CompilerService.prototype.isExternalModule = function (filename) {
        var sourceFile = this.languageService.getSourceFile(filename);
        return ts.isExternalModule(sourceFile);
    };
    CompilerService.defaultFormatCodeOptions = {
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
        PlaceOpenBraceOnNewLineForControlBlocks: false
    };
    return CompilerService;
})();
exports.CompilerService = CompilerService;
(function (CharRangeSection) {
    CharRangeSection[CharRangeSection["PreStart"] = 0] = "PreStart";
    CharRangeSection[CharRangeSection["Start"] = 1] = "Start";
    CharRangeSection[CharRangeSection["Entire"] = 2] = "Entire";
    CharRangeSection[CharRangeSection["Mid"] = 3] = "Mid";
    CharRangeSection[CharRangeSection["End"] = 4] = "End";
    CharRangeSection[CharRangeSection["PostEnd"] = 5] = "PostEnd";
})(exports.CharRangeSection || (exports.CharRangeSection = {}));
var CharRangeSection = exports.CharRangeSection;
var BaseLineIndexWalker = (function () {
    function BaseLineIndexWalker() {
        this.goSubtree = true;
        this.done = false;
    }
    BaseLineIndexWalker.prototype.leaf = function (rangeStart, rangeLength, ll) {
    };
    return BaseLineIndexWalker;
})();
var EditWalker = (function (_super) {
    __extends(EditWalker, _super);
    function EditWalker() {
        _super.call(this);
        this.lineIndex = new LineIndex();
        this.endBranch = [];
        this.state = 2 /* Entire */;
        this.initialText = "";
        this.trailingText = "";
        this.suppressTrailingText = false;
        this.lineIndex.root = new LineNode();
        this.startPath = [this.lineIndex.root];
        this.stack = [this.lineIndex.root];
    }
    EditWalker.prototype.insertLines = function (insertedText) {
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
        var branchParent;
        var lastZeroCount;
        for (var k = this.endBranch.length - 1; k >= 0; k--) {
            this.endBranch[k].updateCounts();
            if (this.endBranch[k].charCount() == 0) {
                lastZeroCount = this.endBranch[k];
                if (k > 0) {
                    branchParent = this.endBranch[k - 1];
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
        var insertionNode = this.startPath[this.startPath.length - 2];
        var leafNode = this.startPath[this.startPath.length - 1];
        var len = lines.length;
        if (len > 0) {
            leafNode.text = lines[0];
            if (len > 1) {
                var insertedNodes = new Array(len - 1);
                var startNode = leafNode;
                for (var i = 1, len = lines.length; i < len; i++) {
                    insertedNodes[i - 1] = new LineLeaf(lines[i]);
                }
                var pathIndex = this.startPath.length - 2;
                while (pathIndex >= 0) {
                    insertionNode = this.startPath[pathIndex];
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
                    this.startPath[j].updateCounts();
                }
            }
        }
        else {
            // no content for leaf node, so delete it
            insertionNode.remove(leafNode);
            for (var j = this.startPath.length - 2; j >= 0; j--) {
                this.startPath[j].updateCounts();
            }
        }
        return this.lineIndex;
    };
    EditWalker.prototype.post = function (relativeStart, relativeLength, lineCollection, parent, nodeType) {
        // have visited the path for start of range, now looking for end
        // if range is on single line, we will never make this state transition
        if (lineCollection == this.lineCollectionAtBranch) {
            this.state = 4 /* End */;
        }
        // always pop stack because post only called when child has been visited
        this.stack.length--;
        return undefined;
    };
    EditWalker.prototype.pre = function (relativeStart, relativeLength, lineCollection, parent, nodeType) {
        // currentNode corresponds to parent, but in the new tree
        var currentNode = this.stack[this.stack.length - 1];
        if ((this.state == 2 /* Entire */) && (nodeType == 1 /* Start */)) {
            // if range is on single line, we will never make this state transition
            this.state = 1 /* Start */;
            this.branchNode = currentNode;
            this.lineCollectionAtBranch = lineCollection;
        }
        var child;
        function fresh(node) {
            if (node.isLeaf()) {
                return new LineLeaf("");
            }
            else
                return new LineNode();
        }
        switch (nodeType) {
            case 0 /* PreStart */:
                this.goSubtree = false;
                if (this.state != 4 /* End */) {
                    currentNode.add(lineCollection);
                }
                break;
            case 1 /* Start */:
                if (this.state == 4 /* End */) {
                    this.goSubtree = false;
                }
                else {
                    child = fresh(lineCollection);
                    currentNode.add(child);
                    this.startPath[this.startPath.length] = child;
                }
                break;
            case 2 /* Entire */:
                if (this.state != 4 /* End */) {
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
            case 3 /* Mid */:
                this.goSubtree = false;
                break;
            case 4 /* End */:
                if (this.state != 4 /* End */) {
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
            case 5 /* PostEnd */:
                this.goSubtree = false;
                if (this.state != 1 /* Start */) {
                    currentNode.add(lineCollection);
                }
                break;
        }
        if (this.goSubtree) {
            this.stack[this.stack.length] = child;
        }
        return lineCollection;
    };
    // just gather text from the leaves
    EditWalker.prototype.leaf = function (relativeStart, relativeLength, ll) {
        if (this.state == 1 /* Start */) {
            this.initialText = ll.text.substring(0, relativeStart);
        }
        else if (this.state == 2 /* Entire */) {
            this.initialText = ll.text.substring(0, relativeStart);
            this.trailingText = ll.text.substring(relativeStart + relativeLength);
        }
        else {
            // state is CharRangeSection.End
            this.trailingText = ll.text.substring(relativeStart + relativeLength);
        }
    };
    return EditWalker;
})(BaseLineIndexWalker);
// text change information 
var TextChange = (function () {
    function TextChange(pos, deleteLen, insertedText) {
        this.pos = pos;
        this.deleteLen = deleteLen;
        this.insertedText = insertedText;
    }
    TextChange.prototype.getTextChangeRange = function () {
        return ts.createTextChangeRange(ts.createTextSpan(this.pos, this.deleteLen), this.insertedText ? this.insertedText.length : 0);
    };
    return TextChange;
})();
exports.TextChange = TextChange;
var ScriptVersionCache = (function () {
    function ScriptVersionCache() {
        this.changes = [];
        this.versions = [];
        this.minVersion = 0; // no versions earlier than min version will maintain change history
        this.currentVersion = 0;
    }
    // REVIEW: can optimize by coalescing simple edits
    ScriptVersionCache.prototype.edit = function (pos, deleteLen, insertedText) {
        this.changes[this.changes.length] = new TextChange(pos, deleteLen, insertedText);
        if ((this.changes.length > ScriptVersionCache.changeNumberThreshold) || (deleteLen > ScriptVersionCache.changeLengthThreshold) || (insertedText && (insertedText.length > ScriptVersionCache.changeLengthThreshold))) {
            this.getSnapshot();
        }
    };
    ScriptVersionCache.prototype.latest = function () {
        return this.versions[this.currentVersion];
    };
    ScriptVersionCache.prototype.latestVersion = function () {
        if (this.changes.length > 0) {
            this.getSnapshot();
        }
        return this.currentVersion;
    };
    ScriptVersionCache.prototype.reloadFromFile = function (filename, cb) {
        var content = ts.sys.readFile(filename);
        this.reload(content);
        if (cb)
            cb();
    };
    // reload whole script, leaving no change history behind reload
    ScriptVersionCache.prototype.reload = function (script) {
        this.currentVersion++;
        this.changes = []; // history wiped out by reload
        var snap = new LineIndexSnapshot(this.currentVersion, this);
        this.versions[this.currentVersion] = snap;
        snap.index = new LineIndex();
        var lm = LineIndex.linesFromText(script);
        snap.index.load(lm.lines);
        // REVIEW: could use linked list 
        for (var i = this.minVersion; i < this.currentVersion; i++) {
            this.versions[i] = undefined;
        }
        this.minVersion = this.currentVersion;
    };
    ScriptVersionCache.prototype.getSnapshot = function () {
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
    };
    ScriptVersionCache.prototype.getTextChangesBetweenVersions = function (oldVersion, newVersion) {
        if (oldVersion < newVersion) {
            if (oldVersion >= this.minVersion) {
                var textChangeRanges = [];
                for (var i = oldVersion + 1; i <= newVersion; i++) {
                    var snap = this.versions[i];
                    for (var j = 0, len = snap.changesSincePreviousVersion.length; j < len; j++) {
                        var textChange = snap.changesSincePreviousVersion[j];
                        textChangeRanges[textChangeRanges.length] = textChange.getTextChangeRange();
                    }
                }
                return ts.collapseTextChangeRangesAcrossMultipleVersions(textChangeRanges);
            }
            else {
                return undefined;
            }
        }
        else {
            return ts.unchangedTextChangeRange;
        }
    };
    ScriptVersionCache.fromString = function (script) {
        var svc = new ScriptVersionCache();
        var snap = new LineIndexSnapshot(0, svc);
        svc.versions[svc.currentVersion] = snap;
        snap.index = new LineIndex();
        var lm = LineIndex.linesFromText(script);
        snap.index.load(lm.lines);
        return svc;
    };
    ScriptVersionCache.changeNumberThreshold = 8;
    ScriptVersionCache.changeLengthThreshold = 256;
    return ScriptVersionCache;
})();
exports.ScriptVersionCache = ScriptVersionCache;
var LineIndexSnapshot = (function () {
    function LineIndexSnapshot(version, cache) {
        this.version = version;
        this.cache = cache;
        this.changesSincePreviousVersion = [];
    }
    LineIndexSnapshot.prototype.getText = function (rangeStart, rangeEnd) {
        return this.index.getText(rangeStart, rangeEnd - rangeStart);
    };
    LineIndexSnapshot.prototype.getLength = function () {
        return this.index.root.charCount();
    };
    // this requires linear space so don't hold on to these 
    LineIndexSnapshot.prototype.getLineStartPositions = function () {
        var starts = [-1];
        var count = 1;
        var pos = 0;
        this.index.every(function (ll, s, len) {
            starts[count++] = pos;
            pos += ll.text.length;
            return true;
        }, 0);
        return starts;
    };
    LineIndexSnapshot.prototype.getLineMapper = function () {
        var _this = this;
        return (function (line) {
            return _this.index.lineNumberToInfo(line).col;
        });
    };
    LineIndexSnapshot.prototype.getTextChangeRangeSinceVersion = function (scriptVersion) {
        if (this.version <= scriptVersion) {
            return ts.unchangedTextChangeRange;
        }
        else {
            return this.cache.getTextChangesBetweenVersions(scriptVersion, this.version);
        }
    };
    LineIndexSnapshot.prototype.getChangeRange = function (oldSnapshot) {
        var oldSnap = oldSnapshot;
        return this.getTextChangeRangeSinceVersion(oldSnap.version);
    };
    return LineIndexSnapshot;
})();
exports.LineIndexSnapshot = LineIndexSnapshot;
var LineIndex = (function () {
    function LineIndex() {
        // set this to true to check each edit for accuracy
        this.checkEdits = false;
    }
    LineIndex.prototype.charOffsetToLineNumberAndPos = function (charOffset) {
        return this.root.charOffsetToLineNumberAndPos(1, charOffset);
    };
    LineIndex.prototype.lineNumberToInfo = function (lineNumber) {
        var lineCount = this.root.lineCount();
        if (lineNumber <= lineCount) {
            var lineInfo = this.root.lineNumberToInfo(lineNumber, 0);
            lineInfo.line = lineNumber;
            return lineInfo;
        }
        else {
            return {
                line: lineNumber,
                col: this.root.charCount()
            };
        }
    };
    LineIndex.prototype.print = function () {
        printLine("index TC " + this.root.charCount() + " TL " + this.root.lineCount());
        this.root.print(0);
        printLine("");
    };
    LineIndex.prototype.load = function (lines) {
        if (lines.length > 0) {
            var leaves = [];
            for (var i = 0, len = lines.length; i < len; i++) {
                leaves[i] = new LineLeaf(lines[i]);
            }
            this.root = LineIndex.buildTreeFromBottom(leaves);
        }
        else {
            this.root = new LineNode();
        }
    };
    LineIndex.prototype.walk = function (rangeStart, rangeLength, walkFns) {
        this.root.walk(rangeStart, rangeLength, walkFns);
    };
    LineIndex.prototype.getText = function (rangeStart, rangeLength) {
        var accum = "";
        if (rangeLength > 0) {
            this.walk(rangeStart, rangeLength, {
                goSubtree: true,
                done: false,
                leaf: function (relativeStart, relativeLength, ll) {
                    accum = accum.concat(ll.text.substring(relativeStart, relativeStart + relativeLength));
                }
            });
        }
        return accum;
    };
    LineIndex.prototype.every = function (f, rangeStart, rangeEnd) {
        if (!rangeEnd) {
            rangeEnd = this.root.charCount();
        }
        var walkFns = {
            goSubtree: true,
            done: false,
            leaf: function (relativeStart, relativeLength, ll) {
                if (!f(ll, relativeStart, relativeLength)) {
                    this.done = true;
                }
            }
        };
        this.walk(rangeStart, rangeEnd - rangeStart, walkFns);
        return !walkFns.done;
    };
    LineIndex.prototype.edit = function (pos, deleteLength, newText) {
        function editFlat(source, s, dl, nt) {
            if (nt === void 0) { nt = ""; }
            return source.substring(0, s) + nt + source.substring(s + dl, source.length);
        }
        if (this.root.charCount() == 0) {
            // TODO: assert deleteLength == 0
            if (newText) {
                this.load(LineIndex.linesFromText(newText).lines);
                return this;
            }
        }
        else {
            if (this.checkEdits) {
                var checkText = editFlat(this.getText(0, this.root.charCount()), pos, deleteLength, newText);
            }
            var walker = new EditWalker();
            if (deleteLength > 0) {
                // check whether last characters deleted are line break
                var e = pos + deleteLength;
                var lineInfo = this.charOffsetToLineNumberAndPos(e);
                if ((lineInfo && (lineInfo.col == 0))) {
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
            if (this.checkEdits) {
                var updatedText = this.getText(0, this.root.charCount());
                if (checkText != updatedText) {
                    exports.logger.msg("buffer edit mismatch");
                }
            }
            return walker.lineIndex;
        }
    };
    LineIndex.buildTreeFromBottom = function (nodes) {
        var nodeCount = Math.ceil(nodes.length / lineCollectionCapacity);
        var interiorNodes = [];
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
    };
    LineIndex.linesFromText = function (text) {
        var lineStarts = ts.computeLineStarts(text);
        if (lineStarts.length == 0) {
            return { lines: [], lineMap: lineStarts };
        }
        var lines = new Array(lineStarts.length);
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
    };
    return LineIndex;
})();
exports.LineIndex = LineIndex;
var LineNode = (function () {
    function LineNode() {
        this.totalChars = 0;
        this.totalLines = 0;
        this.children = [];
    }
    LineNode.prototype.isLeaf = function () {
        return false;
    };
    LineNode.prototype.print = function (indentAmt) {
        var strBuilder = getIndent(indentAmt);
        strBuilder += ("node ch " + this.children.length + " TC " + this.totalChars + " TL " + this.totalLines + " :");
        printLine(strBuilder);
        for (var ch = 0, clen = this.children.length; ch < clen; ch++) {
            this.children[ch].print(indentAmt + 1);
        }
    };
    LineNode.prototype.updateCounts = function () {
        this.totalChars = 0;
        this.totalLines = 0;
        for (var i = 0, len = this.children.length; i < len; i++) {
            var child = this.children[i];
            this.totalChars += child.charCount();
            this.totalLines += child.lineCount();
        }
    };
    LineNode.prototype.execWalk = function (rangeStart, rangeLength, walkFns, childIndex, nodeType) {
        if (walkFns.pre) {
            walkFns.pre(rangeStart, rangeLength, this.children[childIndex], this, nodeType);
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
    };
    LineNode.prototype.skipChild = function (relativeStart, relativeLength, childIndex, walkFns, nodeType) {
        if (walkFns.pre && (!walkFns.done)) {
            walkFns.pre(relativeStart, relativeLength, this.children[childIndex], this, nodeType);
            walkFns.goSubtree = true;
        }
    };
    LineNode.prototype.walk = function (rangeStart, rangeLength, walkFns) {
        // assume (rangeStart < this.totalChars) && (rangeLength <= this.totalChars) 
        var childIndex = 0;
        var child = this.children[0];
        var childCharCount = child.charCount();
        // find sub-tree containing start
        var adjustedStart = rangeStart;
        while (adjustedStart >= childCharCount) {
            this.skipChild(adjustedStart, rangeLength, childIndex, walkFns, 0 /* PreStart */);
            adjustedStart -= childCharCount;
            child = this.children[++childIndex];
            childCharCount = child.charCount();
        }
        // Case I: both start and end of range in same subtree
        if ((adjustedStart + rangeLength) <= childCharCount) {
            if (this.execWalk(adjustedStart, rangeLength, walkFns, childIndex, 2 /* Entire */)) {
                return;
            }
        }
        else {
            // Case II: start and end of range in different subtrees (possibly with subtrees in the middle)
            if (this.execWalk(adjustedStart, childCharCount - adjustedStart, walkFns, childIndex, 1 /* Start */)) {
                return;
            }
            var adjustedLength = rangeLength - (childCharCount - adjustedStart);
            child = this.children[++childIndex];
            if (!child) {
                this.print(2);
            }
            childCharCount = child.charCount();
            while (adjustedLength > childCharCount) {
                if (this.execWalk(0, childCharCount, walkFns, childIndex, 3 /* Mid */)) {
                    return;
                }
                adjustedLength -= childCharCount;
                child = this.children[++childIndex];
                childCharCount = child.charCount();
            }
            if (adjustedLength > 0) {
                if (this.execWalk(0, adjustedLength, walkFns, childIndex, 4 /* End */)) {
                    return;
                }
            }
        }
        // Process any subtrees after the one containing range end
        if (walkFns.pre) {
            var clen = this.children.length;
            if (childIndex < (clen - 1)) {
                for (var ej = childIndex + 1; ej < clen; ej++) {
                    this.skipChild(0, 0, ej, walkFns, 5 /* PostEnd */);
                }
            }
        }
    };
    LineNode.prototype.charOffsetToLineNumberAndPos = function (lineNumber, charOffset) {
        var childInfo = this.childFromCharOffset(lineNumber, charOffset);
        if (!childInfo.child) {
            return {
                line: lineNumber,
                col: charOffset
            };
        }
        else if (childInfo.childIndex < this.children.length) {
            if (childInfo.child.isLeaf()) {
                return {
                    line: childInfo.lineNumber,
                    col: childInfo.charOffset,
                    text: (childInfo.child).text,
                    leaf: (childInfo.child)
                };
            }
            else {
                var lineNode = (childInfo.child);
                return lineNode.charOffsetToLineNumberAndPos(childInfo.lineNumber, childInfo.charOffset);
            }
        }
        else {
            var lineInfo = this.lineNumberToInfo(this.lineCount(), 0);
            return { line: this.lineCount(), col: lineInfo.leaf.charCount() };
        }
    };
    LineNode.prototype.lineNumberToInfo = function (lineNumber, charOffset) {
        var childInfo = this.childFromLineNumber(lineNumber, charOffset);
        if (!childInfo.child) {
            return {
                line: lineNumber,
                col: charOffset
            };
        }
        else if (childInfo.child.isLeaf()) {
            return {
                line: lineNumber,
                col: childInfo.charOffset,
                text: (childInfo.child).text,
                leaf: (childInfo.child)
            };
        }
        else {
            var lineNode = (childInfo.child);
            return lineNode.lineNumberToInfo(childInfo.relativeLineNumber, childInfo.charOffset);
        }
    };
    LineNode.prototype.childFromLineNumber = function (lineNumber, charOffset) {
        var child;
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
    };
    LineNode.prototype.childFromCharOffset = function (lineNumber, charOffset) {
        var child;
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
        };
    };
    LineNode.prototype.splitAfter = function (childIndex) {
        var splitNode;
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
    };
    LineNode.prototype.remove = function (child) {
        var childIndex = this.findChildIndex(child);
        var clen = this.children.length;
        if (childIndex < (clen - 1)) {
            for (var i = childIndex; i < (clen - 1); i++) {
                this.children[i] = this.children[i + 1];
            }
        }
        this.children.length--;
    };
    LineNode.prototype.findChildIndex = function (child) {
        var childIndex = 0;
        var clen = this.children.length;
        while ((this.children[childIndex] != child) && (childIndex < clen))
            childIndex++;
        return childIndex;
    };
    LineNode.prototype.insertAt = function (child, nodes) {
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
            while ((childIndex < lineCollectionCapacity) && (nodeIndex < nodeCount)) {
                this.children[childIndex++] = nodes[nodeIndex++];
            }
            var splitNodes = [];
            var splitNodeCount = 0;
            if (nodeIndex < nodeCount) {
                splitNodeCount = Math.ceil((nodeCount - nodeIndex) / lineCollectionCapacity);
                splitNodes = new Array(splitNodeCount);
                var splitNodeIndex = 0;
                for (var i = 0; i < splitNodeCount; i++) {
                    splitNodes[i] = new LineNode();
                }
                var splitNode = splitNodes[0];
                while (nodeIndex < nodeCount) {
                    splitNode.add(nodes[nodeIndex++]);
                    if (splitNode.children.length == lineCollectionCapacity) {
                        splitNodeIndex++;
                        splitNode = splitNodes[splitNodeIndex];
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
                splitNodes[i].updateCounts();
            }
            return splitNodes;
        }
    };
    // assume there is room for the item; return true if more room
    LineNode.prototype.add = function (collection) {
        this.children[this.children.length] = collection;
        return (this.children.length < lineCollectionCapacity);
    };
    LineNode.prototype.charCount = function () {
        return this.totalChars;
    };
    LineNode.prototype.lineCount = function () {
        return this.totalLines;
    };
    return LineNode;
})();
exports.LineNode = LineNode;
var LineLeaf = (function () {
    function LineLeaf(text) {
        this.text = text;
    }
    LineLeaf.prototype.setUdata = function (data) {
        this.udata = data;
    };
    LineLeaf.prototype.getUdata = function () {
        return this.udata;
    };
    LineLeaf.prototype.isLeaf = function () {
        return true;
    };
    LineLeaf.prototype.walk = function (rangeStart, rangeLength, walkFns) {
        walkFns.leaf(rangeStart, rangeLength, this);
    };
    LineLeaf.prototype.charCount = function () {
        return this.text.length;
    };
    LineLeaf.prototype.lineCount = function () {
        return 1;
    };
    LineLeaf.prototype.print = function (indentAmt) {
        var strBuilder = getIndent(indentAmt);
        printLine(strBuilder + showLines(this.text));
    };
    return LineLeaf;
})();
exports.LineLeaf = LineLeaf;
