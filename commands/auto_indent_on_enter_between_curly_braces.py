import sublime_plugin

from ..libs.viewhelpers import *


class TypescriptAutoIndentOnEnterBetweenCurlyBrackets(sublime_plugin.TextCommand):
    """
    handle the case of hitting enter between {} to auto indent and format
    """

    def run(self, text):
        view = self.view
        if not is_typescript(view):
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
