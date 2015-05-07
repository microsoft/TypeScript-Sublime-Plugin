import sublime_plugin

from ..libs.viewhelpers import *
from ..libs.texthelpers import *
from ..libs.reference import *

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
        formatResp = cli.service.format_on_key(self.view.file_name(), get_location_from_view(self.view), key)
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
        if (NON_BLANK_LINE_PATTERN.search(lineText)):
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
