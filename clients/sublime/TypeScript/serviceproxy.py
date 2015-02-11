import collections
import json

from nodeclient import CommClient
import servicedefs
import jsonhelpers

class Location(collections.namedtuple("Location", "line col")):
    def __init__(self, line, col): pass

class ServiceProxy:
    def __init__(self, comm=CommClient()):
        self.__comm = comm

    def change(self, path, location=Location(0, 0), removeLength=0, insertString=""):
        req = servicedefs.ChangeRequest(servicedefs.ChangeRequestArgs(path, location.line + 1, location.col + 1,
                                                                      removeLength, len(insertString), insertString))
        jsonStr = jsonhelpers.encode(req)
        self.__comm.postCmd(jsonStr)

    def completions(self, path, location=Location(0, 0), prefix="", onCompleted=None):
        req = servicedefs.CompletionsRequest(servicedefs.CompletionsRequestArgs(path, location.line + 1, location.col + 1, prefix))
        jsonStr = jsonhelpers.encode(req)
        def onCompletedJson(json):
            obj = jsonhelpers.fromDict(servicedefs.CompletionsResponse, json)
            onCompleted(obj)
        self.__comm.sendCmd(onCompletedJson, jsonStr)

    def definition(self, path, location=Location(0, 0)):
        req = servicedefs.DefinitionRequest(servicedefs.CodeLocationRequestArgs(path, location.line + 1, location.col + 1))
        jsonStr = jsonhelpers.encode(req)
        jsonResp = self.__comm.sendCmdSync(jsonStr)
        return jsonhelpers.fromDict(servicedefs.DefinitionResponse, jsonResp)

    def format(self, path, beginLoc=Location(0, 0), endLoc=Location(0, 0)):
        beginLineColStr = ServiceProxy.__lineColStr(beginLoc)
        endLineColStr = ServiceProxy.__lineColStr(endLoc)
        return self.__comm.sendCmdSync("format {0} {1} {2}".format(beginLineColStr, endLineColStr, path))

    def formatOnKey(self, path, location=Location(0, 0), key=""):
        lineColStr = ServiceProxy.__lineColStr(location)
        encodedKey = json.JSONEncoder().encode(key)
        return self.__comm.sendCmdSync("formatonkey {0} {{{1}}} {2}".format(lineColStr, encodedKey, path))

    def open(self, path):
        req = servicedefs.OpenRequest(servicedefs.FileRequestArgs(path))
        jsonStr = jsonhelpers.encode(req)
        self.__comm.postCmd(jsonStr)

    def references(self, path, location=Location(0, 0)):
        req = servicedefs.ReferencesRequest(servicedefs.CodeLocationRequestArgs(path, location.line + 1, location.col + 1))
        jsonStr = jsonhelpers.encode(req)
        jsonResp = self.__comm.sendCmdSync(jsonStr)
        return jsonhelpers.fromDict(servicedefs.ReferencesResponse, jsonResp)

    def reload(self, path, alternatePath):
        req = servicedefs.ReloadRequest(servicedefs.ReloadRequestArgs(path, alternatePath))
        jsonStr = jsonhelpers.encode(req)
        jsonResp = self.__comm.sendCmdSync(jsonStr)
        return jsonhelpers.fromDict(servicedefs.ReloadResponse, jsonResp)

    def rename(self, path, location=Location(0, 0)):
        req = servicedefs.RenameRequest(servicedefs.CodeLocationRequestArgs(path, location.line + 1, location.col + 1))
        jsonStr = jsonhelpers.encode(req)
        jsonResp = self.__comm.sendCmdSync(jsonStr)
        return jsonhelpers.fromDict(servicedefs.RenameResponse, jsonResp)

    def requestGetError(self, delay=0, pathList=[]):
        fileList = ""
        delimit = ""
        for path in pathList:
            fileList += delimit + path
            delimit = ";"
        self.__comm.postCmd("geterr {0} {1}".format(delay, fileList))

    def type(self, path, location=Location(0, 0)):
        req = servicedefs.TypeRequest(servicedefs.CodeLocationRequestArgs(path, location.line + 1, location.col + 1))
        jsonStr = jsonhelpers.encode(req)
        jsonResp = self.__comm.sendCmdSync(jsonStr)
        return jsonhelpers.fromDict(servicedefs.TypeResponse, jsonResp)

    def quickInfo(self, path, location=Location(0, 0), onCompleted=None):
        req = servicedefs.QuickInfoRequest(servicedefs.CodeLocationRequestArgs(path, location.line + 1, location.col + 1))
        jsonStr = jsonhelpers.encode(req)
        def onCompletedJson(json):
            obj = jsonhelpers.fromDict(servicedefs.QuickInfoResponse, json)
            onCompleted(obj)
        self.__comm.sendCmd(onCompletedJson, jsonStr)

    @staticmethod
    def __lineColStr(location):
        return "{0} {1}".format(str(location.line + 1), str(location.col + 1))


