/// <reference path='../../node_modules/typescript/bin/typescriptServices.d.ts'/>
/// <reference path='../../node_modules/typescript/bin/typescriptServices_internal.d.ts'/>
/// <reference path='node.d.ts' />
var __extends = this.__extends || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
};
var typescript;
var ts;
(function (_ts) {
    var server;
    (function (server) {
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
        server.printLine = printLine;
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
            server.logger.msg("Estimated precision of high-res timer: " + (total / count).toFixed(3) + " nanoseconds", "Perf");
        }
        function getModififedTime(filename) {
            if (measurePerf) {
                var start = process.hrtime();
            }
            var stats = fs.statSync(filename);
            if (!stats) {
                server.logger.msg("Stat returned undefined for " + filename);
            }
            if (measurePerf) {
                var elapsed = process.hrtime(start);
                var elapsedNano = 1e9 * elapsed[0] + elapsed[1];
                server.logger.msg("Elapsed time for stat (in nanoseconds)" + filename + ": " + elapsedNano.toString(), "Perf");
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
            ScriptInfo.prototype.editContent = function (start, end, newText) {
                this.svc.edit(start, end - start, newText);
            };
            ScriptInfo.prototype.getTextChangeRangeBetweenVersions = function (startVersion, endVersion) {
                return this.svc.getTextChangesBetweenVersions(startVersion, endVersion);
            };
            ScriptInfo.prototype.getChangeRange = function (oldSnapshot) {
                return this.snap().getChangeRange(oldSnapshot);
            };
            return ScriptInfo;
        })();
        server.ScriptInfo = ScriptInfo;
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
        server.CancellationToken = CancellationToken;
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
        server.Logger = Logger;
        // this places log file in the directory containing editorServices.js
        // TODO: check that this location is writable
        server.logger = new Logger(__dirname + "/.log" + process.pid.toString());
        var LSHost = (function () {
            function LSHost(project, cancellationToken) {
                if (cancellationToken === void 0) { cancellationToken = CancellationToken.None; }
                this.project = project;
                this.cancellationToken = cancellationToken;
                this.ls = null;
                this.filenameToScript = {};
            }
            LSHost.prototype.getDefaultLibFileName = function () {
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
            LSHost.prototype.editScript = function (filename, start, end, newText) {
                var script = this.getScriptInfo(filename);
                if (script) {
                    script.editContent(start, end, newText);
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
        server.LSHost = LSHost;
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
                    var normFilename = ts.normalizePath(sourceFiles[i].fileName);
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
                    strBuilder += sourceFile.fileName + "\n";
                });
                return strBuilder;
            };
            Project.prototype.setProjectOptions = function (projectOptions) {
                this.projectOptions = projectOptions;
                if (projectOptions.compilerOptions) {
                    this.compilerService.setCompilerOptions(projectOptions.compilerOptions);
                }
                // TODO: format code options
            };
            return Project;
        })();
        server.Project = Project;
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
                        server.logger.msg(info.filename + " changed");
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
                        server.logger.msg("Error " + msg + " in stat for file " + watchedFile.filename);
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
                    server.logger.msg("Elapsed time for async stat (in nanoseconds)" + watchedFile.filename + ": " + elapsedNano.toString(), "Perf");
                }
            };
            // this implementation uses polling and
            // stat due to inconsistencies of fs.watch
            // and efficiency of stat on modern filesystems
            WatchedFileSet.prototype.startWatchTimer = function () {
                var _this = this;
                server.logger.msg("Start watch timer: " + this.chunkSize.toString(), "Info");
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
        server.WatchedFileSet = WatchedFileSet;
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
                this.psLogger = server.logger;
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
                    else if (parsedCommandLine.fileNames) {
                        var proj = this.createProject(configFilename);
                        for (var i = 0, len = parsedCommandLine.fileNames.length; i < len; i++) {
                            var rootFilename = parsedCommandLine.fileNames[i];
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
                            files: parsedCommandLine.fileNames,
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
        server.ProjectService = ProjectService;
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
        server.CompilerService = CompilerService;
        (function (CharRangeSection) {
            CharRangeSection[CharRangeSection["PreStart"] = 0] = "PreStart";
            CharRangeSection[CharRangeSection["Start"] = 1] = "Start";
            CharRangeSection[CharRangeSection["Entire"] = 2] = "Entire";
            CharRangeSection[CharRangeSection["Mid"] = 3] = "Mid";
            CharRangeSection[CharRangeSection["End"] = 4] = "End";
            CharRangeSection[CharRangeSection["PostEnd"] = 5] = "PostEnd";
        })(server.CharRangeSection || (server.CharRangeSection = {}));
        var CharRangeSection = server.CharRangeSection;
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
        server.TextChange = TextChange;
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
        server.ScriptVersionCache = ScriptVersionCache;
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
        server.LineIndexSnapshot = LineIndexSnapshot;
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
                            server.logger.msg("buffer edit mismatch");
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
        server.LineIndex = LineIndex;
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
        server.LineNode = LineNode;
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
        server.LineLeaf = LineLeaf;
    })(server = _ts.server || (_ts.server = {}));
})(ts || (ts = {}));
/// <reference path='../../node_modules/typescript/bin/typescriptServices.d.ts'/>
/// <reference path='../../node_modules/typescript/bin/typescriptServices_internal.d.ts'/>
/// <reference path='node.d.ts' />
/// <reference path='protodef.d.ts' />
/// <reference path='editorServices.ts' />
var ts;
(function (_ts) {
    var server;
    (function (server) {
        var ts = require('typescript');
        var nodeproto = require('_debugger');
        var readline = require('readline');
        var path = require('path');
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
        function compareFileStart(a, b) {
            if (a.file < b.file) {
                return -1;
            }
            else if (a.file == b.file) {
                var n = compareNumber(a.start.line, b.start.line);
                if (n == 0) {
                    return compareNumber(a.start.col, b.start.col);
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
                start: project.compilerService.host.positionToLineCol(file, diag.start),
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
        var CommandNames;
        (function (CommandNames) {
            CommandNames.Abbrev = "abbrev";
            CommandNames.Change = "change";
            CommandNames.Close = "close";
            CommandNames.Completions = "completions";
            CommandNames.Definition = "definition";
            CommandNames.Format = "format";
            CommandNames.Formatonkey = "formatonkey";
            CommandNames.Geterr = "geterr";
            CommandNames.Navto = "navto";
            CommandNames.Open = "open";
            CommandNames.Quickinfo = "quickinfo";
            CommandNames.References = "references";
            CommandNames.Reload = "reload";
            CommandNames.Rename = "rename";
            CommandNames.Saveto = "saveto";
            CommandNames.Type = "type";
            CommandNames.Unknown = "unknown";
        })(CommandNames || (CommandNames = {}));
        var Session = (function () {
            function Session(useProtocol) {
                if (useProtocol === void 0) { useProtocol = false; }
                this.projectService = new server.ProjectService();
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
            Session.prototype.logError = function (err, cmd) {
                var typedErr = err;
                var msg = "Exception on executing command " + cmd;
                if (typedErr.message) {
                    msg += ":\n" + typedErr.message;
                    if (typedErr.stack) {
                        msg += "\n" + typedErr.stack;
                    }
                }
                this.projectService.log(msg);
            };
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
                console.log("Got JSON msg:\n" + req.raw);
            };
            Session.prototype.sendLineToClient = function (line) {
                // this will use the sys host
                console.log(line);
            };
            Session.prototype.send = function (msg) {
                var json;
                if (this.prettyJSON) {
                    json = JSON.stringify(msg, null, " ");
                }
                else {
                    json = JSON.stringify(msg);
                }
                this.sendLineToClient('Content-Length: ' + (1 + Buffer.byteLength(json, 'utf8')) + '\r\n\r\n' + json);
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
            Session.prototype.response = function (info, cmdName, reqSeq, errorMsg) {
                if (reqSeq === void 0) { reqSeq = 0; }
                var res = {
                    seq: 0,
                    type: "response",
                    command: cmdName,
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
                    containerName: "cn",
                    containerKind: "ck",
                    kindModifiers: "km",
                    start: "s",
                    end: "e",
                    line: "l",
                    col: "c",
                    "interface": "i",
                    "function": "fn"
                };
            };
            Session.prototype.encodeFilename = function (filename) {
                if (!this.fetchedAbbrev) {
                    return filename;
                }
                else {
                    var id = ts.lookUp(this.fileHash, filename);
                    if (!id) {
                        id = this.nextFileId++;
                        this.fileHash[filename] = id;
                        return { id: id, file: filename };
                    }
                    else {
                        return id;
                    }
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
            Session.prototype.output = function (info, cmdName, reqSeq, errorMsg) {
                if (reqSeq === void 0) { reqSeq = 0; }
                if (this.protocol) {
                    this.response(info, cmdName, reqSeq, errorMsg);
                }
                else if (this.prettyJSON) {
                    if (!errorMsg) {
                        this.sendLineToClient(JSON.stringify(info, null, " ").trim());
                    }
                    else {
                        this.sendLineToClient(JSON.stringify(errorMsg));
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
                        this.sendLineToClient("[" + lenStr + "," + infoStr + "]");
                    }
                    else {
                        this.sendLineToClient(JSON.stringify("error: " + errorMsg));
                    }
                }
            };
            Session.prototype.semanticCheck = function (file, project) {
                var diags = project.compilerService.languageService.getSemanticDiagnostics(file);
                if (diags) {
                    var bakedDiags = diags.map(function (diag) { return formatDiag(file, project, diag); });
                    this.event({ file: file, diagnostics: bakedDiags }, "semanticDiag");
                }
            };
            Session.prototype.syntacticCheck = function (file, project) {
                var diags = project.compilerService.languageService.getSyntacticDiagnostics(file);
                if (diags) {
                    var bakedDiags = diags.map(function (diag) { return formatDiag(file, project, diag); });
                    this.event({ file: file, diagnostics: bakedDiags }, "syntaxDiag");
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
                        if (checkSpec.project.getSourceFileFromName(checkSpec.filename)) {
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
                    }
                };
                if ((checkList.length > index) && (matchSeq(seq))) {
                    this.errorTimer = setTimeout(checkOne, ms);
                }
            };
            Session.prototype.goToDefinition = function (line, col, rawfile, reqSeq) {
                if (reqSeq === void 0) { reqSeq = 0; }
                var file = ts.normalizePath(rawfile);
                var project = this.projectService.getProjectForFile(file);
                if (project) {
                    var compilerService = project.compilerService;
                    var pos = compilerService.host.lineColToPosition(file, line, col);
                    var locs = compilerService.languageService.getDefinitionAtPosition(file, pos);
                    if (locs) {
                        var info = locs.map(function (def) { return ({
                            file: def && def.fileName,
                            start: def && compilerService.host.positionToLineCol(def.fileName, def.textSpan.start),
                            end: def && compilerService.host.positionToLineCol(def.fileName, ts.textSpanEnd(def.textSpan))
                        }); });
                        this.output(info, CommandNames.Definition, reqSeq);
                    }
                    else {
                        this.output(undefined, CommandNames.Definition, reqSeq, "could not find def");
                    }
                }
                else {
                    this.output(undefined, CommandNames.Definition, reqSeq, "no project for " + file);
                }
            };
            Session.prototype.rename = function (line, col, rawfile, reqSeq) {
                if (reqSeq === void 0) { reqSeq = 0; }
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
                                var bakedRenameLocs = renameLocs.map(function (loc) { return ({
                                    file: loc.fileName,
                                    start: compilerService.host.positionToLineCol(loc.fileName, loc.textSpan.start),
                                    end: compilerService.host.positionToLineCol(loc.fileName, ts.textSpanEnd(loc.textSpan))
                                }); }).sort(function (a, b) {
                                    if (a.file < b.file) {
                                        return -1;
                                    }
                                    else if (a.file > b.file) {
                                        return 1;
                                    }
                                    else {
                                        // reverse sort assuming no overlap
                                        if (a.start.line < b.start.line) {
                                            return 1;
                                        }
                                        else if (a.start.line > b.start.line) {
                                            return -1;
                                        }
                                        else {
                                            return b.start.col - a.start.col;
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
                                    curFileAccum.locs.push({ start: cur.start, end: cur.end });
                                    return accum;
                                }, []);
                                this.output({ info: renameInfo, locs: bakedRenameLocs }, CommandNames.Rename, reqSeq);
                            }
                            else {
                                this.output({ info: renameInfo, locs: [] }, CommandNames.Rename, reqSeq);
                            }
                        }
                        else {
                            this.output(undefined, CommandNames.Rename, reqSeq, renameInfo.localizedErrorMessage);
                        }
                    }
                    else {
                        this.output(undefined, CommandNames.Rename, reqSeq, "no rename information at cursor");
                    }
                }
            };
            Session.prototype.findReferences = function (line, col, rawfile, reqSeq) {
                if (reqSeq === void 0) { reqSeq = 0; }
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
                            var nameColStart = compilerService.host.positionToLineCol(file, nameSpan.start).col;
                            var nameText = compilerService.host.getScriptSnapshot(file).getText(nameSpan.start, ts.textSpanEnd(nameSpan));
                            var bakedRefs = refs.map(function (ref) {
                                var start = compilerService.host.positionToLineCol(ref.fileName, ref.textSpan.start);
                                var refLineSpan = compilerService.host.lineToTextSpan(ref.fileName, start.line - 1);
                                var snap = compilerService.host.getScriptSnapshot(ref.fileName);
                                var lineText = snap.getText(refLineSpan.start, ts.textSpanEnd(refLineSpan)).replace(/\r|\n/g, "");
                                return {
                                    file: ref.fileName,
                                    start: start,
                                    lineText: lineText,
                                    end: compilerService.host.positionToLineCol(ref.fileName, ts.textSpanEnd(ref.textSpan))
                                };
                            }).sort(compareFileStart);
                            var response = {
                                refs: bakedRefs,
                                symbolName: nameText,
                                symbolStartCol: nameColStart,
                                symbolDisplayString: displayString
                            };
                            this.output(response, CommandNames.References, reqSeq);
                        }
                        else {
                            this.output(undefined, CommandNames.References, reqSeq, "no references at this position");
                        }
                    }
                    else {
                        this.output(undefined, CommandNames.References, reqSeq, "no references at this position");
                    }
                }
            };
            // TODO: implement this as ls api that can return multiple def sites
            Session.prototype.goToType = function (line, col, rawfile, reqSeq) {
                if (reqSeq === void 0) { reqSeq = 0; }
                var file = ts.normalizePath(rawfile);
                var project = this.projectService.getProjectForFile(file);
                if (project) {
                    var compilerService = project.compilerService;
                    var pos = compilerService.host.lineColToPosition(file, line, col);
                    var quickInfo = compilerService.languageService.getQuickInfoAtPosition(file, pos);
                    var typeLoc;
                    if (quickInfo && ((quickInfo.kind == "var") || (quickInfo.kind == "local var"))) {
                        var typeName = parseTypeName(quickInfo.displayParts);
                        if (typeName) {
                            var navItems = compilerService.languageService.getNavigateToItems(typeName);
                            var navItem = findExactMatchType(navItems);
                            if (navItem) {
                                typeLoc = {
                                    file: navItem.fileName,
                                    start: compilerService.host.positionToLineCol(navItem.fileName, navItem.textSpan.start),
                                    end: compilerService.host.positionToLineCol(navItem.fileName, ts.textSpanEnd(navItem.textSpan))
                                };
                            }
                        }
                    }
                    if (typeLoc) {
                        this.output([typeLoc], CommandNames.Type, reqSeq);
                    }
                    else {
                        this.output(undefined, CommandNames.Type, reqSeq, "no info at this location");
                    }
                }
                else {
                    this.output(undefined, CommandNames.Type, reqSeq, "no project for " + file);
                }
            };
            Session.prototype.openClientFile = function (rawfile) {
                var file = ts.normalizePath(rawfile);
                this.projectService.openClientFile(file);
            };
            Session.prototype.quickInfo = function (line, col, rawfile, reqSeq) {
                if (reqSeq === void 0) { reqSeq = 0; }
                var file = ts.normalizePath(rawfile);
                var project = this.projectService.getProjectForFile(file);
                if (project) {
                    var compilerService = project.compilerService;
                    var pos = compilerService.host.lineColToPosition(file, line, col);
                    var quickInfo = compilerService.languageService.getQuickInfoAtPosition(file, pos);
                    if (quickInfo) {
                        var displayString = ts.displayPartsToString(quickInfo.displayParts);
                        var docString = ts.displayPartsToString(quickInfo.documentation);
                        var qi = {
                            kind: quickInfo.kind,
                            kindModifiers: quickInfo.kindModifiers,
                            start: compilerService.host.positionToLineCol(file, quickInfo.textSpan.start),
                            end: compilerService.host.positionToLineCol(file, ts.textSpanEnd(quickInfo.textSpan)),
                            displayString: displayString,
                            documentation: docString
                        };
                        this.output(qi, CommandNames.Quickinfo, reqSeq);
                    }
                    else {
                        this.output(undefined, CommandNames.Quickinfo, reqSeq, "no info");
                    }
                }
            };
            Session.prototype.format = function (line, col, endLine, endCol, rawfile, cmd, reqSeq) {
                if (reqSeq === void 0) { reqSeq = 0; }
                var file = ts.normalizePath(rawfile);
                var project = this.projectService.getProjectForFile(file);
                if (project) {
                    var compilerService = project.compilerService;
                    var pos = compilerService.host.lineColToPosition(file, line, col);
                    var endPos = compilerService.host.lineColToPosition(file, endLine, endCol);
                    var edits;
                    // TODO: avoid duplicate code (with formatonkey)
                    try {
                        edits = compilerService.languageService.getFormattingEditsForRange(file, pos, endPos, compilerService.formatCodeOptions);
                    }
                    catch (err) {
                        this.logError(err, cmd);
                        edits = undefined;
                    }
                    if (edits) {
                        var bakedEdits = edits.map(function (edit) {
                            return {
                                start: compilerService.host.positionToLineCol(file, edit.span.start),
                                end: compilerService.host.positionToLineCol(file, ts.textSpanEnd(edit.span)),
                                newText: edit.newText ? edit.newText : ""
                            };
                        });
                        this.output(bakedEdits, CommandNames.Format, reqSeq);
                    }
                    else {
                        this.output(undefined, CommandNames.Format, reqSeq, "no edits");
                    }
                }
            };
            Session.prototype.formatOnKey = function (line, col, key, rawfile, cmd, reqSeq) {
                if (reqSeq === void 0) { reqSeq = 0; }
                var file = ts.normalizePath(rawfile);
                var project = this.projectService.getProjectForFile(file);
                if (project) {
                    var compilerService = project.compilerService;
                    var pos = compilerService.host.lineColToPosition(file, line, col);
                    var edits;
                    try {
                        edits = compilerService.languageService.getFormattingEditsAfterKeystroke(file, pos, key, compilerService.formatCodeOptions);
                        if ((key == "\n") && ((!edits) || (edits.length == 0) || allEditsBeforePos(edits, pos))) {
                            // TODO: get these options from host
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
                        this.logError(err, cmd);
                        edits = undefined;
                    }
                    if (edits) {
                        var bakedEdits = edits.map(function (edit) {
                            return {
                                start: compilerService.host.positionToLineCol(file, edit.span.start),
                                end: compilerService.host.positionToLineCol(file, ts.textSpanEnd(edit.span)),
                                newText: edit.newText ? edit.newText : ""
                            };
                        });
                        this.output(bakedEdits, CommandNames.Formatonkey, reqSeq);
                    }
                    else {
                        this.output(undefined, CommandNames.Formatonkey, reqSeq, "no edits");
                    }
                }
            };
            Session.prototype.completions = function (line, col, prefix, rawfile, cmd, reqSeq) {
                if (reqSeq === void 0) { reqSeq = 0; }
                if (!prefix) {
                    prefix = "";
                }
                var file = ts.normalizePath(rawfile);
                var project = this.projectService.getProjectForFile(file);
                var completions = undefined;
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
                                    if (details && (details.displayParts) && (details.displayParts.length > 0)) {
                                        protoEntry.displayParts = details.documentation;
                                    }
                                    accum.push(protoEntry);
                                }
                                return accum;
                            }, []);
                            this.output(compressedEntries, CommandNames.Completions, reqSeq);
                        }
                    }
                }
                if (!completions) {
                    this.output(undefined, CommandNames.Completions, reqSeq, "no completions");
                }
            };
            Session.prototype.geterr = function (ms, files) {
                var _this = this;
                var checkList = files.reduce(function (accum, filename) {
                    filename = ts.normalizePath(filename);
                    var project = _this.projectService.getProjectForFile(filename);
                    if (project) {
                        accum.push({ filename: filename, project: project });
                    }
                    return accum;
                }, []);
                if (checkList.length > 0) {
                    this.updateErrorCheck(checkList, this.changeSeq, function (n) { return n == _this.changeSeq; }, ms);
                }
            };
            Session.prototype.change = function (line, col, deleteLen, insertString, rawfile) {
                var file = ts.normalizePath(rawfile);
                var project = this.projectService.getProjectForFile(file);
                if (project) {
                    var compilerService = project.compilerService;
                    var pos = compilerService.host.lineColToPosition(file, line, col);
                    if (pos >= 0) {
                        var end = pos;
                        if (deleteLen) {
                            end += deleteLen;
                        }
                        compilerService.host.editScript(file, pos, end, insertString);
                        this.changeSeq++;
                    }
                }
            };
            Session.prototype.reload = function (rawfile, rawtmpfile, reqSeq) {
                var _this = this;
                if (reqSeq === void 0) { reqSeq = 0; }
                var file = ts.normalizePath(rawfile);
                var tmpfile = ts.normalizePath(rawtmpfile);
                var project = this.projectService.getProjectForFile(file);
                if (project) {
                    this.changeSeq++;
                    // make sure no changes happen before this one is finished
                    project.compilerService.host.reloadScript(file, tmpfile, function () {
                        _this.output(undefined, CommandNames.Reload, reqSeq);
                    });
                }
            };
            Session.prototype.saveToTmp = function (rawfile, rawtmpfile) {
                var file = ts.normalizePath(rawfile);
                var tmpfile = ts.normalizePath(rawtmpfile);
                var project = this.projectService.getProjectForFile(file);
                if (project) {
                    project.compilerService.host.saveTo(file, tmpfile);
                }
            };
            Session.prototype.closeClientFile = function (rawfile) {
                var file = ts.normalizePath(rawfile);
                this.projectService.closeClientFile(file);
            };
            Session.prototype.decorateNavBarItem = function (navBarItem, compilerService, file) {
                var _this = this;
                if (navBarItem.spans.length == 1) {
                    var span = navBarItem.spans[0];
                    var offset = span.start;
                    var textForSpan = compilerService.host.getScriptSnapshot(file).getText(offset, offset + span.length);
                    var adj = textForSpan.indexOf(navBarItem.text);
                    if (adj > 0) {
                        offset += adj;
                    }
                    var quickInfo = compilerService.languageService.getQuickInfoAtPosition(file, offset + (navBarItem.text.length / 2));
                    if (quickInfo) {
                        var displayString = ts.displayPartsToString(quickInfo.displayParts);
                        var docString = ts.displayPartsToString(quickInfo.documentation);
                        navBarItem.displayString = displayString;
                        navBarItem.docString = docString;
                    }
                }
                if (navBarItem.childItems.length > 0) {
                    navBarItem.childItems = navBarItem.childItems.map(function (navBarItem) { return _this.decorateNavBarItem(navBarItem, compilerService, file); });
                }
                return navBarItem;
            };
            Session.prototype.navbar = function (rawfile, reqSeq) {
                var _this = this;
                if (reqSeq === void 0) { reqSeq = 0; }
                var file = ts.normalizePath(rawfile);
                var project = this.projectService.getProjectForFile(file);
                if (project) {
                    var compilerService = project.compilerService;
                    var navBarItems = compilerService.languageService.getNavigationBarItems(file);
                    var bakedNavBarItems = navBarItems.map(function (navBarItem) { return _this.decorateNavBarItem(navBarItem, compilerService, file); });
                    console.log(JSON.stringify(bakedNavBarItems, null, " "));
                }
            };
            Session.prototype.navto = function (searchTerm, rawfile, cmd, reqSeq) {
                var _this = this;
                if (reqSeq === void 0) { reqSeq = 0; }
                var file = ts.normalizePath(rawfile);
                var project = this.projectService.getProjectForFile(file);
                if (project) {
                    var compilerService = project.compilerService;
                    var navItems;
                    var cancellationToken = compilerService.host.getCancellationToken();
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
                        var bakedNavItems = navItems.map(function (navItem) {
                            var start = compilerService.host.positionToLineCol(navItem.fileName, navItem.textSpan.start);
                            var end = compilerService.host.positionToLineCol(navItem.fileName, ts.textSpanEnd(navItem.textSpan));
                            _this.abbreviate(start);
                            var bakedItem = {
                                name: navItem.name,
                                kind: navItem.kind,
                                file: _this.encodeFilename(navItem.fileName),
                                start: start,
                                end: end
                            };
                            if (navItem.kindModifiers && (navItem.kindModifiers != "")) {
                                bakedItem.kindModifiers = navItem.kindModifiers;
                            }
                            if (navItem.matchKind != 'none') {
                                bakedItem.matchKind = navItem.matchKind;
                            }
                            if (navItem.containerName && (navItem.containerName.length > 0)) {
                                bakedItem.containerName = navItem.containerName;
                            }
                            if (navItem.containerKind && (navItem.containerKind.length > 0)) {
                                bakedItem.containerKind = navItem.containerKind;
                            }
                            _this.abbreviate(bakedItem);
                            return bakedItem;
                        });
                        this.output(bakedNavItems, CommandNames.Navto, reqSeq);
                    }
                    else {
                        this.output(undefined, CommandNames.Navto, reqSeq, "no nav items");
                    }
                }
            };
            Session.prototype.executeJSONcmd = function (cmd) {
                var req = JSON.parse(cmd);
                switch (req.command) {
                    case CommandNames.Definition: {
                        var defArgs = req.arguments;
                        this.goToDefinition(defArgs.line, defArgs.col, defArgs.file, req.seq);
                        break;
                    }
                    case CommandNames.References: {
                        var refArgs = req.arguments;
                        this.findReferences(refArgs.line, refArgs.col, refArgs.file, req.seq);
                        break;
                    }
                    case CommandNames.Rename: {
                        var renameArgs = req.arguments;
                        this.rename(renameArgs.line, renameArgs.col, renameArgs.file, req.seq);
                        break;
                    }
                    case CommandNames.Type: {
                        var typeArgs = req.arguments;
                        this.goToType(typeArgs.line, typeArgs.col, typeArgs.file, req.seq);
                        break;
                    }
                    case CommandNames.Open: {
                        var openArgs = req.arguments;
                        this.openClientFile(openArgs.file);
                        break;
                    }
                    case CommandNames.Quickinfo: {
                        var quickinfoArgs = req.arguments;
                        this.quickInfo(quickinfoArgs.line, quickinfoArgs.col, quickinfoArgs.file, req.seq);
                        break;
                    }
                    case CommandNames.Format: {
                        var formatArgs = req.arguments;
                        this.format(formatArgs.line, formatArgs.col, formatArgs.endLine, formatArgs.endCol, formatArgs.file, cmd, req.seq);
                        break;
                    }
                    case CommandNames.Formatonkey: {
                        var formatOnKeyArgs = req.arguments;
                        this.formatOnKey(formatOnKeyArgs.line, formatOnKeyArgs.col, formatOnKeyArgs.key, formatOnKeyArgs.file, cmd, req.seq);
                        break;
                    }
                    case CommandNames.Completions: {
                        var completionsArgs = req.arguments;
                        this.completions(req.arguments.line, req.arguments.col, completionsArgs.prefix, req.arguments.file, cmd, req.seq);
                        break;
                    }
                    case CommandNames.Geterr: {
                        var geterrArgs = req.arguments;
                        this.geterr(geterrArgs.delay, geterrArgs.files);
                        break;
                    }
                    case CommandNames.Change: {
                        var changeArgs = req.arguments;
                        this.change(changeArgs.line, changeArgs.col, changeArgs.deleteLen, changeArgs.insertString, changeArgs.file);
                        break;
                    }
                    case CommandNames.Reload: {
                        var reloadArgs = req.arguments;
                        this.reload(reloadArgs.file, reloadArgs.tmpfile, req.seq);
                        break;
                    }
                    case CommandNames.Saveto: {
                        var savetoArgs = req.arguments;
                        this.saveToTmp(savetoArgs.file, savetoArgs.tmpfile);
                        break;
                    }
                    case CommandNames.Close: {
                        var closeArgs = req.arguments;
                        this.closeClientFile(closeArgs.file);
                        break;
                    }
                    case CommandNames.Navto: {
                        var navtoArgs = req.arguments;
                        this.navto(navtoArgs.searchTerm, navtoArgs.file, cmd, req.seq);
                        break;
                    }
                    default: {
                        this.projectService.log("Unrecognized JSON command: " + cmd);
                        break;
                    }
                }
            };
            Session.prototype.sendAbbrev = function (reqSeq) {
                if (reqSeq === void 0) { reqSeq = 0; }
                if (!this.fetchedAbbrev) {
                    this.output(this.abbrevTable, CommandNames.Abbrev, reqSeq);
                }
                this.fetchedAbbrev = true;
            };
            Session.prototype.listen = function () {
                var _this = this;
                rl.on('line', function (input) {
                    var cmd = input.trim();
                    if (cmd.indexOf("{") == 0) {
                        // assumption is JSON on single line
                        // plan is to also carry this protocol
                        // over tcp, in which case JSON would
                        // have a Content-Length header
                        _this.executeJSONcmd(cmd);
                    }
                    else {
                        var line, col, file;
                        var m;
                        try {
                            if (m = cmd.match(/^definition (\d+) (\d+) (.*)$/)) {
                                line = parseInt(m[1]);
                                col = parseInt(m[2]);
                                file = m[3];
                                _this.goToDefinition(line, col, file);
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
                                file = m[3];
                                _this.rename(line, col, file);
                            }
                            else if (m = cmd.match(/^type (\d+) (\d+) (.*)$/)) {
                                line = parseInt(m[1]);
                                col = parseInt(m[2]);
                                file = m[3];
                                _this.goToType(line, col, file);
                            }
                            else if (m = cmd.match(/^open (.*)$/)) {
                                file = m[1];
                                _this.openClientFile(file);
                            }
                            else if (m = cmd.match(/^references (\d+) (\d+) (.*)$/)) {
                                line = parseInt(m[1]);
                                col = parseInt(m[2]);
                                file = m[3];
                                _this.findReferences(line, col, file);
                            }
                            else if (m = cmd.match(/^quickinfo (\d+) (\d+) (.*)$/)) {
                                line = parseInt(m[1]);
                                col = parseInt(m[2]);
                                file = m[3];
                                _this.quickInfo(line, col, file);
                            }
                            else if (m = cmd.match(/^format (\d+) (\d+) (\d+) (\d+) (.*)$/)) {
                                // format line col endLine endCol file
                                line = parseInt(m[1]);
                                col = parseInt(m[2]);
                                var endLine = parseInt(m[3]);
                                var endCol = parseInt(m[4]);
                                file = m[5];
                                _this.format(line, col, endLine, endCol, file, cmd);
                            }
                            else if (m = cmd.match(/^formatonkey (\d+) (\d+) (\{\".*\"\})\s* (.*)$/)) {
                                line = parseInt(m[1]);
                                col = parseInt(m[2]);
                                var key = JSON.parse(m[3].substring(1, m[3].length - 1));
                                file = m[4];
                                _this.formatOnKey(line, col, key, file, cmd);
                            }
                            else if (m = cmd.match(/^completions (\d+) (\d+) (\{.*\})?\s*(.*)$/)) {
                                line = parseInt(m[1]);
                                col = parseInt(m[2]);
                                var prefix = "";
                                file = m[4];
                                if (m[3]) {
                                    prefix = m[3].substring(1, m[3].length - 1);
                                }
                                _this.completions(line, col, prefix, file, cmd);
                            }
                            else if (m = cmd.match(/^geterr (\d+) (.*)$/)) {
                                var ms = parseInt(m[1]);
                                var rawFiles = m[2];
                                _this.geterr(ms, rawFiles.split(';'));
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
                                file = m[6];
                                _this.change(line, col, deleteLen, insertString, file);
                            }
                            else if (m = cmd.match(/^reload (.*) from (.*)$/)) {
                                _this.reload(m[1], m[2]);
                            }
                            else if (m = cmd.match(/^save (.*) to (.*)$/)) {
                                _this.saveToTmp(m[1], m[2]);
                            }
                            else if (m = cmd.match(/^close (.*)$/)) {
                                _this.closeClientFile(m[1]);
                            }
                            else if (m = cmd.match(/^navto (\{.*\}) (.*)$/)) {
                                var searchTerm = m[1];
                                searchTerm = searchTerm.substring(1, searchTerm.length - 1);
                                _this.navto(searchTerm, m[2], cmd);
                            }
                            else if (m = cmd.match(/^navbar (.*)$/)) {
                                _this.navbar(m[1]);
                            }
                            else if (m = cmd.match(/^abbrev/)) {
                                _this.sendAbbrev();
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
                                _this.output(undefined, CommandNames.Unknown, 0, "Unrecognized command " + cmd);
                            }
                        }
                        catch (err) {
                            _this.logError(err, cmd);
                        }
                    }
                });
                rl.on('close', function () {
                    _this.projectService.closeLog();
                    process.exit(0);
                });
            };
            return Session;
        })();
        server.Session = Session;
    })(server = _ts.server || (_ts.server = {}));
})(ts || (ts = {}));
/// <reference path='protocol.ts' />
var ts;
(function (ts) {
    var server;
    (function (server) {
        new server.Session(true).listen();
    })(server = ts.server || (ts.server = {}));
})(ts || (ts = {}));
