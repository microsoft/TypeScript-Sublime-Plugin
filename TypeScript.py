import json
import os
import sys
import logging
import time
import re
import codecs
from string import Template

import sublime
import sublime_plugin

''' Enable logging '''
logFileLevel = logging.WARN
logConsLevel = logging.WARN

def set_log_level(logger):
    logger.logFile.setLevel(logFileLevel)
    logger.console.setLevel(logConsLevel)

# Need to remove any old zipped package installed by 0.1.1 release
def _cleanup_011():
    this_file = os.path.abspath(__file__)
    old_package = ''

    # Is the current file running under installed packages or packages?
    offset = this_file.find(os.path.sep + 'Installed Packages' + os.path.sep)
    if offset == -1:
        offset = this_file.find(os.path.sep + 'Packages' + os.path.sep)

    if offset == -1:
        print('ERROR: Could not location parent packages folder')
        return

    # Move/delete old package if present
    old_package = os.path.join(this_file[:offset], 'Installed Packages', 'TypeScript.sublime-package')
    temp_name = os.path.join(this_file[:offset], 'Installed Packages', 'TypeScript.-old-sublime-package')
    if os.path.exists(old_package):
        # Rename first, incase delete fails due to file in use
        print('Detected outdated TypeScript plugin package. Removing ' + old_package)
        os.rename(old_package, temp_name)
        os.remove(temp_name)

try:
    _cleanup_011()
except:
    pass

# Sublime/Python 2 & 3 differ in the name of this module, thus package import
# needs to be handled slightly differently
if sys.version_info < (3, 0):
    from libs import logger
else:
    from .libs import logger
set_log_level(logger)

logger.log.warn('TypeScript plugin initialized.')

# get the directory path to this file; ST2 requires this to be done at global scope
pluginDir = os.path.dirname(os.path.abspath(__file__))
pluginName = os.path.basename(pluginDir)

libsDir = os.path.join(pluginDir, 'libs')
if libsDir not in sys.path:
    sys.path.insert(0, libsDir)

from nodeclient import NodeCommClient
from serviceproxy import *
from popupmanager import PopupManager

# Enable Python Tools for visual studio remote debugging
try: 
    from ptvsd import enable_attach
    enable_attach(secret=None)
except ImportError:
    pass

TOOLTIP_SUPPORT = int(sublime.version()) >= 3072

# globally-accessible information singleton; set in function plugin_loaded
cli = None
popup_manager = None

# currently active view
def active_view():
    return sublime.active_window().active_view()

# view is typescript if outer syntactic scope is 'source.ts'
def is_typescript(view):
    if not view.file_name():
        return False
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

def is_special_view(cur_view):
    """ Determine if the current view is a special view.

    Special views are mostly refering to panels. They are different from normal views 
    in that they cannot be the active_view of their windows, therefore their ids shouldn't 
    be equal to the current view id.
    """
    return cur_view.window() and cur_view.id() != cur_view.window().active_view().id()

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
    Returns the LineOffset object of the given text position
    """
    cursor = view.rowcol(position)
    line = cursor[0] + 1
    offset = cursor[1] + 1
    return Location(line, offset)

def extractLineOffset(lineOffset):
    """
    Destructure line and offset tuple from LineOffset object
    convert 1-based line, offset to zero-based line, offset
    ``lineOffset`` LineOffset object
    """
    line = lineOffset.line - 1
    offset = lineOffset.offset - 1
    return (line, offset)


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
        self.renameOnLoad = None

# a reference to a source file, line, offset; next and prev refer to the
# next and previous reference in a view containing references
class Ref:
    def __init__(self, filename, line, offset, prevLine):
        self.filename = filename
        self.line = line
        self.offset = offset
        self.nextLine = None
        self.prevLine = prevLine

    def setNextLine(self, n):
        self.nextLine = n

    def asTuple(self):
        return (self.filename, self.line, self.offset, self.prevLine, self.nextLine)


# maps (line in view containing references) to (filename, line, offset)
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
    (filename, line, offset, prevLine, nextLine) = refTuple
    ref = Ref(filename, line, offset, prevLine)
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
            procFile = os.path.join(pluginDir, "tsserver", "tsserver.js")
        print("spawning node module: " + procFile)
        
        self.nodeClient = NodeCommClient(procFile)
        self.service = ServiceProxy(self.nodeClient)
        self.fileMap = {}
        self.refInfo = None
        self.versionST2 = False
        self.tempFileMap = {}
        self.tempFileList = []
        self.tmpseq = 0

    def ST2(self):
       return self.versionST2
    
    def setFeatures(self):
       if int(sublime.version()) < 3000:
          self.versionST2 = True
       hostInfo = "Sublime Text version " + str(sublime.version())
       # Preferences Settings
       pref_settings = sublime.load_settings('Preferences.sublime-settings')
       tabSize = pref_settings.get('tab_size', 4)
       indentSize = pref_settings.get('indent_size', tabSize)
       tabsToSpaces = pref_settings.get('translate_tabs_to_spaces', True)
       formatOptions = buildSimpleFormatOptions(tabSize, indentSize, tabsToSpaces)
       self.service.configure(hostInfo, None, formatOptions)

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
        if (os.name == "nt") and filename:
            filename = filename.replace('/','\\')
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
        self.lastCompletionLoc = None
        self.lastCompletions = None
        self.lastCompletionPrefix = None
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

def buildSimpleFormatOptions(tabSize, indentSize, tabsToSpaces):
    formatOptions = { "tabSize": tabSize, "indentSize": indentSize,
                      "convertTabsToSpaces": tabsToSpaces }
    return formatOptions

def reconfig_file(view):
    hostInfo = "Sublime Text version " + str(sublime.version())
    # Preferences Settings
    view_settings = view.settings()
    tabSize = view_settings.get('tab_size', 4)
    indentSize = view_settings.get('indent_size', tabSize)
    tabsToSpaces = view_settings.get('translate_tabs_to_spaces', True)
    formatOptions = buildSimpleFormatOptions(tabSize, indentSize, tabsToSpaces)
    cli.service.configure(hostInfo, view.file_name(), formatOptions)

def open_file(view):
    cli.service.open(view.file_name())

def tab_size_changed(view):
    reconfig_file(view)
    clientInfo = cli.getOrAddFile(view.file_name())
    clientInfo.pendingChanges = True

def setFilePrefs(view):
    settings = view.settings()
    settings.set('use_tab_stops', False)
#    settings.set('translate_tabs_to_spaces', True)
    settings.add_on_change('tab_size',lambda: tab_size_changed(view))
    settings.add_on_change('indent_size',lambda: tab_size_changed(view))
    settings.add_on_change('translate_tabs_to_spaces',lambda: tab_size_changed(view))
    reconfig_file(view)

# given a list of regions and a (possibly zero-length) string to insert, 
# send the appropriate change information to the server
def sendReplaceChangesForRegions(view, regions, insertString):
    if cli.ST2() or (not is_typescript(view)):
       return
    for region in regions:
        location = getLocationFromPosition(view, region.begin())
        endLocation = getLocationFromPosition(view, region.end())
        cli.service.change(view.file_name(), location, endLocation, insertString)

def recv_reload_response(reloadResp):
    if reloadResp.request_seq in cli.tempFileMap:
        tmpfile = cli.tempFileMap.pop(reloadResp.request_seq)
        if tmpfile:
            cli.tempFileList.append(tmpfile)

def getTempFileName():
    """ Get the first unused temp file name to avoid conflicts
    """
    seq = cli.service.seq
    if len(cli.tempFileList) > 0:
        temp_file_name = cli.tempFileList.pop()
    else:
        temp_file_name = os.path.join(pluginDir, ".tmpbuf"+str(cli.tmpseq))
        cli.tmpseq += 1
    cli.tempFileMap[seq] = temp_file_name
    return temp_file_name

# write the buffer of view to a temporary file and have the server reload it
def reloadBuffer(view, clientInfo=None):
   if not view.is_loading():
      tmpfileName = getTempFileName()
      tmpfile = codecs.open(tmpfileName, "w", "utf-8")
      text = view.substr(sublime.Region(0, view.size()))
      tmpfile.write(text)
      tmpfile.flush()
      cli.service.reloadAsync(view.file_name(), tmpfileName, recv_reload_response)
      if not cli.ST2():
         if not clientInfo:
            clientInfo = cli.getOrAddFile(view.file_name())
         clientInfo.changeCount = view.change_count()
         clientInfo.pendingChanges = False

# if we have changes to the view not accounted for by change messages, 
# send the whole buffer through a temporary file
def checkUpdateView(view):
    if is_typescript(view):
        clientInfo = cli.getOrAddFile(view.file_name())
        if cli.reloadRequired(view):
            reloadBuffer(view, clientInfo)


# singleton that receives event calls from Sublime
class TypeScriptListener(sublime_plugin.EventListener):
    def __init__(self):
        self.fileMap = {}
        self.pendingCompletions = []
        self.completionsReady = False
        self.completionView = None
        self.mruFileList = []
        self.pendingTimeout = 0
        self.pendingSelectionTimeout = 0
        self.errRefreshRequested = False
        self.changeFocus = False
        self.mod = False
        self.about_to_close_all = False
        self.was_paren_pressed = False

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
                    open_file(view)
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
        logger.view_debug(view, "enter on_activated " + str(view.id()))
        if is_special_view(view):
            if TypescriptNavToCommand.navto_panel_started:
                # The current view is the QuickPanel. Set insert_text_finished to false to suppress 
                # handling in on_modified
                TypescriptNavToCommand.insert_text_finished = False
                view.run_command("insert", {"characters": TypescriptNavToCommand.input_text})
                # Re-enable the handling in on_modified
                TypescriptNavToCommand.insert_text_finished = True

        if not self.about_to_close_all:
            info = self.getInfo(view)
            if info:
                info.lastCompletionLoc = None
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
        logger.view_debug(view, "exit on_activated " + str(view.id()))

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
        if (os.name == 'nt') and filename:
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
                        (l, c) = extractLineOffset(startlc)
                        (endl, endc) = extractLineOffset(endlc)
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
        logger.view_debug(view, "enter on_load")
        clientInfo = cli.getOrAddFile(view.file_name())

        # reset the "close_all" flag when open new files
        if self.about_to_close_all:
            self.about_to_close_all = False

        print("loaded " + view.file_name())
        if clientInfo and clientInfo.renameOnLoad:
            view.run_command('typescript_delayed_rename_file',
                             { "locsName" : clientInfo.renameOnLoad })
            clientInfo.renameOnLoad = None
        logger.view_debug(view, "exit on_load")

    def on_window_command(self, window, command_name, args):
        # logger.log.debug("notice window command: " + command_name)
        if command_name in ["close_all", "exit", "close_window", "close_project"]:
            self.about_to_close_all = True
        
    # ST3 only
    # for certain text commands, learn what changed and notify the
    # server, to avoid sending the whole buffer during completion
    # or when key can be held down and repeated
    # called by ST3 for some, but not all, text commands
    def on_text_command(self, view, command_name, args):
        # If we had a popup session active, and we get the command to hide it,
        # then do the necessary clean up
        if command_name == 'hide_popup':
            popup_manager.on_close_popup()

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
        ev = cli.service.getEvent()
        if ev is not None:
            self.dispatchEvent(ev)
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
        logger.view_debug(view, "enter on_close")
        if not self.about_to_close_all:
            if view.file_name() in self.mruFileList:
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
        logger.view_debug(view, "exit on_close")

    # called by Sublime when the cursor moves (or when text is selected)
    # called after on_modified (when on_modified is called)
    def on_selection_modified(self, view):
        if not is_typescript(view):
            return

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
            if self.mod:
                self.setOnSelectionIdleTimer(1250)
            else:
                self.setOnSelectionIdleTimer(50)
            self.mod = False    
            # hide the doc info output panel if it's up
            panelView = sublime.active_window().get_output_panel("doc")
            if panelView.window():
                sublime.active_window().run_command("hide_panel", { "cancel" : True })

        if TOOLTIP_SUPPORT:
            # Always reset this flag
            _paren_pressed = self.was_paren_pressed
            self.was_paren_pressed = False

            if popup_manager.is_active():
                popup_manager.queue_signature_popup(view)
            else:
                if _paren_pressed:
                    # TODO: Check 'typescript_auto_popup' setting is True
                    logger.log.debug('Triggering popup of sig help on paren')
                    popup_manager.queue_signature_popup(view)

    # usually called by Sublime when the buffer is modified
    # not called for undo, redo
    def on_modified(self, view):
        logger.log.debug("enter on_modified " + str(view.id()))
        # it is a special view
        if is_special_view(view):
            logger.log.debug("enter on_modified: special view. started: %s, insert_text_finished: %s" % 
                   (TypescriptNavToCommand.navto_panel_started, TypescriptNavToCommand.insert_text_finished))

            if TypescriptNavToCommand.navto_panel_started and TypescriptNavToCommand.insert_text_finished:
                new_content = view.substr(sublime.Region(0, view.size()))
                sublime.active_window().run_command("hide_overlay")
                sublime.set_timeout(
                    lambda:sublime.active_window().run_command("typescript_nav_to", {'input_text': new_content}),
                    0)

            logger.log.debug("exit on_modified: special view. started: %s, insert_text_finished: %s" % 
                   (TypescriptNavToCommand.navto_panel_started, TypescriptNavToCommand.insert_text_finished))
        # it is a normal view
        else:
            info = self.getInfo(view)
            if info:
                info.modified = True
                if cli.ST2():
                   info.modCount+=1
                info.lastModChangeCount = self.change_count(view)
                self.mod = True
                (lastCommand, args, rept) = view.command_history(0)
    #            print("modified " + view.file_name() + " command " + lastCommand + " args " + str(args) + " rept " + str(rept))
                if info.preChangeSent:
                    # change handled in on_text_command
                    info.clientInfo.changeCount = self.change_count(view)
                    info.preChangeSent = False
                elif lastCommand == "insert":
                    if (not "\n" in args['characters']) and info.prevSel and (len(info.prevSel) == 1) and (info.prevSel[0].empty()) and (not info.clientInfo.pendingChanges):
                        info.clientInfo.changeCount = self.change_count(view)
                        prevCursor = info.prevSel[0].begin()
                        cursor = view.sel()[0].begin()
                        key = view.substr(sublime.Region(prevCursor, cursor))
                        sendReplaceChangesForRegions(view, staticRegionsToRegions(info.prevSel), key)
                        # mark change as handled so that on_post_text_command doesn't
                        # try to handle it
                        info.changeSent = True
                    else:
                        # request reload because we have strange insert
                        info.clientInfo.pendingChanges = True
                self.setOnIdleTimer(100)
        logger.log.debug("exit on_modified " + str(view.id()))

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
                if ((command_name == "commit_completion") or command_name == ("insert_best_completion")) and (len(view.sel()) == 1) and (not info.clientInfo.pendingChanges):
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
                    info.lastCompletionLoc = None
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
                    completion = (name + "\t" + rawCompletion.kind, name.replace("$", "\\$"))
                    completions.append(completion)
                self.pendingCompletions = completions
            else:
                self.pendingCompletions = []
            if not cli.ST2():
                self.completionsReady = True
                active_view().run_command('hide_auto_complete')
                self.run_auto_complete()
        else:
            self.pendingCompletions = []

    def run_auto_complete(self):
        active_view().run_command("auto_complete", {
            'disable_auto_insert': True, 
            'api_completions_only': True, 
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
            if (not self.completionsReady) or cli.ST2():
                if info.lastCompletionLoc:
                    if (((len(prefix)-1)+info.lastCompletionLoc == locations[0]) and (prefix.startswith(info.lastCompletionPrefix))):
                        return (info.lastCompletions,
                                sublime.INHIBIT_WORD_COMPLETIONS | sublime.INHIBIT_EXPLICIT_COMPLETIONS)

                location = getLocationFromPosition(view, locations[0])
                checkUpdateView(view)
                if cli.ST2():
                    cli.service.completions(view.file_name(), location, prefix, self.handleCompletionInfo)
                else:
                    cli.service.asyncCompletions(view.file_name(), location, prefix, self.handleCompletionInfo)
            completions = self.pendingCompletions
            if self.completionsReady:
                info.lastCompletions = completions
                info.lastCompletionLoc = locations[0]
                info.lastCompletionPrefix = prefix
            self.pendingCompletions = []
            self.completionsReady = False
            return (completions, sublime.INHIBIT_WORD_COMPLETIONS | sublime.INHIBIT_EXPLICIT_COMPLETIONS)

    def on_query_context(self, view, key, operator, operand, match_all):
        if key == 'is_popup_visible' and TOOLTIP_SUPPORT:
            return view.is_popup_visible()
        if key == 'paren_pressed':
            # Dummy check we never intercept, used as a notification paren was
            # pressed.  Used to automatically display signature help.
            self.was_paren_pressed = True
            return False
        if key == 'tooltip_supported':
            return TOOLTIP_SUPPORT == operand
        return None


# for debugging, send command to server to save server buffer in temp file
# TODO: safe temp file name on Windows
class TypescriptSave(sublime_plugin.TextCommand):
    def run(self, text):
        if (not is_typescript(self.view)):
            print("To run this command, please first assign a file name to the view")
            return
        cli.service.saveto(self.view.file_name(), "/tmp/curstate")

sublimeWordMask = 515

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
        wordAtSel = self.view.classify(self.view.sel()[0].begin())
        if (wordAtSel & sublimeWordMask):
            cli.service.quickInfo(self.view.file_name(), getLocationFromView(self.view), self.handleQuickInfo)
        else:
            self.view.erase_status("typescript_info")
             
    def is_enabled(self):
        return is_typescript(self.view)


class TypescriptSignaturePanel(sublime_plugin.TextCommand):
    def is_enabled(self):
        return is_typescript(self.view)

    def run(self, text):
        print('TypeScript signature panel triggered')
        self.results = []
        self.snippets = []
        cli.service.signatureHelp(self.view.file_name(),
                                  getLocationFromView(self.view), '',
                                  self.on_results)
        if self.results:
            self.view.window().show_quick_panel(self.results, self.on_selected)

    def on_results(self, completionsResp):
        if not completionsResp.success or not completionsResp.body:
            return

        def get_text_from_parts(displayParts):
            result = ""
            if displayParts:
                for part in displayParts:
                    result += part.text
            return result

        for signature in completionsResp.body.items:
            signatureText = get_text_from_parts(signature.prefixDisplayParts)
            snippetText = ""
            paramIdx = 1

            if signature.parameters:
                for param in signature.parameters:
                    if paramIdx > 1:
                        signatureText += ", "
                        snippetText += ", "

                    paramText = ""
                    paramText += get_text_from_parts(param.displayParts)
                    signatureText += paramText
                    snippetText += "${" + str(paramIdx) + ":" + paramText + "}"
                    paramIdx += 1

            signatureText += get_text_from_parts(signature.suffixDisplayParts)
            self.results.append(signatureText)
            self.snippets.append(snippetText)

    def on_selected(self, index):
        if index == -1:
            return

        self.view.run_command('insert_snippet',
                              {"contents": self.snippets[index]})

class TypescriptSignaturePopup(sublime_plugin.TextCommand):
    def is_enabled(self):
        return TOOLTIP_SUPPORT and is_typescript(self.view)

    def run(self, edit, move=None):
        logger.log.debug('In run for signature popup with move: {0}'.format(move if move else 'None'))
        if not TOOLTIP_SUPPORT:
            return

        if move is None:
            popup_manager.queue_signature_popup(self.view)
        elif move == 'prev':
            popup_manager.move_prev()
        elif move == 'next':
            popup_manager.move_next()
        else:
            raise ValueError('Unknown arg: ' + move)


class TypescriptShowDoc(sublime_plugin.TextCommand):
    def run(self, text, infoStr="", docStr=""):
       self.view.insert(text, self.view.sel()[0].begin(), infoStr + "\n\n")
       self.view.insert(text, self.view.sel()[0].begin(), docStr)
     
# only use for short strings
def htmlEscape(str):
    return str.replace('&','&amp;').replace('<','&lt;').replace('>',"&gt;")

# command to show the doc string associated with quick info;
# re-runs quick info in case info has changed
class TypescriptQuickInfoDoc(sublime_plugin.TextCommand):
    def handleQuickInfo(self, quickInfoResp):
        if quickInfoResp.success:
            infoStr = quickInfoResp.body.displayString
            finfoStr = infoStr
            docStr = quickInfoResp.body.documentation
            if len(docStr) > 0:
                if not TOOLTIP_SUPPORT:
                    docPanel = sublime.active_window().get_output_panel("doc")
                    docPanel.run_command('typescript_show_doc', 
                                         { 'infoStr': infoStr, 
                                           'docStr': docStr })
                    docPanel.settings().set('color_scheme', "Packages/Color Scheme - Default/Blackboard.tmTheme")
                    sublime.active_window().run_command('show_panel', { 'panel': 'output.doc' })
                finfoStr = infoStr + " (^T^Q for more)"
            self.view.set_status("typescript_info", finfoStr)
            if TOOLTIP_SUPPORT:
                hinfoStr = htmlEscape(infoStr)
                hdocStr = htmlEscape(docStr)
                html = "<div>"+hinfoStr+"</div>"
                if len(docStr) > 0:
                    html += "<div>"+hdocStr+"</div>"
                self.view.show_popup(html, location = -1, max_width = 800)
        else:
            self.view.erase_status("typescript_info")

    def run(self, text):
        if (not is_typescript(self.view)):
            print("To run this command, please first assign a file name to the view")
            return
        checkUpdateView(self.view)
        wordAtSel = self.view.classify(self.view.sel()[0].begin())
        if (wordAtSel & sublimeWordMask):
            cli.service.quickInfo(self.view.file_name(), getLocationFromView(self.view), self.handleQuickInfo)
        else:
            self.view.erase_status("typescript_info")

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
                

# go to definition command
class TypescriptGoToDefinitionCommand(sublime_plugin.TextCommand):
    def run(self, text):
        if (not is_typescript(self.view)):
            print("To run this command, please first assign a file name to the view")
            return
        checkUpdateView(self.view)
        definitionResp = cli.service.definition(self.view.file_name(), getLocationFromView(self.view))
        if definitionResp.success:
            codeSpan = definitionResp.body[0] if len(definitionResp.body) > 0 else None
            if codeSpan:
                filename = codeSpan.file
                startlc = codeSpan.start
                sublime.active_window().open_file('{0}:{1}:{2}'.format(filename, startlc.line, startlc.offset),
                                                  sublime.ENCODED_POSITION)


# go to type command
class TypescriptGoToTypeCommand(sublime_plugin.TextCommand):
    def run(self, text):
        if (not is_typescript(self.view)):
            print("To run this command, please first assign a file name to the view")
            return
        checkUpdateView(self.view)
        typeResp = cli.service.type(self.view.file_name(), getLocationFromView(self.view))
        if typeResp.success:
            items = typeResp.body
            if len(items) > 0:
                codeSpan = items[0]
                filename = codeSpan.file
                startlc = codeSpan.start
                sublime.active_window().open_file('{0}:{1}:{2}'.format(filename, startlc.line or 0, startlc.offset or 0), 
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
        if (not is_typescript(self.view)):
            print("To run this command, please first assign a file name to the view")
            return
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
                sublime.active_window().show_input_panel("New name for {0}: ".format(displayName), infoLocs.info.displayName, 
                                                         on_done, None, on_cancel)


def locsToValue(locs, name):
    locsValue = []
    for loc in locs:
        locsValue.append(loc.toDict())
    return { "locs": locsValue, "name": name }

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
                    clientInfo = cli.getOrAddFile(file)
                    innerLocsValue = locsToValue(innerLocs, newName)
                    print("setting load handler for " + file)
                    clientInfo.renameOnLoad = innerLocsValue
                    activeWindow.open_file(file)
                elif renameView != self.view:
                    innerLocsValue = locsToValue(innerLocs, newName)
                    renameView.run_command('typescript_delayed_rename_file',
                                           { "locsName" : innerLocsValue })
                else:
                    for innerLoc in innerLocs:
                        startlc = innerLoc.start
                        (startl, startc) = extractLineOffset(startlc)
                        endlc = innerLoc.end
                        (endl, endc) = extractLineOffset(endlc)
                        applyEdit(text, self.view, startl, startc, endl, 
                                  endc, ntext = newName)


def extractLineOffsetFromDict(lc):
    line = lc['line'] - 1
    offset = lc['offset'] - 1
    return (line, offset)

class TypescriptDelayedRenameFile(sublime_plugin.TextCommand):
    def run(self, text, locsName = None):
        if locsName['locs'] and (len(locsName['name']) > 0):
            locs = locsName['locs']
            name = locsName['name']
            for innerLoc in locs:
                startlc = innerLoc['start']
                (startl, startc) = extractLineOffsetFromDict(startlc)
                endlc = innerLoc['end']
                (endl, endc) = extractLineOffsetFromDict(endlc)
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
        if (not is_typescript(self.view)):
            print("To run this command, please first assign a file name to the view")
            return
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


# if cursor is on reference line, go to (filename, line, offset) referenced by
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
        refView = getRefView()
        if refView:
            refInfo = cli.getRefInfo()
            line = refInfo.nextRefLine()
            pos = refView.text_point(int(line), 0)
            setCaretPos(refView, pos)
            refView.run_command('typescript_go_to_ref')


# command: go to previous reference in active references file
# TODO: generalize this to work for all types of references
class TypescriptPrevRefCommand(sublime_plugin.TextCommand):
    def run(self, text):
        refView = getRefView()
        if refView:
            refInfo = cli.getRefInfo()
            line = refInfo.prevRefLine()
            pos = refView.text_point(int(line), 0)
            setCaretPos(refView, pos)
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
                    fileCount+=1
                    if prevFilename != "":
                        self.view.insert(text, self.view.sel()[0].begin(), "\n")
                    self.view.insert(text, self.view.sel()[0].begin(), filename + ":\n")
                    prevFilename = filename
                startlc = ref.start
                (l, c) = extractLineOffset(startlc)
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
        setCaretPos(self.view, self.view.text_point(2, 0))
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
            (startl, startc) = extractLineOffset(startlc)
            endlc = codeEdit.end
            (endl, endc) = extractLineOffset(endlc)
            newText = codeEdit.newText
            applyEdit(text, view, startl, startc, endl, endc, ntext=newText)


def insertText(view, edit, loc, text):
    view.insert(edit, loc, text)
    sendReplaceChangesForRegions(view, [sublime.Region(loc, loc)], text)
    if not cli.ST2():
        clientInfo = cli.getOrAddFile(view.file_name())
        clientInfo.changeCount = view.change_count()
    checkUpdateView(view)


def setCaretPos(view, pos):
    view.sel().clear()
    view.sel().add(pos)

# format on ";", "}", or "\n"; called by typing these keys in a ts file
# in the case of "\n", this is only called when no completion dialogue visible
class TypescriptFormatOnKey(sublime_plugin.TextCommand):
    def run(self, text, key = "", insertKey = True):
        if 0 == len(key):
            return
        checkUpdateView(self.view)
        loc = self.view.sel()[0].begin()
        if insertKey:
            active_view().run_command('hide_auto_complete')
            insertText(self.view, text, loc, key)
        if (not is_typescript(self.view)):
            print("To run this command, please first assign a file name to the view")
            return
        formatResp = cli.service.formatOnKey(self.view.file_name(), getLocationFromView(self.view), key)
        if formatResp.success:
            codeEdits = formatResp.body
            applyFormattingChanges(text, self.view, codeEdits)

# format a range of locations in the view
def formatRange(text, view, begin, end):
    if (not is_typescript(view)):
        print("To run this command, please first assign a file name to the view")
        return
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
        if (not is_typescript(self.view)):
            print("To run this command, please first assign a file name to the view")
            return
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
        if (not is_typescript(self.view)):
            print("To run this command, please first assign a file name to the view")
            return
        checkUpdateView(self.view)
        sel=self.view.sel()
        if (len(sel) == 1):
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
        if (not is_typescript(view)):
            print("To run this command, please first assign a file name to the view")
            return
        checkUpdateView(view)
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


class TypescriptNavToCommand(sublime_plugin.WindowCommand):

    navto_panel_started = False

    # indicate if the insert_text command has finished pasting text into the textbox.
    # during which time the on_modified callback shouldn't run
    insert_text_finished = False
    input_text = ""

    @classmethod
    def reset(cls):
        cls.navto_panel_started = False
        cls.insert_text_finished = False

    def is_enabled(self):
        return is_typescript(self.window.active_view())

    def run(self, input_text = ""):
        logger.log.debug("start running navto with text: %s" % input_text)
        
        TypescriptNavToCommand.reset()
        TypescriptNavToCommand.input_text = input_text        
        TypescriptNavToCommand.navto_panel_started = True

        # Text used for querying is not always equal to the input text. This is because the quick 
        # panel will disappear if an empty list is provided, and we want to avoid this. Therefore
        # when some input text that will result in empty results is given (for example, empty 
        # string), we use alternative text to ensure the panel stay active
        query_text = "a" if input_text == "" else input_text
        items = cli.service.navTo(query_text, self.window.active_view().file_name())
        self.items = items if len(items) != 0 else self.items

        self.window.show_quick_panel(self.format_navto_result(self.items), self.on_done)  
        logger.log.debug("end running navto with text: %s" % input_text)
        
    def on_done(self, index):
        TypescriptNavToCommand.reset()

        if index >= 0:
            item = self.items[index]
            line, offset = item['start']['line'], item['start']['offset']
            file_at_location = item['file'] + ":%s:%s" % (line, offset)
            self.window.open_file(file_at_location, sublime.ENCODED_POSITION)
            
    def format_navto_result(self, item_list):
        def get_description_str(i):
            name = i["name"]
            kind = i["kind"]
            container_kind = i["containerKind"] if "containerKind" in i else os.path.basename(i["file"]) + " (global)"
            container_name = i["containerName"] if "containerName" in i else ""
            description_str = "{0} in {1} {2}".format(kind, container_kind, container_name)
            return [name, description_str]

        return [ get_description_str(i) for i in item_list]

    def on_highlight(self, index):
        pass

class TypescriptAutoIndentOnEnterBetweenCurlyBrackets(sublime_plugin.TextCommand):
    """
    handle the case of hitting enter between {} to auto indent and format
    """
    def run(self, text):
        view = self.view
        if (not is_typescript(view)):
            print("To run this command, please first assign a file name to the view")
            return
        view.run_command('typescript_format_on_key', { "key": "\n" });
        loc = view.sel()[0].begin()
        rowOffset = view.rowcol(loc)
        tabSize = view.settings().get('tab_size')
        braceOffset = rowOffset[1]
        ws = ""
        for i in range(tabSize):
           ws += ' '
        ws += "\n"
        for i in range(braceOffset):
            ws += ' '
        # insert the whitespace
        insertText(view, text, loc, ws)
        setCaretPos(view, loc + tabSize)


# this is not always called on startup by Sublime, so we call it
# from on_activated or on_close if necessary
def plugin_loaded():
    global cli, popup_manager
    print('initialize typescript...')
    print(sublime.version())
    cli = EditorClient()
    cli.setFeatures()

    if popup_manager is None and TOOLTIP_SUPPORT:
        # Full path to template file
        html_path = os.path.join(pluginDir, 'popup.html')

        # Needs to be in format such as: 'Packages/TypeScript/popup.html'
        rel_path = html_path[len(sublime.packages_path()) - len('Packages'):]
        rel_path = rel_path.replace('\\', '/')  # Yes, even on Windows

        logger.log.info('Popup resource path: {0}'.format(rel_path))
        popup_text = sublime.load_resource(rel_path)
        logger.log.info('Loaded tooltip template from {0}'.format(rel_path))

        PopupManager.html_template = Template(popup_text)
        popup_manager = PopupManager(cli.service)

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
              updateRefLine(refInfo, int(curLine), refView)
           else:
              print("no current ref line")
        else:
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
    cli.service.exit()
