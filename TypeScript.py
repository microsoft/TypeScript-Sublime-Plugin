import json
import os
import sys
import time
import re
import codecs

import sublime
import sublime_plugin

# get the directory path to this file; ST2 requires this to be done at global scope
pluginDir = os.path.dirname(os.path.realpath(__file__))
pluginName = os.path.basename(pluginDir)

libsDir = os.path.join(pluginDir, 'libs')
if libsDir not in sys.path:
    sys.path.insert(0, libsDir)

from nodeclient import NodeCommClient
from serviceproxy import *

# Enable Python Tools for visual studio remote debugging
try: 
    from ptvsd import enable_attach
    enable_attach(secret=None)
except ImportError:
    pass

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
def is_typescript_scope(view, scopeSel):
    try:
        location = view.sel()[0].begin()
    except:
        return False

    return view.match_selector(location, scopeSel)

def getLocationFromView(view):
    """
    Returns the Location tuple of the beginning of the first selected region in the view
    """
    region = view.sel()[0]
    return getLocationFromRegion(view, region)

def getLocationFromRegion(view, region):
    """
    Returns the Location tuple of the beginning of the given region
    """
    position = region.begin()
    return getLocationFromPosition(view, position)

def getLocationFromPosition(view, position):
    """
    Returns the LineCol object of the given text position
    """
    cursor = view.rowcol(position)
    line = cursor[0] + 1
    col = cursor[1] + 1
    return Location(line, col)

def extractLineCol(lineColumn):
    """
    Destructure line and column tuple from LineColumn object
    convert 1-based line,col to zero-based line,col
    ``lineColumn`` LineColumn object
    """
    line = lineColumn.line - 1
    col = lineColumn.col - 1
    return (line, col)


# per-file, globally-accessible information
class ClientFileInfo:
    def __init__(self, filename):
        self.filename = filename
        self.pendingChanges = False
        self.changeCount = 0
        self.errors = {
            'syntacticDiag': [], 
            'semanticDiag': [], 
        }
        self.loadHandler = None

# a reference to a source file, line, column; next and prev refer to the
# next and previous reference in a view containing references
class Ref:
    def __init__(self, filename, line, col, prevLine):
        self.filename = filename
        self.line = line
        self.col = col
        self.nextLine = None
        self.prevLine = prevLine

    def setNextLine(self, n):
        self.nextLine = n

    def asTuple(self):
        return (self.filename, self.line, self.col, self.prevLine, self.nextLine)


# maps (line in view containing references) to (filename, line, column)
# referenced
class RefInfo:
    def __init__(self, firstLine, refId):
        self.refMap = {}
        self.currentRefLine = None
        self.firstLine = firstLine
        self.lastLine = None
        self.refId = refId

    def setLastLine(self, lastLine):
       self.lastLine = lastLine

    def addMapping(self, line, target):
        self.refMap[line] = target

    def containsMapping(self, line):
        return line in self.refMap

    def getMapping(self, line):
        if line in self.refMap:
            return self.refMap[line]

    def getCurrentMapping(self):
        if self.currentRefLine:
            return self.getMapping(self.currentRefLine)

    def setRefLine(self, line):
        self.currentRefLine = line

    def getRefLine(self):
       return self.currentRefLine

    def getRefId(self):
       return self.refId
    
    def nextRefLine(self):
      currentMapping = self.getCurrentMapping()
      if (not self.currentRefLine) or (not currentMapping):
         self.currentRefLine = self.firstLine
      else:
         (filename, l, c, p, n) = currentMapping.asTuple()
         if n:
            self.currentRefLine = n
         else:
            self.currentRefLine = self.firstLine
      return self.currentRefLine

    def prevRefLine(self):
      currentMapping = self.getCurrentMapping()
      if (not self.currentRefLine) or (not currentMapping):
         self.currentRefLine = self.lastLine
      else:
         (filename, l, c, p, n) = currentMapping.asTuple()
         if p:
            self.currentRefLine = p
         else:
            self.currentRefLine = self.lastLine

      return self.currentRefLine
          
    def asValue(self):
        vmap = {}
        keys = self.refMap.keys()
        for key in keys:
            vmap[key] = self.refMap[key].asTuple()
        return (vmap, self.currentRefLine, self.firstLine, self.lastLine, self.refId)


# build a reference from a serialized reference
def buildRef(refTuple):
    (filename, line, col, prevLine, nextLine) = refTuple
    ref = Ref(filename, line, col, prevLine)
    ref.setNextLine(nextLine)
    return ref

# build a ref info from a serialized ref info
def buildRefInfo(refInfoV):
    (dict, currentLine, firstLine, lastLine, refId) = refInfoV
    refInfo = RefInfo(firstLine, refId)
    refInfo.setRefLine(currentLine)
    refInfo.setLastLine(lastLine)
    for key in dict.keys():
        refInfo.addMapping(key, buildRef(dict[key]))
    return refInfo


# hold information that must be accessible globally; this is a singleton
class EditorClient:
    def __init__(self):
        # retrieve the path to tsserver.js
        # first see if user set the path to the file
        settings = sublime.load_settings('Preferences.sublime-settings')
        procFile = settings.get('typescript_proc_file')
        if not procFile:
            # otherwise, get tsserver.js from package directory
            procFile = os.path.join(pluginDir, "tsserver/tsserver.js")
        print("spawning node module: " + procFile)
        
        self.nodeClient = NodeCommClient(procFile)
        self.service = ServiceProxy(self.nodeClient)
        self.completions = {}
        self.fileMap = {}
        self.refInfo = None
        self.versionST2 = False

    def ST2(self):
       return self.versionST2
    
    def setFeatures(self):
       if int(sublime.version()) < 3000:
          self.versionST2 = True

    def reloadRequired(self, view):
       clientInfo = self.getOrAddFile(view.file_name())
       return self.versionST2 or clientInfo.pendingChanges or (clientInfo.changeCount < view.change_count())

    # ref info is for Find References view
    # TODO: generalize this so that there can be multiple
    # for example, one for Find References and one for build errors
    def disposeRefInfo(self):
        self.refInfo = None

    def initRefInfo(self, firstLine, refId):
        self.refInfo = RefInfo(firstLine, refId)
        return self.refInfo

    def updateRefInfo(self, refInfo):
        self.refInfo = refInfo

    def getRefInfo(self):
        return self.refInfo

    # get or add per-file information that must be globally acessible
    def getOrAddFile(self, filename):
        if not filename in self.fileMap:
            clientInfo = ClientFileInfo(filename)
            self.fileMap[filename] = clientInfo
        else:
            clientInfo = self.fileMap[filename]
        return clientInfo

    def hasErrors(self, filename):
        clientInfo = self.getOrAddFile(filename)
        return (len(clientInfo.errors['syntacticDiag']) > 0) or (len(clientInfo.errors['semanticDiag']) > 0)


# per-file info that will only be accessible from TypeScriptListener instance
class FileInfo:
    def __init__(self, filename, cc):
        self.filename = filename
        self.changeSent = False
        self.preChangeSent = False
        self.modified = False
        self.completionPrefixSel = None
        self.completionSel = None
        self.prevSel = None
        self.view = None
        self.hasErrors = False
        self.clientInfo = None
        self.changeCountErrReq = -1
        self.lastModChangeCount = cc
        self.modCount = 0

# region that will not change as buffer is modified
class StaticRegion:
    def __init__(self, b, e):
        self.b = b
        self.e = e

    def toRegion(self):
        return sublime.Region(self.b, self.e)

    def begin(self):
        return self.b

    def empty(self):
        return self.b == self.e


# convert a list of static regions to ordinary regions
def staticRegionsToRegions(staticRegions):
    result = []
    for staticRegion in staticRegions:
        result.append(staticRegion.toRegion())
    return result

# copy a region into a static region
def copyRegionStatic(r):
    return StaticRegion(r.begin(), r.end())

# copy a list of regions into a list of static regions
def copyRegionsStatic(regions):
    result = []
    for region in regions:
        result.append(copyRegionStatic(region))
    return result

# copy a region (this is needed because the original region may change)
def copyRegion(r):
    return sublime.Region(r.begin(), r.end())

# copy a list of regions
def copyRegions(regions):
    result = []
    for region in regions:
        result.append(copyRegion(region))
    return result

# from a list of empty regions, make a list of regions whose begin() value is
# one before the begin() value of the corresponding input (for left_delete)
def decrRegions(emptyRegions, amt):
    rr = []
    for region in emptyRegions:
        rr.append(sublime.Region(region.begin() - amt, region.begin() - amt))
    return rr

def decrLocsToRegions(locs, amt):
    rr = []
    for loc in locs:
        rr.append(sublime.Region(loc - amt, loc - amt))
    return rr

# right now, we have this setting because there is no way to know how to translate
# tabs on the server side
# TODO: see if we can tolerate tabs by having the editor tell the server how
# to interpret them
def setFilePrefs(view):
    settings = view.settings()
    settings.set('translate_tabs_to_spaces', True)
    settings.set('tab_size', 4)
    settings.set('detect_indentation', False)
    settings.set('use_tab_stops', False)

# given a list of regions and a (possibly zero-length) string to insert, 
# send the appropriate change information to the server
def sendReplaceChangesForRegions(view, regions, insertString):
    if cli.ST2():
       return
    for region in regions:
        location = getLocationFromPosition(view, region.begin())
        endLocation = getLocationFromPosition(view, region.end())
        cli.service.change(view.file_name(), location, endLocation, insertString)

def getTempFileName():
   return os.path.join(pluginDir, ".tmpbuf")

# write the buffer of view to a temporary file and have the server reload it
def reloadBuffer(view, clientInfo=None):
   if not view.is_loading():
      t = time.time()
      tmpfileName = getTempFileName()
      tmpfile = codecs.open(tmpfileName, "w", "utf-8")
      text = view.substr(sublime.Region(0, view.size()))
      tmpfile.write(text)
      tmpfile.flush()
      cli.service.reload(view.file_name(), tmpfileName)
      et = time.time()
      print("time for reload %f" % (et - t))
      if not cli.ST2():
         if not clientInfo:
            clientInfo = cli.getOrAddFile(view.file_name())
         clientInfo.changeCount = view.change_count()
         clientInfo.pendingChanges = False

# if we have changes to the view not accounted for by change messages, 
# send the whole buffer through a temporary file
def checkUpdateView(view):
    clientInfo = cli.getOrAddFile(view.file_name())
    if cli.reloadRequired(view):
        reloadBuffer(view, clientInfo)


# singleton that receives event calls from Sublime
class TypeScriptListener(sublime_plugin.EventListener):
    def __init__(self):
        self.fileMap = {}
        self.pendingCompletions = None
        self.completionView = None
        self.mruFileList = []
        self.pendingTimeout = 0
        self.pendingSelectionTimeout = 0
        self.errRefreshRequested = False
        self.changeFocus = False

    def getInfo(self, view):
        info = None
        if view.file_name() is not None:
            if is_typescript(view):
                info = self.fileMap.get(view.file_name())
                if not info:
                    if not cli:
                        plugin_loaded()
                    info = FileInfo(view.file_name(), None)
                    info.view = view
                    settings = view.settings()
                    info.clientInfo = cli.getOrAddFile(view.file_name())
                    setFilePrefs(view)
                    self.fileMap[view.file_name()] = info
                    cli.service.open(view.file_name())
                    if view.is_dirty():
                       if not view.is_loading():
                          reloadBuffer(view, info.clientInfo)
                       else:
                          info.clientInfo.pendingChanges = True
                    if (info in self.mruFileList):
                        self.mruFileList.remove(info)
                    self.mruFileList.append(info)
        return info
           
    def change_count(self, view):
        info = self.getInfo(view)
        if info:
            if cli.ST2():
                return info.modCount
            else:
                return view.change_count()

    # called by Sublime when a view receives focus
    def on_activated(self, view):
        info = self.getInfo(view)
        if info:
            # save cursor in case we need to read what was inserted
            info.prevSel = copyRegionsStatic(view.sel())
            # ask server for initial error diagnostics
            self.refreshErrors(view, 200)
            # set modified and selection idle timers, so we can read
            # diagnostics and update
            # status line
            self.setOnIdleTimer(20)
            self.setOnSelectionIdleTimer(20)
            self.changeFocus = True

    # ask the server for diagnostic information on all opened ts files in
    # most-recently-used order
    # TODO: limit this request to ts files currently visible in views
    def refreshErrors(self, view, errDelay):
        info = self.getInfo(view)
        if info and (self.changeFocus or (info.changeCountErrReq < self.change_count(view))):
            self.changeFocus = False
            info.changeCountErrReq = self.change_count(view)
            window = sublime.active_window()
            numGroups = window.num_groups()
            files = []
            for i in range(numGroups):
                groupActiveView = window.active_view_in_group(i)
                info = self.getInfo(groupActiveView)
                if info:
                    files.append(groupActiveView.file_name())
                    checkUpdateView(groupActiveView)
            if len(files) > 0:
                cli.service.requestGetError(errDelay, files)
            self.errRefreshRequested = True
            self.setOnIdleTimer(errDelay + 300)

    # expand region list one to left for backspace change info
    def expandEmptyLeft(self, regions):
        result = []
        for region in regions:
            if region.empty():
                result.append(sublime.Region(region.begin() - 1, region.end()))
            else:
                result.append(region)
        return result

    # expand region list one to right for delete key change info
    def expandEmptyRight(self, regions):
        result = []
        for region in regions:
            if region.empty():
                result.append(sublime.Region(region.begin(), region.end() + 1))
            else:
                result.append(region)
        return result

    # error messages arrived from the server; show them in view
    def showErrorMsgs(self, diagEvtBody, syntactic):
        filename = diagEvtBody.file
        if os.name == 'nt':
           filename = filename.replace('/', '\\')
        diags = diagEvtBody.diagnostics
        info = self.fileMap.get(filename)
        if info:
            view = info.view
            if not (info.changeCountErrReq == self.change_count(view)):
                self.setOnIdleTimer(200)                
            else:
                if syntactic:
                    regionKey = 'syntacticDiag'
                else:
                    regionKey = 'semanticDiag'
                view.erase_regions(regionKey)
                clientInfo = cli.getOrAddFile(filename)
                clientInfo.errors[regionKey] = []
                errRegions = []
                if diags:
                    for diag in diags:
                        startlc = diag.start
                        endlc = diag.end
                        (l, c) = extractLineCol(startlc)
                        (endl, endc) = extractLineCol(endlc)
                        text = diag.text
                        start = view.text_point(l, c)
                        end = view.text_point(endl, endc)
                        if (end <= view.size()):
                            region = sublime.Region(start, end)
                            errRegions.append(region)
                            clientInfo.errors[regionKey].append((region, text))
                info.hasErrors = cli.hasErrors(filename)
                self.update_status(view, info)
                if cli.ST2():
                   view.add_regions(regionKey, errRegions, "keyword", "", sublime.DRAW_OUTLINED)
                else:
                   view.add_regions(regionKey, errRegions, "keyword", "", 
                                    sublime.DRAW_NO_FILL + sublime.DRAW_NO_OUTLINE + sublime.DRAW_SQUIGGLY_UNDERLINE)            

    # event arrived from the server; call appropriate handler
    def dispatchEvent(self, ev):
        evtype = ev.event
        if evtype == 'syntaxDiag':
            self.showErrorMsgs(ev.body, syntactic=True)
        elif evtype == 'semanticDiag':
            self.showErrorMsgs(ev.body, syntactic=False)

    # set timer to go off when selection is idle
    def setOnSelectionIdleTimer(self, ms):
        self.pendingSelectionTimeout+=1
        sublime.set_timeout(self.handleSelectionTimeout, ms)
        
    def handleSelectionTimeout(self):
        self.pendingSelectionTimeout-=1
        if self.pendingSelectionTimeout == 0:
            self.onSelectionIdle()

    # if selection is idle (cursor is not moving around)
    # update the status line (error message or quick info, if any)
    def onSelectionIdle(self):
        view = active_view()
        info = self.getInfo(view)
        if info:
            self.update_status(view, info)

    # set timer to go off when file not being modified
    def setOnIdleTimer(self, ms):
        self.pendingTimeout+=1
        sublime.set_timeout(self.handleTimeout, ms)
        
    def handleTimeout(self):
        self.pendingTimeout-=1
        if self.pendingTimeout == 0:
            self.onIdle()

    # if file hasn't been modified for a time
    # check the event queue and dispatch any events
    def onIdle(self):
        view = active_view()
        ev = cli.service.getEvent()
        if ev is not None:
            self.dispatchEvent(ev)
            self.errRefreshRequested = False
            # reset the timer in case more events are on the queue
            self.setOnIdleTimer(50)
        elif self.errRefreshRequested:
            # reset the timer if we haven't gotten an event
            # since the last time errors were requested
            self.setOnIdleTimer(50)
        info = self.getInfo(view)
        if info:
            # request errors
            self.refreshErrors(view, 500)

    def on_load(self, view):
        clientInfo = cli.getOrAddFile(view.file_name())
        if clientInfo and clientInfo.loadHandler:
            clientInfo.loadHandler(view)
            clientInfo.loadHandler = None
        
    # ST3 only
    # for certain text commands, learn what changed and notify the
    # server, to avoid sending the whole buffer during completion
    # or when key can be held down and repeated
    # called by ST3 for some, but not all, text commands
    def on_text_command(self, view, command_name, args):
        info = self.getInfo(view)
        if info:
            info.changeSent = True
            info.preChangeSent = True
            if command_name == "left_delete":
                # backspace
                sendReplaceChangesForRegions(view, self.expandEmptyLeft(view.sel()), "")
            elif command_name == "right_delete":
                # delete
                sendReplaceChangesForRegions(view, self.expandEmptyRight(view.sel()), "")
            else:
                # notify on_modified and on_post_text_command events that
                # nothing was handled
                # there are multiple flags because Sublime does not always call
                # all three events
                info.preChangeSent = False
                info.changeSent = False
                info.modified = False
                if (command_name == "commit_completion") or (command_name == "insert_best_completion"):
                    # for finished completion, remember current cursor and set
                    # a region that will be
                    # moved by the inserted text
                    info.completionSel = copyRegions(view.sel())
                    view.add_regions("apresComp", copyRegions(view.sel()), 
                                     flags=sublime.HIDDEN)

    # update the status line with error info and quick info if no error info
    def update_status(self, view, info):
        if info.hasErrors:
            view.run_command('typescript_error_info')
        else:
            view.erase_status("typescript_error")
        errstatus = view.get_status('typescript_error')
        if errstatus and (len(errstatus) > 0):
            view.erase_status("typescript_info")
        else:
            view.run_command('typescript_quick_info')

    def on_close(self, view):
       if not cli:
           plugin_loaded()
       if view.is_scratch() and (view.name() == "Find References"):
           cli.disposeRefInfo()
       else:
           info = self.getInfo(view)
           if info:
               if (info in self.mruFileList):
                   self.mruFileList.remove(info)
               # make sure we know the latest state of the file
               reloadBuffer(view, info.clientInfo)
               # notify the server that the file is closed
               cli.service.close(view.file_name())
          

    # called by Sublime when the cursor moves (or when text is selected)
    # called after on_modified (when on_modified is called)
    def on_selection_modified(self, view):
        info = self.getInfo(view)
        if info:
            if not info.clientInfo:
                info.clientInfo = cli.getOrAddFile(view.file_name())
            if (info.clientInfo.changeCount < self.change_count(view)) and (info.lastModChangeCount != self.change_count(view)):
                # detected a change to the view for which Sublime did not call
                # on_modified
                # and for which we have no hope of discerning what changed
                info.clientInfo.pendingChanges = True
            # save the current cursor position so that we can see (in
            # on_modified) what was inserted
            info.prevSel = copyRegionsStatic(view.sel())
            self.setOnSelectionIdleTimer(50)
            # hide the doc info output panel if it's up
            panelView = sublime.active_window().get_output_panel("doc")
            if panelView.window():
                sublime.active_window().run_command("hide_panel", { "cancel" : True })

    # usually called by Sublime when the buffer is modified
    # not called for undo, redo
    def on_modified(self, view):
        info = self.getInfo(view)
        if info:
            info.modified = True
            if cli.ST2():
               info.modCount+=1
            info.lastModChangeCount = self.change_count(view)
            print("modified " + view.file_name())
            (lastCommand, args, rept) = view.command_history(0)
            if info.preChangeSent:
                # change handled in on_text_command
                info.clientInfo.changeCount = self.change_count(view)
                info.preChangeSent = False
            elif (lastCommand == "insert") and (not "\n" in args['characters']) and (len(info.prevSel) == 1) and (info.prevSel[0].empty()):
                info.clientInfo.changeCount = self.change_count(view)
                prevCursor = info.prevSel[0].begin()
                cursor = view.sel()[0].begin()
                key = view.substr(sublime.Region(prevCursor, cursor))
                sendReplaceChangesForRegions(view, staticRegionsToRegions(info.prevSel), key)
                # mark change as handled so that on_post_text_command doesn't
                # try to handle it
                info.changeSent = True
            self.setOnIdleTimer(100)

    # ST3 only
    # called by ST3 for some, but not all, text commands
    # not called for insert command
    def on_post_text_command(self, view, command_name, args):
        def buildReplaceRegions(emptyRegionsA, emptyRegionsB):
            rr = []
            for i in range(len(emptyRegionsA)):
                rr.append(sublime.Region(emptyRegionsA[i].begin(), emptyRegionsB[i].begin()))
            return rr

        info = self.getInfo(view)
        if info:
            if (not info.changeSent) and info.modified:
                # file is modified but on_text_command and on_modified did not
                # handle it
                # handle insertion of string from completion menu, so that
                # it is fast to type completedName1.completedName2 (avoid a lag
                # when completedName1 is committed)
                if ((command_name == "commit_completion") or command_name == ("insert_best_completion")) and (len(view.sel()) == 1):
                    # get saved region that was pushed forward by insertion of
                    # the completion
                    apresCompReg = view.get_regions("apresComp")
                    # note: assuming sublime makes all regions empty for
                    # completion, which the doc claims is true
                    # insertion string is from region saved in
                    # on_query_completion to region pushed forward by
                    # completion insertion
                    insertionString = view.substr(sublime.Region(info.completionPrefixSel[0].begin(), apresCompReg[0].begin()))
                    sendReplaceChangesForRegions(view, buildReplaceRegions(info.completionPrefixSel, info.completionSel), insertionString)
                    view.erase_regions("apresComp")
                elif ((command_name == "typescript_format_on_key") or (command_name == "typescript_format_document") or (command_name == "typescript_format_selection") or (command_name == "typescript_format_line") or (command_name == "typescript_paste_and_format")):
                     # changes were sent by the command so no need to
                     print("handled changes for " + command_name)
                else:
                    print(command_name)
                    # give up and send whole buffer to server (do this eagerly
                    # to avoid lag on next request to server)
                    reloadBuffer(view, info.clientInfo)
                # we are up-to-date because either change was sent to server or
                # whole buffer was sent to server
                info.clientInfo.changeCount = view.change_count()
            # reset flags and saved regions used for communication among
            # on_text_command, on_modified, on_selection_modified, 
            # on_post_text_command, and on_query_completion
            info.changeSent = False
            info.modified = False
            info.completionSel = None

    # helper called back when completion info received from server
    def handleCompletionInfo(self, completionsResp):
        if completionsResp.success:
            completions = []
            rawCompletions = completionsResp.body
            if rawCompletions:
                for rawCompletion in rawCompletions:
                    name = rawCompletion.name
                    completion = (name + "\t" + rawCompletion.kind, name)
                    completions.append(completion)
                self.pendingCompletions = completions
            else:
                self.pendingCompletions = []
        else:
            self.pendingCompletions = []

    #  not currently used; would be used in async case
    def run_auto_complete(self):
        active_view().run_command("auto_complete", {
            'disable_auto_insert': True, 
            'api_completions_only': False, 
            'next_completion_if_showing': False, 
            'auto_complete_commit_on_tab': True, 
        })

    # synchronous for now; can change to async by adding hide/show from the
    # handler
    def on_query_completions(self, view, prefix, locations):
        info = self.getInfo(view)
        if info:
            print("complete with: " + prefix)
            info.completionPrefixSel = decrLocsToRegions(locations, len(prefix))
            if not cli.ST2():
               view.add_regions("apresComp", decrLocsToRegions(locations, 0), flags=sublime.HIDDEN)

            location = getLocationFromPosition(view, locations[0])
            checkUpdateView(view)
            cli.service.completions(view.file_name(), location, prefix, self.handleCompletionInfo)
            
            completions = self.pendingCompletions
            self.pendingCompletions = None
            return (completions, sublime.INHIBIT_WORD_COMPLETIONS | sublime.INHIBIT_EXPLICIT_COMPLETIONS)


# for debugging, send command to server to save server buffer in temp file
# TODO: safe temp file name on Windows
class TypescriptSave(sublime_plugin.TextCommand):
    def run(self, text):
        cli.service.saveto(self.view.file_name(), "/tmp/curstate")

# command currently called only from event handlers
class TypescriptQuickInfo(sublime_plugin.TextCommand):
    def handleQuickInfo(self, quickInfoResp):
        if quickInfoResp.success:
            infoStr = quickInfoResp.body.displayString
            docStr = quickInfoResp.body.documentation
            if len(docStr) > 0:
                infoStr = infoStr + " (^T^Q for more)"
            self.view.set_status("typescript_info", infoStr)
        else:
            self.view.erase_status("typescript_info")

    def run(self, text):
        checkUpdateView(self.view)
        cli.service.quickInfo(self.view.file_name(), getLocationFromView(self.view), self.handleQuickInfo)
             
    def is_enabled(self):
        return is_typescript(self.view)


class TypescriptShowDoc(sublime_plugin.TextCommand):
    def run(self, text, infoStr="", docStr=""):
       self.view.insert(text, self.view.sel()[0].begin(), infoStr + "\n\n")
       self.view.insert(text, self.view.sel()[0].begin(), docStr)
     

# command to show the doc string associated with quick info;
# re-runs quick info in case info has changed
class TypescriptQuickInfoDoc(sublime_plugin.TextCommand):
    def handleQuickInfo(self, quickInfoResp):
        if quickInfoResp.success:
            infoStr = quickInfoResp.body.displayString
            docStr = quickInfoResp.body.documentation
            if len(docStr) > 0:
                docPanel = sublime.active_window().get_output_panel("doc")
                docPanel.run_command('typescript_show_doc', 
                                     { 'infoStr': infoStr, 
                                       'docStr': docStr })
                docPanel.settings().set('color_scheme', "Packages/Color Scheme - Default/Blackboard.tmTheme")
                sublime.active_window().run_command('show_panel', { 'panel': 'output.doc' })
                infoStr = infoStr + " (^T^Q for more)"
            self.view.set_status("typescript_info", infoStr)
        else:
            self.view.erase_status("typescript_info")

    def run(self, text):
        checkUpdateView(self.view)
        cli.service.quickInfo(self.view.file_name(), getLocationFromView(self.view), self.handleQuickInfo)

    def is_enabled(self):
        return is_typescript(self.view)


# command called from event handlers to show error text in status line
# (or to erase error text from status line if no error text for location)
class TypescriptErrorInfo(sublime_plugin.TextCommand):
    def run(self, text):
        clientInfo = cli.getOrAddFile(self.view.file_name())
        pt = self.view.sel()[0].begin()
        errorText = ""
        for (region, text) in clientInfo.errors['syntacticDiag']:
            if region.contains(pt):
                errorText = text
        for (region, text) in clientInfo.errors['semanticDiag']:
            if region.contains(pt):
                errorText = text
        if len(errorText) > 0:
            self.view.set_status("typescript_error", errorText)
        else:
            self.view.erase_status("typescript_error")
                
    def is_enabled(self):
        return is_typescript(self.view)


# go to definition command
class TypescriptGoToDefinitionCommand(sublime_plugin.TextCommand):
    def run(self, text):
        checkUpdateView(self.view)
        definitionResp = cli.service.definition(self.view.file_name(), getLocationFromView(self.view))
        if definitionResp.success:
            codeSpan = definitionResp.body[0] if len(definitionResp.body) > 0 else None
            if codeSpan:
                filename = codeSpan.file
                startlc = codeSpan.start
                sublime.active_window().open_file('{0}:{1}:{2}'.format(filename, startlc.line, startlc.col),
                                                  sublime.ENCODED_POSITION)


# go to type command
class TypescriptGoToTypeCommand(sublime_plugin.TextCommand):
    def run(self, text):
        checkUpdateView(self.view)
        typeResp = cli.service.type(self.view.file_name(), getLocationFromView(self.view))
        if typeResp.success:
            items = typeResp.body
            if len(items) > 0:
                codeSpan = items[0]
                filename = codeSpan.file
                startlc = codeSpan.start
                sublime.active_window().open_file('{0}:{1}:{2}'.format(filename, startlc.line or 0, startlc.col or 0), 
                                                  sublime.ENCODED_POSITION)

class FinishRenameCommandArgs:
    def __init__(self, newName, outerLocs):
        self.newName = newName
        self.outerLocs = outerLocs

    @staticmethod
    def fromDict(newName, outerLocs):
        return FinishRenameCommandArgs(
            newName, 
            jsonhelpers.fromDict(servicedefs.FileLocations, outerLocs))

# rename command
class TypescriptRenameCommand(sublime_plugin.TextCommand):
    def run(self, text):
        checkUpdateView(self.view)
        renameResp = cli.service.rename(self.view.file_name(), getLocationFromView(self.view))
        if renameResp.success:
            infoLocs = renameResp.body
            displayName = infoLocs.info.fullDisplayName
            outerLocs = infoLocs.locs
            def on_cancel():
                return 
            def on_done(newName):
                args = FinishRenameCommandArgs(newName, outerLocs)
                argsJsonStr = jsonhelpers.encode(args)
                self.view.run_command('typescript_finish_rename', { "argsJson": argsJsonStr })
            if len(outerLocs) > 0:
                sublime.active_window().show_input_panel("New name for {0}: ".format(displayName), "", 
                                                         on_done, None, on_cancel)


def locsToValue(locs):
    locsValue = []
    for loc in locs:
        locsValue.append(loc.toDict())
    return locsValue

# called from on_done handler in finish_rename command
# on_done is called by input panel for new name
class TypescriptFinishRenameCommand(sublime_plugin.TextCommand):
    def run(self, text, argsJson=""):
        args = jsonhelpers.decode(FinishRenameCommandArgs, argsJson)
        newName = args.newName
        outerLocs = args.outerLocs
        if len(outerLocs) > 0:
            for outerLoc in outerLocs:
                file = outerLoc.file
                innerLocs = outerLoc.locs
                activeWindow = sublime.active_window()
                renameView = activeWindow.find_open_file(file)
                if not renameView:
                    renameView = activeWindow.open_file(file)
                if renameView.is_loading():
                    clientInfo = cli.getOrAddFile(file)
                    innerLocsValue = locsToValue(innerLocs)
                    def applyLocs(v):
                        v.run_command('typescript_delayed_rename_file',
                                      { "locs" : innerLocsValue, "name" : newName })
                    clientInfo.loadHandler = applyLocs
                elif renameView != self.view:
                    print(" got to " + renameView.file_name())
                    innerLocsValue = locsToValue(innerLocs)
                    print(innerLocsValue)
                    renameView.run_command('typescript_delayed_rename_file',
                                           { "locs" : innerLocsValue, "name" : newName })
                else:
                    for innerLoc in innerLocs:
                        startlc = innerLoc.start
                        (startl, startc) = extractLineCol(startlc)
                        endlc = innerLoc.end
                        (endl, endc) = extractLineCol(endlc)
                        applyEdit(text, self.view, startl, startc, endl, 
                                  endc, ntext = newName)


def extractLineColFromDict(lc):
    line = lc['line'] - 1
    col = lc['col'] - 1
    return (line, col)

class TypescriptDelayedRenameFile(sublime_plugin.TextCommand):
    def run(self, text, locs = None, name = ""):
        if locs and (len(name) > 0):
            print(name)
            print(locs)
            for innerLoc in locs:
                startlc = innerLoc['start']
                (startl, startc) = extractLineColFromDict(startlc)
                endlc = innerLoc['end']
                (endl, endc) = extractLineColFromDict(endlc)
                applyEdit(text, self.view, startl, startc, endl, 
                          endc, ntext = name)
            

# if the FindReferences view is active, get it
# TODO: generalize this so that we can find any scratch view
# containing references to other files
def getRefView(create=True):
    active_window = sublime.active_window()
    for view in active_window.views():
        if view.name() == "Find References":
            return view
    if create:
        refView = active_window.new_file()
        refView.set_name("Find References")
        refView.set_scratch(True)
        return refView

class FindReferencesCommandArgs:
    def __init__(self, filename, line, referencesRespBody):
        self.filename = filename
        self.line = line
        self.referencesRespBody = referencesRespBody

    @staticmethod
    def fromDict(filename, line, referencesRespBody):
        return FindReferencesCommandArgs(
            filename,
            line,
            jsonhelpers.fromDict(servicedefs.ReferencesResponseBody, referencesRespBody))

# find references command
class TypescriptFindReferencesCommand(sublime_plugin.TextCommand):
    def run(self, text):
        checkUpdateView(self.view)
        referencesResp = cli.service.references(self.view.file_name(), getLocationFromView(self.view))
        if referencesResp.success:
            pos = self.view.sel()[0].begin()
            cursor = self.view.rowcol(pos)
            line = str(cursor[0] + 1)
            args = FindReferencesCommandArgs(self.view.file_name(), line, referencesResp.body)
            argsJsonStr = jsonhelpers.encode(args)
            refView = getRefView()
            refView.run_command('typescript_populate_refs', { "argsJson": argsJsonStr })


# place the caret on the currently-referenced line and
# update the reference line to go to next
def updateRefLine(refInfo, curLine, view):
    view.erase_regions("curref")
    caretPos = view.text_point(curLine, 0)
    # sublime 2 doesn't support custom icons
    icon = "Packages/" + pluginName + "/icons/arrow-right3.png" if not cli.ST2() else ""
    view.add_regions("curref", [sublime.Region(caretPos, caretPos + 1)], 
                     "keyword", icon, 
                     sublime.HIDDEN)


# if cursor is on reference line, go to (filename, line, col) referenced by
# that line
class TypescriptGoToRefCommand(sublime_plugin.TextCommand):
    def run(self, text):
        pos = self.view.sel()[0].begin()
        cursor = self.view.rowcol(pos)
        refInfo = cli.getRefInfo()
        mapping = refInfo.getMapping(str(cursor[0]))
        if mapping:
           (filename, l, c, p, n) = mapping.asTuple()
           updateRefLine(refInfo, cursor[0], self.view)
           sublime.active_window().open_file('{0}:{1}:{2}'.format(filename, l + 1 or 0, c + 1 or 0), 
              sublime.ENCODED_POSITION)    


# command: go to next reference in active references file
# TODO: generalize this to work for all types of references
class TypescriptNextRefCommand(sublime_plugin.TextCommand):
    def run(self, text):
        print("next ref")
        if (self.view.file_name()):
            print(self.view.file_name())
        refView = getRefView()
        if refView:
            refInfo = cli.getRefInfo()
            line = refInfo.nextRefLine()
            pos = refView.text_point(int(line), 0)
            refView.sel().clear()
            refView.sel().add(sublime.Region(pos, pos))
            refView.run_command('typescript_go_to_ref')


# command: go to previous reference in active references file
# TODO: generalize this to work for all types of references
class TypescriptPrevRefCommand(sublime_plugin.TextCommand):
    def run(self, text):
        print("prev ref")
        if (self.view.file_name()):
            print(self.view.file_name())
        refView = getRefView()
        if refView:
            refInfo = cli.getRefInfo()
            line = refInfo.prevRefLine()
            pos = refView.text_point(int(line), 0)
            refView.sel().clear()
            refView.sel().add(sublime.Region(pos, pos))
            refView.run_command('typescript_go_to_ref')


# highlight all occurances of refId in view
def highlightIds(view, refId):
    idRegions = view.find_all("(?<=\W)" + refId + "(?=\W)") 
    if idRegions and (len(idRegions) > 0):
       if cli.ST2():
          view.add_regions("refid", idRegions, "constant.numeric", "", sublime.DRAW_OUTLINED)
       else:
          view.add_regions("refid", idRegions, "constant.numeric", 
                           flags=sublime.DRAW_NO_FILL | sublime.DRAW_NO_OUTLINE | sublime.DRAW_SOLID_UNDERLINE)


# helper command called by TypescriptFindReferences; put the references in the
# references buffer
# TODO: generalize this to populate any type of references file
# (such as build errors)
class TypescriptPopulateRefs(sublime_plugin.TextCommand):
    def run(self, text, argsJson):
        args = jsonhelpers.decode(FindReferencesCommandArgs, argsJson)
        filename = args.filename
        line = args.line
        refDisplayString = args.referencesRespBody.symbolDisplayString
        refId = args.referencesRespBody.symbolName
        refs = args.referencesRespBody.refs

        fileCount = 0
        matchCount = 0
        self.view.set_read_only(False)
        # erase the caret showing the last reference followed
        self.view.erase_regions("curref")
        # clear the references buffer
        self.view.erase(text, sublime.Region(0, self.view.size()))
        header = "References to {0} \n\n".format(refDisplayString)
        self.view.insert(text, self.view.sel()[0].begin(), header)
        self.view.set_syntax_file("Packages/" + pluginName + "/FindRefs.hidden-tmLanguage")
        window = sublime.active_window()
        refInfo = None
        if len(refs) > 0:
            prevFilename = ""
            openview = None
            prevLine = None
            for ref in refs:
                filename = ref.file
                if prevFilename != filename:
                    print("refs from " + filename)
                    fileCount+=1
                    if prevFilename != "":
                        self.view.insert(text, self.view.sel()[0].begin(), "\n")
                    self.view.insert(text, self.view.sel()[0].begin(), filename + ":\n")
                    prevFilename = filename
                startlc = ref.start
                (l, c) = extractLineCol(startlc)
                pos = self.view.sel()[0].begin()
                cursor = self.view.rowcol(pos)
                line = str(cursor[0])
                if not refInfo:
                    refInfo = cli.initRefInfo(line, refId)
                refInfo.addMapping(line, Ref(filename, l, c, prevLine))
                if prevLine:
                    mapping = refInfo.getMapping(prevLine)
                    mapping.setNextLine(line)
                prevLine = line
                content = ref.lineText
                displayRef = "    {0}:  {1}\n".format(l + 1, content)
                matchCount+=1
                self.view.insert(text, self.view.sel()[0].begin(), displayRef)
        refInfo.setLastLine(line)
        self.view.insert(text, self.view.sel()[0].begin(), 
                             "\n{0} matches in {1} file{2}\n".format(matchCount, 
                                                                     fileCount, "" if (fileCount == 1) else "s"))
        if matchCount > 0:
            highlightIds(self.view, refId)
        window.focus_view(self.view)
        self.view.sel().clear()
        caretPos = self.view.text_point(2, 0)
        self.view.sel().add(sublime.Region(caretPos, caretPos))
        # serialize the reference info into the settings
        self.view.settings().set('refinfo', refInfo.asValue())
        self.view.set_read_only(True)


# apply a single edit specification to a view
def applyEdit(text, view, startl, startc, endl, endc, ntext=""):
    begin = view.text_point(startl, startc)
    end = view.text_point(endl, endc)
    region = sublime.Region(begin, end)
    sendReplaceChangesForRegions(view, [region], ntext)
    # break replace into two parts to avoid selection changes
    if region.size() > 0:
        view.erase(text, region)
    if (len(ntext) > 0):
        view.insert(text, begin, ntext)


# apply a set of edits to a view
def applyFormattingChanges(text, view, codeEdits):
    if codeEdits:
        for codeEdit in codeEdits[::-1]:
            startlc = codeEdit.start
            (startl, startc) = extractLineCol(startlc)
            endlc = codeEdit.end
            (endl, endc) = extractLineCol(endlc)
            newText = codeEdit.newText
            applyEdit(text, view, startl, startc, endl, endc, ntext=newText)


# format on ";", "}", or "\n"; called by typing these keys in a ts file
# in the case of "\n", this is only called when no completion dialogue visible
class TypescriptFormatOnKey(sublime_plugin.TextCommand):
    def run(self, text, key = "", insertKey = True):
        if 0 == len(key):
            return
        loc = self.view.sel()[0].begin()
        if insertKey:
            self.view.insert(text, loc, key)
            sendReplaceChangesForRegions(self.view, [sublime.Region(loc, loc)], key)
            if not cli.ST2():
                clientInfo = cli.getOrAddFile(self.view.file_name())
                clientInfo.changeCount = self.view.change_count()
            checkUpdateView(self.view)
        formatResp = cli.service.formatOnKey(self.view.file_name(), getLocationFromView(self.view), key)
        if formatResp.success:
            codeEdits = formatResp.body
            applyFormattingChanges(text, self.view, codeEdits)


# format a range of locations in the view
def formatRange(text, view, begin, end):
    checkUpdateView(view)
    formatResp = cli.service.format(view.file_name(), getLocationFromPosition(view, begin), getLocationFromPosition(view, end))
    if formatResp.success:
        codeEdits = formatResp.body
        applyFormattingChanges(text, view, codeEdits)
    if not cli.ST2():
        clientInfo = cli.getOrAddFile(view.file_name())
        clientInfo.changeCount = view.change_count()


# command to format the current selection
class TypescriptFormatSelection(sublime_plugin.TextCommand):
    def run(self, text):
        r = self.view.sel()[0]
        formatRange(text, self.view, r.begin(), r.end())


# command to format the entire buffer
class TypescriptFormatDocument(sublime_plugin.TextCommand):
    def run(self, text):
        formatRange(text, self.view, 0, self.view.size())

nonBlankLinePattern = re.compile("[\S]+")

# command to format the current line
class TypescriptFormatLine(sublime_plugin.TextCommand):
    def run(self, text):
        lineRegion = self.view.line(self.view.sel()[0])
        lineText = self.view.substr(lineRegion)
        if (nonBlankLinePattern.search(lineText)):
            formatRange(text, self.view, lineRegion.begin(), lineRegion.end())
        else:
            position = self.view.sel()[0].begin()
            cursor = self.view.rowcol(position)
            line = cursor[0]
            if line > 0:
                self.view.run_command('typescript_format_on_key', { "key": "\n", "insertKey": False });

class TypescriptFormatBrackets(sublime_plugin.TextCommand):
    def run(self, text):
        sel=self.view.sel()
        if (len(sel) == 1):
            print('format brackets')
            originalPos = sel[0].begin()
            bracketChar = self.view.substr(originalPos)
            if bracketChar != "}":
                self.view.run_command('move_to', { "to": "brackets" });
                bracketPos = self.view.sel()[0].begin()
                bracketChar = self.view.substr(bracketPos)
            if bracketChar == "}":
                self.view.run_command('move', { "by": "characters", "forward": True })
                self.view.run_command('typescript_format_on_key', { "key": "}", "insertKey": False });
                self.view.run_command('move', { "by": "characters", "forward": True })

class TypescriptPasteAndFormat(sublime_plugin.TextCommand):
    def run(self, text):
        view = self.view
        beforePaste = copyRegionsStatic(view.sel())
        if cli.ST2():
            view.add_regions("apresPaste", copyRegions(view.sel()), "", "", sublime.HIDDEN)
        else:
            view.add_regions("apresPaste", copyRegions(view.sel()), flags = sublime.HIDDEN)
        view.run_command("paste")
        afterPaste = view.get_regions("apresPaste")
        view.erase_regions("apresPaste")
        for i in range(len(beforePaste)):
            rb = beforePaste[i]
            ra = afterPaste[i]
            rblineStart = view.line(rb.begin()).begin()
            ralineEnd = view.line(ra.begin()).end()
            formatRange(text, view, rblineStart, ralineEnd)

# this is not always called on startup by Sublime, so we call it
# from on_activated or on_close if necessary
# TODO: get abbrev message and set up dictionary
def plugin_loaded():
    global cli
    print('initialize typescript...')
    print(sublime.version())
    cli = EditorClient()
    cli.setFeatures()
    refView = getRefView(False)
    if refView:
        settings = refView.settings()
        refInfoV = settings.get('refinfo')
        if refInfoV:
           print("got refinfo from settings")
           refInfo = buildRefInfo(refInfoV)
           cli.updateRefInfo(refInfo)
           refView.set_scratch(True)
           highlightIds(refView, refInfo.getRefId())
           curLine = refInfo.getRefLine()
           if curLine:
              updateRefLine(refInfo, curLine, refView)
           else:
              print("no current ref line")
        else:
           print("trying to close ref view")
           window = sublime.active_window()
           if window:
              window.focus_view(refView)
              window.run_command('close')
    else:
       print("ref view not found")


# this unload is not always called on exit
def plugin_unloaded():
    print('typescript plugin unloaded')
    refView = getRefView()
    if refView:
        refInfo = cli.getRefInfo()
        if refInfo:
            refView.settings().set('refinfo', refInfo.asValue())
