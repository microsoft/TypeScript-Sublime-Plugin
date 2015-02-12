import collections

import jsonhelpers
import servicedefs
from nodeclient import CommClient
from servicedefs import LineCol

class ServiceProxy:
    def __init__(self, comm=CommClient()):
        self.__comm = comm

    def change(self, path, location=LineCol(1, 1), removeLength=0, insertString=""):
        req = servicedefs.ChangeRequest(servicedefs.ChangeRequestArgs(path, location.line, location.col,
                                                                      removeLength, len(insertString), insertString))
        jsonStr = jsonhelpers.encode(req)
        self.__comm.postCmd(jsonStr)

    def completions(self, path, location=LineCol(1, 1), prefix="", onCompleted=None):
        req = servicedefs.CompletionsRequest(servicedefs.CompletionsRequestArgs(path, location.line, location.col, prefix))
        jsonStr = jsonhelpers.encode(req)
        def onCompletedJson(json):
            obj = jsonhelpers.decode(servicedefs.CompletionsResponse, json)
            onCompleted(obj)
        self.__comm.sendCmd(onCompletedJson, jsonStr)

    def definition(self, path, location=LineCol(1, 1)):
        req = servicedefs.DefinitionRequest(servicedefs.CodeLocationRequestArgs(path, location.line, location.col))
        jsonStr = jsonhelpers.encode(req)
        jsonRespStr = self.__comm.sendCmdSync(jsonStr)
        return jsonhelpers.decode(servicedefs.DefinitionResponse, jsonRespStr)

    def format(self, path, beginLoc=LineCol(1, 1), endLoc=LineCol(1, 1)):
        req = servicedefs.FormatRequest(servicedefs.FormatRequestArgs(path, beginLoc.line, beginLoc.col, endLoc.line, endLoc.col))
        jsonStr = jsonhelpers.encode(req)
        jsonRespStr = self.__comm.sendCmdSync(jsonStr)
        return jsonhelpers.decode(servicedefs.FormatResponse, jsonRespStr)

    def formatOnKey(self, path, location=LineCol(1, 1), key=""):
        req = servicedefs.FormatOnKeyRequest(servicedefs.FormatOnKeyRequestArgs(path, location.line, location.col, key))
        jsonStr = jsonhelpers.encode(req)
        jsonRespStr = self.__comm.sendCmdSync(jsonStr)
        return jsonhelpers.decode(servicedefs.FormatResponse, jsonRespStr)

    def open(self, path):
        req = servicedefs.OpenRequest(servicedefs.FileRequestArgs(path))
        jsonStr = jsonhelpers.encode(req)
        self.__comm.postCmd(jsonStr)

    def references(self, path, location=LineCol(1, 1)):
        req = servicedefs.ReferencesRequest(servicedefs.CodeLocationRequestArgs(path, location.line, location.col))
        jsonStr = jsonhelpers.encode(req)
        jsonRespStr = self.__comm.sendCmdSync(jsonStr)
        return jsonhelpers.decode(servicedefs.ReferencesResponse, jsonRespStr)

    def reload(self, path, alternatePath):
        req = servicedefs.ReloadRequest(servicedefs.ReloadRequestArgs(path, alternatePath))
        jsonStr = jsonhelpers.encode(req)
        jsonRespStr = self.__comm.sendCmdSync(jsonStr)
        return jsonhelpers.decode(servicedefs.ReloadResponse, jsonRespStr)

    def rename(self, path, location=LineCol(1, 1)):
        req = servicedefs.RenameRequest(servicedefs.CodeLocationRequestArgs(path, location.line, location.col))
        jsonStr = jsonhelpers.encode(req)
        jsonRespStr = self.__comm.sendCmdSync(jsonStr)
        return jsonhelpers.decode(servicedefs.RenameResponse, jsonRespStr)

    def requestGetError(self, delay=0, pathList=[]):
        fileList = ""
        delimit = ""
        for path in pathList:
            fileList += delimit + path
            delimit = ";"
        req = servicedefs.GeterrRequest(servicedefs.GeterrRequestArgs(fileList, delay))
        jsonStr = jsonhelpers.encode(req)
        self.__comm.postCmd(jsonStr)

    def type(self, path, location=LineCol(1, 1)):
        req = servicedefs.TypeRequest(servicedefs.CodeLocationRequestArgs(path, location.line, location.col))
        jsonStr = jsonhelpers.encode(req)
        jsonRespStr = self.__comm.sendCmdSync(jsonStr)
        return jsonhelpers.decode(servicedefs.TypeResponse, jsonRespStr)

    def quickInfo(self, path, location=LineCol(1, 1), onCompleted=None):
        req = servicedefs.QuickInfoRequest(servicedefs.CodeLocationRequestArgs(path, location.line, location.col))
        jsonStr = jsonhelpers.encode(req)
        def onCompletedJson(json):
            obj = jsonhelpers.decode(servicedefs.QuickInfoResponse, json)
            onCompleted(obj)
        self.__comm.sendCmd(onCompletedJson, jsonStr)

    def getEvent(self):
        event = None
        evJsonStr = self.__comm.getEvent()
        if not evJsonStr is None:
            event = jsonhelpers.decode(servicedefs.Event, evJsonStr)
            if event.event == "syntaxDiag" or event.event == "semanticDiag":
                event = jsonhelpers.decode(servicedefs.DiagEvent, evJsonStr)
        return event



