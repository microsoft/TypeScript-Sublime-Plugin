import json
import os
import subprocess
import threading
import time

# queue module name changed from Python 2 to 3
try: 
   import Queue as queue
except ImportError:
   import queue


class NodeClient:
    __HEADER_CONTENT_LENGTH = b"Content-Length: "

    def __init__(self, scriptPath):
        """
        Starts a node client (if not already started) and communicate with it. 
        The script file to run is passed to the constructor.
        """

        # create response and event queues
        self.__msgq = queue.Queue()
        self.__eventq = queue.Queue()

        # start node process
        if os.name == "nt":
            # linux subprocess module does not have STARTUPINFO
            # so only use it if on Windows
            si = subprocess.STARTUPINFO()
            si.dwFlags |= subprocess.SW_HIDE | subprocess.STARTF_USESHOWWINDOW
            self.__serverProc = subprocess.Popen(["node", scriptPath],
                                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, startupinfo=si)
        else:
            nodePath = NodeClient.__which("node")
            print(nodePath)
            self.__serverProc = subprocess.Popen([nodePath, scriptPath],
                                         stdin=subprocess.PIPE, stdout=subprocess.PIPE)

        # start reader thread
        readerThread = threading.Thread(target=NodeClient.__reader, args=(self.__serverProc.stdout, self.__msgq, self.__eventq))
        readerThread.daemon = True
        readerThread.start()

        self.__debugProc = None
        self.__breakpoints = []

    # work in progress
    def addBreakpoint(self, file, line):
        self.__breakpoints.append((file, line))

    # work in progress
    def debug(self, file):
        # TODO: msg if already debugging
        self.__debugProc = subprocess.Popen(["node", "debug", file],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def sendCmd(self, cb, cmd):
        """
        send single-line command string; no sequence number; wait for response
        this assumes stdin/stdout; for TCP, need to add correlation with sequence numbers
        """
        self.postCmd(cmd)
        data = self.__msgq.get(block=True)
        cb(data)

    def sendCmdSync(self, cmd):
        """
        Sends the command and wait for the result and returns it
        """
        self.postCmd(cmd)
        data = self.__msgq.get(block=True)
        return data

    def postCmd(self, cmd):
        """
        Post command to server; no response needed
        """
        print(cmd)
        cmd = cmd + "\n"
        self.__serverProc.stdin.write(cmd.encode())
        self.__serverProc.stdin.flush()

    def getEvent(self):
        """
        Try to get event from event queue
        """
        try:
            ev = self.eventq.get(block=False)
        except:
            return None
        return ev

    @staticmethod
    def __readMsg(stream, msgq, eventq):
        """
        Reader thread helper
        """
        state = "headers"
        bodlen = 0
        while state == "headers":
            header = stream.readline().strip()
            if len(header) == 0:
                state = "body"
            elif header.startswith(NodeClient.__HEADER_CONTENT_LENGTH):
                bodlen = int(header[len(NodeClient.__HEADER_CONTENT_LENGTH):])
        # TODO: signal error if bodlen == 0
        if bodlen > 0:
            data = stream.read(bodlen)
            jsonStr = data.decode("utf-8")
            jsonObj = json.loads(jsonStr)
            if jsonObj["type"] == "response":
                msgq.put(jsonObj)
            else:
                print("event:")
                print(jsonObj)
                eventq.put(jsonObj)

    @staticmethod
    def __reader(stream, msgq, eventq):
        """
        Main function for reader thread
        """
        while True:
            NodeClient.__readMsg(stream, msgq, eventq)

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
           path_list = os.environ["PATH"] + os.pathsep + "/usr/local/bin"
           for path in path_list.split(os.pathsep):
              path = path.strip('"')
              programPath = os.path.join(path, program)
              if is_executable(programPath):
                 return programPath
        return None