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

    def __init__(self, first_line, ref_id):
        self.ref_map = {}
        self.current_ref_line = None
        self.first_line = first_line
        self.last_line = None
        self.ref_id = ref_id

    def set_last_line(self, last_Line):
        self.last_line = last_Line

    def add_mapping(self, line, target):
        self.ref_map[line] = target

    def contains_mapping(self, line):
        return line in self.ref_map

    def get_mapping(self, line):
        if line in self.ref_map:
            return self.ref_map[line]

    def get_current_mapping(self):
        if self.current_ref_line:
            return self.get_mapping(self.current_ref_line)

    def set_ref_line(self, line):
        self.current_ref_line = line

    def get_ref_line(self):
        return self.current_ref_line

    def get_ref_id(self):
        return self.ref_id

    def next_ref_line(self):
        currentMapping = self.get_current_mapping()
        if (not self.current_ref_line) or (not currentMapping):
            self.current_ref_line = self.first_line
        else:
            (filename, l, c, p, n) = currentMapping.asTuple()
            if n:
                self.current_ref_line = n
            else:
                self.current_ref_line = self.first_line
        return self.current_ref_line

    def prevRefLine(self):
        currentMapping = self.get_current_mapping()
        if (not self.current_ref_line) or (not currentMapping):
            self.current_ref_line = self.last_line
        else:
            (filename, l, c, p, n) = currentMapping.asTuple()
            if p:
                self.current_ref_line = p
            else:
                self.current_ref_line = self.last_line

        return self.current_ref_line

    def asValue(self):
        vmap = {}
        keys = self.ref_map.keys()
        for key in keys:
            vmap[key] = self.ref_map[key].asTuple()
        return (vmap, self.current_ref_line, self.first_line, self.last_line, self.ref_id)


# command currently called only from event handlers
class TypescriptQuickInfo(sublime_plugin.TextCommand):
    def handle_quick_info(self, quickinfo_resp_dict):
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
            cli.service.quickInfo(self.view.file_name(), get_location_from_view(self.view), self.handle_quick_info)
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
                                         {'infoStr': infoStr,
                                          'docStr': docStr})
                    docPanel.settings().set('color_scheme', "Packages/Color Scheme - Default/Blackboard.tmTheme")
                    sublime.active_window().run_command('show_panel', {'panel': 'output.doc'})
                finfoStr = infoStr + " (^T^Q for more)"
            self.view.set_status("typescript_info", finfoStr)
            if TOOLTIP_SUPPORT:
                hinfoStr = htmlEscape(infoStr)
                hdocStr = htmlEscape(docStr)
                html = "<div>" + hinfoStr + "</div>"
                if len(docStr) > 0:
                    html += "<div>" + hdocStr + "</div>"
                self.view.show_popup(html, location=-1, max_width=800)
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
                sublime.active_window().open_file(
                    '{0}:{1}:{2}'.format(filename, startlc["line"] or 0, startlc["offset"] or 0),
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
                self.view.run_command('typescript_finish_rename', {"argsJson": args_json_str})

            if len(outerLocs) > 0:
                sublime.active_window().show_input_panel("New name for {0}: ".format(displayName),
                                                         infoLocs["info"]["displayName"],
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
                                           {"locsName": {"locs": innerLocs, "name": newName}})
                else:
                    for innerLoc in innerLocs:
                        startlc = innerLoc["start"]
                        (startl, startc) = extract_line_offset(startlc)
                        endlc = innerLoc["end"]
                        (endl, endc) = extract_line_offset(endlc)
                        apply_edit(text, self.view, startl, startc, endl,
                                   endc, ntext=newName)


class TypescriptDelayedRenameFile(sublime_plugin.TextCommand):
    def run(self, text, locsName=None):
        if locsName['locs'] and (len(locsName['name']) > 0):
            locs = locsName['locs']
            name = locsName['name']
            for innerLoc in locs:
                startlc = innerLoc['start']
                (startl, startc) = extract_line_offset(startlc)
                endlc = innerLoc['end']
                (endl, endc) = extract_line_offset(endlc)
                apply_edit(text, self.view, startl, startc, endl,
                           endc, ntext=name)


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
            refView.run_command('typescript_populate_refs', {"argsJson": args_json_str})


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
            line = refInfo.next_ref_line()
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
                    fileCount += 1
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
                matchCount += 1
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
    def run(self, text, key="", insertKey=True):
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
            # logger.log.debug(str(formatResp))
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
                self.view.run_command('typescript_format_on_key', {"key": "\n", "insertKey": False});


class TypescriptFormatBrackets(sublime_plugin.TextCommand):
    def run(self, text):
        if (not is_typescript(self.view)):
            print("To run this command, please first assign a file name to the view")
            return
        check_update_view(self.view)
        sel = self.view.sel()
        if (len(sel) == 1):
            originalPos = sel[0].begin()
            bracketChar = self.view.substr(originalPos)
            if bracketChar != "}":
                self.view.run_command('move_to', {"to": "brackets"});
                bracketPos = self.view.sel()[0].begin()
                bracketChar = self.view.substr(bracketPos)
            if bracketChar == "}":
                self.view.run_command('move', {"by": "characters", "forward": True})
                self.view.run_command('typescript_format_on_key', {"key": "}", "insertKey": False});
                self.view.run_command('move', {"by": "characters", "forward": True})


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
            view.add_regions("apresPaste", copy_regions(view.sel()), flags=sublime.HIDDEN)
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

    def run(self, input_text=""):
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

        return [get_description_str(i) for i in item_list]

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
        view.run_command('typescript_format_on_key', {"key": "\n"});
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
            highlightIds(refView, refInfo.get_ref_id())
            curLine = refInfo.get_ref_line()
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
