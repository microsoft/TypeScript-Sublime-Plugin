import sublime_plugin

from ..libs import *
from ..libs.viewhelpers import *
from ..libs.reference import *

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
            update_ref_line(refInfo, cursor[0], self.view)
            sublime.active_window().open_file('{0}:{1}:{2}'.format(filename, l + 1 or 0, c + 1 or 0),
                                              sublime.ENCODED_POSITION)


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
            line = refInfo.prev_ref_line()
            pos = refView.text_point(int(line), 0)
            set_caret_pos(refView, pos)
            refView.run_command('typescript_go_to_ref')


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
            highlight_ids(self.view, refId)
        window.focus_view(self.view)
        set_caret_pos(self.view, self.view.text_point(2, 0))
        # serialize the reference info into the settings
        self.view.settings().set('refinfo', refInfo.asValue())
        self.view.set_read_only(True)
