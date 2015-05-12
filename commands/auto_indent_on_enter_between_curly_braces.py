import sublime_plugin

from ..libs.viewhelpers import *


class TypescriptAutoIndentOnEnterBetweenCurlyBrackets(sublime_plugin.TextCommand):
    """
    handle the case of hitting enter between {} to auto indent and format
    """

    def run(self, text):
        print("TypescriptAutoIndentOnEnterBetweenCurlyBrackets")
        view = self.view
        if not is_typescript(view):
            print("To run this command, please first assign a file name to the view")
            return
        view.run_command('typescript_format_on_key', {"key": "\n"})
        loc = view.sel()[0].begin()
        row, offset = view.rowcol(loc)
        tab_size = view.settings().get('tab_size')
        brace_offset = offset
        ws = ""
        for i in range(tab_size):
            ws += ' '
        ws += "\n"
        for i in range(brace_offset):
            ws += ' '
        # insert the whitespace
        insert_text(view, text, loc, ws)
        set_caret_pos(view, loc + tab_size)
