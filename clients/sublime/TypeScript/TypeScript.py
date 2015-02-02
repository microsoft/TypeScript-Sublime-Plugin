import sys
import os
import sublime
import sublime_plugin
import subprocess
import threading
# queue module name changed from Python 2 to 3
try :
   import Queue as queue
except ImportError:
   import queue
import json
import time

# globally-accessible information singleton; set in function plugin_loaded 
cli = None

# currently active view
def active_view():
    return sublime.active_window().active_view()

# view is typescript if outer syntactic scope is 'source.ts'
def is_typescript(view):
    try:
        location = view.sel()[0].begin()
    except:
        return False

    return view.match_selector(location, 'source.ts')

# True if the cursor is in a syntactic scope specified by selector scopeSel
def is_typescript_scope(view,scopeSel):
    try:
        location = view.sel()[0].begin()
    except:
        return False

    return view.match_selector(location, scopeSel)

# reader thread helper
def readMsg(stream,msgq,eventq):
    state = 'headers'
    bodlen = 0
    while state == 'headers':
        header = stream.readline().strip()
        if len(header)==0:
            state='body'
        elif header.startswith(b'Content-Length: '):
            bodlen=int(header[15:])
# TODO: signal error if bodlen == 0
    if bodlen > 0:
        data=stream.read(bodlen)
        jsonStr = data.decode('utf-8')
        jsonObj = json.loads(jsonStr)
        if jsonObj['type']=='response':
            msgq.put(jsonObj)
        else:
            print("event:")
            print(jsonObj)
            eventq.put(jsonObj)

# main function for reader thread    
def reader(stream,msgq,eventq):
    while True:
        readMsg(stream,msgq,eventq)

# per-file, globally-accessible information
class ClientFileInfo:
    def __init__(self,filename):
        self.filename=filename
        self.pendingChanges=False
        self.changeCount=0
        self.errors = {
            'syntacticDiag': [],
            'semanticDiag': [],
        }

# a reference to a source file, line, column; next and prev refer to the
# next and previous reference in a view containing references
class Ref:
    def __init__(self,filename,line,col,prevLine):
        self.filename=filename
        self.line=line
        self.col=col
        self.nextLine=None
        self.prevLine=prevLine

    def setNextLine(self,n):
        self.nextLine=n

    def asTuple(self):
        return (self.filename,self.line,self.col,self.prevLine,self.nextLine)

# maps (line in view containing references) to (filename, line, column) referenced
class RefInfo:
    def __init__(self,firstLine):
        self.refMap={}
        self.currentRefLine=firstLine
                
    def addMapping(self,line,target):
        self.refMap[line]=target

    def containsMapping(self,line):
        return line in self.refMap

    def getMapping(self,line):
        if line in self.refMap:
            return self.refMap[line]

    def getCurrentMapping(self):
        if self.currentRefLine:
            return self.getMapping(self.currentRefLine)

    def setRefLine(self,line):
        self.currentRefLine=line

    def getRefLine(self):
        return self.currentRefLine

    def asValue(self):
        vmap={}
        keys=self.refMap.keys()
        for key in keys:
            vmap[key]=self.refMap[key].asTuple()
        return (vmap,self.currentRefLine)

# build a reference from a serialized reference
def buildRef(refTuple):
    (filename,line,col,prevLine,nextLine)=refTuple
    ref=Ref(filename,line,col,prevLine)
    ref.setNextLine(nextLine)
    return ref

# build a ref info from a serialized ref info
def buildRefInfo(refInfoV):
    refInfo=RefInfo(refInfoV[1])
    dict=refInfoV[0]
    for key in dict.keys():
        refInfo.addMapping(key,buildRef(dict[key]))
    return refInfo

def which(program):
    def is_exe(fpath):
        return os.path.isfile(fpath) and os.access(fpath, os.X_OK)

    fpath, fname = os.path.split(program)
    if fpath:
        if is_exe(program):
            return program
    else:
       # /usr/local/bin is not on mac default path
       # but is where node is typically installed on mac
       path_list=os.environ["PATH"]+":/usr/local/bin"
       for path in path_list.split(os.pathsep):
          path = path.strip('"')
          exe_file = os.path.join(path, program)
          if is_exe(exe_file):
             return exe_file
    return None

# get the directory path to this file; ST2 requires this to be done
# at global scope
dirpath=os.path.dirname(os.path.realpath(__file__))

# hold information that must be accessible globally; this is a singleton
class Client:
    def __init__(self):
        # create response and event queues
        self.msgq = queue.Queue()
        self.eventq = queue.Queue()
        # see if user set path for protocol.js
        settings=sublime.load_settings('Preferences.sublime-settings')
        procFile=settings.get('typescript_proc_file')
        if not procFile:
            # otherwise, get protocol.js from package directory
            procFile=os.path.join(dirpath,"protocol.js")
        print("spawning node module: "+procFile)
        nodePath=which('node')
        print(nodePath)
        # start node process
        if os.name=='nt':
            # linux subprocess module does not have STARTUPINFO
            # so only use it if on Windows
            si = subprocess.STARTUPINFO()
            si.dwFlags |= subprocess.SW_HIDE | subprocess.STARTF_USESHOWWINDOW
            self.proc = subprocess.Popen([nodePath,procFile],
                                         stdin=subprocess.PIPE,stdout=subprocess.PIPE,startupinfo=si)
        else:
            self.proc = subprocess.Popen([nodePath,procFile],
                                         stdin=subprocess.PIPE,stdout=subprocess.PIPE)
        # start reader thread
        self.t = threading.Thread(target = reader, args=(self.proc.stdout,self.msgq,self.eventq))
        self.t.daemon = True
        self.t.start()
        self.completions={}
        self.fileMap={}
        self.refInfo=None
        self.breakpoints=[]
        self.debugProc=None

    def addBreakpoint(file,line):
        self.breakpoints.append((file,line))

    # work in progress
    def debug(file):
        # TODO: msg if already debugging
        self.debugProc=subprocess.Popen(['node','debug',file],
                                     stdin=subprocess.PIPE,stdout=subprocess.PIPE)

    # ref info is for Find References view
    # TODO: generalize this so that there can be multiple
    # for example, one for Find References and one for build errors
    def disposeRefInfo(self):
        self.refInfo=None

    def initRefInfo(self,firstLine):
        self.refInfo=RefInfo(firstLine)
        return self.refInfo

    def updateRefInfo(self,refInfo):
        self.refInfo=refInfo

    def getRefInfo(self):
        return self.refInfo

    # get or add per-file information that must be globally acessible
    def getOrAddFile(self,filename):
        if not filename in self.fileMap:
            clientInfo=ClientFileInfo(filename)
            self.fileMap[filename]=clientInfo
        else:
            clientInfo=self.fileMap[filename]
        return clientInfo

    def hasErrors(self,filename):
        clientInfo=self.getOrAddFile(filename)
        return (len(clientInfo.errors['syntacticDiag'])>0) or (len(clientInfo.errors['semanticDiag'])>0)

    #  send single-line command string; no sequence number; wait for response
    #  this assumes stdin/stdout; for TCP, need to add correlation with sequence numbers
    def simpleRequest(self,cb,cmd):
        self.sendCmd(cmd)
        data = self.msgq.get(True)
        cb(data)

    # synchronous version of simpleRequest
    def simpleRequestSync(self,cmd):
        self.sendCmd(cmd)
        data = self.msgq.get(True)
        return data

    # send command to server; no response needed 
    def sendCmd(self, cmd):
        print(cmd)
        cmd=cmd+"\n"
        self.proc.stdin.write(cmd.encode())
        self.proc.stdin.flush()

    # try to get event from event queue
    def getEvent(self):
        try:
            ev=self.eventq.get(False)
        except:
            return None
        return ev

    def printCmd(self, cmd):
        print(cmd)

# per-file info that will only be accessible from TypeScriptListener instance
class FileInfo:
    def __init__(self,filename,cc):
        self.filename=filename
        self.changeSent=False
        self.preChangeSent=False
        self.modified=False
        self.completionPrefixSel=None
        self.completionSel=None
        self.prevSel=None
        self.view=None
        self.hasErrors=False
        self.clientInfo=None
        self.changeCountErrReq= -1
        self.lastModChangeCount=cc

# region that will not change as buffer is modified
class StaticRegion:
    def __init__(self,b,e):
        self.b=b;
        self.e=e;

    def toRegion(self):
        return sublime.Region(self.b,self.e)

    def begin(self):
        return self.b

# convert a list of static regions to ordinary regions
def staticRegionsToRegions(staticRegions):
    result=[]
    for staticRegion in staticRegions:
        result.append(staticRegion.toRegion())
    return result

# copy a region into a static region
def copyRegionStatic(r):
    return StaticRegion(r.begin(),r.end())

# copy a list of regions into a list of static regions
def copyRegionsStatic(regions):
    result=[]
    for region in regions:
        result.append(copyRegionStatic(region))
    return result

# copy a region (this is needed because the original region may change)
def copyRegion(r):
    return sublime.Region(r.begin(),r.end())

# copy a list of regions
def copyRegions(regions):
    result=[]
    for region in regions:
        result.append(copyRegion(region))
    return result

# from a list of empty regions, make a list of regions whose begin() value is
# one before the begin() value of the corresponding input (for left_delete)
def decrRegions(emptyRegions,amt):
    rr = []
    for region in emptyRegions:
        rr.append(sublime.Region(region.begin()-amt,region.begin()-amt))
    return rr

def decrLocsToRegions(locs,amt):
    rr = []
    for loc in locs:
        rr.append(sublime.Region(loc-amt,loc-amt))
    return rr

# right now, we must have this setting because no way to guess how to translate
# tabs on the server side; so burn it in
# TODO: see if we can tolerate tabs by having the editor tell the server how
# to interpret them
def setFilePrefs(view):
    settings=view.settings()
    settings.set('translateTabsToSpaces',True)

# given a list of regions and a (possibly zero-length) string to insert,
# send the appropriate change information to the server
def sendReplaceChangesForRegions(view,regions,insertString):
    for region in regions:
        lineColStr=cmdLineColRegion(view,region,"change")
        insertLen=len(insertString)
        if insertLen>0:
            encodedInsertStr = json.JSONEncoder().encode(insertString);
            cli.sendCmd('{0}{1} {2} {{{3}}} {4}'.format(lineColStr,region.size(),insertLen,
                                                        encodedInsertStr,view.file_name()))
        else:
            cli.sendCmd('{0}{1} {2} {3}'.format(lineColStr,region.size(),insertLen,
                                                view.file_name()))
# helper for printing parts of command lines
def cmdLineColPosShow(view,pos,cmdline):
    return cmdLineColPos(view,pos,"{0} {1}:".format(cmdline,pos))

# write the buffer of view to a temporary file and have the server reload it
def reloadBuffer(view,clientInfo=None):
    # TODO: use different temp file path on Windows (see ST2 code)
    t=time.time()
    tmpfile=open("/tmp/pydiff","w")
    tmpfile.write(view.substr(sublime.Region(0,view.size())))
    tmpfile.flush();
    cli.simpleRequestSync("reload {0} from /tmp/pydiff".format(view.file_name()))
    et=time.time()
    print("time for reload %f" % (et-t))
    if not clientInfo:
        clientInfo=cli.getOrAddFile(view.file_name())
    clientInfo.changeCount=view.change_count()
    clientInfo.pendingChanges=False

# if we have changes to the view not accounted for by change messages,
# send the whole buffer through a temporary file
def checkUpdateView(view):
    clientInfo=cli.getOrAddFile(view.file_name())    
    if clientInfo.pendingChanges or (clientInfo.changeCount<view.change_count()):
        print('unhandled change: reload '+str(view.change_count())+" "+str(clientInfo.changeCount)+" "+str(clientInfo.pendingChanges))
        reloadBuffer(view,clientInfo)

# update the buffer if necessary, and then send command to server
def updateSendCmd(view,cmdstr):
    checkUpdateView(view)
    cli.sendCmd(cmdstr)

# update the buffer if necessary, and then send command to server;
# wait for response and when it is back, call cb
def updateSimpleRequest(view,cb,cmdstr):
    checkUpdateView(view)
    cli.simpleRequest(cb,cmdstr)

# update the buffer if necessary, and then send command to server;
# wait for response and return it
def updateSimpleRequestSync(view,cmdstr):
    checkUpdateView(view)
    return cli.simpleRequestSync(cmdstr)

# singleton that receives event calls from Sublime
class TypeScriptListener(sublime_plugin.EventListener):
    def __init__(self):
        self.fileMap={}
        self.pendingCompletions=None
        self.completionView=None
        self.mruFileList=[]
        self.pendingTimeout=0
        self.pendingSelectionTimeout=0
        self.errRefreshRequested=False

    # called by Sublime when a view receives focus
    def on_activated(self,view):
        if view.file_name() is not None:
            if is_typescript(view):
                if not cli:
                    plugin_loaded()
                info = self.fileMap.get(view.file_name())
                if not info:
                    info=FileInfo(view.file_name(),view.change_count())
                    info.view=view
                    info.clientInfo=cli.getOrAddFile(view.file_name())
                    setFilePrefs(view)
                    self.fileMap[view.file_name()]=info
                    cli.sendCmd("open "+view.file_name())
                    if view.is_dirty():
                        reloadBuffer(view,info.clientInfo)
                else:
                    self.mruFileList.remove(info)
                self.mruFileList.append(info)
                # save cursor in case we need to read what was inserted
                info.prevSel=copyRegionsStatic(view.sel())
                # ask server for initial error diagnostics
                self.refreshErrors(view,200)
                # set modified and selection idle timers, so we can read diagnostics and update 
                # status line
                self.setOnIdleTimer(20)
                self.setOnSelectionIdleTimer(20)
        else:
            print("active buffer "+str(view.buffer_id()))

    # ask the server for diagnostic information on all opened ts files in
    # most-recently-used order
    # TODO: limit this request to ts files currently visible in views
    def refreshErrors(self,view,errDelay):
        info=self.fileMap.get(view.file_name())
        if info and (info.changeCountErrReq<view.change_count()):
            info.changeCountErrReq=view.change_count()
            fileList=""
            delimit=""
            # traverse list in reverse b/c MRU always appended to end of list
            # TODO: check if file visible and only add if is visible
            for i in range(len(self.mruFileList)-1,-1,-1):
                fileList+=(delimit+self.mruFileList[i].filename)
                delimit=";"
            cmdstr="geterr {0} {1}".format(errDelay,fileList)
            updateSendCmd(view,cmdstr)
            self.errRefreshRequested=True
            self.setOnIdleTimer(errDelay+300)

    # expand region list one to left for backspace change info
    def expandEmptyLeft(self,regions):
        result=[]
        for region in regions:
            if region.empty():
                result.append(sublime.Region(region.begin()-1,region.end()))
            else:
                result.append(region)
        return result

    # expand region list one to right for delete key change info
    def expandEmptyRight(self,regions):
        result=[]
        for region in regions:
            if region.empty():
                result.append(sublime.Region(region.begin(),region.end()+1))
            else:
                result.append(region)
        return result

    # error messages arrived from the server; show them in view
    def showErrorMsgs(self,errs,syntactic):
        filename = errs['fileName']
        diags = errs['diagnostics']
        info = self.fileMap.get(filename)
        if info:
            view=info.view
            if info.changeCountErrReq==view.change_count():
                if syntactic:
                    regionKey='syntacticDiag'
                else:
                    regionKey='semanticDiag'
                view.erase_regions(regionKey)
                clientInfo=cli.getOrAddFile(filename)
                clientInfo.errors[regionKey]=[]
                errRegions=[]
                for diag in diags:
                    minlc=diag['min']
                    (l,c)=extractLineCol(minlc)
                    text=diag['text']
                    charCount=diag['len']
                    start=view.text_point(l,c)
                    end=start+charCount
                    if (end<=view.size()):
                        region=sublime.Region(start,end+1)
                        errRegions.append(region)
                        clientInfo.errors[regionKey].append((region,text))
                info.hasErrors=cli.hasErrors(filename)
                self.update_status(view,info)
                # TODO: use different flags for ST2
                view.add_regions(regionKey, errRegions, "keyword", "",
                                 sublime.DRAW_NO_FILL + sublime.DRAW_NO_OUTLINE + sublime.DRAW_SQUIGGLY_UNDERLINE)            

    # event arrived from the server; call appropriate handler
    def dispatchEvent(self,ev):
        evtype=ev['event']
        if evtype=='syntaxDiag':
            self.showErrorMsgs(ev['body'],True)
        elif evtype=='semanticDiag':
            self.showErrorMsgs(ev['body'],False)            

    # set timer to go off when selection is idle
    def setOnSelectionIdleTimer(self,ms):
        self.pendingSelectionTimeout+=1;
        sublime.set_timeout(self.handleSelectionTimeout,ms)                
        
    def handleSelectionTimeout(self):
        self.pendingSelectionTimeout-=1
        if self.pendingSelectionTimeout==0:
            self.onSelectionIdle()

    # if selection is idle (cursor is not moving around)
    # update the status line (error message or quick info, if any)
    def onSelectionIdle(self):
        view=active_view()
        info=self.fileMap.get(view.file_name())
        if info:
            self.update_status(view,info)        

    # set timer to go off when file not being modified
    def setOnIdleTimer(self,ms):
        self.pendingTimeout+=1;
        sublime.set_timeout(self.handleTimeout,ms)                
        
    def handleTimeout(self):
        self.pendingTimeout-=1
        if self.pendingTimeout==0:
            self.onIdle()

    # if file hasn't been modified for a time
    # check the event queue and dispatch any events
    def onIdle(self):
        view=active_view()
        ev=cli.getEvent()
        if ev is not None:
            self.dispatchEvent(ev)
            self.errRefreshRequested=False
            # reset the timer in case more events are on the queue
            self.setOnIdleTimer(50)
        elif self.errRefreshRequested:
            # reset the timer if we haven't gotten an event
            # since the last time errors were requested
            self.setOnIdleTimer(50)
        info=self.fileMap.get(view.file_name())
        if info:
            # request errors 
            self.refreshErrors(view,500)

    # ST3 only
    # for certain text commands, learn what changed and notify the
    # server, to avoid sending the whole buffer during completion
    # or when key can be held down and repeated
    # called by ST3 for some, but not all, text commands
    def on_text_command(self,view,command_name,args):
        info=self.fileMap.get(view.file_name())
        if info:
            info.changeSent=True
            info.preChangeSent=True
            if command_name == "left_delete":
                # backspace
                sendReplaceChangesForRegions(view,self.expandEmptyLeft(view.sel()),"")
            elif command_name == "right_delete":
                # delete
                sendReplaceChangesForRegions(view,self.expandEmptyRight(view.sel()),"")
            else:
                # notify on_modified and on_post_text_command events that nothing was handled
                # there are multiple flags because Sublime does not always call all three events
                info.preChangeSent=False
                info.changeSent=False
                info.modified=False
                if (command_name=="commit_completion") or (command_name=="insert_best_completion"):
                    # for finished completion, remember current cursor and set a region that will be
                    # moved by the inserted text
                    info.completionSel=copyRegions(view.sel())
                    view.add_regions("apresComp",copyRegions(view.sel()),
                                     flags=sublime.HIDDEN)

    # update the status line with error info and quick info if no error info
    def update_status(self,view,info):
        if info.hasErrors:
            view.run_command('typescript_error_info')
        else:
            view.erase_status("typescript_error")
        errstatus=view.get_status('typescript_error')
        if errstatus and (len(errstatus)>0):
            view.erase_status("typescript_info")
        else:
            view.run_command('typescript_quick_info')

    # TODO: send close message to service for ts files 
    def on_close(self,view):
        if view.is_scratch() and (view.name()=="Find References"):
            cli.disposeRefInfo()

    # called by Sublime when the cursor moves (or when text is selected)
    # called after on_modified (when on_modified is called)
    def on_selection_modified(self,view):
        info=self.fileMap.get(view.file_name())
        if info:
            if not info.clientInfo:
                info.clientInfo=cli.getOrAddFile(view.file_name())
            # TODO: ST2 does not have view.change_count()
            if (info.clientInfo.changeCount<view.change_count()) and (info.lastModChangeCount!=view.change_count()):
                # detected a change to the view for which Sublime did not call on_modified
                # and for which we have no hope of discerning what changed
                info.clientInfo.pendingChanges=True
            # save the current cursor position so that we can see (in on_modified) what was inserted
            info.prevSel=copyRegionsStatic(view.sel())
            self.setOnSelectionIdleTimer(50)
            # hide the doc info output panel if it's up
            panelView=sublime.active_window().get_output_panel("doc")
            if panelView.window():
                sublime.active_window().run_command("hide_panel", { "cancel" : True })

    # usually called by Sublime when the buffer is modified
    # not called for undo, redo
    def on_modified(self, view):
        info=self.fileMap.get(view.file_name())
        if info:
            info.modified=True
            # ST3; no cc in ST2
            info.lastModChangeCount=view.change_count()
            print("modified "+view.file_name())
            (lastCommand,args,rept)=view.command_history(0)
            print("omm: "+lastCommand+" cc: ",view.change_count())
            if info.preChangeSent:
                # change handled in on_text_command
                info.clientInfo.changeCount=view.change_count()
                info.preChangeSent=False
            elif (lastCommand=="insert") and (not "\n" in args['characters']):
                # single-line insert, use saved cursor information to determine what was inserted
                # REVIEW: consider using this only if there is a single cursor, and only if that
                # cursor is an empty region; right now, the code tries to handle multiple cursors
                # and non-empty selections (which will be replaced by the string inserted)
                info.clientInfo.changeCount=view.change_count()
                prevCursor=info.prevSel[0].begin()
                cursor=view.sel()[0].begin()
                key=view.substr(sublime.Region(prevCursor,cursor))
                sendReplaceChangesForRegions(view,staticRegionsToRegions(info.prevSel),key)
                # mark change as handled so that on_post_text_command doesn't try to handle it
                info.changeSent=True
            self.setOnIdleTimer(100)

    # ST3 only
    # called by ST3 for some, but not all, text commands
    # not called for insert command
    def on_post_text_command(self,view,command_name,args):
        def buildReplaceRegions(emptyRegionsA,emptyRegionsB):
            rr = []
            for i in range(len(emptyRegionsA)):
                rr.append(sublime.Region(emptyRegionsA[i].begin(),emptyRegionsB[i].begin()))
            return rr

        info=self.fileMap.get(view.file_name())
        if info:
            if (not info.changeSent) and info.modified:
                # file is modified but on_text_command and on_modified did not handle it
                # handle insertion of string from completion menu, so that
                # it is fast to type completedName1.completedName2 (avoid a lag when completedName1 is committed)
                # TODO: make this ST3 only; no completion from server in ST2 because no UI
                if ((command_name=="commit_completion") or command_name==("insert_best_completion"))  and (len(view.sel())==1):
                    # get saved region that was pushed forward by insertion of the completion
                    apresCompReg=view.get_regions("apresComp")
                    # note: assuming sublime makes all regions empty for completion, which the doc claims is true
                    # insertion string is from region saved in on_query_completion to region pushed forward by completion insertion
                    insertionString=view.substr(sublime.Region(info.completionPrefixSel[0].begin(),apresCompReg[0].begin()))
                    sendReplaceChangesForRegions(view,buildReplaceRegions(info.completionPrefixSel,info.completionSel),insertionString)
                    view.erase_regions("apresComp")
                elif ((command_name=="typescript_format_on_key")or (command_name=="typescript_format_document") or
                      (command_name=="typescript_format_selection") or (command_name=="typescript_format_line")):
                     # changes were sent by the command so no need to 
                     print("handled changes for "+command_name)
                else:
                    print(command_name)
                    # give up and send whole buffer to server (do this eagerly to avoid lag on next request to server)
                    reloadBuffer(view,info.clientInfo)
                # we are up-to-date because either change was sent to server or whole buffer was sent to server
                info.clientInfo.changeCount=view.change_count()
            # reset flags and saved regions used for communication among on_text_command, on_modified, on_selection_modified,
            # on_post_text_command, and on_query_completion
            info.changeSent=False
            info.modified=False
            info.completionSel=None

    # helper called back when completion info received from server
    def handleCompletionInfo(self,data):
        if data['success']:
            completions=[]
            rawCompletions=data['body']
            for rawCompletion in rawCompletions:
                name=rawCompletion['name']
                completion=(name+"\t"+rawCompletion['kind'],name)
                completions.append(completion)
            self.pendingCompletions=completions
        else:
            self.pendingCompletions=[]

    #  not currently used; would be used in async case
    def run_auto_complete(self):
        active_view().run_command("auto_complete", {
            'disable_auto_insert': True,
            'api_completions_only': False,
            'next_completion_if_showing': False,
            'auto_complete_commit_on_tab': True,
        })

    # ST3 only
    # synchronous for now; can change to async by adding hide/show from the handler
    def on_query_completions(self,view,prefix,locations):
        info=self.fileMap.get(view.file_name())
        if info:
            print("complete with: "+prefix)
            word=view.substr(view.word(locations[0]))
            print(view.id())
            info.completionPrefixSel=decrLocsToRegions(locations,len(prefix))
            view.add_regions("apresComp",decrLocsToRegions(locations,0),flags=sublime.HIDDEN)
            cmdsuffix="{{{0}}} {1}".format(prefix,view.file_name())
            cmdstr = cmdLineColPos(view,locations[0],"completions")+cmdsuffix
            updateSimpleRequest(view,self.handleCompletionInfo,cmdstr)
            print("end complete with: "+prefix)
            completions=self.pendingCompletions
            self.pendingCompletions=None
            return (completions,sublime.INHIBIT_WORD_COMPLETIONS|sublime.INHIBIT_EXPLICIT_COMPLETIONS)
                
# pos, cmdName => "cmdName lineAtPos colAtPos"                    
def cmdLineColPos(view,pos,cmdName):
    cursor = view.rowcol(pos)
    line = str(cursor[0] + 1)
    col = str(cursor[1] + 1)
    return '{0} {1} {2} '.format(cmdName,line,col)

# pos1, pos2 cmdName => "cmdName lineAtPos1 colAtPos1 lineAtPos2 colAtPos2" 
def cmdLineColPos2(view,pos1,pos2,cmdName):
    cursor = view.rowcol(pos1)
    line = str(cursor[0] + 1)
    col = str(cursor[1] + 1)
    cursor = view.rowcol(pos2)
    line2 = str(cursor[0] + 1)
    col2 = str(cursor[1] + 1)
    return '{0} {1} {2} {3} {4} '.format(cmdName,line,col,line2,col2)

# location, cmdName => "cmdName lineAtlocation.begin() colAtlocation.begin()"
def cmdLineColRegion(view,location,cmdName):
    cursor = view.rowcol(location.begin())
    line = str(cursor[0] + 1)
    col = str(cursor[1] + 1)
    return '{0} {1} {2} '.format(cmdName,line,col)

# cmdName => "cmdName lineAtCursor colAtCursor"    
def cmdLineCol(view, cmdName):
    location = view.sel()[0]
    return cmdLineColRegion(view,location,cmdName)

# for debugging, send command to server to save server buffer in temp file
# TODO: safe temp file name on Windows
class TypescriptSave(sublime_plugin.TextCommand):
    def run(self,text):
        cli.sendCmd("save {0} to /tmp/curstate".format(self.view.file_name()))

# command currently called only from event handlers
class TypescriptQuickInfo(sublime_plugin.TextCommand):
    def handleQuickInfo(self,data):
        print(data)
        if data['success']:
            allinfo=data['body']
            infoStr=allinfo['info']
            docStr=allinfo['doc']
            if len(docStr) > 0:
                infoStr=infoStr+" (^T^Q for more)"
            self.view.set_status("typescript_info",infoStr)
        else:
            self.view.erase_status("typescript_info")

    def run(self,text):
        cmdstr = cmdLineCol(self.view, "quickinfo")+self.view.file_name()
        updateSimpleRequest(self.view,self.handleQuickInfo,cmdstr)
             
    def is_enabled(self):
        return is_typescript(self.view)

# command to show the doc string associated with quick info;
# re-runs quick info in case info has changed
class TypescriptQuickInfoDoc(sublime_plugin.TextCommand):
    def handleQuickInfo(self,data):
        print(data)
        if data['success']:
            allinfo=data['body']
            infoStr=allinfo['info']
            docStr=allinfo['doc']
            if len(docStr)>0:
                docPanel=sublime.active_window().get_output_panel("doc")
                docPanel.run_command('append',{
                    'characters': infoStr+"\n\n"+docStr 
                })
                docPanel.settings().set('color_scheme', "Packages/Color Scheme - Default/Blackboard.tmTheme");
                sublime.active_window().run_command('show_panel',{ 'panel': 'output.doc' })
                infoStr=infoStr+" (^T^Q for more)"
            self.view.set_status("typescript_info",infoStr)
        else:
            self.view.erase_status("typescript_info")

    def run(self,text):
        cmdstr = cmdLineCol(self.view, "quickinfo")+self.view.file_name()
        updateSimpleRequest(self.view,self.handleQuickInfo,cmdstr)
             
    def is_enabled(self):
        return is_typescript(self.view)

# command called from event handlers to show error text in status line
# (or to erase error text from status line if no error text for location)
class TypescriptErrorInfo(sublime_plugin.TextCommand):
    def run(self,text):
        clientInfo=cli.getOrAddFile(self.view.file_name())
        pt=self.view.sel()[0].begin()
        errorText=""
        for (region,text) in clientInfo.errors['syntacticDiag']:
            if region.contains(pt):
                errorText=text
        for (region,text) in clientInfo.errors['semanticDiag']:
            if region.contains(pt):
                errorText=text
        if len(errorText)>0:
            self.view.set_status("typescript_error",errorText)
        else:
            self.view.erase_status("typescript_error")
                
    def is_enabled(self):
        return is_typescript(self.view)

# go to definition command
class TypescriptGoToDefinitionCommand(sublime_plugin.TextCommand):
    def run(self,text):
        cmdstr = cmdLineCol(self.view, "definition")+self.view.file_name()
        data=updateSimpleRequestSync(self.view,cmdstr)
        if data['success']:
            bod = data['body']
            filename = bod['file']
            minlc = bod['min']
            line = 1+int(minlc['line'])
            col = 1+int(minlc['offset'])
            sublime.active_window().open_file(
                '{}:{}:{}'.format(filename, line or 0, col or 0),
                sublime.ENCODED_POSITION)

# go to type command
class TypescriptGoToTypeCommand(sublime_plugin.TextCommand):
    def run(self,text):
        cmdstr = cmdLineCol(self.view, "type")+self.view.file_name()
        data=updateSimpleRequestSync(self.view,cmdstr)
        if data['success']:
            bod = data['body']
            filename = bod['fileName']
            minlc = bod['min']
            line = 1+int(minlc['line'])
            col = 1+int(minlc['offset'])
            sublime.active_window().open_file(
                '{}:{}:{}'.format(filename, line or 0, col or 0),
                sublime.ENCODED_POSITION)

# rename command
class TypescriptRenameCommand(sublime_plugin.TextCommand):
    def run(self,text):
        cmdstr = cmdLineCol(self.view, "rename")+self.view.file_name()
        data=updateSimpleRequestSync(self.view,cmdstr)
        if data['success']:
            infoLocs=data['body']
            info=infoLocs['info']
            displayName=info['fullDisplayName']
            outerLocs=infoLocs['locs']
            def on_cancel():
                return 
            def on_done(newName):
                self.view.run_command('typescript_finish_rename',
                                      { "outerLocs":outerLocs, "newName":newName})
            if len(outerLocs)>0:
                sublime.active_window().show_input_panel("New name for {0}: ".format(displayName),"",
                                                         on_done,None,on_cancel)

# called from on_done handler in finish_rename command 
# on_done is called by input panel for new name
class TypescriptFinishRenameCommand(sublime_plugin.TextCommand):
    def run(self,text,outerLocs=[],newName=""):
        if len(outerLocs)>0:
            for outerLoc in outerLocs:
                file=outerLoc['file']
                innerLocs=outerLoc['locs']
                for innerLoc in innerLocs:
                    minlc=innerLoc['min']
                    (minl,minc)=extractLineCol(minlc)
                    limlc=innerLoc['lim']
                    (liml,limc)=extractLineCol(limlc)
                    applyEdit(text,self.view,minl,minc,liml,
                              limc,ntext=newName)

# if the FindReferences view is active, get it
# TODO: generalize this so that we can find any scratch view
# containing references to other files        
def getRefView(create=True):
    active_window=sublime.active_window()
    for view in active_window.views():
        if view.is_scratch() and (view.name()=="Find References"):
            return view
    if create:
        refView=active_window.new_file()
        refView.set_name("Find References")
        refView.set_scratch(True)
        return refView

# find references command
class TypescriptFindReferencesCommand(sublime_plugin.TextCommand):
    def run(self,text):
        cmdstr = cmdLineCol(self.view, "references")+self.view.file_name()
        data=updateSimpleRequestSync(self.view,cmdstr)
        if data['success']:
            pos=self.view.sel()[0].begin()
            cursor = self.view.rowcol(pos)
            line = str(cursor[0] + 1)
            refsPlusIdInfo=data['body']
            refs=refsPlusIdInfo[0]
            refId=refsPlusIdInfo[1]
            refIdStart=refsPlusIdInfo[2]
            refDisplayString=refsPlusIdInfo[3]
            refView=getRefView()
            refView.run_command('typescript_populate_refs',
                                {
                                    "refId" : refId,
                                    "refDisplayString" : refDisplayString,
                                    "refs": refs,
                                    "line": line,
                                    "filename" : self.view.file_name()
                                })
            
                                
# destructure line and column tuple from JSON-parsed location info
def extractLineCol(lc):
    line=lc['line']
    col=lc['offset']
    return (line,col)

# place the caret on the currently-referenced line and
# update the reference line to go to next
def updateRefLine(refInfo,curLine,nextLine,view):
    print("update ref line {0} {1}".format(curLine,nextLine))
    view.erase_regions("curref")
    refInfo.setRefLine(nextLine)    
    caretPos=view.text_point(int(curLine),0)
    view.add_regions("curref",[sublime.Region(caretPos,caretPos+1)],
                     "keyword","Packages/TypeScript/icons/arrow-right3.png",
                     sublime.HIDDEN)

# if cursor is on reference line, go to (filename, line, col) referenced by that line    
class TypescriptGoToRefCommand(sublime_plugin.TextCommand):
    def run(self,text,forward=True):
        pos = self.view.sel()[0].begin()
        cursor = self.view.rowcol(pos)
        line=str(cursor[0])
        refInfo=cli.getRefInfo()
        if refInfo.containsMapping(line):
            (filename,l,c,p,n)=refInfo.getMapping(line).asTuple()
            if forward:
                updateRefLine(refInfo,line,n,self.view)
            else:
                updateRefLine(refInfo,line,p,self.view)
            print(cmdLineColPos(self.view,self.view.sel()[0].begin(),
                                "GoRef: "))
            print('{}:{}:{}'.format(filename, l+1 or 0, c+1 or 0))
            sublime.active_window().open_file(
                '{}:{}:{}'.format(filename, l+1 or 0, c+1 or 0),
                sublime.ENCODED_POSITION)    

# FIX: this works in the middle of the ref file but not at the end
# go to next reference in active references file
# TODO: generalize this to work for all types of references
class TypescriptNextRefCommand(sublime_plugin.TextCommand):
    def run(self,text):
        print("next ref")
        if (self.view.file_name()):
            print(self.view.file_name())
        refView=getRefView()
        if refView:
            refInfo=cli.getRefInfo()
            line=refInfo.getRefLine()
            mapping=refInfo.getMapping(line)
            if mapping:
                (filename,l,c,p,n)=mapping.asTuple()
                pos=refView.text_point(int(line),0)
                refView.sel().clear()
                refView.sel().add(sublime.Region(pos,pos))
                refView.run_command('typescript_go_to_ref')

# FIX: this works in the middle of the ref file but not at the end
# go to previous reference in active references file
# TODO: generalize this to work for all types of references
class TypescriptPrevRefCommand(sublime_plugin.TextCommand):
    def run(self,text):
        print("prev ref")
        if (self.view.file_name()):
            print(self.view.file_name())
        refView=getRefView()
        if refView:
            refInfo=cli.getRefInfo()
            line=refInfo.getRefLine()
            mapping=refInfo.getMapping(line)
            if mapping:
                (filename,l,c,p,n)=mapping.asTuple()
                pos=refView.text_point(int(line),0)
                refView.sel().clear()
                refView.sel().add(sublime.Region(pos,pos))
                refView.run_command('typescript_go_to_ref', { "forward": False })

# highlight all occurances of refId in view
# TODO: ST2 add_regions with different flags
def highlightIds(view,refId):
    idRegions=view.find_all("(?<=\W)"+refId+"(?=\W)") 
    if idRegions and (len(idRegions)>0):
        view.add_regions("refid",idRegions,"constant.numeric",
                         flags=sublime.DRAW_NO_FILL|sublime.DRAW_NO_OUTLINE|sublime.DRAW_SOLID_UNDERLINE)

# helper command called by TypescriptFindReferences; put the references in the
# references buffer
# TODO: generalize this to populate any type of references file 
# (such as build errors)
class TypescriptPopulateRefs(sublime_plugin.TextCommand):
    def run(self,text,refId="",refDisplayString="",refs=[],line=0,filename=""):
        fileCount=0
        matchCount=0
        self.view.set_read_only(False)
        # erase the caret showing the last reference followed
        self.view.erase_regions("curref")
        # clear the references buffer
        self.view.erase(text,sublime.Region(0,self.view.size()))
        header="References to {0} \n\n".format(refDisplayString)
        self.view.insert(text,self.view.sel()[0].begin(),header)
        self.view.set_syntax_file('Packages/TypeScript/FindRefs.hidden-tmLanguage')
        window=sublime.active_window()
        refInfo=None
        if len(refs)>0:
            prevFilename=""
            openview=None
            prevLine=None
            for ref in refs:
                filename=ref['file']
                if prevFilename!=filename:
                    fileCount+=1
                    if prevFilename!="":
                        self.view.insert(text,self.view.sel()[0].begin(),"\n")
                    self.view.insert(text,self.view.sel()[0].begin(),filename+":\n")
                    prevFilename=filename
                minlc=ref['min']
                (l,c)=extractLineCol(minlc)
                pos=self.view.sel()[0].begin()
                cursor = self.view.rowcol(pos)
                line=str(cursor[0])
                if not refInfo:
                    refInfo=cli.initRefInfo(line)
                refInfo.addMapping(line,Ref(filename,l,c,prevLine))
                if prevLine:
                    mapping=refInfo.getMapping(prevLine)
                    mapping.setNextLine(line)
                prevLine=line
                content=ref['lineText']
                displayRef="    {0}:  {1}\n".format(l+1,content)
                matchCount+=1
                self.view.insert(text,self.view.sel()[0].begin(),displayRef)
        self.view.insert(text,self.view.sel()[0].begin(),
                             "\n{0} matches in {1} file{2}\n".format(matchCount,
                                                                     fileCount,"" if (fileCount==1) else "s"))

        if matchCount>0:
            highlightIds(self.view,refId)
        window.focus_view(self.view)
        self.view.sel().clear()
        caretPos=self.view.text_point(2,0)
        self.view.sel().add(sublime.Region(caretPos,caretPos))
        # serialize the reference info into the settings
        self.view.settings().set('refinfo',refInfo.asValue())
        self.view.set_read_only(True)

# apply a single edit specification to a view
def applyEdit(text,view,minl,minc,liml,limc,ntext=""):
    begin=view.text_point(minl,minc)
    end=view.text_point(liml,limc)
    region=sublime.Region(begin,end)
    sendReplaceChangesForRegions(view,[region],ntext)
    # break replace into two parts to avoid selection changes
    if region.size()>0:
        view.erase(text,region)
    if (len(ntext)>0):
        view.insert(text,begin,ntext)
    
# apply a set of edits to a view
def applyFormattingChanges(text,view,changes):
    n=len(changes)
    for i in range(n-1,-1,-1):
        change=changes[i]
        minlc=change['min']
        (minLine,minCol)=extractLineCol(minlc)
        limlc=change['lim']
        (limLine,limCol)=extractLineCol(limlc)
        newText=change['newText']
        applyEdit(text,view,minLine,minCol,
                  limLine,limCol,ntext=newText)

# format on ";", "}", or "\n"; called by typing these keys in a ts file
# in the case of "\n", this is only called when no completion dialogue visible
class TypescriptFormatOnKey(sublime_plugin.TextCommand):
    def run(self,text,key=""):
        if 0==len(key):
            return
        loc=self.view.sel()[0].begin()
        self.view.insert(text,loc,key)
        sendReplaceChangesForRegions(self.view,[sublime.Region(loc,loc)],key)
        clientInfo=cli.getOrAddFile(self.view.file_name())
        clientInfo.changeCount=self.view.change_count()
        encodedKey = json.JSONEncoder().encode(key);
        cmdstr = cmdLineCol(self.view, "formatonkey")
        cmdstr += ("{{{0}}} ".format(encodedKey)+self.view.file_name())
        data=updateSimpleRequestSync(self.view,cmdstr)
        if data['success']:
            changes=data['body']
            applyFormattingChanges(text,self.view,changes)

# format a range of locations in the view
def formatRange(text,view,begin,end):
        cmdstr = cmdLineColPos2(view,begin,end,"format")
        cmdstr += view.file_name()
        data=updateSimpleRequestSync(view,cmdstr)
        if data['success']:
            changes=data['body']
            applyFormattingChanges(text,view,changes)

# command to format the current selection    
class TypescriptFormatSelection(sublime_plugin.TextCommand):
    def run(self,text):
        r=self.view.sel()[0]
        formatRange(text,self.view,r.begin(),r.end())

# command to format the entire buffer
class TypescriptFormatDocument(sublime_plugin.TextCommand):
    def run(self,text):
        formatRange(text,self.view,0,self.view.size())

# command to format the current line
class TypescriptFormatLine(sublime_plugin.TextCommand):
    def run(self,text):
        lineRegion=self.view.line(self.view.sel()[0])
        formatRange(text,self.view,lineRegion.begin(),lineRegion.end())

# this is not always called on startup by Sublime, so we call it
# from on_activated if necessary
# TODO: get abbrev message and set up dictionary
def plugin_loaded():
    global cli
    print('initialize typescript...')
    print(sublime.version())
    cli = Client()
    refView=getRefView(False)
    if refView:
        settings=refView.settings()
        refInfoV=settings.get('refinfo')
        if refInfoV:
            refInfo=buildRefInfo(refInfoV)
            cli.updateRefInfo(refInfo)


# this unload is not always called on exit
def plugin_unloaded():
    print('typescript plugin unloaded')
    refView=getRefView()
    if refView:
        refInfo=cli.getRefInfo()
        if refInfo:
            refView.settings().set('refinfo',refInfo.asValue())
        
    



