from ..libs.view_helpers import *
from ..libs.reference import *
from .base_command import TypeScriptBaseTextCommand


class TypescriptGoToDefinitionCommand(TypeScriptBaseTextCommand):
    """Go to definition command"""
    def run(self, text):
        check_update_view(self.view)
        definition_resp = cli.service.definition(self.view.file_name(), get_location_from_view(self.view))
        if definition_resp["success"]:
            code_span = definition_resp["body"][0] if len(definition_resp["body"]) > 0 else None
            if code_span:
                filename = code_span["file"]
                start_location = code_span["start"]
                sublime.active_window().open_file(
                    '{0}:{1}:{2}'.format(filename, start_location["line"], start_location["offset"]),
                    sublime.ENCODED_POSITION
                )
