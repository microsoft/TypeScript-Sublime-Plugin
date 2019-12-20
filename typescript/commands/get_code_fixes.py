import sublime_plugin
from ..libs.view_helpers import *
from ..libs import log
from .base_command import TypeScriptBaseTextCommand


class ReplaceTextCommand(TypeScriptBaseTextCommand):
    """The replace_text command implementation."""

    def run(self, edit, start, end, text):
        """Replace the content of a region with new text.
        Arguments:
            edit (Edit):
                The edit object to identify this operation.
            start (int):
                The beginning of the Region to replace.
            end (int):
                The end of the Region to replace.
            text (string):
                The new text to replace the content of the Region with.
        """
        visible_region = self.view.visible_region()
        region = sublime.Region(start, end)
        text = text.replace('\r\n', '\n').replace('\r', '\n')
        self.view.replace(edit, region, text)


class TypescriptRequestCodeFixesCommand(TypeScriptBaseTextCommand):
    """
    Code Fixes command
        Get all errors in the current view
        Use errorCodes along with cursor offsets to get codeFixes
    """
    all_code_fixes = []
    all_errors = []

    def get_errors_at_cursor(self, path, cursor):
        line = cursor[0] + 1
        column = cursor[1] + 1
        errors_at_cursor = list(filter(lambda error:
                                       error['start']['line'] == line and
                                       error['end']['line'] == line and
                                       error['start']['offset'] <= column and
                                       error['end']['offset'] >= column, self.all_errors))
        return errors_at_cursor

    def handle_selection(self, idx):
        if idx == -1:
            return
        all_changes = self.all_code_fixes['body'][idx]['changes'][0]['textChanges']
        for change in all_changes:
            text = change['newText']
            if text[:1] == '\n':
                start = self.view.text_point(
                    change['start']['line'] - 1, change['start']['offset'])
                end = self.view.text_point(
                    change['end']['line'] - 1, change['end']['offset'])
            else:
                start = self.view.text_point(
                    change['start']['line'] - 1, change['start']['offset'] - 1)
                end = self.view.text_point(
                    change['end']['line'] - 1, change['end']['offset'] - 1)
            self.view.run_command(
                'replace_text', {'start': start, 'end': end, 'text': text})

    def run(self, text):
        log.debug("running TypescriptRequestCodeFixesCommand")
        if not is_typescript(self.view):
            print("To run this command, please first assign a file name to the view")
            return
        check_update_view(self.view)
        path = self.view.file_name()

        semantic_errors = cli.service.get_semantic_errors(path)
        syntactic_errors = cli.service.get_syntactic_errors(path)

        if semantic_errors['success']:
            self.all_errors = self.all_errors + semantic_errors['body']

        if syntactic_errors['success']:
            self.all_errors = self.all_errors + syntactic_errors['body']

        pos = self.view.sel()[0].begin()
        cursor = self.view.rowcol(pos)
        errors = self.get_errors_at_cursor(path, cursor)

        if len(errors):
            error_codes = list(map(lambda error: error['code'], errors))
            start_line = errors[0]['start']['line']
            end_line = errors[0]['end']['line']
            start_offset = errors[0]['start']['offset']
            end_offset = errors[0]['end']['offset']
            self.all_code_fixes = cli.service.get_code_fixes(
                path, start_line, start_offset, end_line, end_offset, error_codes)
            if self.all_code_fixes['success']:
                if len(self.all_code_fixes['body']):
                    possibleFixesDescriptions = list(
                        map(lambda fix: fix['description'], self.all_code_fixes['body']))
                    if len(possibleFixesDescriptions) == 1:
                        self.handle_selection(0)
                    else:
                        self.view.window().show_quick_panel(
                            possibleFixesDescriptions, self.handle_selection, False, -1)
