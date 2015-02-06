import collections
import json

from nodeclient import CommClient

class Location(collections.namedtuple("Location", "line col")):
    def __init__(self, line, col): pass

class ServiceProxy:
    def __init__(self, comm=CommClient()):
        self.__comm = comm

    def change(self, path, location=Location(0, 0), removeLength=0, insertString=""):
        lineColStr = ServiceProxy.__lineColStr(location)
        insertLength = len(insertString)
        if insertLength > 0:
            encodedInsertStr = json.JSONEncoder().encode(insertString)
            self.__comm.postCmd("change {0} {1} {2} {{{3}}} {4}".format(lineColStr, removeLength, insertLength, encodedInsertStr, path))
        else:
            self.__comm.postCmd("change {0} {1} {2} {3}".format(lineColStr, removeLength, insertLength, path))

    def completions(self, path, location=Location(0, 0), prefix="", onCompleted=None):
        lineColStr = ServiceProxy.__lineColStr(location)
        self.__comm.sendCmd(onCompleted, "completions {0} {{{1}}} {2}".format(lineColStr, prefix, path))

    def definition(self, path, location=Location(0, 0)):
        lineColStr = ServiceProxy.__lineColStr(location)
        return self.__comm.sendCmdSync("definition {0} {1}".format(lineColStr, path))

    def format(self, path, beginLoc=Location(0, 0), endLoc=Location(0, 0)):
        beginLineColStr = ServiceProxy.__lineColStr(beginLoc)
        endLineColStr = ServiceProxy.__lineColStr(endLoc)
        return self.__comm.sendCmdSync("format {0} {1} {2}".format(beginLineColStr, endLineColStr, path))

    def formatOnKey(self, path, location=Location(0, 0), key=""):
        lineColStr = ServiceProxy.__lineColStr(location)
        encodedKey = json.JSONEncoder().encode(key)
        return self.__comm.sendCmdSync("formatonkey {0} {{{1}}} {2}".format(lineColStr, encodedKey, path))

    def open(self, path):
        self.__comm.postCmd("open " + path)

    def references(self, path, location=Location(0, 0)):
        lineColStr = ServiceProxy.__lineColStr(location)
        return self.__comm.sendCmdSync("references {0} {1}".format(lineColStr, path))

    def reload(self, path, alternatePath):
        cmd = "reload {0} from {1}".format(path, alternatePath)
        self.__comm.sendCmdSync(cmd)

    def rename(self, path, location=Location(0, 0)):
        lineColStr = ServiceProxy.__lineColStr(location)
        return self.__comm.sendCmdSync("rename {0} {1}".format(lineColStr, path))

    def requestGetError(self, delay=0, pathList=[]):
        fileList = ""
        delimit = ""
        for path in pathList:
            fileList += delimit + path
            delimit = ";"
        self.__comm.postCmd("geterr {0} {1}".format(delay, fileList))

    def type(self, path, location=Location(0, 0)):
        lineColStr = ServiceProxy.__lineColStr(location)
        return self.__comm.sendCmdSync("type {0} {1}".format(lineColStr, path))

    def quickInfo(self, path, location=Location(0, 0), onCompleted=None):
        lineColStr = ServiceProxy.__lineColStr(location)
        self.__comm.sendCmd(onCompleted, "quickinfo {0} {1}".format(lineColStr, path))

    @staticmethod
    def __lineColStr(location):
        return "{0} {1}".format(str(location.line + 1), str(location.col + 1))


