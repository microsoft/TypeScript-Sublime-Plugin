from ..libs.viewhelpers import is_typescript, insert_text, set_caret_pos
from .base_command import TypeScriptBaseTextCommand


class TypescriptAutoIndentOnEnterBetweenCurlyBrackets(TypeScriptBaseTextCommand):
    """
    handle the case of hitting enter between {} to auto indent and format
    """

    def run(self, text):
        view = self.view
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
