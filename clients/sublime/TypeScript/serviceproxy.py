import json

from nodeclient import CommClient

class Location:
    def __init__(self, line=0, column=0):
        self.line = line
        self.column = column

class ServiceProxy:
    def __init__(self, comm=CommClient()):
        self.__comm = comm

    def open(self, path):
        self.__comm.postCmd("open " + path)

    def reload(self, path, alternatePath):
        cmd = "reload {0} from {1}".format(path, alternatePath)
        self.__comm.sendCmdSync(cmd)

    def change(self, path, location=Location(), removeLength=0, insertString=""):
        lineColStr = ServiceProxy.__cmdLineCol("change", location.line, location.column);
        insertLength = len(insertString)
        if insertLength > 0:
            encodedInsertStr = json.JSONEncoder().encode(insertString)
            self.__comm.postCmd("{0} {1} {2} {{{3}}} {4}".format(lineColStr, removeLength, insertLength, encodedInsertStr, path))
        else:
            self.__comm.postCmd("{0} {1} {2} {3}".format(lineColStr, removeLength, insertLength, path))

    def requestGetError(self, delay=0, pathList=[]):
        fileList = ""
        delimit = ""
        for path in pathList:
            fileList += delimit + path
            delimit = ";"
        self.__comm.postCmd("geterr {0} {1}".format(delay, fileList))


    @staticmethod
    def __cmdLineCol(cmdName, line, col):
        return "{0} {1} {2}".format(cmdName, line, col)


