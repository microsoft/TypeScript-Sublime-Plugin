import sublime_plugin

from ..libs import *
from ..libs.viewhelpers import *
from ..libs.texthelpers import *



class TypeScriptListener(sublime_plugin.EventListener):
    """Singleton that receives event calls from Sublime"""

    def __init__(self):
        self.fileMap = {}
        self.mruFileList = []
        self.pendingTimeout = 0
        self.pendingSelectionTimeout = 0
        self.errRefreshRequested = False
        self.changeFocus = False
        self.mod = False
        self.about_to_close_all = False
        self.was_paren_pressed = False



    # called by Sublime when a view receives focus
    def on_activated(self, view):
        logger.view_debug(view, "enter on_activated " + str(view.id()))
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
                cli.service.request_get_err(errDelay, files)
            self.errRefreshRequested = True
            self.setOnIdleTimer(errDelay + 300)



    # error messages arrived from the server; show them in view
    def showErrorMsgs(self, diagEvtBody, syntactic):
        filename = diagEvtBody["file"]
        if (os.name == 'nt') and filename:
            filename = filename.replace('/', '\\')
        diags = diagEvtBody["diagnostics"]
        info = self.fileMap.get(filename)
        if info:
            view = info.view
            if not (info.change_count_err_req == self.change_count(view)):
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
        self.pendingSelectionTimeout += 1
        sublime.set_timeout(self.handleSelectionTimeout, ms)

    def handleSelectionTimeout(self):
        self.pendingSelectionTimeout -= 1
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
        self.pendingTimeout += 1
        sublime.set_timeout(self.handleTimeout, ms)

    def handleTimeout(self):
        self.pendingTimeout -= 1
        if self.pendingTimeout == 0:
            self.onIdle()

    # if file hasn't been modified for a time
    # check the event queue and dispatch any events
    def onIdle(self):
        view = active_view()
        ev = cli.service.get_event()
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
                             {"locsName": clientInfo.renameOnLoad})
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

        popup_manager = get_popup_manager()
        if command_name == 'hide_popup':
            popup_manager.on_close_popup()

        info = self.getInfo(view)
        if info:
            info.change_sent = True
            info.pre_change_sent = True
            if command_name == "left_delete":
                # backspace
                send_replace_changes_for_regions(view, self.left_expand_empty_region(view.sel()), "")
            elif command_name == "right_delete":
                # delete
                send_replace_changes_for_regions(view, self.right_expand_empty_region(view.sel()), "")
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
        ev = cli.service.get_event()
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
                # if not cli:
                #    plugin_loaded()

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

        popup_manager = get_popup_manager()
        info = self.getInfo(view)
        if info:
            if not info.client_info:
                info.client_info = cli.get_or_add_file(view.file_name())
            if (info.client_info.change_count < self.change_count(view)) and (
                        info.last_modify_change_count != self.change_count(view)):
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
                sublime.active_window().run_command("hide_panel", {"cancel": True})

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
        # logger.log.debug("enter on_modified " + str(view.id()))
        if not is_special_view(view):
            info = self.getInfo(view)
            if info:
                info.modified = True
                if IS_ST2:
                    info.modify_count += 1
                info.last_modify_change_count = self.change_count(view)
                self.mod = True
                (lastCommand, args, rept) = view.command_history(0)
                #print("modified " + view.file_name() + " command " + lastCommand + " args " + str(args) + " rept " + str(rept))
                if info.pre_change_sent:
                    # change handled in on_text_command
                    info.client_info.change_count = self.change_count(view)
                    info.pre_change_sent = False
                elif lastCommand == "insert":
                    if (not "\n" in args['characters']) and info.prev_sel and (len(info.prev_sel) == 1) and (
                            info.prev_sel[0].empty()) and (not info.client_info.pending_changes):
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
                if ((command_name == "commit_completion") or command_name == ("insert_best_completion")) and (
                            len(view.sel()) == 1) and (not info.client_info.pending_changes):
                    # get saved region that was pushed forward by insertion of
                    # the completion
                    apresCompReg = view.get_regions("apresComp")
                    # note: assuming sublime makes all regions empty for
                    # completion, which the doc claims is true
                    # insertion string is from region saved in
                    # on_query_completion to region pushed forward by
                    # completion insertion
                    insertionString = view.substr(
                        sublime.Region(info.completion_prefix_sel[0].begin(), apresCompReg[0].begin()))
                    send_replace_changes_for_regions(view, buildReplaceRegions(info.completion_prefix_sel,
                                                                               info.completion_sel), insertionString)
                    view.erase_regions("apresComp")
                    info.last_completion_loc = None
                elif ((command_name == "typescript_format_on_key") or (
                            command_name == "typescript_format_document") or (
                            command_name == "typescript_format_selection") or (command_name == "typescript_format_line") or (
                            command_name == "typescript_paste_and_format")):
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
