import sublime_plugin

from ..libs.viewhelpers import *
from ..libs.reference import *


class TypescriptGoToTypeCommand(sublime_plugin.TextCommand):
    """Go to type command"""
    def run(self, text):
        if not is_typescript(self.view):
            print("To run this command, please first assign a file name to the view")
            return
        check_update_view(self.view)
        typeResp = cli.service.type(self.view.file_name(), get_location_from_view(self.view))
        if typeResp["success"]:
            items = typeResp["body"]
            if len(items) > 0:
                codeSpan = items[0]
                filename = codeSpan["file"]
                startlc = codeSpan["start"]
                sublime.active_window().open_file(
                    '{0}:{1}:{2}'.format(filename, startlc["line"] or 0, startlc["offset"] or 0),
                    sublime.ENCODED_POSITION
                )
