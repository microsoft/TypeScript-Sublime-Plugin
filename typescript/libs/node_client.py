import os
import subprocess
import threading
import time
import json
import sublime
import sublime_plugin

from .logger import log
from . import json_helpers
from . import global_vars

# queue module name changed from Python 2 to 3
if int(sublime.version()) < 3000:
    import Queue as queue
else:
    import queue


class CommClient:
    def serverStarted(self): pass

    def workerStarted(self): pass

    def getEvent(self): pass

    def getEventFromWorker(self): pass

    def postCmd(self, cmd): pass

    def postCmdToWorker(self, cmd): pass
    
    def sendCmd(self, cmd, cb): pass

    def sendCmdToWorker(self, cmd, cb): pass

    def sendCmdSync(self, cmd): pass

    def sendCmdToWorkerSync(self, cmd, cb): pass
    
    def sendCmdAsync(self, cmd, cb): pass

    def sendCmdToWorkerAsync(self, cmd, cb): pass


class NodeCommClient(CommClient):
    __CONTENT_LENGTH_HEADER = b"Content-Length: "
    stop_worker = False

    def __init__(self, scriptPath):
        """
        Starts a node client (if not already started) and communicate with it. 
        The script file to run is passed to the constructor.
        """

        self.asyncReq = {}
        self.__serverProc = None
        self.__workerProc = None
        self.script_path = scriptPath

        # create response and event queues
        self.__msgq = queue.Queue()
        self.__eventq = queue.Queue()
        self.__worker_eventq = queue.Queue()

        # start node process
        pref_settings = sublime.load_settings('Preferences.sublime-settings')
        node_path = pref_settings.get('node_path')
        if node_path:
            node_path = os.path.expandvars(node_path)
        if not node_path:
            if os.name == "nt":
                node_path = "node"
            else:
                node_path = NodeCommClient.__which("node")
        if not node_path:
            path_list = os.environ["PATH"] + os.pathsep + "/usr/local/bin" + os.pathsep + "$NVM_BIN"
            print("Unable to find executable file for node on path list: " + path_list)
            print("To specify the node executable file name, use the 'node_path' setting")
            self.__serverProc = None
        else:
            global_vars._node_path = node_path
            print("Found node executable at " + node_path)
            try:
                if os.name == "nt":
                    # linux subprocess module does not have STARTUPINFO
                    # so only use it if on Windows
                    si = subprocess.STARTUPINFO()
                    si.dwFlags |= subprocess.SW_HIDE | subprocess.STARTF_USESHOWWINDOW
                    self.__serverProc = subprocess.Popen([node_path, scriptPath],
                                                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, startupinfo=si)
                else:
                    log.debug("opening " + node_path + " " + scriptPath)
                    self.__serverProc = subprocess.Popen([node_path, scriptPath],
                                                         stdin=subprocess.PIPE, stdout=subprocess.PIPE)
            except:
                self.__serverProc = None
        # start reader thread
        if self.__serverProc and (not self.__serverProc.poll()):
            log.debug("server proc " + str(self.__serverProc))
            log.debug("starting reader thread")
            readerThread = threading.Thread(target=NodeCommClient.__reader, args=(
                self.__serverProc.stdout, self.__msgq, self.__eventq, self.asyncReq, self.__serverProc))
            readerThread.daemon = True
            readerThread.start()

        self.__debugProc = None
        self.__breakpoints = []

    def startWorker(self):
        NodeCommClient.stop_worker = False

        node_path = global_vars.get_node_path()
        if os.name == "nt":
            si = subprocess.STARTUPINFO()
            si.dwFlags |= subprocess.SW_HIDE | subprocess.STARTF_USESHOWWINDOW
            self.__workerProc = subprocess.Popen(
                [node_path, self.script_path], stdin=subprocess.PIPE, stdout=subprocess.PIPE, startupinfo=si
            )
        else:
            self.__workerProc = subprocess.Popen(
                [node_path, self.script_path], stdin=subprocess.PIPE, stdout=subprocess.PIPE)

        # start reader thread
        if self.__serverProc and (not self.__serverProc.poll()):
            log.debug("server proc " + str(self.__serverProc))
            log.debug("starting reader thread")
            readerThread = threading.Thread(target=NodeCommClient.__reader, args=(
                self.__serverProc.stdout, self.__msgq, self.__eventq, self.asyncReq, self.__serverProc))
            readerThread.daemon = True
            readerThread.start()
            log.debug("readerThread.is_alive: {0}".format(readerThread.is_alive()))

    def stopWorker(self):
        NodeCommClient.stop_worker = True

    def serverStarted(self):
        return self.__serverProc is not None

    def workerStarted(self):
        return self.__workerProc is not None

    # work in progress
    def addBreakpoint(self, file, line):
        self.__breakpoints.append((file, line))

    # work in progress
    def debug(self, file):
        # TODO: msg if already debugging
        self.__debugProc = subprocess.Popen(["node", "--debug", file],
                                            stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def makeTimeoutMsg(self, cmd, seq):
        jsonDict = json_helpers.decode(cmd)
        timeoutMsg = {
            "seq": 0,
            "type": "response",
            "success": False,
            "request_seq": seq,
            "command": jsonDict["command"],
            "message": "timeout"
        }
        return timeoutMsg

    def sendCmd(self, cmd, cb, seq):
        """
        send single-line command string; no sequence number; wait for response
        this assumes stdin/stdout; for TCP, need to add correlation with sequence numbers
        """
        if self.postCmd(cmd):
            reqSeq = -1
            try:
                while reqSeq < seq:
                    data = self.__msgq.get(True, 1)
                    dict = json_helpers.decode(data)
                    reqSeq = dict['request_seq']
                if cb:
                    cb(dict)
            except queue.Empty:
                print("queue timeout")
                if (cb):
                    cb(self.makeTimeoutMsg(cmd, seq))
        else:
            if (cb):
                cb(self.makeTimeoutMsg(cmd, seq))

    def sendCmdAsync(self, cmd, cb, seq):
        """
        Sends the command and registers a callback
        """
        if self.postCmd(cmd):
            self.asyncReq[seq] = cb

    def sendCmdToWorkerAsync(self, cmd, cb, seq):
        """
        Sends the command and registers a callback
        """
        if self.postCmdToWorker(cmd):
            self.asyncReq[seq] = cb

    def sendCmdSync(self, cmd, seq):
        """
        Sends the command and wait for the result and returns it
        """
        if self.postCmd(cmd):
            reqSeq = -1
            try:
                while reqSeq < seq:
                    data = self.__msgq.get(True, 1)
                    dict = json_helpers.decode(data)
                    reqSeq = dict['request_seq']
                return dict
            except queue.Empty:
                print("queue timeout")
                return self.makeTimeoutMsg(cmd, seq)
        else:
            return self.makeTimeoutMsg(cmd, seq)

    def sendCmdToWorkerSync(self, cmd, seq):
        """
        Sends the command and wait for the result and returns it
        """
        if self.postCmdToWorker(cmd):
            reqSeq = -1
            try:
                while reqSeq < seq:
                    data = self.__msgq.get(True, 1)
                    dict = json_helpers.decode(data)
                    reqSeq = dict['request_seq']
                return dict
            except queue.Empty:
                print("queue timeout")
                return self.makeTimeoutMsg(cmd, seq)
        else:
            return self.makeTimeoutMsg(cmd, seq)

    def postCmd(self, cmd):
        """
        Post command to server; no response needed
        """
        log.debug('Posting command: {0}'.format(cmd))
        if not self.__serverProc:
            log.error("can not send request; node process not running")
            return False
        else:
            cmd = cmd + "\n"
            self.__serverProc.stdin.write(cmd.encode())
            self.__serverProc.stdin.flush()
            return True

    def postCmdToWorker(self, cmd):
        """
        Post command to worker process; no response needed
        """
        log.debug('Posting command to worker: {0}'.format(cmd))
        if not self.__workerProc:
            log.error("can not send request; worker process not running")
            return False
        else:
            cmd += "\n"
            self.__workerProc.stdin.write(cmd.encode())
            self.__workerProc.stdin.flush()
            return True

    def getEvent(self):
        """
        Try to get event from event queue
        """
        try:
            ev = self.__eventq.get(False)
        except:
            return None
        return ev

    def getEventFromWorker(self):
        try:
            ev = self.__worker_eventq.get(False)
        except:
            return None
        return ev

    @staticmethod
    def __readMsg(stream, msgq, eventq, asyncReq, proc):
        """
        Reader thread helper
        """
        state = "init"
        body_length = 0
        while state != "body":
            header = stream.readline().strip()
            # log.debug(
            #     'Stream state: "{0}".  Read header: "{1}"'.format(
            #         state,
            #         header if header else 'None'
            #     )
            # )
            if len(header) == 0:
                if state == 'init':
                    # log.info('0 byte line in stream when expecting header')
                    return proc.poll() is not None
                else:
                    # Done reading header
                    state = "body"
            else:
                state = 'header'
                if header.startswith(NodeCommClient.__CONTENT_LENGTH_HEADER):
                    body_length = int(header[len(NodeCommClient.__CONTENT_LENGTH_HEADER):])

        if body_length > 0:
            data = stream.read(body_length)
            log.debug('Read body of length: {0}'.format(body_length))
            data_json = data.decode("utf-8")
            data_dict = json_helpers.decode(data_json)
            if data_dict['type'] == "response":
                request_seq = data_dict['request_seq']
                log.debug('Body sequence#: {0}'.format(request_seq))
                if request_seq in asyncReq:
                    callback = asyncReq.pop(request_seq, None)
                    if callback:
                        callback(data_dict)
                        return False
                else:
                    # Only put in the queue if wasn't an async request
                    msgq.put(data_json)
            else:
                eventq.put(data_json)
        else:
            log.info('Body length of 0 in server stream')
            return False

    @staticmethod
    def __reader(stream, msgq, eventq, asyncReq, proc):
        """ Main function for reader thread """
        while True:
            if NodeCommClient.__readMsg(stream, msgq, eventq, asyncReq, proc):
                log.debug("server exited")
                return

    @staticmethod
    def __worker_reader(stream, msgq, eventq, asyncReq, proc):
        """ Main function for worker thread """
        while True:
            if NodeCommClient.__readMsg(stream, msgq, eventq, asyncReq, proc) or NodeCommClient.stop_worker:
                log.debug("worker exited")
                return

    @staticmethod
    def __which(program):
        def is_executable(fpath):
            return os.path.isfile(fpath) and os.access(fpath, os.X_OK)

        fpath, fname = os.path.split(program)
        if fpath:
            if is_executable(program):
                return program
        else:
            # /usr/local/bin is not on mac default path
            # but is where node is typically installed on mac
            path_list = os.environ["PATH"] + os.pathsep + "/usr/local/bin" + os.pathsep + "$NVM_BIN"
            for path in path_list.split(os.pathsep):
                path = path.strip('"')
                programPath = os.path.join(path, program)
                if is_executable(programPath):
                    return programPath
        return None
