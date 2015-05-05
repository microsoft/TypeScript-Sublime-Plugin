import json
import os
import sys
import logging
import time
import re
import codecs
import sublime
import sublime_plugin

from string import Template
from builtins import classmethod
from .libs.servicedefs import *
from .libs.globalvars import *
from .libs import *


''' Enable logging '''
logFileLevel = logging.WARN
logConsLevel = logging.WARN

nonBlankLinePattern = re.compile("[\S]+")
validCompletionId = re.compile("[a-zA-Z_$\.][\w$\.]*\Z")

def set_log_level(logger):
    logger.logFile.setLevel(logFileLevel)
    logger.console.setLevel(logConsLevel)

def _cleanup_011():
    '''Remove any old zipped package installed by 0.1.1 release'''
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

set_log_level(logger)
logger.log.warn('TypeScript plugin initialized.')

# ST2 requires this to be done at global scope
if globalvars.LIBS_DIR not in sys.path:
    sys.path.insert(0, globalvars.LIBS_DIR)

# Enable Python Tools for visual studio remote debugging
try: 
    from ptvsd import enable_attach
    enable_attach(secret=None)
except ImportError:
    pass

# globally-accessible information singleton; set in function plugin_loaded
cli = None
popup_manager = None

# per-file, globally-accessible information
class ClientFileInfo:
    def __init__(self, filename):
        self.filename = filename
        self.pending_changes = False
        self.change_count = 0
        self.errors = {
            'syntacticDiag': [], 
            'semanticDiag': [], 
        }
        self.rename_on_load = None

class RefInfo:
    """Maps (line in view containing references) to (filename, line, offset) referenced"""
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

# singleton that receives event calls from Sublime
class TypeScriptListener(sublime_plugin.EventListener):
    def __init__(self):
        self.fileMap = {}
        self.pendingCompletions = []
        self.completionsReady = False
        self.completionsLoc = None
        self.completionRequestSeq = None
        self.completionRequestPrefix = None
        self.completionRequestLoc = None
        self.completionRequestMember = False
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
                    info.client_info = cli.get_or_add_file(view.file_name())
                    set_file_prefs(view)
                    self.fileMap[view.file_name()] = info
                    open_file(view)
                    if view.is_dirty():
                       if not view.is_loading():
                          reload_buffer(view, info.client_info)
                       else:
                          info.client_info.pending_changes = True
                    if (info in self.mruFileList):
                        self.mruFileList.remove(info)
                    self.mruFileList.append(info)
        return info
           
    def change_count(self, view):
        info = self.getInfo(view)
        if info:
            if IS_ST2:
                return info.modify_count
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
                info.last_completion_loc = None
                # save cursor in case we need to read what was inserted
                info.prev_sel = regions_to_static_regions(view.sel())
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
        if info and (self.changeFocus or (info.change_count_err_req < self.change_count(view))):
            self.changeFocus = False
            info.change_count_err_req = self.change_count(view)
            window = sublime.active_window()
            numGroups = window.num_groups()
            files = []
            for i in range(numGroups):
                groupActiveView = window.active_view_in_group(i)
                info = self.getInfo(groupActiveView)
                if info:
                    files.append(groupActiveView.file_name())
                    check_update_view(groupActiveView)
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
        filename = diagEvtBody["file"]
        if (os.name == 'nt') and filename:
           filename = filename.replace('/', '\\')
        diags = diagEvtBody["diagnostics"]
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
                clientInfo = cli.get_or_add_file(filename)
                clientInfo.errors[regionKey] = []
                errRegions = []
                if diags:
                    for diag in diags:
                        startlc = diag["start"]
                        endlc = diag["end"]
                        (l, c) = extract_line_offset(startlc)
                        (endl, endc) = extract_line_offset(endlc)
                        text = diag["text"]
                        start = view.text_point(l, c)
                        end = view.text_point(endl, endc)
                        if (end <= view.size()):
                            region = sublime.Region(start, end)
                            errRegions.append(region)
                            clientInfo.errors[regionKey].append((region, text))
                info.hasErrors = cli.has_errors(filename)
                self.update_status(view, info)
                if IS_ST2:
                   view.add_regions(regionKey, errRegions, "keyword", "", sublime.DRAW_OUTLINED)
                else:
                   view.add_regions(regionKey, errRegions, "keyword", "", 
                                    sublime.DRAW_NO_FILL + sublime.DRAW_NO_OUTLINE + sublime.DRAW_SQUIGGLY_UNDERLINE) 

    # event arrived from the server; call appropriate handler
    def dispatchEvent(self, ev):
        evtype = ev["event"]
        if evtype == 'syntaxDiag':
            self.showErrorMsgs(ev["body"], syntactic=True)
        elif evtype == 'semanticDiag':
            self.showErrorMsgs(ev["body"], syntactic=False)

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
        clientInfo = cli.get_or_add_file(view.file_name())

        # reset the "close_all" flag when open new files
        if self.about_to_close_all:
            self.about_to_close_all = False

        print("loaded " + view.file_name())
        if clientInfo and clientInfo.rename_on_load:
            view.run_command('typescript_delayed_rename_file',
                             { "locsName" : clientInfo.renameOnLoad })
            clientInfo.rename_on_load = None
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
            info.change_sent = True
            info.pre_change_sent = True
            if command_name == "left_delete":
                # backspace
                send_replace_changes_for_regions(view, self.expandEmptyLeft(view.sel()), "")
            elif command_name == "right_delete":
                # delete
                send_replace_changes_for_regions(view, self.expandEmptyRight(view.sel()), "")
            else:
                # notify on_modified and on_post_text_command events that
                # nothing was handled
                # there are multiple flags because Sublime does not always call
                # all three events
                info.pre_change_sent = False
                info.change_sent = False
                info.modified = False
                if (command_name == "commit_completion") or (command_name == "insert_best_completion"):
                    # for finished completion, remember current cursor and set
                    # a region that will be
                    # moved by the inserted text
                    info.completion_sel = copy_regions(view.sel())
                    view.add_regions("apresComp", copy_regions(view.sel()), 
                                     flags=sublime.HIDDEN)

    # update the status line with error info and quick info if no error info
    def update_status(self, view, info):
        ev = cli.service.getEvent()
        if ev is not None:
            self.dispatchEvent(ev)
        if info.has_errors:
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
                    cli.dispose_ref_info()
                else:
                    info = self.getInfo(view)
                if info:
                    if (info in self.mruFileList):
                        self.mruFileList.remove(info)
                    # make sure we know the latest state of the file
                    reload_buffer(view, info.client_info)
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
            if not info.client_info:
                info.client_info = cli.get_or_add_file(view.file_name())
            if (info.client_info.change_count < self.change_count(view)) and (info.last_modify_change_count != self.change_count(view)):
                # detected a change to the view for which Sublime did not call
                # on_modified
                # and for which we have no hope of discerning what changed
                info.client_info.pending_changes = True
            # save the current cursor position so that we can see (in
            # on_modified) what was inserted
            info.prev_sel = regions_to_static_regions(view.sel())
            if self.mod:
                # backspace past start of completion
                if info.last_completion_loc and (info.last_completion_loc > view.sel()[0].begin()):
                    view.run_command('hide_auto_complete')
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
#        logger.log.debug("enter on_modified " + str(view.id()))
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
                if IS_ST2:
                   info.modify_count+=1
                info.last_modify_change_count = self.change_count(view)
                self.mod = True
                (lastCommand, args, rept) = view.command_history(0)
    #            print("modified " + view.file_name() + " command " + lastCommand + " args " + str(args) + " rept " + str(rept))
                if info.pre_change_sent:
                    # change handled in on_text_command
                    info.client_info.change_count = self.change_count(view)
                    info.pre_change_sent = False
                elif lastCommand == "insert":
                    if (not "\n" in args['characters']) and info.prev_sel and (len(info.prev_sel) == 1) and (info.prev_sel[0].empty()) and (not info.client_info.pending_changes):
                        info.client_info.change_count = self.change_count(view)
                        prevCursor = info.prev_sel[0].begin()
                        cursor = view.sel()[0].begin()
                        key = view.substr(sublime.Region(prevCursor, cursor))
                        send_replace_changes_for_regions(view, static_regions_to_regions(info.prev_sel), key)
                        # mark change as handled so that on_post_text_command doesn't
                        # try to handle it
                        info.change_sent = True
                    else:
                        # request reload because we have strange insert
                        info.client_info.pending_changes = True
                self.setOnIdleTimer(100)
#        logger.log.debug("exit on_modified " + str(view.id()))

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
            if (not info.change_sent) and info.modified:
                # file is modified but on_text_command and on_modified did not
                # handle it
                # handle insertion of string from completion menu, so that
                # it is fast to type completedName1.completedName2 (avoid a lag
                # when completedName1 is committed)
                if ((command_name == "commit_completion") or command_name == ("insert_best_completion")) and (len(view.sel()) == 1) and (not info.client_info.pending_changes):
                    # get saved region that was pushed forward by insertion of
                    # the completion
                    apresCompReg = view.get_regions("apresComp")
                    # note: assuming sublime makes all regions empty for
                    # completion, which the doc claims is true
                    # insertion string is from region saved in
                    # on_query_completion to region pushed forward by
                    # completion insertion
                    insertionString = view.substr(sublime.Region(info.completion_prefix_sel[0].begin(), apresCompReg[0].begin()))
                    send_replace_changes_for_regions(view, buildReplaceRegions(info.completion_prefix_sel, info.completion_sel), insertionString)
                    view.erase_regions("apresComp")
                    info.last_completion_loc = None
                elif ((command_name == "typescript_format_on_key") or (command_name == "typescript_format_document") or (command_name == "typescript_format_selection") or (command_name == "typescript_format_line") or (command_name == "typescript_paste_and_format")):
                     # changes were sent by the command so no need to
                     print("handled changes for " + command_name)
                else:
                    print(command_name)
                    # give up and send whole buffer to server (do this eagerly
                    # to avoid lag on next request to server)
                    reload_buffer(view, info.client_info)
                # we are up-to-date because either change was sent to server or
                # whole buffer was sent to server
                info.client_info.change_count = view.change_count()
            # reset flags and saved regions used for communication among
            # on_text_command, on_modified, on_selection_modified, 
            # on_post_text_command, and on_query_completion
            info.change_sent = False
            info.modified = False
            info.completion_sel = None

    # helper called back when completion info received from server
    def handleCompletionInfo(self, completionsResp):
        self.pendingCompletions = []
        if (not IS_ST2):
            view = active_view()
            loc = view.sel()[0].begin()
            prefixLen = len(self.completionRequestPrefix)
            str = view.substr(sublime.Region(self.completionRequestLoc-prefixLen,loc))
            if (not str.startswith(self.completionRequestPrefix)):
                return
            if (str.find(".") > 0):
                if not self.completionRequestMember:
                    print(str + " includes a dot but not req mem")
                    return
            if (len(str) > 0) and (not validCompletionId.match(str)):
                return
        if completionsResp["success"] and ((completionsResp["request_seq"] == self.completionRequestSeq) or IS_ST2):
            completions = []
            rawCompletions = completionsResp["body"]
            if rawCompletions:
                for rawCompletion in rawCompletions:
                    name = rawCompletion["name"]
                    completion = (name + "\t" + rawCompletion["kind"], name.replace("$", "\\$"))
                    completions.append(completion)
                self.pendingCompletions = completions
            if not IS_ST2:
                self.completionsReady = True
                active_view().run_command('hide_auto_complete')
                self.run_auto_complete()

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
            #print("complete with: \"" + prefix + "\" ready: " + str(self.completionsReady))
            info.completion_prefix_sel = decrease_locs_to_regions(locations, len(prefix))
            if not IS_ST2:
               view.add_regions("apresComp", decrease_locs_to_regions(locations, 0), flags=sublime.HIDDEN)
            if (not self.completionsReady) or IS_ST2:
                location = get_location_from_position(view, locations[0])
                check_update_view(view)
                if IS_ST2:
                    cli.service.completions(view.file_name(), location, prefix, self.handleCompletionInfo)
                else:
                    self.completionRequestLoc = locations[0]
                    self.completionRequestPrefix = prefix
                    self.completionRequestSeq = cli.service.seq
                    if (locations[0] > 0):
                        prevChar = view.substr(sublime.Region(locations[0]-1,locations[0]-1))
                        self.completionRequestMember = (prevChar == ".")
                    else:
                        self.completionRequestMember = False
                    cli.service.asyncCompletions(view.file_name(), location, prefix, self.handleCompletionInfo)
            completions = self.pendingCompletions
            info.last_completion_loc = locations[0]
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


# command currently called only from event handlers
class TypescriptQuickInfo(sublime_plugin.TextCommand):
    def handleQuickInfo(self, quickinfo_resp_dict):
        if quickinfo_resp_dict["success"]:
            infoStr = quickinfo_resp_dict["body"]["displayString"]
            docStr = quickinfo_resp_dict["body"]["documentation"]
            if len(docStr) > 0:
                infoStr = infoStr + " (^T^Q for more)"
            self.view.set_status("typescript_info", infoStr)
        else:
            self.view.erase_status("typescript_info")

    def run(self, text):
        check_update_view(self.view)
        wordAtSel = self.view.classify(self.view.sel()[0].begin())
        if (wordAtSel & SUBLIME_WORD_MASK):
            cli.service.quickInfo(self.view.file_name(), get_location_from_view(self.view), self.handleQuickInfo)
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
                                  get_location_from_view(self.view), '',
                                  self.on_results)
        if self.results:
            self.view.window().show_quick_panel(self.results, self.on_selected)

    def on_results(self, response_dict):
        if not response_dict["success"] or not response_dict["body"]:
            return

        def get_text_from_parts(displayParts):
            result = ""
            if displayParts:
                for part in displayParts:
                    result += part["text"]
            return result

        for signature in response_dict["body"]["items"]:
            signatureText = get_text_from_parts(signature["prefixDisplayParts"])
            snippetText = ""
            paramIdx = 1

            if signature["parameters"]:
                for param in signature["parameters"]:
                    if paramIdx > 1:
                        signatureText += ", "
                        snippetText += ", "

                    paramText = ""
                    paramText += get_text_from_parts(param["displayParts"])
                    signatureText += paramText
                    snippetText += "${" + str(paramIdx) + ":" + paramText + "}"
                    paramIdx += 1

            signatureText += get_text_from_parts(signature["suffixDisplayParts"])
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
     

# command to show the doc string associated with quick info;
# re-runs quick info in case info has changed
class TypescriptQuickInfoDoc(sublime_plugin.TextCommand):
    def handleQuickInfo(self, quickInfo_resp_dict):
        if quickInfo_resp_dict["success"]:
            infoStr = quickInfo_resp_dict["body"]["displayString"]
            finfoStr = infoStr
            docStr = quickInfo_resp_dict["body"]["documentation"]
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
        check_update_view(self.view)
        wordAtSel = self.view.classify(self.view.sel()[0].begin())
        if (wordAtSel & SUBLIME_WORD_MASK):
            cli.service.quickInfo(self.view.file_name(), get_location_from_view(self.view), self.handleQuickInfo)
        else:
            self.view.erase_status("typescript_info")

    def is_enabled(self):
        return is_typescript(self.view)


# command called from event handlers to show error text in status line
# (or to erase error text from status line if no error text for location)
class TypescriptErrorInfo(sublime_plugin.TextCommand):
    def run(self, text):
        clientInfo = cli.get_or_add_file(self.view.file_name())
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
        check_update_view(self.view)
        definitionResp = cli.service.definition(self.view.file_name(), get_location_from_view(self.view))
        if definitionResp["success"]:
            codeSpan = definitionResp["body"][0] if len(definitionResp["body"]) > 0 else None
            if codeSpan:
                filename = codeSpan["file"]
                startlc = codeSpan["start"]
                sublime.active_window().open_file('{0}:{1}:{2}'.format(filename, startlc["line"], startlc["offset"]),
                                                  sublime.ENCODED_POSITION)


# go to type command
class TypescriptGoToTypeCommand(sublime_plugin.TextCommand):
    def run(self, text):
        if (not is_typescript(self.view)):
            print("To run this command, please first assign a file name to the view")
            return
        check_update_view(self.view)
        typeResp = cli.service.type(self.view.file_name(), get_location_from_view(self.view))
        if typeResp["success"]:
            items = typeResp["body"]
            if len(items) > 0:
                codeSpan = items[0]
                filename = codeSpan["file"]
                startlc = codeSpan["start"]
                sublime.active_window().open_file('{0}:{1}:{2}'.format(filename, startlc["line"] or 0, startlc["offset"] or 0), 
                                                  sublime.ENCODED_POSITION)

# rename command
class TypescriptRenameCommand(sublime_plugin.TextCommand):
    def run(self, text):
        if (not is_typescript(self.view)):
            print("To run this command, please first assign a file name to the view")
            return
        check_update_view(self.view)
        renameResp = cli.service.rename(self.view.file_name(), get_location_from_view(self.view))
        if renameResp["success"]:
            infoLocs = renameResp["body"]
            displayName = infoLocs["info"]["fullDisplayName"]
            outerLocs = infoLocs["locs"]
            def on_cancel():
                return 
            def on_done(newName):
                args = {"newName": newName, "outerLocs": outerLocs}
                args_json_str = jsonhelpers.encode(args)
                self.view.run_command('typescript_finish_rename', { "argsJson": args_json_str })
            if len(outerLocs) > 0:
                sublime.active_window().show_input_panel("New name for {0}: ".format(displayName), infoLocs["info"]["displayName"], 
                                                         on_done, None, on_cancel)

# called from on_done handler in finish_rename command
# on_done is called by input panel for new name
class TypescriptFinishRenameCommand(sublime_plugin.TextCommand):
    def run(self, text, argsJson=""):
        args = jsonhelpers.decode(argsJson)
        newName = args["newName"]
        outerLocs = args["outerLocs"]
        if len(outerLocs) > 0:
            for outerLoc in outerLocs:
                file = outerLoc["file"]
                innerLocs = outerLoc["locs"]
                activeWindow = sublime.active_window()
                renameView = activeWindow.find_open_file(file)
                if not renameView:
                    clientInfo = cli.get_or_add_file(file)
                    clientInfo.rename_on_load = {"locs": innerLocs, "name": newName}
                    activeWindow.open_file(file)
                elif renameView != self.view:
                    renameView.run_command('typescript_delayed_rename_file',
                                           { "locsName" : {"locs": innerLocs, "name": newName}})
                else:
                    for innerLoc in innerLocs:
                        startlc = innerLoc["start"]
                        (startl, startc) = extract_line_offset(startlc)
                        endlc = innerLoc["end"]
                        (endl, endc) = extract_line_offset(endlc)
                        apply_edit(text, self.view, startl, startc, endl, 
                                  endc, ntext = newName)

class TypescriptDelayedRenameFile(sublime_plugin.TextCommand):
    def run(self, text, locsName = None):
        if locsName['locs'] and (len(locsName['name']) > 0):
            locs = locsName['locs']
            name = locsName['name']
            for innerLoc in locs:
                startlc = innerLoc['start']
                (startl, startc) = extract_line_offset(startlc)
                endlc = innerLoc['end']
                (endl, endc) = extract_line_offset(endlc)
                apply_edit(text, self.view, startl, startc, endl, 
                          endc, ntext = name)
            

# find references command
class TypescriptFindReferencesCommand(sublime_plugin.TextCommand):
    def run(self, text):
        if (not is_typescript(self.view)):
            print("To run this command, please first assign a file name to the view")
            return
        check_update_view(self.view)
        referencesResp = cli.service.references(self.view.file_name(), get_location_from_view(self.view))
        if referencesResp["success"]:
            pos = self.view.sel()[0].begin()
            cursor = self.view.rowcol(pos)
            line = str(cursor[0] + 1)
            args = {"line": line, "filename": self.view.file_name(), "referencesRespBody": referencesResp["body"]}
            args_json_str = jsonhelpers.encode(args)
            refView = get_ref_view()
            refView.run_command('typescript_populate_refs', { "argsJson": args_json_str })


# place the caret on the currently-referenced line and
# update the reference line to go to next
def updateRefLine(refInfo, curLine, view):
    view.erase_regions("curref")
    caretPos = view.text_point(curLine, 0)
    # sublime 2 doesn't support custom icons
    icon = "Packages/" + PLUGIN_NAME + "/icons/arrow-right3.png" if not IS_ST2 else ""
    view.add_regions("curref", [sublime.Region(caretPos, caretPos + 1)], 
                     "keyword", icon, 
                     sublime.HIDDEN)


# if cursor is on reference line, go to (filename, line, offset) referenced by
# that line
class TypescriptGoToRefCommand(sublime_plugin.TextCommand):
    def run(self, text):
        pos = self.view.sel()[0].begin()
        cursor = self.view.rowcol(pos)
        refInfo = cli.get_ref_info()
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
        refView = get_ref_view()
        if refView:
            refInfo = cli.get_ref_info()
            line = refInfo.nextRefLine()
            pos = refView.text_point(int(line), 0)
            set_caret_pos(refView, pos)
            refView.run_command('typescript_go_to_ref')


# command: go to previous reference in active references file
# TODO: generalize this to work for all types of references
class TypescriptPrevRefCommand(sublime_plugin.TextCommand):
    def run(self, text):
        refView = get_ref_view()
        if refView:
            refInfo = cli.get_ref_info()
            line = refInfo.prevRefLine()
            pos = refView.text_point(int(line), 0)
            set_caret_pos(refView, pos)
            refView.run_command('typescript_go_to_ref')


# highlight all occurances of refId in view
def highlightIds(view, refId):
    idRegions = view.find_all("(?<=\W)" + refId + "(?=\W)") 
    if idRegions and (len(idRegions) > 0):
       if IS_ST2:
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
        args = jsonhelpers.decode(argsJson)
        filename = args["filename"]
        line = args["line"]
        refDisplayString = args["referencesRespBody"]["symbolDisplayString"]
        refId = args["referencesRespBody"]["symbolName"]
        refs = args["referencesRespBody"]["refs"]

        fileCount = 0
        matchCount = 0
        self.view.set_read_only(False)
        # erase the caret showing the last reference followed
        self.view.erase_regions("curref")
        # clear the references buffer
        self.view.erase(text, sublime.Region(0, self.view.size()))
        header = "References to {0} \n\n".format(refDisplayString)
        self.view.insert(text, self.view.sel()[0].begin(), header)
        self.view.set_syntax_file("Packages/" + PLUGIN_NAME + "/FindRefs.hidden-tmLanguage")
        window = sublime.active_window()
        refInfo = None
        if len(refs) > 0:
            prevFilename = ""
            openview = None
            prevLine = None
            for ref in refs:
                filename = ref["file"]
                if prevFilename != filename:
                    fileCount+=1
                    if prevFilename != "":
                        self.view.insert(text, self.view.sel()[0].begin(), "\n")
                    self.view.insert(text, self.view.sel()[0].begin(), filename + ":\n")
                    prevFilename = filename
                startlc = ref["start"]
                (l, c) = extract_line_offset(startlc)
                pos = self.view.sel()[0].begin()
                cursor = self.view.rowcol(pos)
                line = str(cursor[0])
                if not refInfo:
                    refInfo = cli.init_ref_info(line, refId)
                refInfo.addMapping(line, Ref(filename, l, c, prevLine))
                if prevLine:
                    mapping = refInfo.getMapping(prevLine)
                    mapping.setNextLine(line)
                prevLine = line
                content = ref["lineText"]
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
        set_caret_pos(self.view, self.view.text_point(2, 0))
        # serialize the reference info into the settings
        self.view.settings().set('refinfo', refInfo.asValue())
        self.view.set_read_only(True)

# format on ";", "}", or "\n"; called by typing these keys in a ts file
# in the case of "\n", this is only called when no completion dialogue visible
class TypescriptFormatOnKey(sublime_plugin.TextCommand):
    def run(self, text, key = "", insertKey = True):
        if 0 == len(key):
            return
        check_update_view(self.view)
        loc = self.view.sel()[0].begin()
        if insertKey:
            active_view().run_command('hide_auto_complete')
            insert_text(self.view, text, loc, key)
        if (not is_typescript(self.view)):
            print("To run this command, please first assign a file name to the view")
            return
        formatResp = cli.service.formatOnKey(self.view.file_name(), get_location_from_view(self.view), key)
        if formatResp["success"]:
#            logger.log.debug(str(formatResp))
            codeEdits = formatResp["body"]
            apply_formatting_changes(text, self.view, codeEdits)

# command to format the current selection
class TypescriptFormatSelection(sublime_plugin.TextCommand):
    def run(self, text):
        r = self.view.sel()[0]
        format_range(text, self.view, r.begin(), r.end())

# command to format the entire buffer
class TypescriptFormatDocument(sublime_plugin.TextCommand):
    def run(self, text):
        format_range(text, self.view, 0, self.view.size())


# command to format the current line
class TypescriptFormatLine(sublime_plugin.TextCommand):
    def run(self, text):
        if (not is_typescript(self.view)):
            print("To run this command, please first assign a file name to the view")
            return
        lineRegion = self.view.line(self.view.sel()[0])
        lineText = self.view.substr(lineRegion)
        if (nonBlankLinePattern.search(lineText)):
            format_range(text, self.view, lineRegion.begin(), lineRegion.end())
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
        check_update_view(self.view)
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
        check_update_view(view)
        beforePaste = regions_to_static_regions(view.sel())
        if IS_ST2:
            view.add_regions("apresPaste", copy_regions(view.sel()), "", "", sublime.HIDDEN)
        else:
            view.add_regions("apresPaste", copy_regions(view.sel()), flags = sublime.HIDDEN)
        view.run_command("paste")
        afterPaste = view.get_regions("apresPaste")
        view.erase_regions("apresPaste")
        for i in range(len(beforePaste)):
            rb = beforePaste[i]
            ra = afterPaste[i]
            rblineStart = view.line(rb.begin()).begin()
            ralineEnd = view.line(ra.begin()).end()
            format_range(text, view, rblineStart, ralineEnd)


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
        response_dict = cli.service.navTo(query_text, self.window.active_view().file_name())
        if response_dict["success"]:
            items = response_dict["body"]
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
        insert_text(view, text, loc, ws)
        set_caret_pos(view, loc + tabSize)


# this is not always called on startup by Sublime, so we call it
# from on_activated or on_close if necessary
def plugin_loaded():
    global cli, popup_manager
    print('initialize typescript...')
    print(sublime.version())
    cli = EditorClient.get_instance()
    cli.set_features()

    if popup_manager is None and TOOLTIP_SUPPORT:
        # Full path to template file
        html_path = os.path.join(globalvars.PLUGIN_DIR, 'popup.html')

        # Needs to be in format such as: 'Packages/TypeScript/popup.html'
        rel_path = html_path[len(sublime.packages_path()) - len('Packages'):]
        rel_path = rel_path.replace('\\', '/')  # Yes, even on Windows

        logger.log.info('Popup resource path: {0}'.format(rel_path))
        popup_text = sublime.load_resource(rel_path)
        logger.log.info('Loaded tooltip template from {0}'.format(rel_path))

        PopupManager.html_template = Template(popup_text)
        popup_manager = PopupManager(cli.service)

    refView = get_ref_view(False)
    if refView:
        settings = refView.settings()
        refInfoV = settings.get('refinfo')
        if refInfoV:
           print("got refinfo from settings")
           refInfo = build_ref_info(refInfoV)
           cli.update_ref_info(refInfo)
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
    refView = get_ref_view()
    if refView:
        refInfo = cli.get_ref_info()
        if refInfo:
            refView.settings().set('refinfo', refInfo.asValue())
    cli.service.exit()
