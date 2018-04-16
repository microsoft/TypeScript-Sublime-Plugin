from ..libs.view_helpers import *
from ..libs import log
from .base_command import TypeScriptBaseTextCommand


class TypescriptOrganizeImportsCommand(TypeScriptBaseTextCommand):
    """
    Organize imports command
    """
    def run(self, text):
        log.debug("running TypescriptOrganizeImportsCommand")
        if not is_typescript(self.view):
            print("To run this command, please first assign a file name to the view")
            return
        check_update_view(self.view)
        format_response = cli.service.organize_imports(self.view.file_name())
        if format_response["success"]:
            log.debug(str(format_response["body"]))
            code_edits = format_response["body"][0]["textChanges"]
            apply_formatting_changes(text, self.view, code_edits)
