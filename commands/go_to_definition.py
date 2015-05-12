import sublime_plugin

from ..libs.viewhelpers import *
from ..libs.reference import *


class TypescriptGoToDefinitionCommand(sublime_plugin.TextCommand):
    """Go to definition command"""
    def is_enabled(self):
        return is_typescript(self.view)

    def run(self, text):
        check_update_view(self.view)
        definitionResp = cli.service.definition(self.view.file_name(), get_location_from_view(self.view))
        if definitionResp["success"]:
            codeSpan = definitionResp["body"][0] if len(definitionResp["body"]) > 0 else None
            if codeSpan:
                filename = codeSpan["file"]
                startlc = codeSpan["start"]
                sublime.active_window().open_file(
                    '{0}:{1}:{2}'.format(filename, startlc["line"], startlc["offset"]),
                    sublime.ENCODED_POSITION
                )
