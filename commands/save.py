import sublime, sublime_plugin
from ..libs.viewhelpers import *


class TypescriptSave(sublime_plugin.TextCommand):
    """Save file command

    For debugging, send command to server to save server buffer in temp file
    TODO: safe temp file name on Windows
    """
    def run(self, text):
        if not is_typescript(self.view):
            print("To run this command, please first assign a file name to the view")
            return
        cli.service.save_to(self.view.file_name(), "/tmp/curstate")
