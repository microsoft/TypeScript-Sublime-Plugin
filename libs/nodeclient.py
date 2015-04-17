import os
import subprocess
import threading
import time
import json
import sublime
import sublime_plugin
from logger import log

# queue module name changed from Python 2 to 3
if int(sublime.version()) < 3000:
   import Queue as queue
else:
   import queue

import jsonhelpers
import servicedefs

class CommClient:
    def getEvent(self): pass
    def postCmd(self, cmd): pass
    def sendCmd(self, cb, cmd): pass
    def sendCmdSync(self, cmd): pass
    def sendCmdAsync(self, cmd): pass


class NodeCommClient(CommClient):
    __CONTENT_LENGTH_HEADER = b"Content-Length: "

    def __init__(self, scriptPath):
        """
        Starts a node client (if not already started) and communicate with it. 
        The script file to run is passed to the constructor.
        """


        self.asyncReq = {}
        self.__serverProc = None

        # create response and event queues
        self.__msgq = queue.Queue()
        self.__eventq = queue.Queue()

        # start node process
        pref_settings = sublime.load_settings('Preferences.sublime-settings')
        node_path = pref_settings.get('node_path')
        if node_path:
            node_path = os.path.expandvars(node_path)
        if not node_path:
           if (os.name == "nt"):
              node_path = "node"
           else:
              node_path = NodeCommClient.__which("node")
        if not node_path:
           path_list = os.environ["PATH"] + os.pathsep + "/usr/local/bin" + os.pathsep + "$NVM_BIN"
           print("Unable to find executable file for node on path list: " + path_list)
           print("To specify the node executable file name, use the 'node_path' setting")
           self.__serverProc = None
        else:
           print("Found node executable at " + node_path)
           try: 
              if os.name == "nt":
                 # linux subprocess module does not have STARTUPINFO
                 # so only use it if on Windows
                 si = subprocess.STARTUPINFO()
                 si.dwFlags |= subprocess.SW_HIDE | subprocess.STARTF_USESHOWWINDOW
                 self.__serverProc = subprocess.Popen([node_path, scriptPath],
                                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE,startupinfo=si)
              else:
                 self.__serverProc = subprocess.Popen([node_path, scriptPath],
                                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE)
           except FileNotFoundError:
              self.__serverProc = None
        # start reader thread
        if self.__serverProc:
           readerThread = threading.Thread(target=NodeCommClient.__reader, args=(self.__serverProc.stdout, self.__msgq, self.__eventq, self.asyncReq))
           readerThread.daemon = True
           readerThread.start()
        self.__debugProc = None
        self.__breakpoints = []

    def serverStarted(self):
       return self.__serverProc is not None

    # work in progress
    def addBreakpoint(self, file, line):
        self.__breakpoints.append((file, line))

    # work in progress
    def debug(self, file):
        # TODO: msg if already debugging
        self.__debugProc = subprocess.Popen(["node", "--debug", file],
                                            stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def makeTimeoutMsg(self, cmd, seq):
       jsonDict = json.loads(cmd)
       timeoutMsg = {
          "seq": 0,
          "type": "response",
          "success": False,
          "request_seq": seq,
          "command": jsonDict["command"],
          "message": "timeout"
       }
       return timeoutMsg

    def sendCmd(self, cb, cmd, seq):
        """
        send single-line command string; no sequence number; wait for response
        this assumes stdin/stdout; for TCP, need to add correlation with sequence numbers
        """
        if self.postCmd(cmd):
           reqSeq = -1
           try:
              while reqSeq < seq:
                 data = self.__msgq.get(True,1)
                 dict = json.loads(data)
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

    def sendCmdAsync(self, cmd, seq, cb):
        """
        Sends the command and registers a callback
        """
        if self.postCmd(cmd):
           self.asyncReq[seq] = cb
     
    def sendCmdSync(self, cmd, seq):
        """
        Sends the command and wait for the result and returns it
        """
        if self.postCmd(cmd):
           reqSeq = -1
           try: 
               while reqSeq < seq:
                   data = self.__msgq.get(True,1)
                   dict = json.loads(data)
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
           log.error("can not send request; node process not started")
           return False
        else:
           cmd = cmd + "\n"
           self.__serverProc.stdin.write(cmd.encode())
           self.__serverProc.stdin.flush()
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

    @staticmethod
    def __readMsg(stream, msgq, eventq, asyncReq):
        """
        Reader thread helper
        """
        state = "init"
        bodlen = 0
        while state != "body":
            header = stream.readline().strip()
            log.debug('Stream state: "{0}".  Read header: "{1}"'.format(
                                        state, header if header else 'None'))

            if len(header) == 0:
                if state == 'init':
                    log.info('0 byte line in stream when expecting header')
                    return
                else:
                    state = "body"
            else:
                state = 'header'
                if header.startswith(NodeCommClient.__CONTENT_LENGTH_HEADER):
                    bodlen = int(header[len(NodeCommClient.__CONTENT_LENGTH_HEADER):])

        if bodlen > 0:
            data = stream.read(bodlen)
            log.debug('Read body of length: {0}'.format(bodlen))
            jsonStr = data.decode("utf-8")
            dict = json.loads(jsonStr)
            if dict['type'] == "response":
                request_seq = dict['request_seq']
                log.debug('Body sequence#: {0}'.format(request_seq))
                if request_seq in asyncReq:
                    callback = asyncReq.pop(request_seq, None)
                    if callback:
                        callback(dict)
                        return
                else:
                    # Only put in the queue if wasn't an async request
                    msgq.put(jsonStr)
            else:
                eventq.put(jsonStr)
        else:
            log.info('Body length of 0 in server stream')
            return

    @staticmethod
    def __reader(stream, msgq, eventq, asyncReq):
        """
        Main function for reader thread
        """
        while True:
            NodeCommClient.__readMsg(stream, msgq, eventq, asyncReq)

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
