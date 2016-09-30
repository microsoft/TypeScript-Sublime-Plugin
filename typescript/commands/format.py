from ..libs.view_helpers import *
from ..libs import log
from .base_command import TypeScriptBaseTextCommand


class TypescriptFormatOnKey(TypeScriptBaseTextCommand):
    """
    Format on ";", "}", or "\n"; called by typing these keys in a ts file
    in the case of "\n", this is only called when no completion dialogue is visible
    """
    def run(self, text, key="", insert_key=True):
        log.debug("running TypescriptFormatOnKey")

        if 0 == len(key):
            return
        check_update_view(self.view)

        format_response = cli.service.format_on_key(self.view.file_name(), get_location_from_view(self.view), key)
        if format_response["success"]:
            # logger.log.debug(str(formatResp))
            code_edits = format_response["body"]
            apply_formatting_changes(text, self.view, code_edits)


class TypescriptFormatSelection(TypeScriptBaseTextCommand):
    """Command to format the current selection"""
    def run(self, text):
        log.debug("running TypescriptFormatSelection")
        r = self.view.sel()[0]
        format_range(text, self.view, r.begin(), r.end())


class TypescriptFormatDocument(TypeScriptBaseTextCommand):
    """Command to format the entire buffer"""
    def run(self, text):
        log.debug("running TypescriptFormatDocument")
        format_range(text, self.view, 0, self.view.size())


class TypescriptFormatLine(TypeScriptBaseTextCommand):
    """Command to format the current line"""
    def run(self, text):
        log.debug("running TypescriptFormatLine")
        line_region = self.view.line(self.view.sel()[0])
        line_text = self.view.substr(line_region)
        if NON_BLANK_LINE_PATTERN.search(line_text):
            format_range(text, self.view, line_region.begin(), line_region.end())
        else:
            position = self.view.sel()[0].begin()
            line, offset = self.view.rowcol(position)
            if line > 0:
                self.view.run_command('typescript_format_on_key', {"key": "\n", "insert_key": False})


class TypescriptFormatBrackets(TypeScriptBaseTextCommand):
    def run(self, text):
        log.debug("running TypescriptFormatBrackets")
        check_update_view(self.view)
        sel = self.view.sel()
        if len(sel) == 1:
            original_pos = sel[0].begin()
            bracket_char = self.view.substr(original_pos)
            if bracket_char != "}":
                self.view.run_command('move_to', {"to": "brackets"})
                bracket_pos = self.view.sel()[0].begin()
                bracket_char = self.view.substr(bracket_pos)
            if bracket_char == "}":
                self.view.run_command('move', {"by": "characters", "forward": True})
                self.view.run_command('typescript_format_on_key', {"key": "}", "insert_key": False})
                self.view.run_command('move', {"by": "characters", "forward": True})


class TypescriptPasteAndFormat(TypeScriptBaseTextCommand):
    def is_enabled(self):
        return True

    def run(self, text):
        if is_typescript(self.view) and get_language_service_enabled():
            self._run(text)
        else:
            # fall back to default paste command
            self.view.run_command('paste')

    def _run(self, text):
        log.debug("running TypescriptPasteAndFormat")
        view = self.view
        check_update_view(view)
        regions_before_paste = regions_to_static_regions(view.sel())
        if IS_ST2:
            view.add_regions("apresPaste", copy_regions(view.sel()), "", "", sublime.HIDDEN)
        else:
            view.add_regions("apresPaste", copy_regions(view.sel()), flags=sublime.HIDDEN)
        view.run_command("paste")
        regions_after_paste = view.get_regions("apresPaste")
        view.erase_regions("apresPaste")

        for rb, ra in zip(regions_before_paste, regions_after_paste):
            line_start = view.line(rb.begin()).begin()
            line_end = view.line(ra.begin()).end()
            format_range(text, view, line_start, line_end)


class TypescriptAutoIndentOnEnterBetweenCurlyBrackets(TypeScriptBaseTextCommand):
    """
    Handle the case of hitting enter between {} to auto indent and format
    """

    def run(self, text):
        log.debug("running TypescriptAutoIndentOnEnterBetweenCurlyBrackets")
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