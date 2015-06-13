from ..libs.view_helpers import *
from ..libs.reference import *
from .base_command import TypeScriptBaseTextCommand


class TypescriptGoToTypeCommand(TypeScriptBaseTextCommand):
    """Go to type command"""
    def run(self, text):
        check_update_view(self.view)
        type_resp = cli.service.type(self.view.file_name(), get_location_from_view(self.view))
        if type_resp["success"]:
            items = type_resp["body"]
            if len(items) > 0:
                code_span = items[0]
                filename = code_span["file"]
                start_location = code_span["start"]
                sublime.active_window().open_file(
                    '{0}:{1}:{2}'.format(filename, start_location["line"], start_location["offset"]),
                    sublime.ENCODED_POSITION
                )
