import json

from .nodeclient import CommClient

class Location:
    def __init__(self, line=0, column=0):
        """
        Creates a Location object from the given line and column values. The line and column values are 0 based.
        """
        self.line = line
        self.column = column

class ServiceProxy:
    def __init__(self, comm=CommClient()):
        self.__comm = comm

    def change(self, path, location=Location(), removeLength=0, insertString=""):
        lineColStr = ServiceProxy.__lineColStr(location.line, location.column);
        insertLength = len(insertString)
        if insertLength > 0:
            encodedInsertStr = json.JSONEncoder().encode(insertString)
            self.__comm.postCmd("change {0} {1} {2} {{{3}}} {4}".format(lineColStr, removeLength, insertLength, encodedInsertStr, path))
        else:
            self.__comm.postCmd("change {0} {1} {2} {3}".format(lineColStr, removeLength, insertLength, path))

    def completions(self, path, location=Location(), prefix="", onCompleted=None):
        lineColStr = ServiceProxy.__lineColStr(location.line, location.column)
        self.__comm.sendCmd(onCompleted, "completions {0} {{{1}}} {2}".format(lineColStr, prefix, path))

    def definition(self, path, location=Location()):
        lineColStr = ServiceProxy.__lineColStr(location.line, location.column)
        return self.__comm.sendCmdSync("definition {0} {1}".format(lineColStr, path))

    def format(self, path, beginLoc=Location(), endLoc=Location()):
        beginLineColStr = ServiceProxy.__lineColStr(beginLoc.line, beginLoc.column)
        endLineColStr = ServiceProxy.__lineColStr(endLoc.line, endLoc.column)
        return self.__comm.sendCmdSync("format {0} {1} {2}".format(beginLineColStr, endLineColStr, path))

    def formatOnKey(self, path, location=Location(), key=""):
        lineColStr = ServiceProxy.__lineColStr(location.line, location.column)
        encodedKey = json.JSONEncoder().encode(key)
        return self.__comm.sendCmdSync("formatonkey {0} {{{1}}} {2}".format(lineColStr, encodedKey, path))

    def open(self, path):
        self.__comm.postCmd("open " + path)

    def references(self, path, location=Location()):
        lineColStr = ServiceProxy.__lineColStr(location.line, location.column)
        return self.__comm.sendCmdSync("references {0} {1}".format(lineColStr, path))

    def reload(self, path, alternatePath):
        cmd = "reload {0} from {1}".format(path, alternatePath)
        self.__comm.sendCmdSync(cmd)

    def rename(self, path, location=Location()):
        lineColStr = ServiceProxy.__lineColStr(location.line, location.column)
        return self.__comm.sendCmdSync("rename {0} {1}".format(lineColStr, path))

    def requestGetError(self, delay=0, pathList=[]):
        fileList = ""
        delimit = ""
        for path in pathList:
            fileList += delimit + path
            delimit = ";"
        self.__comm.postCmd("geterr {0} {1}".format(delay, fileList))

    def type(self, path, location=Location()):
        lineColStr = ServiceProxy.__lineColStr(location.line, location.column)
        return self.__comm.sendCmdSync("type {0} {1}".format(lineColStr, path))

    def quickInfo(self, path, location=Location(), onCompleted=None):
        lineColStr = ServiceProxy.__lineColStr(location.line, location.column)
        self.__comm.sendCmd(onCompleted, "quickinfo {0} {1}".format(lineColStr, path))

    @staticmethod
    def __lineColStr(line, col):
        return "{0} {1}".format(str(line + 1), str(col + 1))


