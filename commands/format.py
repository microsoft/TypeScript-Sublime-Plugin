import sublime_plugin

from ..libs.viewhelpers import *
from ..libs.texthelpers import *
from ..libs.reference import *


class TypescriptFormatOnKey(sublime_plugin.TextCommand):
    """
    Format on ";", "}", or "\n"; called by typing these keys in a ts file
    in the case of "\n", this is only called when no completion dialogue visible
    """
    def is_enabled(self):
        return is_typescript(self.view)

    def run(self, text, key="", insert_key=True):
        if 0 == len(key):
            return
        check_update_view(self.view)
        loc = self.view.sel()[0].begin()

        if insert_key:
            active_view().run_command('hide_auto_complete')
            insert_text(self.view, text, loc, key)

        format_response = cli.service.format_on_key(self.view.file_name(), get_location_from_view(self.view), key)
        if format_response["success"]:
            # logger.log.debug(str(formatResp))
            code_edits = format_response["body"]
            apply_formatting_changes(text, self.view, code_edits)


class TypescriptFormatSelection(sublime_plugin.TextCommand):
    """Command to format the current selection"""
    def is_enabled(self):
        return is_typescript(self.view)

    def run(self, text):
        r = self.view.sel()[0]
        format_range(text, self.view, r.begin(), r.end())


class TypescriptFormatDocument(sublime_plugin.TextCommand):
    """Command to format the entire buffer"""
    def is_enabled(self):
        return is_typescript(self.view)

    def run(self, text):
        format_range(text, self.view, 0, self.view.size())


class TypescriptFormatLine(sublime_plugin.TextCommand):
    """Command to format the current line"""
    def is_enabled(self):
        return is_typescript(self.view)

    def run(self, text):
        line_region = self.view.line(self.view.sel()[0])
        line_text = self.view.substr(line_region)
        if NON_BLANK_LINE_PATTERN.search(line_text):
            format_range(text, self.view, line_region.begin(), line_region.end())
        else:
            position = self.view.sel()[0].begin()
            cursor = self.view.rowcol(position)
            line = cursor[0]
            if line > 0:
                self.view.run_command('typescript_format_on_key', {"key": "\n", "insertKey": False});


class TypescriptFormatBrackets(sublime_plugin.TextCommand):
    def is_enabled(self):
        return is_typescript(self.view)

    def run(self, text):
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
                self.view.run_command('typescript_format_on_key', {"key": "}", "insertKey": False})
                self.view.run_command('move', {"by": "characters", "forward": True})


class TypescriptPasteAndFormat(sublime_plugin.TextCommand):
    def is_enabled(self):
        return is_typescript(self.view)

    def run(self, text):
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
        for i in range(len(regions_before_paste)):
            rb = regions_before_paste[i]
            ra = regions_after_paste[i]
            rb_line_start = view.line(rb.begin()).begin()
            ra_line_end = view.line(ra.begin()).end()
            format_range(text, view, rb_line_start, ra_line_end)
