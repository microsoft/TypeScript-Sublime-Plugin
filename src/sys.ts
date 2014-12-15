///<reference path='node.d.ts' />
///<reference path='tsio.ts' />

interface System {
    args: string[];
    newLine: string;
    useCaseSensitiveFileNames: boolean;
    write(s: string): void;
    readFile(fileName: string, encoding?: string): string;
    writeFile(fileName: string, data: string, writeByteOrderMark?: boolean): void;
    watchFile?(fileName: string, callback: (fileName: string) => void): FileWatcher;
    resolvePath(path: string): string;
    fileExists(path: string): boolean;
    directoryExists(path: string): boolean;
    createDirectory(directoryName: string): void;
    getExecutingFilePath(): string;
    getCurrentDirectory(): string;
    getMemoryUsage?(): number;
    exit(exitCode?: number): void;
}

interface FileWatcher {
    close(): void;
}

var sys: System = (function () {
    function getNodeSystem(): System {
        var _fs = require("fs");
        var _path = require("path");
        var _os = require('os');

        var platform: string = _os.platform();
        // win32\win64 are case insensitive platforms, MacOS (darwin) by default is also case insensitive
        var useCaseSensitiveFileNames = platform !== "win32" && platform !== "win64" && platform !== "darwin";

        function readFile(fileName: string, encoding?: string): string {
            if (!_fs.existsSync(fileName)) {
                return undefined;
            }
            var buffer = _fs.readFileSync(fileName);
            var len = buffer.length;
            if (len >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
                // Big endian UTF-16 byte order mark detected. Since big endian is not supported by node.js,
                // flip all byte pairs and treat as little endian.
                len &= ~1;
                for (var i = 0; i < len; i += 2) {
                    var temp = buffer[i];
                    buffer[i] = buffer[i + 1];
                    buffer[i + 1] = temp;
                }
                return buffer.toString("utf16le", 2);
            }
            if (len >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
                // Little endian UTF-16 byte order mark detected
                return buffer.toString("utf16le", 2);
            }
            if (len >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
                // UTF-8 byte order mark detected
                return buffer.toString("utf8", 3);
            }
            // Default is UTF-8 with no byte order mark
            return buffer.toString("utf8");
        }

        function writeFile(fileName: string, data: string, writeByteOrderMark?: boolean): void {
            // If a BOM is required, emit one
            if (writeByteOrderMark) {
                data = '\uFEFF' + data;
            }

            _fs.writeFileSync(fileName, data, "utf8");
        }

        return {
            args: process.argv.slice(2),
            newLine: _os.EOL,
            useCaseSensitiveFileNames: useCaseSensitiveFileNames,
            write(s: string): void {
               // 1 is a standard descriptor for stdout
               _fs.writeSync(1, s);
            },
            readFile: readFile,
            writeFile: writeFile,
            watchFile: (fileName, callback) => {
                // watchFile polls a file every 250ms, picking up file notifications.
                _fs.watchFile(fileName, { persistent: true, interval: 250 }, fileChanged);

                return {
                    close() { _fs.unwatchFile(fileName, fileChanged); }
                };

                function fileChanged(curr: any, prev: any) {
                    if (+curr.mtime <= +prev.mtime) {
                        return;
                    }

                    callback(fileName);
                };
            },
            resolvePath: function (path: string): string {
                return _path.resolve(path);
            },
            fileExists(path: string): boolean {
                return _fs.existsSync(path);
            },
            directoryExists(path: string) {
                return _fs.existsSync(path) && _fs.statSync(path).isDirectory();
            },
            createDirectory(directoryName: string) {
                if (!this.directoryExists(directoryName)) {
                    _fs.mkdirSync(directoryName);
                }
            },
            getExecutingFilePath() {
                return __dirname;
            },
            getCurrentDirectory() {
                return (<any>process).cwd();
            },
            getMemoryUsage() {
                if (global.gc) {
                    global.gc();
                }
                return process.memoryUsage().heapUsed;
            },
            exit(exitCode?: number): void {
                process.exit(exitCode);
            }
        };
    }
    return getNodeSystem();
})();
