import collections

import jsonhelpers
import servicedefs
from nodeclient import CommClient
from servicedefs import Location

class ServiceProxy:
    def __init__(self, comm=CommClient()):
        self.__comm = comm
        self.seq = 1

    def incrSeq(self):
        temp = self.seq
        self.seq += 1
        return temp

    def change(self, path, location=Location(1, 1), endLocation=Location(1,1), insertString=""):
        req = servicedefs.ChangeRequest(self.incrSeq(),servicedefs.ChangeRequestArgs(path, location.line, location.col,
                                                                                     endLocation.line, endLocation.col,
                                                                                     insertString))
        jsonStr = jsonhelpers.encode(req)
        self.__comm.postCmd(jsonStr)

    def completions(self, path, location=Location(1, 1), prefix="", onCompleted=None):
        req = servicedefs.CompletionsRequest(self.incrSeq(),
                                             servicedefs.CompletionsRequestArgs(path, location.line, location.col, prefix))
        jsonStr = jsonhelpers.encode(req)
        def onCompletedJson(responseDict):
            obj = jsonhelpers.fromDict(servicedefs.CompletionsResponse, responseDict)
            onCompleted(obj)
        self.__comm.sendCmd(onCompletedJson, jsonStr, req.seq)

    def definition(self, path, location=Location(1, 1)):
        req = servicedefs.DefinitionRequest(self.incrSeq(), servicedefs.FileLocationRequestArgs(path, location.line, location.col))
        jsonStr = jsonhelpers.encode(req)
        responseDict = self.__comm.sendCmdSync(jsonStr, req.seq)
        return jsonhelpers.fromDict(servicedefs.DefinitionResponse,responseDict)

    def format(self, path, beginLoc=Location(1, 1), endLoc=Location(1, 1)):
        req = servicedefs.FormatRequest(self.incrSeq(),
                                        servicedefs.FormatRequestArgs(path, beginLoc.line, beginLoc.col, endLoc.line, endLoc.col))
        jsonStr = jsonhelpers.encode(req)
        responseDict = self.__comm.sendCmdSync(jsonStr, req.seq)
        return jsonhelpers.fromDict(servicedefs.FormatResponse, responseDict)

    def formatOnKey(self, path, location=Location(1, 1), key=""):
        req = servicedefs.FormatOnKeyRequest(self.incrSeq(),
                                             servicedefs.FormatOnKeyRequestArgs(path, location.line, location.col, key))
        jsonStr = jsonhelpers.encode(req)
        responseDict = self.__comm.sendCmdSync(jsonStr, req.seq)
        return jsonhelpers.fromDict(servicedefs.FormatResponse, responseDict)

    def open(self, path):
        req = servicedefs.OpenRequest(self.incrSeq(), servicedefs.FileRequestArgs(path))
        jsonStr = jsonhelpers.encode(req)
        self.__comm.postCmd(jsonStr)

    def close(self, path):
        req = servicedefs.CloseRequest(self.incrSeq(), servicedefs.FileRequestArgs(path))
        jsonStr = jsonhelpers.encode(req)
        self.__comm.postCmd(jsonStr)

    def references(self, path, location=Location(1, 1)):
        req = servicedefs.ReferencesRequest(self.incrSeq(), servicedefs.FileLocationRequestArgs(path, location.line, location.col))
        jsonStr = jsonhelpers.encode(req)
        responseDict = self.__comm.sendCmdSync(jsonStr, req.seq)
        return jsonhelpers.fromDict(servicedefs.ReferencesResponse, responseDict)

    def reload(self, path, alternatePath):
        req = servicedefs.ReloadRequest(self.incrSeq(), servicedefs.ReloadRequestArgs(path, alternatePath))
        jsonStr = jsonhelpers.encode(req)
        responseDict = self.__comm.sendCmdSync(jsonStr, req.seq)
        return jsonhelpers.fromDict(servicedefs.ReloadResponse, responseDict)

    def rename(self, path, location=Location(1, 1)):
        req = servicedefs.RenameRequest(self.incrSeq(), servicedefs.FileLocationRequestArgs(path, location.line, location.col))
        jsonStr = jsonhelpers.encode(req)
        responseDict = self.__comm.sendCmdSync(jsonStr, req.seq)
        return jsonhelpers.fromDict(servicedefs.RenameResponse, responseDict)

    def requestGetError(self, delay=0, pathList=[]):
        req = servicedefs.GeterrRequest(self.incrSeq(), servicedefs.GeterrRequestArgs(pathList, delay))
        jsonStr = jsonhelpers.encode(req)
        self.__comm.postCmd(jsonStr)

    def type(self, path, location=Location(1, 1)):
        req = servicedefs.TypeRequest(self.incrSeq(), servicedefs.FileLocationRequestArgs(path, location.line, location.col))
        jsonStr = jsonhelpers.encode(req)
        responseDict = self.__comm.sendCmdSync(jsonStr, req.seq)
        return jsonhelpers.fromDict(servicedefs.TypeResponse, responseDict)

    def quickInfo(self, path, location=Location(1, 1), onCompleted=None):
        req = servicedefs.QuickInfoRequest(self.incrSeq(), servicedefs.FileLocationRequestArgs(path, location.line, location.col))
        jsonStr = jsonhelpers.encode(req)
        def onCompletedJson(json):
            obj = jsonhelpers.fromDict(servicedefs.QuickInfoResponse, json)
            if onCompleted:
                onCompleted(obj)
        self.__comm.sendCmd(onCompletedJson, jsonStr, req.seq)

    def getEvent(self):
        event = None
        evJsonStr = self.__comm.getEvent()
        if not evJsonStr is None:
            event = jsonhelpers.decode(servicedefs.Event, evJsonStr)
            if event.event == "syntaxDiag" or event.event == "semanticDiag":
                event = jsonhelpers.decode(servicedefs.DiagnosticEvent, evJsonStr)
        return event


    def saveto(self, path, alternatePath):
        req = servicedefs.SavetoRequest(self.incrSeq(), servicedefs.ReloadRequestArgs(path, alternatePath))
        jsonStr = jsonhelpers.encode(req)
        self.__comm.postCmd(jsonStr)        
