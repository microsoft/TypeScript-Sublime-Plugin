import sublime, sublime_plugin
from ..libs.viewhelpers import *


class TypescriptSave(sublime_plugin.TextCommand):
    """Save file command

    For debugging, send command to server to save server buffer in temp file
    TODO: safe temp file name on Windows
    """
    def is_enabled(self):
        return is_typescript(self.view)

    def run(self, text):
        cli.service.save_to(self.view.file_name(), "/tmp/curstate")
