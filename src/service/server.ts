/// <reference path="node.d.ts" />
/// <reference path="protocol.ts" />

module ts.server {
    var ts: typeof typescript = require('typescript');
    var nodeproto: typeof NodeJS._debugger = require('_debugger');
    var readline: NodeJS.ReadLine = require('readline');
    var path: NodeJS.Path = require('path');
    var fs: typeof NodeJS.fs = require('fs');

    // Wire sys methods
    if (!ts.sys.getModififedTime) {
        ts.sys.getModififedTime = function (fileName: string): Date {
            var stats = fs.statSync(fileName);
            return stats.mtime;
        };
    }
    if (!ts.sys.stat) {
        ts.sys.stat = function (fileName: string, callback?: (err: any, stats: any) => any) {
            fs.stat(fileName, callback);
        }
    }

    var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
    });

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

    function printObject(obj: any) {
        for (var p in obj) {
            if (obj.hasOwnProperty(p)) {
                console.log(p + ": " + obj[p]);
            }
        }
    }

    class Logger implements ts.server.Logger {
        fd = -1;
        seq = 0;
        inGroup = false;
        firstInGroup = true;

        constructor(public logFilename: string) {
        }

        static padStringRight(str: string, padding: string) {
            return (str + padding).slice(0, padding.length);
        }

        close() {
            if (this.fd >= 0) {
                fs.close(this.fd);
            }
        }

        perftrc(s: string) {
            this.msg(s, "Perf");
        }

        info(s: string) {
            this.msg(s, "Info");
        }

        startGroup() {
            this.inGroup = true;
            this.firstInGroup = true;
        }

        endGroup() {
            this.inGroup = false;
            this.seq++;
            this.firstInGroup = true;
        }

        msg(s: string, type = "Err") {
            if (this.fd < 0) {
                this.fd = fs.openSync(this.logFilename, "w");
            }
            if (this.fd >= 0) {
                s = s + "\n";
                var prefix = Logger.padStringRight(type + " " + this.seq.toString(), "          ");
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
        }
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
            this.client.on('break',(res: NodeJS._debugger.Event) => {
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

    class DebuggerSession extends Session {
        debugSession: JsDebugSession;

        constructor(host: ServerHost, logger: ts.server.Logger, useProtocol: boolean, prettyJSON: boolean) {
            super(host, logger, useProtocol, prettyJSON);
        }

        executeCmd(cmd: string) {
            // Handel debugger commands
            var line: number, col: number, file: string;
            var m: string[];

            try {
                if (m = cmd.match(/^dbg start$/)) {
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
                else {
                    super.executeCmd(cmd);
                }
            }
            catch (err) {
                this.logError(err, cmd);
            }
        }
    }

    class IOSession extends DebuggerSession {
        protocol: NodeJS._debugger.Protocol;

        constructor(host: ServerHost, logger: ts.server.Logger, useProtocol: boolean, prettyJSON: boolean) {
            super(host, logger, useProtocol, prettyJSON);
            if (useProtocol) {
                this.initProtocol();
            }
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
            this.projectService.log("Got JSON msg:\n" + req.raw);
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
                    this.executeCmd(cmd);
                }
            });

            rl.on('close',() => {
                this.projectService.closeLog();
                this.projectService.log("Exiting...");
                process.exit(0);
            });
        }
    }

    // This places log file in the directory containing editorServices.js
    // TODO: check that this location is writable
    var logger = new Logger(__dirname + "/.log" + process.pid.toString());
    
    // set the global logger object 
    globalLogger = logger;

    // Start listening
    new IOSession(ts.sys, logger, /* useProtocol */ true, /* prettyJSON */ false).listen();
}